#!/usr/bin/env node
/**
 * Multi-world tests.
 *
 * The whole premise is that one scoring engine serves several completely
 * different datasets. These assert that fiction really does run through the
 * same code path as the real world, that switching worlds keeps both sets of
 * answers, and that a world with no money and no aeroplanes doesn't render
 * controls for either.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { installDom } from './dom-shim.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const doc = installDom({
  fetchFile: async (url) => {
    const p = url instanceof URL ? fileURLToPath(url) : join(ROOT, String(url));
    try {
      const text = await readFile(p, 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(text) };
    } catch {
      return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
    }
  }
});

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    const detail = fn();
    passed++;
    console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.log(`  ✗ ${name} — ${e.message}`);
    if (process.env.VG_TRACE) console.error(e.stack);
  }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

/** Same as check(), for anything that has to wait (the search box is debounced). */
async function checkAsync(name, fn) {
  try {
    const detail = await fn();
    passed++;
    console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.log(`  ✗ ${name} — ${e.message}`);
    if (process.env.VG_TRACE) console.error(e.stack);
  }
}

const { loadAll, loadWorlds, worlds, data, activeWorld } = await import('../js/data.js');
const store = await import('../js/state.js');
const S = await import('../js/scoring.js');
const { renderSetup } = await import('../js/ui/setup.js');
const { renderCriteria } = await import('../js/ui/criteria.js');
const { renderResults } = await import('../js/ui/results.js');
const { renderDetail } = await import('../js/ui/detail.js');
const { Nd } = await import('./dom-shim.mjs');
const comps = await import('../js/ui/components.js');

const root = () => new Nd('main');
const go = () => {};

await loadWorlds();
console.log(`\nMulti-world tests — ${worlds().length} worlds registered\n`);

console.log('Both worlds load');
await loadAll('real');
const real = data();
const realCount = real.destinations.length;
await loadAll('fiction');
const fic = data();

check('fiction loads with its own criteria and destinations', () => {
  assert(activeWorld() === 'fiction', 'fiction is not the active world');
  assert(fic.destinations.length > 0, 'no fictional destinations');
  assert(fic.criteria.length > 0, 'no fictional criteria');
  const realIds = new Set(['halal', 'kosher', 'visaEase', 'flightTime']);
  const leaked = fic.criteria.filter((c) => realIds.has(c.id));
  assert(leaked.length === 0, `real-world criteria leaked in: ${leaked.map((c) => c.id).join(', ')}`);
  return `${fic.destinations.length} destinations, ${fic.criteria.length} criteria`;
});

check('fiction prices in tiers, not money', () => {
  assert(fic.usesMoney === false, 'fiction claims to use money');
  const noTier = fic.destinations.filter((d) => ![1, 2, 3].includes(d.costTier));
  assert(noTier.length === 0, `missing costTier: ${noTier.map((d) => d.id).join(', ')}`);
  const withMoney = fic.destinations.filter((d) => d.costPerDay);
  assert(withMoney.length === 0, 'a fictional place has a price per day');
  return 'all destinations use a 1-3 cost tier';
});

check('the same engine scores fiction', () => {
  const prefs = { ...S.emptyPrefs(), month: 6, maxPerCountry: 0,
    weights: { dragons: 3, monsters: 2, scenery: 2 } };
  const { results } = S.rankDestinations(fic.destinations, prefs, fic.criteriaById);
  assert(results.length === fic.destinations.length, 'not everything was scored');
  assert(results.every((r) => Number.isInteger(r.overall) && r.overall >= 0 && r.overall <= 100),
    'scores out of range');
  assert(results[0].overall > results[results.length - 1].overall, 'no ranking spread');
  return `top: ${results.slice(0, 3).map((r) => `${r.dest.name} ${r.overall}%`).join(', ')}`;
});

check('the cost tier scores monotonically', () => {
  const crit = fic.criteriaById.get('cost');
  assert(crit && crit.kind === 'tier', 'cost is not a tier criterion');
  const prefs = { ...S.emptyPrefs() };
  prefs.targets = { ...prefs.targets, costTier: 2 };
  const scores = [1, 2, 3].map((t) => S.scoreCriterion(crit, { costTier: t }, prefs).score);
  assert(scores.every((v, i) => i === 0 || scores[i - 1] >= v),
    `not monotonic: ${scores.map((v) => v.toFixed(2)).join(' → ')}`);
  return scores.map((v) => v.toFixed(2)).join(' → ');
});

console.log('\nThe fiction screens render');
check('trip screen hides money and aeroplanes', () => {
  store.update((s) => { s.world = 'fiction'; s.prefs.weights = {}; }, { persist: false });
  const r = root();
  renderSetup(r, { go });
  // Assert on the CONTROLS, not on prose — an earlier version of this test
  // failed on the word "travel style" appearing in a hint sentence.
  const labels = r.querySelectorAll('.field__label').map((n) => n.textContent);
  assert(!labels.includes('Flying from'), 'a fictional world offered a home airport');
  assert(!labels.includes('Travel style'), 'a fictional world offered a money travel style');
  assert(r.querySelectorAll('.select').length === 0, 'an airport dropdown was rendered');
  assert(/expedition/i.test(r.textContent), 'heading was not adapted for fiction');
  assert(!/£/.test(r.textContent), 'pounds sterling appeared in a fictional world');
  return `no airports, no travel style (${labels.length} fields)`;
});

check('rating cost gives a three-step control, not a slider', () => {
  store.update((s) => { s.prefs.weights = {}; }, { persist: false });
  store.setImportance('cost', 2);
  const r = root();
  renderSetup(r, { go });
  const target = r.querySelector('.crit__target');
  assert(target, 'no target control for cost');
  const opts = target.querySelectorAll('.seg__btn');
  assert(opts.length === 3, `expected 3 spending levels, got ${opts.length}`);
  assert(target.querySelectorAll('.range__input').length === 0, 'a money slider appeared');
  return opts.map((o) => o.textContent).join(' / ');
});

check('criteria list excludes the trip-owned ones', () => {
  const r = root();
  renderCriteria(r, { go });
  const heads = r.querySelectorAll('.cat__head').length;
  assert(heads > 0, 'no categories rendered');
  return `${heads} categories`;
});

check('results and detail render for fiction', () => {
  store.update((s) => { s.prefs.weights = { scenery: 3, taverns: 2, safety: 2 }; }, { persist: false });
  const res = root();
  renderResults(res, { go });
  assert(res.querySelectorAll('.card').length > 0, 'no result cards');

  const det = root();
  renderDetail(det, fic.destinations[0].id, { go });
  const t = det.textContent;
  assert(!/NaN|undefined|£0\b/.test(t), 'money leaked into a fictional detail page');
  assert(/Shoestring|Comfortable|Lavish/.test(t), 'no cost tier shown');
  return 'cards + detail clean';
});

console.log('\nWorlds stay separate');
check('each world keeps its own answers', () => {
  store.update((s) => { s.world = 'real'; s.prefs.weights = { beaches: 3 }; }, { persist: false });
  store.update((s) => { s.world = 'fiction'; s.prefs.weights = { dragons: 3 }; }, { persist: false });

  store.update((s) => { s.world = 'real'; }, { persist: false });
  assert(store.state.prefs.weights.beaches === 3, 'real world lost its answers');
  assert(store.state.prefs.weights.dragons === undefined, 'fiction leaked into the real world');

  store.update((s) => { s.world = 'fiction'; }, { persist: false });
  assert(store.state.prefs.weights.dragons === 3, 'fiction lost its answers');
  assert(store.state.prefs.weights.beaches === undefined, 'the real world leaked into fiction');
  return 'preferences, saves and comparisons are per world';
});

check('both worlds are declared in the registry with a theme', () => {
  const ids = worlds().map((w) => w.id);
  assert(ids.includes('real') && ids.includes('fiction'), `worlds are ${ids.join(', ')}`);
  const fiction = worlds().find((w) => w.id === 'fiction');
  assert(fiction.theme === 'fiction', 'fiction has no theme to switch to');
  return `${realCount} real + ${fic.destinations.length} fictional destinations`;
});

console.log('\nEvery place says where it came from');
check('fiction cards carry an info button', () => {
  store.update((s) => { s.world = 'fiction'; s.prefs = S.applyPreset(S.emptyPrefs(), fic.presets[0]); }, { persist: false });
  const r = root();
  renderResults(r, { go });
  const btns = r.querySelectorAll('.info-btn');
  assert(btns.length > 0, 'no info buttons rendered on the results cards');
  return `${btns.length} on the results screen`;
});

check('every fictional universe explains itself', () => {
  const missing = [...new Set(fic.destinations.map((d) => d.cc))].filter((cc) => !fic.sources[cc]);
  assert(missing.length === 0, `no source note for ${missing.join(', ')}`);
  const thin = Object.entries(fic.sources)
    .filter(([, v]) => !v.work || !v.creator || !v.text || String(v.text).length < 80)
    .map(([k]) => k);
  assert(thin.length === 0, `thin or incomplete source notes: ${thin.join(', ')}`);
  return `${Object.keys(fic.sources).length} works credited`;
});

check('the info panel opens, names the work, and closes', () => {
  const dest = fic.destById.get('rivendell') || fic.destinations[0];
  comps.openInfo(dest);
  const panel = doc.body.querySelector('.infosheet');
  assert(panel, 'no panel appeared in the document');
  const t = panel.textContent;
  const src = fic.sources[dest.cc];
  assert(t.includes(dest.name), 'panel does not name the place');
  assert(t.includes(src.work), `panel does not name the work (${src.work})`);
  assert(t.includes(src.creator), 'panel does not credit the creator');
  panel.querySelector('.infosheet__close').click();
  assert(!doc.body.querySelector('.infosheet'), 'panel did not close');
  return `named ${src.work}`;
});

console.log('\nBrowse lists the whole catalogue');
const browse = await import('../js/ui/browse.js');

const browseScreen = async (worldId) => {
  await loadAll(worldId);
  store.update((s) => { s.world = worldId; }, { persist: false });
  const r = root();
  browse.renderBrowse(r, { go });
  return r;
};
/** The search box is debounced, so typing has to be awaited. */
const type = async (screen, text) => {
  const box = screen.querySelector('.search');
  box.value = text;
  box.fire('input', { target: box });
  await new Promise((r) => setTimeout(r, 220));
};

await checkAsync('every destination in the world is listed', async () => {
  const out = [];
  for (const id of ['real', 'fiction']) {
    const set = id === 'real' ? real : fic;
    browse.resetBrowse();
    const rows = (await browseScreen(id)).querySelectorAll('.browse__row');
    assert(rows.length === set.destinations.length,
      `${id}: listed ${rows.length} of ${set.destinations.length}`);
    out.push(`${id} ${rows.length}`);
  }
  return out.join(' · ');
});

await checkAsync('grouping covers everything, with nothing lost', async () => {
  browse.resetBrowse();
  const r = await browseScreen('fiction');
  const heads = r.querySelectorAll('.browse__groupHead');
  const total = r.querySelectorAll('.browse__groupCount')
    .reduce((sum, n) => sum + Number(n.textContent), 0);
  assert(heads.length > 1, 'nothing was grouped');
  assert(total === fic.destinations.length, `groups total ${total}, not ${fic.destinations.length}`);
  return `${heads.length} groups, ${total} places`;
});

await checkAsync('search narrows the list', async () => {
  browse.resetBrowse();
  const r = await browseScreen('fiction');
  const before = r.querySelectorAll('.browse__row').length;
  await type(r, 'dragon');
  const after = r.querySelectorAll('.browse__row').length;
  assert(after > 0 && after < before, `search matched ${after} of ${before}`);
  return `"dragon" → ${after} of ${before}`;
});

await checkAsync('a filter chip narrows the list, and clearing restores it', async () => {
  browse.resetBrowse();
  const r = await browseScreen('fiction');
  const before = r.querySelectorAll('.browse__row').length;
  const chip = r.querySelectorAll('.browse__chip')[0];
  assert(chip, 'no filter chips rendered');
  const label = chip.textContent;
  chip.click();
  const after = r.querySelectorAll('.browse__row').length;
  assert(after > 0 && after < before, `filter "${label}" left ${after} of ${before}`);
  const clear = r.querySelectorAll('button').find((b) => b.textContent === 'Clear filters');
  assert(clear, 'no Clear filters button appeared');
  clear.click();
  assert(r.querySelectorAll('.browse__row').length === before, 'clearing did not restore the list');
  return `"${label}" → ${after} of ${before}, then restored`;
});

await checkAsync('browsing never rewrites your trip preferences', async () => {
  store.update((s) => { s.world = 'fiction'; s.prefs = S.applyPreset(S.emptyPrefs(), fic.presets[0]); }, { persist: false });
  const before = JSON.stringify(store.state.prefs);
  browse.resetBrowse();
  const r = await browseScreen('fiction');
  r.querySelectorAll('.browse__chip')[0].click();
  await type(r, 'sea');
  assert(JSON.stringify(store.state.prefs) === before, 'browse filters leaked into the saved preferences');
  return 'trip preferences untouched';
});

await checkAsync('scores appear once criteria are rated', async () => {
  store.update((s) => { s.world = 'fiction'; s.prefs = S.applyPreset(S.emptyPrefs(), fic.presets[0]); }, { persist: false });
  browse.resetBrowse();
  const pcts = (await browseScreen('fiction')).querySelectorAll('.browse__pct');
  assert(pcts.length === fic.destinations.length, `${pcts.length} scores for ${fic.destinations.length} places`);
  assert(pcts.every((p) => /^\d+%$/.test(p.textContent)), 'a score is not a percentage');
  return `${pcts.length} scored`;
});

console.log('\nFiction keeps seasons, not a calendar');
const { renderCompare } = await import('../js/ui/compare.js');

await checkAsync('the trip screen asks for a season, not a month', async () => {
  await loadAll('fiction');
  store.update((s) => { s.world = 'fiction'; }, { persist: false });
  const r = root();
  renderSetup(r, { go });
  const seasons = r.querySelectorAll('.seasons__btn').map((b) => b.querySelector('.seasons__label').textContent);
  assert(seasons.length === 4, `${seasons.length} seasons offered`);
  assert(r.querySelectorAll('.months__btn').length === 0, 'a month picker is still on the fiction trip screen');
  assert(seasons.join(' ') === 'Spring Summer Autumn Winter', seasons.join(' '));
  return seasons.join(' · ');
});

await checkAsync('trip length is gone where it does nothing', async () => {
  await loadAll('fiction');
  store.update((s) => { s.world = 'fiction'; }, { persist: false });
  const r = root();
  renderSetup(r, { go });
  // Nights only ever fed the total-cost sum, and fiction prices in tiers.
  assert(!/night/i.test(r.textContent), 'the fiction trip screen still mentions nights');

  await loadAll('real');
  store.update((s) => { s.world = 'real'; }, { persist: false });
  const r2 = root();
  renderSetup(r2, { go });
  assert(/night/i.test(r2.textContent), 'the real trip screen lost its trip length');
  return 'hidden in fiction, kept in the real world';
});

await checkAsync('no screen names a calendar month in fiction', async () => {
  await loadAll('fiction');
  store.update((s) => {
    s.world = 'fiction';
    s.prefs = S.applyPreset(S.emptyPrefs(), fic.presets[0]);
    s.compare = fic.destinations.slice(0, 3).map((d) => d.id);
  }, { persist: false });

  const months = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/;
  const screens = [
    ['trip', renderSetup], ['matches', renderResults],
    ['compare', (r, c) => renderCompare(r, c)]
  ];
  for (const [name, render] of screens) {
    const r = root();
    render(r, { go });
    const hit = months.exec(r.textContent);
    assert(!hit, `the ${name} screen says "${hit && hit[0]}"`);
  }
  const r = root();
  renderDetail(r, fic.destinations[0].id, { go });
  const hit = months.exec(r.textContent);
  assert(!hit, `the detail page says "${hit && hit[0]}"`);
  return 'trip, matches, compare and detail all clean';
});

await checkAsync('the year curve collapses to four seasons', async () => {
  await loadAll('fiction');
  store.update((s) => { s.world = 'fiction'; s.prefs = S.applyPreset(S.emptyPrefs(), fic.presets[0]); }, { persist: false });
  const r = root();
  renderDetail(r, fic.destinations[0].id, { go });
  const labels = r.querySelectorAll('.curve__month').map((n) => n.textContent);
  assert(labels.length === 4, `${labels.length} bars, expected 4`);
  assert(labels.join(' ') === 'Spring Summer Autumn Winter', labels.join(' '));

  await loadAll('real');
  store.update((s) => { s.world = 'real'; s.prefs = S.applyPreset(S.emptyPrefs(), real.presets[0]); }, { persist: false });
  const r2 = root();
  renderDetail(r2, real.destinations[0].id, { go });
  assert(r2.querySelectorAll('.curve__month').length === 12, 'the real world lost its twelve months');
  return '4 bars in fiction, 12 in the real world';
});

check('a season maps to a month the engine can score', () => {
  for (const s of S.SEASONS) {
    assert(s.months.includes(s.month), `${s.label} points outside its own months`);
    assert(S.seasonOf(s.month).id === s.id, `${s.label} does not round-trip`);
  }
  const all = S.SEASONS.flatMap((s) => s.months).sort((a, b) => a - b);
  assert(all.join() === [...Array(12).keys()].join(), 'the seasons do not cover the year exactly once');
  return 'all twelve months covered exactly once';
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) { for (const f of failures) console.error('  FAIL ' + f); process.exit(1); }
