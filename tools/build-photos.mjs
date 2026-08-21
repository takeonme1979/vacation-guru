#!/usr/bin/env node
/**
 * build-photos.mjs — turn editorial photo topics into real, credited photos.
 *
 * Each destination in the source data lists 6 topics describing what each photo
 * should SHOW ("Barceloneta beach Barcelona", "Park Güell mosaic bench"). This
 * resolves every topic against Wikimedia Commons and records the image URL plus
 * the attribution the licence requires.
 *
 *   node tools/build-photos.mjs                 resolve URLs -> data/photos.json
 *   node tools/build-photos.mjs --world fiction resolve a different world
 *   node tools/build-photos.mjs --download      also save thumbnails locally
 *   node tools/build-photos.mjs --force         re-resolve topics already done
 *   node tools/build-photos.mjs --only barcelona-es,rome-it
 *
 * Resumable: existing entries are kept unless --force, so an interrupted run
 * costs nothing to restart.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const DOWNLOAD = args.includes('--download');
const FORCE = args.includes('--force');
const ONLY = (() => {
  const i = args.indexOf('--only');
  return i >= 0 && args[i + 1] ? new Set(args[i + 1].split(',')) : null;
})();
const WORLD_ID = (() => {
  const i = args.indexOf('--world');
  return i >= 0 && args[i + 1] ? args[i + 1] : 'real';
})();

/** Resolved in main() once the world registry has been read. */
let OUT = join(ROOT, 'data', 'photos.json');
let THUMB_DIR = join(ROOT, 'assets', 'img', 'thumbs');

/**
 * Wikimedia only serves thumbnails at a fixed list of widths — anything else
 * returns HTTP 400. 480px is NOT on the list, which silently broke every card
 * image until the browser fell back to a placeholder.
 * https://w.wiki/GHai
 */
const ALLOWED_WIDTHS = [120, 250, 500, 960, 1280, 1920, 2560];
const THUMB_W = 500;      // bundled card thumbnail  (must be in ALLOWED_WIDTHS)
const FULL_W = 1280;      // streamed full-screen version (ditto)
const UA = 'VacationGuru/0.1 (offline holiday matcher; contact: local dev build)';
const MAX_ATTEMPTS = 5;

/**
 * Wikimedia throttles anonymous API traffic hard, and once it starts returning
 * 429 it keeps doing so for a while — so the pace adapts: every 429 slows all
 * subsequent requests, and a clean run gradually speeds back up.
 */
let pauseMs = 1100;
const PAUSE_MIN = 700;
const PAUSE_MAX = 6000;
const slowDown = () => { pauseMs = Math.min(PAUSE_MAX, Math.round(pauseMs * 1.6)); };
const speedUp = () => { pauseMs = Math.max(PAUSE_MIN, Math.round(pauseMs * 0.97)); };
let throttleEvents = 0;

/** Files that are technically images but never a photo of a place. */
const REJECT = /\.(svg|pdf|djvu?|ogv|webm|ogg|gif|tif|tiff)$/i;

/**
 * Internet Archive book-page uploads: "Some Title (1903) (14593364928).jpg".
 * They are scans of a page, not photographs of anything, and they flood any
 * search containing an ordinary word like "library" or "swamp".
 */
const IA_BOOK_PAGE = /\(1[5-9]\d\d\)\s*\(\d{8,}\)|\(20[01]\d\)\s*\(\d{8,}\)/;

/** Never useful in any world: schematics, heraldry, merchandise. */
const REJECT_ALWAYS = /\b(map|karte|mapa|logo|coat of arms|wappen|flag|flagge|diagram|blueprint|plan of|floor ?plan|seal|emblem|chart|graph|banner|icon|stamp|coin|postcard)\b/i;

/**
 * Rejected only where a photograph is the point. A steel engraving of Lilliput
 * is the BEST available image of Lilliput — there was never a photograph — but
 * an engraving of Barcelona is just a worse picture of somewhere you can go and
 * photograph today. Worlds declare which they want via `photoPolicy`.
 */
const REJECT_IF_PHOTO_ONLY = /\b(engraving|drawing|sketch|painting of|portrait of)\b/i;

/**
 * Satellite and orbital imagery, rejected where a photograph is the point.
 * Commons holds vast, meticulously titled collections from Copernicus, MODIS,
 * Landsat and the ISS, and they match a place name better than anything shot
 * from the ground -- so "Esperance white sand beach" resolved to an ESA view
 * of farmland from orbit, and Rangiroa to a MODIS tile. Nobody picks a holiday
 * from 400km up.
 */
const REJECT_ORBITAL = /\b(copernicus|modis|landsat|sentinel-?\d|earth from space|from space|seen from orbit|satellite (image|view)|astronaut photograph)\b|\biss[\s_-]?\d{3}|\bsts-?\d{2,3}\b|\b(nasa|iss)\b/i;

/**
 * Archive collections of genuinely old photographs. A 1959 Fortepan shot of
 * Lake Balaton is a real photograph of the right place -- and no use at all to
 * somebody deciding where to go this summer.
 */
const REJECT_ARCHIVE = /\b(fortepan|nypl|new york public library|library of congress|bundesarchiv|nationaal archief|tropenmuseum|national archives|dpla)\b/i;

/**
 * A picture of the signpost is not a picture of the place: "Reinebringen hike
 * view" resolved to a trailhead sign, "Grand Ole Opry" to a wall of plaques.
 * Allowed only when the topic asks for a sign, since some signs are landmarks.
 */
const REJECT_SIGN = /\b(sign|signs|signage|signpost|plaque|plaques)\b/i;

/** Photographs older than this are rejected where a photograph is the point. */
const OLDEST_USEFUL_YEAR = 1990;


/** Set from the world's photoPolicy once main() has read the registry. */
let ALLOW_ART = false;
const MIN_WIDTH = () => (ALLOW_ART ? 600 : 800);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const cleanUrl = (u) => (u ? String(u).split('?')[0] : '');

/**
 * Progressively simpler queries to try for one topic.
 *
 * Editorial topics are written to describe a photo ("Positano cliffside village
 * Amalfi"), but Commons search is fairly literal and has the place under plain
 * "Positano". So: try the full phrase first, then strip descriptive filler, then
 * shorten from each end. The first variant that yields a usable image wins, and
 * because it also becomes the caption, the label never over-claims what the
 * picture actually shows.
 */
const FILLER = /\b(aerial|panorama|panoramic|closeup|close-up|colourful|colorful|turquoise|golden|beautiful|scenic|stunning|dramatic|typical|famous|iconic|traditional)\b/gi;

export function queryVariants(topic) {
  const full = String(topic);
  const stripped = full.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  const words = (stripped || full).split(' ').filter(Boolean);

  // Broadening must not throw away the subject. "Elven architecture concept
  // forest" once collapsed to "Elven" — a commune in Brittany — and captioned a
  // roadside crucifix as Rivendell. Keep at least half the topic, never under
  // two words, so a shortened query always still means something.
  const floor = Math.max(2, Math.ceil(words.length / 2));

  const out = [];
  const push = (candidate) => {
    // Every query must keep a proper noun, or it stops being about a place:
    // "houses bougainvillea" would match anywhere on earth.
    if (!candidate || candidate.length < 4 || !/[A-Z]/.test(candidate)) return;
    if (candidate !== full && candidate.split(' ').filter(Boolean).length < floor) return;
    if (!out.includes(candidate)) out.push(candidate);
  };

  // The topic as written, and the same topic with descriptive filler removed,
  // are used verbatim — nothing has been guessed about them.
  push(full);
  if (stripped !== full) push(stripped);

  // Everything shorter is a guess, so it must at least be a grammatical phrase.
  // Cutting mid-phrase leaves a dangling adjective: "Giant hand small person
  // engraving" became "Giant hand small" and matched a mountain bike. Only the
  // trimmed form is offered, so a fragment that trims away to nothing is never
  // tried at all.
  //
  // Trimming trailing lowercase words only makes sense for a topic built around
  // a NAME — "Bodrum white houses" should fall back to "Bodrum". A purely
  // descriptive topic has no capitals to fall back to, so trimming it destroys
  // the subject ("Cobbled alley overhanging" would become "Cobbled"). There,
  // plain truncation is used and onTopic() is what keeps the result honest.
  const named = words.slice(1).some((w) => /^[A-Z]/.test(w));
  const shorten = named
    ? (v) => v.replace(/(\s+[a-z][\w'’-]*)+$/, '').trim()
    : (v) => v;

  if (named) {
    // A named topic can fall a long way and still mean something: "Positano
    // cliffside village Amalfi" is usefully reduced towards "Positano".
    for (let n = words.length - 1; n >= 2; n--) push(shorten(words.slice(0, n).join(' ')));
    for (let n = words.length - 1; n >= 2; n--) push(shorten(words.slice(words.length - n).join(' ')));
  } else {
    // A description has no name to fall back on, so every word dropped is a
    // word of meaning lost — and it becomes the caption. One word, no more:
    // "Norse great hall interior" may become "Norse great hall", never
    // "Norse great".
    push(words.slice(0, words.length - 1).join(' '));
  }

  return out.slice(0, 5);
}

/** Words that carry no meaning when checking whether a result is on-topic. */
const STOPWORDS = new Set([
  'the', 'and', 'with', 'from', 'into', 'over', 'under', 'near', 'above',
  'view', 'shot', 'photo', 'image', 'picture'
]);

const contentWords = (phrase) =>
  String(phrase).toLowerCase().split(/[^a-z0-9']+/i)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));

/**
 * Does this result plausibly show what was asked for?
 *
 * Commons ranks by full-text relevance across every field, so a query can come
 * back with something that shares no vocabulary at all with it: "Frozen tundra"
 * returned Lambeau Field (its nickname), "Viking hall" an arena, "Empty Italian"
 * Roger Fenton's Crimean War photograph. Requiring the result's own text to echo
 * the query catches all three, and a rejected match simply falls through to the
 * next candidate — or to an honest placeholder.
 */
/**
 * How much of the query does this text actually name, 0..1? `onTopic` asks the
 * same question of title + description + categories together, which is right
 * for rejecting nonsense but blind to WHERE the words matched. A file called
 * "Golden sands beach Varna, Bulgaria" and one called "Golden Sands, 9007,
 * Bulgaria" both pass; only the first is telling you it shows the beach.
 */
export function titleOverlap(query, title) {
  const want = contentWords(query);
  if (!want.length) return 0;
  const stem = (w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
  const hay = new Set(
    String(title).toLowerCase().split(/[^a-z0-9']+/).filter(Boolean).map(stem)
  );
  return want.filter((w) => hay.has(stem(w))).length / want.length;
}

export function onTopic(query, haystack) {
  const want = contentWords(query);
  if (!want.length) return true;
  // Whole words only. A substring test let "hand" match "handlebar", which is
  // how "Giant hand small person engraving" ended up illustrated by a mountain
  // bike. A single trailing plural is folded so "mountains" still meets
  // "mountain".
  const stem = (w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
  const hay = new Set(
    String(haystack).toLowerCase().split(/[^a-z0-9']+/).filter(Boolean).map(stem)
  );
  const hits = want.filter((w) => hay.has(stem(w))).length;
  return hits >= Math.min(2, want.length);
}

async function searchCommons(topic) {
  const params = new URLSearchParams({
    action: 'query', format: 'json',
    // maxlag is Wikimedia's documented etiquette: back off when their
    // replication is behind rather than adding to the load.
    maxlag: '5',
    generator: 'search', gsrsearch: topic, gsrnamespace: '6', gsrlimit: '12',
    prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: String(FULL_W)
  });
  const url = 'https://commons.wikimedia.org/w/api.php?' + params;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Exponential backoff with jitter, so a throttled run does not resynchronise
    // into another burst on the next attempt.
    const backoff = () => sleep(1500 * 2 ** attempt + Math.random() * 600);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });

      if (res.status === 429) {
        throttleEvents++;
        slowDown();
        // Honour the server's own guidance when it gives any.
        const retryAfter = Number(res.headers.get('retry-after'));
        await (Number.isFinite(retryAfter) && retryAfter > 0
          ? sleep(Math.min(retryAfter, 120) * 1000)
          : backoff());
        continue;
      }
      if (res.status >= 500) { await backoff(); continue; }
      if (!res.ok) return null;

      const json = await res.json();
      // A maxlag rejection arrives as HTTP 200 with an error body.
      if (json?.error?.code === 'maxlag') { slowDown(); await backoff(); continue; }
      speedUp();
      return json;
    } catch {
      await backoff();
    }
  }
  return null;
}

function pickBest(json, topic, used) {
  const pages = json?.query?.pages;
  if (!pages) return null;

  const candidates = [];
  for (const page of Object.values(pages)) {
    const title = page.title || '';
    const ii = page.imageinfo?.[0];
    if (!ii || !ii.url) continue;
    if (REJECT.test(title) || REJECT.test(ii.url)) continue;
    if (REJECT_ALWAYS.test(title)) continue;
    if (IA_BOOK_PAGE.test(title)) continue;
    if (!ALLOW_ART && REJECT_IF_PHOTO_ONLY.test(title)) continue;
    if (!ALLOW_ART && (REJECT_ORBITAL.test(title) || REJECT_ORBITAL.test(ii.url))
        && !REJECT_ORBITAL.test(topic)) continue;
    if (!ALLOW_ART && REJECT_ARCHIVE.test(title)) continue;
    if (!ALLOW_ART && REJECT_SIGN.test(title) && !REJECT_SIGN.test(topic)) continue;
    if ((ii.width || 0) < MIN_WIDTH()) continue;
    // Never hand the same file to two topics in one destination's gallery.
    if (used && used.has(title)) continue;

    const meta = ii.extmetadata || {};
    const licence = stripHtml(meta.LicenseShortName?.value);
    const artist = stripHtml(meta.Artist?.value) || 'Unknown';

    // Bulk uploaders of scanned book illustrations. In fiction these are gold —
    // a plate from an 1838 Gulliver is the primary source. Where a photograph is
    // the point they are just an old drawing of somewhere you could photograph.
    if (!ALLOW_ART && /Internet Archive Book Images|British Library|Wellcome (Images|Collection)/i.test(artist)) continue;
    // Title alone is often just "DSC08797", so read the description too.
    if (!onTopic(topic, `${title} ${stripHtml(meta.ImageDescription?.value)} `
      + `${stripHtml(meta.ObjectName?.value)} ${stripHtml(meta.Categories?.value)}`)) continue;
    // Skip anything without a clear reusable licence.
    if (!licence || /fair use|non-?free/i.test(licence)) continue;
    if (!ALLOW_ART) {
      const shot = stripHtml(meta.DateTimeOriginal?.value) || stripHtml(meta.DateTime?.value);
      const year = Number((String(shot).match(/\b(1[89]\d{2}|20\d{2})\b/) || [])[1]);
      if (year && year < OLDEST_USEFUL_YEAR) continue;
    }

    // Prefer landscape, decent resolution, and an index order that reflects
    // Commons' own relevance ranking.
    const ratio = (ii.width || 1) / (ii.height || 1);
    let score = 0;
    score += Math.min(ii.width, 4000) / 1000;
    // Book plates and frontispieces are portrait, so penalising portrait would
    // throw away most of the usable illustration in an art-allowing world.
    score += ratio >= 1.2 && ratio <= 2.2 ? 3 : ratio >= 1 ? 1 : (ALLOW_ART ? 0 : -2);
    score -= (page.index ?? 0) * 0.35;
    // A title that actually names the subject beats a vaguer file that merely
    // happens to be bigger: "Golden Sands beach Varna" was losing to a 4608px
    // panoramio shot called "Golden Sands, 9007, Bulgaria".
    score += titleOverlap(topic, title.replace(/^File:/, '')) * 4;
    if (/quality|featured/i.test(stripHtml(meta.Assessments?.value))) score += 4;

    candidates.push({
      score,
      title,
      full: cleanUrl(ii.thumburl || ii.url),
      thumbSource: ii.url,
      credit: artist,
      license: licence,
      source: ii.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
      topic
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

/** Derive a smaller rendition, snapping to a width Wikimedia will actually serve. */
function thumbUrlFor(fullUrl, width) {
  if (!fullUrl.includes('/thumb/')) return fullUrl;
  const allowed = ALLOWED_WIDTHS.includes(width)
    ? width
    : ALLOWED_WIDTHS.reduce((a, b) => (Math.abs(b - width) < Math.abs(a - width) ? b : a));
  return fullUrl.replace(/\/(\d+)px-([^/]+)$/, `/${allowed}px-$2`);
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  // Every world is built by the same pipeline, so the resolver takes one too —
  // the only difference is which directory the topics and output live in.
  const registry = JSON.parse(await readFile(join(ROOT, 'data', 'worlds.json'), 'utf8'));
  const world = registry.worlds.find((w) => w.id === WORLD_ID);
  if (!world) {
    throw new Error(`Unknown world "${WORLD_ID}" — try ${registry.worlds.map((w) => w.id).join(' or ')}`);
  }
  ALLOW_ART = world.photoPolicy === 'any';
  const DIR = join(ROOT, 'data', world.dir);
  OUT = join(DIR, 'photos.json');
  THUMB_DIR = join(ROOT, 'assets', 'img', 'thumbs', world.dir === '.' ? 'real' : world.dir);

  const destinations = JSON.parse(await readFile(join(DIR, 'destinations.json'), 'utf8'));
  console.log(`
  ${world.label}: ${destinations.length} destinations, `
    + `${destinations.reduce((n, d) => n + d.photoTopics.length, 0)} topics`
    + `  (${ALLOW_ART ? 'photographs and illustration' : 'photographs only'})
`);
  let store = { photos: {} };
  if (existsSync(OUT)) {
    try { store = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* start fresh */ }
  }
  store.photos ||= {};

  if (DOWNLOAD) await mkdir(THUMB_DIR, { recursive: true });

  const targets = destinations.filter((d) => !ONLY || ONLY.has(d.id));
  let resolved = 0, skipped = 0, failed = 0, downloaded = 0, broadened = 0;
  const misses = [];

  for (const dest of targets) {
    const existing = store.photos[dest.id] || [];
    const out = [];
    // Titles already claimed by this destination, so a broadened query
    // cannot hand the same picture to two different topics.
    const used = new Set();

    for (let i = 0; i < dest.photoTopics.length; i++) {
      const topic = dest.photoTopics[i];
      const prev = existing[i];

      if (!FORCE && prev && prev.full && (prev.wanted ?? prev.topic) === topic) {
        // photos.json stores the source URL, not the Commons title -- recover it
        // so a reused entry still reserves its file against the rest of the gallery.
        if (prev.source) {
          const t = decodeURIComponent(prev.source.split('/wiki/')[1] || '').replace(/_/g, ' ');
          if (t) used.add(t);
        }
        out.push(prev); skipped++;
        continue;
      }

      // Try the full topic, then progressively simpler queries.
      let best = null;
      let matched = topic;
      for (const variant of queryVariants(topic)) {
        const json = await searchCommons(variant);
        await sleep(pauseMs);
        const candidate = json && pickBest(json, variant, used);
        if (candidate) { best = candidate; matched = variant; break; }
      }

      if (!best) {
        failed++;
        misses.push(`${dest.id} [${i}] ${topic}`);
        out.push({ topic });                       // app falls back to a placeholder
        continue;
      }
      if (matched !== topic) broadened++;
      used.add(best.title);

      const record = {
        // Caption what we actually found, not what we hoped for.
        topic: matched,
        wanted: matched === topic ? undefined : topic,
        full: best.full,
        thumb: thumbUrlFor(best.full, THUMB_W),
        credit: best.credit,
        license: best.license,
        source: best.source
      };

      if (DOWNLOAD) {
        const file = `${dest.id}-${i}.jpg`;
        try {
          await download(record.thumb, join(THUMB_DIR, file));
          record.thumb = `assets/img/thumbs/${world.dir === '.' ? 'real' : world.dir}/${file}`;
          downloaded++;
          await sleep(120);
        } catch (e) {
          console.warn(`    could not download ${file}: ${e.message}`);
        }
      }

      out.push(record);
      resolved++;
    }

    store.photos[dest.id] = out;
    const got = out.filter((p) => p.full).length;
    console.log(`  ${got === out.length ? '✓' : '~'} ${dest.name.padEnd(28)} ${got}/${out.length}`);
    await writeFile(OUT, JSON.stringify(store, null, 1), 'utf8');   // checkpoint every destination
  }

  console.log(`\n  resolved ${resolved}, reused ${skipped}, unresolved ${failed}` +
              (DOWNLOAD ? `, downloaded ${downloaded} thumbnails` : ''));
  if (misses.length) {
    console.log('\n  Topics with no usable image — reword these in the source data:');
    for (const m of misses.slice(0, 40)) console.log('    ' + m);
    if (misses.length > 40) console.log(`    …and ${misses.length - 40} more`);
  }
  console.log(`\n  wrote ${OUT}\n`);
}

// Run only when invoked directly — this module also exports helpers for tests.
const invokedDirectly = process.argv[1] &&
  fileURLToPath(import.meta.url) === (await import('node:path')).resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
