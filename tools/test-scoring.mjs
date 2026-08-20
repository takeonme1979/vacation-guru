#!/usr/bin/env node
/**
 * Behavioural tests for the scoring engine.
 *
 * These are not unit tests of arithmetic — they assert that the recommendations
 * are actually sensible, which is the only thing that matters here. If the data
 * or the weighting drifts far enough to put a landlocked city at the top of a
 * beach search, this fails.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  rankDestinations, scoreDestination, scoreCriterion, emptyPrefs, applyPreset,
  monthCurve, estimateFlightHours, MONTHS
} from '../js/scoring.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (p) => JSON.parse(await readFile(join(ROOT, p), 'utf8'));

const criteriaDoc = await readJson('data/criteria.json');
const destinations = await readJson('data/destinations.json');
const criteriaById = new Map(criteriaDoc.criteria.map((c) => [c.id, c]));
const presets = Object.fromEntries(criteriaDoc.presets.map((p) => [p.id, p]));

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

function top(prefs, n = 5) {
  return rankDestinations(destinations, prefs, criteriaById).results.slice(0, n);
}
const names = (rs) => rs.map((r) => `${r.dest.name} ${r.overall}%`).join(', ');

console.log(`\nScoring engine tests — ${destinations.length} destinations, ${criteriaById.size} criteria\n`);

// ---------------------------------------------------------------------------
console.log('Sanity');
// ---------------------------------------------------------------------------
{
  const prefs = { ...emptyPrefs(), weights: { beaches: 2, foodScene: 2, safety: 1 }, month: 6 };
  const all = rankDestinations(destinations, { ...prefs, maxPerCountry: 0 }, criteriaById).results;

  check('every destination scores', all.length === destinations.length);
  check('all scores are 0-100 integers',
    all.every((r) => Number.isInteger(r.overall) && r.overall >= 0 && r.overall <= 100),
    all.filter((r) => !Number.isInteger(r.overall) || r.overall < 0 || r.overall > 100)
       .map((r) => r.dest.id + '=' + r.overall).slice(0, 3).join(' '));
  check('results are sorted descending when diversity is off',
    all.every((r, i) => i === 0 || all[i - 1].overall >= r.overall));

  // With the country cap on, order is deliberately not globally descending —
  // over-cap entries are demoted below everything that made the cut. Each
  // block must still be internally descending.
  const capped = rankDestinations(destinations, { ...prefs, maxPerCountry: 2 }, criteriaById).results;
  const seenCount = {};
  const primary = [], overflow = [];
  for (const r of capped) {
    const n = seenCount[r.dest.country] = (seenCount[r.dest.country] || 0) + 1;
    (n <= 2 ? primary : overflow).push(r);
  }
  check('diversity-capped results are descending within each block',
    primary.every((r, i) => i === 0 || primary[i - 1].overall >= r.overall) &&
    overflow.every((r, i) => i === 0 || overflow[i - 1].overall >= r.overall) &&
    capped.length === destinations.length,
    `${primary.length} primary + ${overflow.length} demoted`);
  check('no NaN in any breakdown',
    all.every((r) => r.breakdown.every((b) => b.score === null || Number.isFinite(b.score))));
  check('empty preferences score zero, not NaN',
    scoreDestination(destinations[0], emptyPrefs(), criteriaById).overall === 0);
}

// ---------------------------------------------------------------------------
console.log('\nDoes it recommend the right kind of place?');
// ---------------------------------------------------------------------------
{
  // Ski week in January
  const ski = { ...applyPreset(emptyPrefs(), presets['ski-week']), month: 0, maxPerCountry: 0 };
  const skiTop = top(ski, 3);
  check('ski search returns mountains in January',
    skiTop.every((r) => r.dest.ratings.skiing >= 55 || r.dest.ratings.mountains >= 80),
    names(skiTop));

  // The same search in July should collapse
  const skiJuly = { ...ski, month: 6 };
  const janBest = top(ski, 1)[0];
  const julyScoreOfSameePlace = scoreDestination(janBest.dest, skiJuly, criteriaById).overall;
  check('ski scores drop sharply in July',
    julyScoreOfSameePlace < janBest.overall - 15,
    `${janBest.dest.name}: ${janBest.overall}% in January vs ${julyScoreOfSameePlace}% in July`);

  // Beach in August
  const beach = { ...applyPreset(emptyPrefs(), presets['beach-chill']), month: 7, maxPerCountry: 0 };
  const beachTop = top(beach, 5);
  check('beach search returns places with real beaches',
    beachTop.every((r) => r.dest.ratings.beaches >= 60), names(beachTop));

  // City culture — should be cities, not islands
  const culture = { ...applyPreset(emptyPrefs(), presets['city-culture']), month: 4, maxPerCountry: 0 };
  const cultureTop = top(culture, 5);
  check('culture search returns museum/history cities',
    cultureTop.every((r) => r.dest.ratings.museums >= 55 || r.dest.ratings.historicSites >= 80),
    names(cultureTop));

  // Budget backpacking — should not return the most expensive places
  const budget = { ...applyPreset(emptyPrefs(), presets['budget-backpack']), month: 4, maxPerCountry: 0 };
  budget.targets.budgetPerDay = 60;
  budget.targets.budgetStyle = 'budget';
  const budgetTop = top(budget, 5);
  check('budget search avoids the priciest destinations',
    budgetTop.every((r) => r.dest.costPerDay.budget <= 65), names(budgetTop));

  // The cost score must fall monotonically as a destination gets pricier —
  // the under/over-budget branches have to meet, or "slightly over" can
  // outrank "comfortably under".
  const costCrit = criteriaById.get('cost');
  const probe = { ...emptyPrefs(), month: 4 };
  probe.targets = { ...probe.targets, budgetPerDay: 100, budgetStyle: 'mid' };
  const fake = (mid) => ({ costPerDay: { budget: 1, mid, luxury: mid * 2 }, priceIndex: new Array(12).fill(80) });
  const curveCost = [20, 50, 80, 100, 120, 160, 220, 300]
    .map((c) => scoreCriterion(costCrit, fake(c / (0.72 + 0.0035 * 80)), probe).score);
  check('cost score decreases monotonically across the budget boundary',
    curveCost.every((v, i) => i === 0 || curveCost[i - 1] >= v),
    curveCost.map((v) => v.toFixed(2)).join(' → '));
}

// ---------------------------------------------------------------------------
console.log('\nSeasonality');
// ---------------------------------------------------------------------------
{
  const quiet = { ...emptyPrefs(), weights: { beaches: 3, peacefulness: 3, sunshine: 2 } };
  quiet.targets.peacefulness = 20;
  quiet.targets.temperature = 26;

  const santorini = destinations.find((d) => d.id === 'santorini-gr');
  const may = scoreDestination(santorini, { ...quiet, month: 4 }, criteriaById).overall;
  const august = scoreDestination(santorini, { ...quiet, month: 7 }, criteriaById).overall;
  check('a quiet-seeker is steered away from Santorini in August',
    may > august, `May ${may}% vs August ${august}%`);

  const curve = monthCurve(santorini, quiet, criteriaById);
  check('month curve has 12 entries and a sensible best month',
    curve.curve.length === 12 && curve.best !== 7,
    `best = ${MONTHS[curve.best]}`);

  // A sun-seeker should be pushed to the Canaries rather than the Med in January
  const winterSun = { ...emptyPrefs(), month: 0, maxPerCountry: 0,
    weights: { sunshine: 3, temperature: 3, beaches: 2 } };
  winterSun.targets.temperature = 24;
  const winterTop = top(winterSun, 3);
  check('winter sun search finds warm places in January',
    winterTop.every((r) => r.dest.climate.tempHigh[0] >= 18), names(winterTop));
}

// ---------------------------------------------------------------------------
console.log('\nMust-haves and dealbreakers');
// ---------------------------------------------------------------------------
{
  const mustSki = { ...emptyPrefs(), month: 0, weights: { skiing: 3, foodScene: 1 } };
  const rome = destinations.find((d) => d.id === 'rome-it');
  const romeResult = scoreDestination(rome, mustSki, criteriaById);
  check('a must-have it cannot meet is flagged as a dealbreaker',
    romeResult.dealbreakers === 1 && romeResult.penalised,
    `Rome scored ${romeResult.overall}% with ${romeResult.dealbreakers} dealbreaker(s)`);

  const strict = { ...mustSki, strict: true };
  const strictResults = rankDestinations(destinations, strict, criteriaById);
  check('strict mode removes everything failing a must-have',
    strictResults.results.every((r) => r.dealbreakers === 0) && strictResults.strictDropped > 0,
    `${strictResults.results.length} kept, ${strictResults.strictDropped} dropped`);

  check('the dealbreaker penalty actually lowers the score',
    romeResult.overall < romeResult.rawScore,
    `${romeResult.overall}% vs raw ${romeResult.rawScore}%`);
}

// ---------------------------------------------------------------------------
console.log('\nMissing data is excluded, not scored as zero');
// ---------------------------------------------------------------------------
{
  const noHome = { ...emptyPrefs(), weights: { flightTime: 3, beaches: 1 }, home: null };
  const r = scoreDestination(destinations[0], noHome, criteriaById);
  const flight = r.breakdown.find((b) => b.id === 'flightTime');
  check('flight time with no home airport is skipped, not counted as a miss',
    flight.score === null && r.dealbreakers === 0 && r.overall > 0,
    `overall ${r.overall}%, unknowns ${r.unknowns}`);

  const madrid = destinations.find((d) => d.id === 'madrid-es');
  const seaPrefs = { ...emptyPrefs(), weights: { seaTemperature: 2 }, month: 6 };
  const seaItem = scoreDestination(madrid, seaPrefs, criteriaById)
    .breakdown.find((b) => b.id === 'seaTemperature');
  check('a landlocked city scores zero for sea temperature, not "no data"',
    seaItem.score === 0 && /landlocked/i.test(seaItem.detail), seaItem.detail);
}

// ---------------------------------------------------------------------------
console.log('\nFlight time');
// ---------------------------------------------------------------------------
{
  const lhr = { lat: 51.470, lon: -0.454 };
  const bcn = destinations.find((d) => d.id === 'barcelona-es');
  const hrs = estimateFlightHours(lhr, bcn);
  check('London to Barcelona estimates about two hours', hrs >= 1.6 && hrs <= 3.0, `${hrs}h`);

  const near = { ...emptyPrefs(), month: 5, maxPerCountry: 0,
    weights: { flightTime: 3, beaches: 2 }, home: { ...lhr, id: 'LHR', label: 'London Heathrow' } };
  near.targets.maxFlightHours = 3;
  const nearTop = top(near, 5);
  check('a 3-hour limit keeps results close to home',
    nearTop.every((r) => estimateFlightHours(lhr, r.dest) <= 4.2), names(nearTop));
}

// ---------------------------------------------------------------------------
console.log('\nFilters and diversity');
// ---------------------------------------------------------------------------
{
  const euOnly = { ...emptyPrefs(), weights: { beaches: 2, foodScene: 2 }, month: 6,
    filters: { continents: ['Europe'], excludeIds: [], types: [] } };
  const res = rankDestinations(destinations, euOnly, criteriaById);
  check('continent filter is respected',
    res.results.every((r) => r.dest.continent === 'Europe') && res.filteredOut > 0);

  const capped = { ...emptyPrefs(), weights: { beaches: 3, swimming: 2 }, month: 7, maxPerCountry: 2 };
  const first8 = top(capped, 8);
  const counts = {};
  for (const r of first8) counts[r.dest.country] = (counts[r.dest.country] || 0) + 1;
  check('country cap stops one country dominating the top results',
    Object.values(counts).every((n) => n <= 2),
    Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' '));
}

// ---------------------------------------------------------------------------
console.log('\nExplainability');
// ---------------------------------------------------------------------------
{
  const prefs = { ...applyPreset(emptyPrefs(), presets['foodie']), month: 4 };
  const best = top(prefs, 1)[0];
  check('the top result explains itself',
    best.highlights.length > 0 && best.breakdown.every((b) => typeof b.detail === 'string' && b.detail.length),
    `${best.dest.name}: ${best.highlights.map((h) => h.criterion.label).join(', ')}`);
  check('every rated criterion appears in the breakdown',
    best.breakdown.length === Object.values(prefs.weights).filter(Boolean).length);
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.error('  FAIL ' + f);
  process.exit(1);
}
