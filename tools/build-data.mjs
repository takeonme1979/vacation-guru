#!/usr/bin/env node
/**
 * build-data.mjs — merge the three authoring layers into one runtime file.
 *
 *   archetype baseline  ->  country baseline  ->  destination overrides
 *
 * Builds every world listed in data/worlds.json. Each world is a self-contained
 * dataset in its own directory:
 *
 *   <dir>/criteria.json, archetypes.json, countries.json, destinations/*.json
 *     -> <dir>/destinations.json   (what the app loads)
 *        <dir>/meta.json           (counts, coverage, build stamp)
 *
 * "countries" means the surrounding context a place inherits from — a real
 * country for the real world, a universe such as Middle-earth for fiction.
 *
 * Run with --strict to make warnings fatal (used in CI).
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A short fingerprint of some content.
 *
 * The build used to stamp `new Date()` into meta.json and into the service
 * worker's cache version. That made every build produce different bytes from
 * identical sources, which had two costs: CI could not verify that the
 * committed artefacts actually match the source, and every rebuild invalidated
 * every returning visitor's cache whether or not anything had changed.
 *
 * A content hash fixes both. The cache busts when the content differs, which is
 * the only time it should.
 */
function contentId(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}
const DATA = join(ROOT, 'data');
const STRICT = process.argv.includes('--strict');

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

/**
 * Plausible bounds per series — a typo of 710 for 71 should not reach the app.
 * A world may widen them in worlds.json: Earth ranges would reject a lava
 * planet, which is a legitimate destination in some datasets.
 */
const EARTH_CLIMATE_RANGE = {
  tempHigh:  [-45, 55],
  tempLow:   [-60, 42],
  rainDays:  [0, 31],
  sunHours:  [0, 15],
  humidity:  [5, 100],
  seaTemp:   [-2, 35],
  snowDepth: [0, 600]
};
const CLIMATE_KEYS = Object.keys(EARTH_CLIMATE_RANGE);
const REQUIRED_CLIMATE = ['tempHigh', 'tempLow', 'rainDays', 'sunHours', 'humidity'];

function checkArray(dest, name, arr, { min = -60, max = 400, required = true } = {}) {
  if (arr == null) {
    if (required) err(`${dest.id}: missing ${name}`);
    return;
  }
  if (!Array.isArray(arr) || arr.length !== 12) {
    err(`${dest.id}: ${name} must be an array of 12 (got ${Array.isArray(arr) ? arr.length : typeof arr})`);
    return;
  }
  arr.forEach((v, i) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) err(`${dest.id}: ${name}[${i}] is not a number`);
    else if (v < min || v > max) err(`${dest.id}: ${name}[${i}] = ${v} out of range ${min}..${max}`);
  });
}

async function buildWorld(world) {
  const DIR = join(DATA, world.dir);
  const CLIMATE_RANGE = { ...EARTH_CLIMATE_RANGE, ...(world.climateRange || {}) };
  const criteria = await readJson(join(DIR, 'criteria.json'));
  const archetypes = await readJson(join(DIR, 'archetypes.json'));
  const countries = await readJson(join(DIR, 'countries.json'));
  // Where each universe comes from — optional, and shown behind the ⓘ button.
  let sources = {};
  try {
    sources = (await readJson(join(DIR, 'sources.json'))).sources || {};
  } catch { /* a world need not explain itself */ }

  // Only `max`-kind criteria carry a stored 0-100 rating. Everything else is
  // computed at scoring time from climate / cost / crowd / geography.
  const ratedIds = criteria.criteria.filter((c) => c.kind === 'max').map((c) => c.id);
  const ratedSet = new Set(ratedIds);
  const allCritIds = new Set(criteria.criteria.map((c) => c.id));

  const countryKeys = countries.keyOrder;
  const countryRatings = {};
  for (const [cc, row] of Object.entries(countries.countries)) {
    if (row.length !== countryKeys.length + 1) {
      err(`country ${cc}: ${row.length - 1} values, expected ${countryKeys.length}`);
      continue;
    }
    const rec = { name: row[0], r: {} };
    countryKeys.forEach((k, i) => {
      if (!ratedSet.has(k)) err(`country keyOrder "${k}" is not a rated criterion`);
      rec.r[k] = row[i + 1];
    });
    countryRatings[cc] = rec;
  }

  for (const cc of Object.keys(sources)) {
    if (!countryRatings[cc]) err(`sources.json: "${cc}" is not a country code`);
  }

  for (const [aid, a] of Object.entries(archetypes.archetypes)) {
    for (const k of Object.keys(a.r)) {
      if (!ratedSet.has(k)) err(`archetype ${aid}: "${k}" is not a rated criterion`);
    }
  }

  // ---- load destination shards -------------------------------------------
  const files = (await readdir(join(DIR, 'destinations')))
    .filter((f) => f.endsWith('.json'))
    .sort();

  const out = [];
  const seen = new Set();

  for (const file of files) {
    const shard = await readJson(join(DIR, 'destinations', file));
    for (const d of shard.destinations || []) {
      if (!d.id) { err(`${file}: destination with no id`); continue; }
      if (seen.has(d.id)) { err(`duplicate id: ${d.id}`); continue; }
      seen.add(d.id);

      const arch = archetypes.archetypes[d.arch];
      if (!arch) { err(`${d.id}: unknown archetype "${d.arch}"`); continue; }
      const country = countryRatings[d.country];
      if (!country) { err(`${d.id}: unknown country code "${d.country}"`); continue; }

      // Reject overrides that name something the engine will never read.
      for (const k of Object.keys(d.r || {})) {
        if (!allCritIds.has(k)) err(`${d.id}: override "${k}" is not a criterion`);
        else if (!ratedSet.has(k)) err(`${d.id}: override "${k}" is computed at runtime and cannot be overridden`);
      }

      const ratings = { ...arch.r, ...country.r, ...(d.r || {}) };

      // Every rated criterion must end up with a number.
      const missing = ratedIds.filter((id) => typeof ratings[id] !== 'number');
      if (missing.length) warn(`${d.id}: no value for ${missing.length} criteria (${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}) — defaulted to 0`);
      for (const id of missing) ratings[id] = 0;
      for (const [k, v] of Object.entries(ratings)) {
        if (v < 0 || v > 100) err(`${d.id}: rating ${k} = ${v} out of range 0..100`);
      }

      // ---- climate & seasonal arrays ---------------------------------------
      const climate = d.climate || {};
      for (const k of Object.keys(climate)) {
        if (!CLIMATE_KEYS.includes(k)) err(`${d.id}: unknown climate series "${k}"`);
      }
      for (const k of CLIMATE_KEYS) {
        if (climate[k] == null && !REQUIRED_CLIMATE.includes(k)) continue;
        const [min, max] = CLIMATE_RANGE[k];
        checkArray(d, `climate.${k}`, climate[k], { min, max, required: REQUIRED_CLIMATE.includes(k) });
      }
      if (climate.tempHigh && climate.tempLow) {
        climate.tempHigh.forEach((hi, i) => {
          if (hi < climate.tempLow[i]) err(`${d.id}: tempHigh[${i}] (${hi}) below tempLow[${i}] (${climate.tempLow[i]})`);
        });
      }
      checkArray(d, 'crowd', d.crowd, { min: 0, max: 100 });
      // priceIndex only means anything under the money cost model.
      if (d.costTier === undefined) checkArray(d, 'priceIndex', d.priceIndex, { min: 0, max: 100 });
      else if (d.priceIndex) err(`${d.id}: priceIndex has no meaning alongside costTier`);

      // Two cost models: real money per day, or a three-step tier for worlds
      // where currencies are not comparable.
      if (d.costTier !== undefined) {
        if (![1, 2, 3].includes(d.costTier)) err(`${d.id}: costTier must be 1, 2 or 3`);
        if (d.cost) err(`${d.id}: has both costTier and cost — pick one model`);
      } else if (!d.cost || ['budget', 'mid', 'luxury'].some((k) => typeof d.cost[k] !== 'number')) {
        err(`${d.id}: needs either costTier (1-3) or numeric cost budget/mid/luxury`);
      } else if (!(d.cost.budget < d.cost.mid && d.cost.mid < d.cost.luxury)) {
        err(`${d.id}: cost tiers must increase (${d.cost.budget}/${d.cost.mid}/${d.cost.luxury})`);
      }

      // Gated criteria need their gating series, or they silently score zero.
      if ((ratings.skiing ?? 0) >= 40 && !climate.snowDepth) {
        err(`${d.id}: skiing is ${ratings.skiing} but there is no climate.snowDepth series, so the skiing gate would score it 0 all year`);
      }

      // Coordinates are optional: they drive flight-time scoring, which only
      // exists in worlds where you can catch a plane.
      if (d.lat !== undefined || d.lon !== undefined) {
        if (typeof d.lat !== 'number' || typeof d.lon !== 'number' ||
            Math.abs(d.lat) > 90 || Math.abs(d.lon) > 180) err(`${d.id}: bad lat/lon`);
      }
      if (!d.name) err(`${d.id}: missing name`);
      if (!d.blurb) warn(`${d.id}: no blurb`);
      // Six topics is a target, not a rule. Some places — a fictional one
      // especially — simply have fewer photographable referents than that, and
      // three real photographs beat three real photographs plus three gradients.
      // Two is the floor: below that it stops being a gallery.
      if (!Array.isArray(d.photos) || d.photos.length < 2) {
        err(`${d.id}: ${(d.photos || []).length} photo topics — need at least 2`);
      }

      out.push({
        id: d.id,
        name: d.name,
        country: country.name,
        cc: d.country,
        region: d.region || null,
        continent: d.continent,
        lat: d.lat ?? null,
        lon: d.lon ?? null,
        type: d.type,
        archetype: d.arch,
        blurb: d.blurb || '',
        about: d.about || null,
        tags: d.tags || [],
        ratings,
        climate,
        crowd: d.crowd,
        priceIndex: d.priceIndex || null,
        costPerDay: d.cost || null,
        costTier: d.costTier ?? null,
        photoTopics: d.photos || []
      });
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name));

  // ---- report -------------------------------------------------------------
  for (const w of warnings) console.warn('  warn  ' + w);
  for (const e of errors) console.error('  ERROR ' + e);

  if (errors.length || (STRICT && warnings.length)) {
    console.error(`\nBuild failed: ${errors.length} error(s), ${warnings.length} warning(s).`);
    process.exit(1);
  }

  const byContinent = {};
  const byCountry = {};
  const byType = {};
  for (const d of out) {
    byContinent[d.continent] = (byContinent[d.continent] || 0) + 1;
    byCountry[d.country] = (byCountry[d.country] || 0) + 1;
    byType[d.type] = (byType[d.type] || 0) + 1;
  }

  if (Object.keys(sources).length) {
    const noSource = [...new Set(out.map((d) => d.cc))].filter((cc) => !sources[cc]);
    for (const cc of noSource) warn(`no sources.json entry for "${cc}" — the info panel will be thin`);
  }

  const meta = {
    // Deliberately NOT a timestamp. See contentId() below: identical sources
    // must produce identical output, or nothing downstream can be checked.
    builtId: null,
    schemaVersion: 1,
    destinations: out.length,
    countries: Object.keys(byCountry).length,
    ratedCriteria: ratedIds.length,
    totalCriteria: criteria.criteria.length,
    dataPoints: out.length * ratedIds.length,
    photoTopics: out.reduce((s, d) => s + d.photoTopics.length, 0),
    byContinent,
    byType
  };

  // The id is a fingerprint of everything that went into this world, so a
  // rebuild with no source changes produces byte-identical files.
  meta.builtId = contentId([
    JSON.stringify(out),
    JSON.stringify(criteria),
    JSON.stringify(archetypes),
    JSON.stringify(countries)
  ].join(' '));

  await writeFile(join(DIR, 'destinations.json'), JSON.stringify(out), 'utf8');
  await writeFile(join(DIR, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');


  const kb = (JSON.stringify(out).length / 1024).toFixed(0);
  console.log(`\n✓ ${out.length} destinations across ${meta.countries} countries  (${kb} KB)`);
  console.log(`  ${ratedIds.length} rated criteria each = ${meta.dataPoints.toLocaleString()} data points`);
  console.log(`  ${meta.photoTopics} photo topics`);
  console.log('  ' + Object.entries(byContinent).map(([k, v]) => `${k}: ${v}`).join('  ·  '));
  return meta;
}

async function main() {
  const registry = await readJson(join(DATA, 'worlds.json'));
  const ids = [];

  for (const world of registry.worlds) {
    const meta = await buildWorld(world);
    ids.push(world.id + ':' + meta.builtId);
  }

  for (const w of warnings) console.warn('  warn  ' + w);
  for (const e of errors) console.error('  ERROR ' + e);
  if (errors.length || (STRICT && warnings.length)) {
    console.error(`
Build failed: ${errors.length} error(s), ${warnings.length} warning(s).`);
    process.exit(1);
  }

  // Stamp the service worker's cache version with this build.
  //
  // It was a hardcoded constant, so it never changed — which meant returning
  // visitors kept being served whatever data was cached on their first visit,
  // no matter how many times the catalogue was rebuilt.
  const swPath = join(ROOT, 'sw.js');
  // Every world's fingerprint, plus the shell files the worker precaches.
  const shell = await Promise.all(
    ['index.html', 'css/styles.css', 'js/main.js', 'js/scoring.js']
      .map((f) => readFile(join(ROOT, f), 'utf8').catch(() => ''))
  );
  const buildId = 'vg-' + contentId([...ids, ...shell].join(' '));
  const sw = await readFile(swPath, 'utf8');
  const stamped = sw.replace(/const CACHE_VERSION = '[^']*';/,
    `const CACHE_VERSION = '${buildId}';`);
  if (stamped === sw && !sw.includes(buildId)) {
    warn('could not stamp CACHE_VERSION into sw.js — stale data may be served to returning visitors');
  }
  await writeFile(swPath, stamped, 'utf8');
  if (warnings.length) console.log(`
  (${warnings.length} warning${warnings.length === 1 ? '' : 's'})`);
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
