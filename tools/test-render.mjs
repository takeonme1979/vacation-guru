#!/usr/bin/env node
/**
 * Render smoke tests.
 *
 * The UI is plain DOM built through one `h()` helper, which means a very small
 * DOM shim is enough to actually RENDER every screen in Node and click things —
 * catching the class of bug a syntax check never will (undefined properties,
 * bad handlers, missing data fields) without needing a browser or Puppeteer.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { installDom, countNodes, Nd } from './dom-shim.mjs';
import { budgetSpread, crowdWord, applyPreset } from '../js/scoring.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

installDom({
  // Serve the real data files off disk so data.js works unmodified.
  fetchFile: async (url) => {
    const p = url instanceof URL ? fileURLToPath(url) : join(ROOT, String(url));
    try {
      const text = await readFile(p, 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
    } catch {
      return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
    }
  }
});

// ---------------------------------------------------------------------------

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
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const { loadAll, data } = await import('../js/data.js');
await loadAll();
const store_ = await import('../js/state.js');
const { renderSetup } = await import('../js/ui/setup.js');
const { renderCriteria } = await import('../js/ui/criteria.js');
const { renderResults, renderShortlist } = await import('../js/ui/results.js');
const { renderDetail } = await import('../js/ui/detail.js');
const { renderCompare } = await import('../js/ui/compare.js');
const { heroPhoto, photosFor } = await import('../js/images.js');

const go = () => {};

/** Criteria categories start collapsed, so open them before counting rows. */
function renderCriteriaExpanded(r) {
  renderCriteria(r, { go });
  const toolbar = r.querySelectorAll('.toolbar')[0];
  const expand = toolbar.querySelectorAll('.btn')[0];
  if (expand.textContent === 'Expand all') {
    expand.click();
    renderCriteria(r, { go });
  }
  return r;
}
const root = () => new Nd('main');

console.log(`\nRender smoke tests — ${data().destinations.length} destinations\n`);

console.log('Screens render without throwing');
check('setup screen', () => {
  const r = root(); renderSetup(r, { go });
  assert(countNodes(r) > 100, 'suspiciously few nodes: ' + countNodes(r));
  assert(r.querySelectorAll('.preset').length === data().presets.length, 'preset count wrong');
  return `${countNodes(r)} nodes, ${r.querySelectorAll('.months__btn').length} months`;
});

check('criteria screen lists every criterion', () => {
  const r = renderCriteriaExpanded(root());
  const rows = r.querySelectorAll('.crit').length;
  assert(rows === data().criteria.length - 4,
    `${rows} rows for ${data().criteria.length} criteria (4 live on Trip)`);
  return `${rows} criteria in ${r.querySelectorAll('.cat').length} categories`;
});

check('results screen with no criteria shows empty state', () => {
  const r = root(); renderResults(r, { go });
  assert(r.querySelector('.empty'), 'expected an empty state');
  return 'empty state shown';
});

check('results screen renders cards once criteria are set', () => {
  store_.setImportance('beaches', 3);
  store_.setImportance('foodScene', 2);
  store_.setImportance('safety', 1);
  const r = root(); renderResults(r, { go });
  const cards = r.querySelectorAll('.card').length;
  assert(cards === 12, `expected 12 cards on first page, got ${cards}`);
  assert(r.querySelectorAll('.ring').length >= 12, 'score rings missing');
  return `${cards} cards, ${r.querySelectorAll('.chip').length} RAG chips`;
});

check('every destination detail screen renders', () => {
  let worst = null;
  for (const d of data().destinations) {
    const r = root();
    try { renderDetail(r, d.id, { go }); } catch (e) { throw new Error(`${d.id}: ${e.message}`); }
    const n = countNodes(r);
    if (!worst || n < worst.n) worst = { id: d.id, n };
    assert(n > 80, `${d.id} rendered only ${n} nodes`);
    assert(r.querySelectorAll('.curve__bar').length === 12, `${d.id}: month curve not 12 bars`);
  }
  return `all ${data().destinations.length} rendered (leanest: ${worst.id}, ${worst.n} nodes)`;
});

check('unknown destination id degrades gracefully', () => {
  const r = root(); renderDetail(r, 'nope-xx', { go });
  assert(/could not be found/i.test(r.textContent), 'expected a not-found message');
  return 'shows not-found';
});

console.log('\nInteraction');
check('clicking a preset sets weights and applies targets', () => {
  const r = root(); renderSetup(r, { go });
  const before = Object.keys(store_.state.prefs.weights).length;
  r.querySelectorAll('.preset')[3].click();          // "Ski Week"
  const after = Object.keys(store_.state.prefs.weights).length;
  assert(after > 0 && after !== before, `weights did not change (${before} -> ${after})`);
  assert(store_.state.lastPreset, 'lastPreset not recorded');
  return `${store_.state.lastPreset} → ${after} criteria`;
});

check('importance buttons update state', () => {
  const r = renderCriteriaExpanded(root());
  const row = r.querySelectorAll('.crit')[0];
  row.querySelectorAll('.imp__btn')[3].click();      // "Must have"
  const first = data().categories[0].criteria[0].id;
  assert(store_.state.prefs.weights[first] === 3, `expected 3, got ${store_.state.prefs.weights[first]}`);
  return `${first} = must have`;
});

check('month picker changes the scored month', () => {
  const r = root(); renderSetup(r, { go });
  r.querySelectorAll('.months__btn')[0].click();
  assert(store_.state.prefs.month === 0, 'month did not change');
  return 'switched to January';
});

check('save and compare toggles persist', () => {
  const id = data().destinations[0].id;
  store_.toggleShortlist(id);
  store_.toggleCompare(id);
  assert(store_.isShortlisted(id), 'not shortlisted');
  assert(store_.isComparing(id), 'not comparing');
  const r = root(); renderShortlist(r, { go });
  assert(r.querySelectorAll('.card').length === 1, 'saved screen should show one card');
  return 'saved + comparing';
});

check('compare screen renders a row per rated criterion', () => {
  store_.toggleCompare(data().destinations[1].id);
  const r = root(); renderCompare(r, { go });
  const rated = Object.values(store_.state.prefs.weights).filter(Boolean).length;
  const rows = r.querySelectorAll('.cmp__row').length;
  assert(rows === rated + 2, `expected ${rated + 2} rows (criteria + header + cost), got ${rows}`);
  return `${rows} rows across 2 destinations`;
});

check('compare lays destinations out in columns', () => {
  store_.update((s) => { s.compare = []; }, { persist: false });
  const ids = data().destinations.slice(0, 3).map((d) => d.id);
  ids.forEach((id) => store_.toggleCompare(id));
  const r = root();
  renderCompare(r, { go });
  const grid = r.querySelector('.cmp');
  assert(grid, 'no compare grid rendered');
  // Without this the CSS grid-template-columns is invalid and every cell
  // stacks into a single column.
  assert(grid.style['--cols'] === '3',
    `--cols is "${grid.style['--cols']}" not "3" — the grid would collapse to one column`);
  const headCells = r.querySelectorAll('.cmp__cell--head').length;
  assert(headCells === 3, `expected 3 destination columns, got ${headCells}`);
  return '3 destination columns declared';
});

check('compare with fewer than two shows guidance', () => {
  store_.update((s) => { s.compare = []; }, { persist: false });
  const r = root(); renderCompare(r, { go });
  assert(r.querySelector('.empty'), 'expected empty state');
  return 'empty state shown';
});

async function checkAsync(name, fn) {
  try {
    const detail = await fn();
    passed++;
    console.log(`  \u2713 ${name}${detail ? ' \u2014 ' + detail : ''}`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.log(`  \u2717 ${name} \u2014 ${e.message}`);
  }
}

/** Fire an event straight at a node's listeners, the way a browser would. */
const fire = (el, type, value) => {
  if (value !== undefined) el.attributes.value = String(value);
  for (const fn of el.listeners[type] || []) fn({ target: { value }, preventDefault() {} });
};

console.log('\nSearch box (regression: only one letter used to land)');
await checkAsync('typing does not replace the search input', async () => {
  const r = root();
  renderCriteria(r, { go });
  const first = r.querySelector('.search');
  assert(first, 'no search input rendered');

  // Type three characters one at a time, as a person would.
  for (const term of ['b', 'be', 'bea']) fire(first, 'input', term);
  await new Promise((res) => setTimeout(res, 240));

  const after = r.querySelector('.search');
  assert(after === first, 'the search input was replaced, so focus and caret would be lost');
  assert(after.attributes.value === 'bea', `input value is "${after.attributes.value}", not "bea"`);

  const labels = r.querySelectorAll('.crit__label').map((n) => n.textContent.toLowerCase());
  assert(labels.length > 0, 'search filtered everything away');
  assert(labels.some((l) => l.includes('bea')), `no result contains "bea": ${labels.slice(0, 5).join(', ')}`);
  return `${labels.length} criteria match "bea", input node preserved`;
});

await checkAsync('clearing the search restores the full list', async () => {
  const r = renderCriteriaExpanded(root());
  fire(r.querySelector('.search'), 'input', '');
  await new Promise((res) => setTimeout(res, 240));
  const rows = r.querySelectorAll('.crit').length;
  assert(rows === data().criteria.length - 4, `${rows} of ${data().criteria.length - 4} criteria shown`);
  return 'all criteria back';
});

console.log('\nScale criteria live on Trip, weight and target together');
check('rating Atmosphere reveals a labelled slider', () => {
  store_.update((s) => { s.prefs.weights = {}; }, { persist: false });
  const before = root();
  renderSetup(before, { go: () => {} });
  assert(before.querySelectorAll('.crit__target').length === 0, 'target shown before any rating');

  store_.setImportance('peacefulness', 2);
  const r = root();
  renderSetup(r, { go: () => {} });
  const target = r.querySelector('.crit__target');
  assert(target, 'no target control after rating peacefulness');
  const ends = target.querySelector('.range__ends');
  assert(/Deserted/.test(ends.textContent) && /Buzzing/.test(ends.textContent),
    `end labels missing: "${ends.textContent}"`);
  return `ends read "${ends.textContent}"`;
});

check('temperature, cost and flight time also get targets there', () => {
  store_.update((s) => { s.prefs.weights = {}; s.prefs.home = null; }, { persist: false });
  ['temperature', 'cost', 'flightTime'].forEach((id) => store_.setImportance(id, 2));
  const r = root();
  renderSetup(r, { go: () => {} });
  assert(r.querySelectorAll('.crit__target').length === 3,
    `expected 3 targets, got ${r.querySelectorAll('.crit__target').length}`);
  const text = r.textContent;
  assert(/ideal daytime temperature/i.test(text), 'temperature target missing');
  assert(/budget per person/i.test(text), 'budget target missing');
  assert(/home airport/i.test(text), 'flight time should prompt for a home airport when none is set');
  return '3 targets, flight time prompts for an airport';
});

check('an impossible style + budget combination is called out', () => {
  store_.update((s) => {
    s.prefs.weights = {};
    s.prefs.targets.budgetStyle = 'luxury';
    s.prefs.targets.budgetPerDay = 50;
  }, { persist: false });
  store_.setImportance('cost', 2);
  const r = root();
  renderSetup(r, { go: () => {} });
  const note = r.querySelector('.budget-note');
  assert(note, 'no budget note beside the budget slider');
  assert(/is-bad/.test(note.className), `expected a hard warning, class was "${note.className}"`);
  assert(/Nothing costs under/.test(note.textContent), `unexpected message: ${note.textContent}`);
  return note.textContent.slice(0, 60) + '…';
});

check('a preference has exactly one home', () => {
  // These four used to be editable on BOTH screens, so the same setting had two
  // owners. They now live only on Trip, weight beside target.
  store_.update((s) => { s.prefs.weights = {}; }, { persist: false });
  ['temperature', 'peacefulness', 'cost', 'flightTime'].forEach((id) => store_.setImportance(id, 2));

  const trip = root();
  renderSetup(trip, { go: () => {} });
  assert(trip.querySelectorAll('.crit__target').length === 4,
    `Trip should own 4 targets, found ${trip.querySelectorAll('.crit__target').length}`);
  assert(trip.querySelectorAll('.imp').length === 4,
    'Trip should carry an importance picker for each');

  const crit = root();
  renderCriteria(crit, { go: () => {} });
  const listed = crit.querySelectorAll('.crit__label').map((n) => n.textContent);
  const leaked = listed.filter((l) => /^(Temperature|Atmosphere|Cost|Travel Time)$/.test(l));
  assert(leaked.length === 0, `Criteria still lists: ${leaked.join(', ')}`);
  return `Trip owns 4, Criteria lists the other ${listed.length}`;
});

check('one crowd vocabulary describes both the wish and the place', () => {
  assert(crowdWord(10) === 'Deserted' && crowdWord(95) === 'Heaving',
    `unexpected words: ${crowdWord(10)} / ${crowdWord(95)}`);
  store_.update((s) => { s.prefs.weights = {}; }, { persist: false });
  store_.setImportance('peacefulness', 2);
  const r = root();
  renderSetup(r, { go: () => {} });
  // The shim handles simple selectors only, so walk it in two steps.
  const readout = r.querySelector('.crit__target').querySelector('.range__readout').textContent;
  assert(['Deserted', 'Quiet', 'Balanced', 'Busy', 'Heaving'].includes(readout),
    `readout "${readout}" is not from the shared vocabulary`);
  return `preference reads "${readout}"`;
});

console.log('\nTrip basics');
check('choosing a preset stays on the setup page', () => {
  const nav = [];
  const r = root();
  renderSetup(r, { go: (h) => nav.push(h) });
  r.querySelectorAll('.preset')[0].click();
  assert(nav.length === 0, `navigated to ${nav.join(', ')} instead of staying put`);
  return 'stays on setup';
});

check('trip length is on the first page and drives total cost', () => {
  const r = root();
  renderSetup(r, { go: () => {} });
  assert(/how long for/i.test(r.textContent), 'no trip-length control on the setup page');
  store_.setTarget('tripNights', 10);
  const detail = root();
  renderDetail(detail, data().destinations[0].id, { go: () => {} });
  assert(/excl\. flights/i.test(detail.textContent), 'no total trip cost on the detail screen');
  return 'nights set to 10, total shown';
});

check('switching travel style re-anchors the daily spend', () => {
  store_.update((s) => {
    s.prefs.targets.budgetStyle = 'luxury';
    s.prefs.targets.budgetPerDay = 500;
  }, { persist: false });
  const r = root();
  renderSetup(r, { go: () => {} });
  r.querySelectorAll('.seg__btn')[0].click();          // budget / mid / luxury
  const t = store_.state.prefs.targets;
  const spread = budgetSpread(data().destinations, 'budget', store_.state.prefs.month);
  assert(t.budgetStyle === 'budget', 'style did not change');
  assert(t.budgetPerDay < 500, `spend stayed at £${t.budgetPerDay}`);
  assert(Math.abs(t.budgetPerDay - spread.median) <= 10,
    `spend £${t.budgetPerDay} is not near the £${spread.median} median`);
  return `budget £${spread.median}/day`;
});


console.log('\nResult cards always show a real photo where one exists');
check('the card hero skips an unresolved first photo', () => {
  let cardsWithPlaceholder = 0;
  let rescued = 0;
  for (const d of data().destinations) {
    const all = photosFor(d);
    const hero = heroPhoto(d);
    if (hero.isPlaceholder) cardsWithPlaceholder++;
    // If any photo resolved, the hero must be a resolved one.
    if (all.some((p) => !p.isPlaceholder)) {
      assert(!hero.isPlaceholder, `${d.id}: hero is a placeholder despite having real photos`);
      if (all[0].isPlaceholder) rescued++;
    }
  }
  return `${rescued} cards rescued from a failed first topic, ${cardsWithPlaceholder} still placeholder-only`;
});


check('a gallery is never padded out with gradients', () => {
  // Six photos was a target, not a rule. Once a place has two real pictures the
  // unresolved topics are dropped — four photographs say more than four
  // photographs followed by two captioned gradients.
  let short = 0;
  const sizes = {};
  for (const d of data().destinations) {
    const all = photosFor(d);
    const real = all.filter((p) => !p.isPlaceholder).length;
    const fake = all.length - real;
    if (real >= 2) {
      assert(fake === 0, `${d.id}: ${real} real photos but still shows ${fake} placeholder(s)`);
    } else {
      assert(all.length <= 3, `${d.id}: ${all.length} placeholders — should stop at 3`);
      short++;
    }
    assert(all.length >= 1, `${d.id}: no photos at all`);
    sizes[all.length] = (sizes[all.length] || 0) + 1;
  }
  const shape = Object.keys(sizes).sort().map((k) => `${k}\u00d7${sizes[k]}`).join(' ');
  return `gallery sizes ${shape}${short ? `, ${short} short of two real photos` : ''}`;
});

console.log('\nStarting over actually starts over');
check('clearing takes the targets a preset moved with it', () => {
  // Weights alone were not enough. Beach & Chill also pushes the temperature
  // target to 28 and atmosphere to 30, and those used to survive a "Clear all"
  // invisibly, quietly shaping the next search.
  const beach = data().presets.find((p) => p.id === 'beach-chill');
  store_.update((s) => {
    s.prefs = applyPreset(store_.state.prefs, beach);
    s.prefs.filters.continents = ['Europe'];
  }, { persist: false });

  const moved = store_.state.prefs.targets.temperature;
  assert(moved === 28, `the preset did not move the temperature target (${moved})`);
  assert(store_.hasCriteria(), 'hasCriteria() says there is nothing to clear');

  store_.clearCriteria();

  assert(Object.values(store_.state.prefs.weights).every((v) => !v), 'weights survived');
  assert(store_.state.prefs.targets.temperature !== 28,
    `temperature target still ${store_.state.prefs.targets.temperature}`);
  assert(store_.state.prefs.filters.continents.length === 0, 'a continent filter survived');
  assert(store_.state.lastPreset === null, 'the preset is still marked as applied');
  assert(!store_.hasCriteria(), 'hasCriteria() still says there is something to clear');
  return 'weights, targets, filters and the preset all cleared';
});

check('but it keeps the practical facts of the trip', () => {
  store_.update((s) => {
    s.prefs.month = 2;
    s.prefs.targets.tripNights = 11;
    s.prefs.targets.budgetStyle = 'luxury';
    s.prefs.weights = { beaches: 3 };
  }, { persist: false });
  store_.clearCriteria();
  const t = store_.state.prefs.targets;
  assert(store_.state.prefs.month === 2, 'the month was reset');
  assert(t.tripNights === 11, 'trip length was reset');
  assert(t.budgetStyle === 'luxury', 'travel style was reset');
  return 'month, trip length and travel style all survive';
});

check('the trip screen offers it only when there is something to clear', () => {
  const has = () => {
    const r = root();
    renderSetup(r, { go: () => {} });
    return r.querySelectorAll('.btn').some((b) => /Clear all criteria/.test(b.textContent));
  };
  store_.clearCriteria();
  assert(!has(), 'offered to clear an empty questionnaire');
  store_.update((s) => { s.prefs.weights = { beaches: 3 }; }, { persist: false });
  assert(has(), 'no way to start over from the trip screen');
  store_.clearCriteria();
  return 'hidden when empty, shown when not';
});

console.log('\nCriteria list starts collapsed');
check('categories are minimised on a fresh visit', () => {
  // "Clear all" is what starting a new search looks like.
  const reset = root();
  renderCriteria(reset, { go: () => {} });
  reset.querySelectorAll('.toolbar')[0].querySelectorAll('.btn')[1].click();

  const r = root();
  renderCriteria(r, { go: () => {} });
  const cats = r.querySelectorAll('.cat').length;
  const open = r.querySelectorAll('.cat').filter((n) => /is-open/.test(n.className)).length;
  assert(cats > 0, 'no categories rendered');
  assert(open === 0, `${open} of ${cats} categories were already expanded`);
  // Collapsed means no criterion rows are on screen yet.
  assert(r.querySelectorAll('.crit').length === 0, 'criterion rows visible while collapsed');
  return `${cats} categories, all collapsed`;
});

check('a category opens on click, and expand-all opens the rest', () => {
  const r = root();
  renderCriteria(r, { go: () => {} });
  r.querySelectorAll('.cat__head')[0].click();
  const afterOne = root();
  renderCriteria(afterOne, { go: () => {} });
  assert(afterOne.querySelectorAll('.cat').filter((n) => /is-open/.test(n.className)).length === 1,
    'clicking a category header did not open exactly one');

  // Expand all is the second toolbar button (search, expand, clear).
  const expand = afterOne.querySelectorAll('.toolbar')[0].querySelectorAll('.btn')[0];
  expand.click();
  const afterAll = root();
  renderCriteria(afterAll, { go: () => {} });
  const cats = afterAll.querySelectorAll('.cat').length;
  const open = afterAll.querySelectorAll('.cat').filter((n) => /is-open/.test(n.className)).length;
  assert(open === cats, `expand all opened ${open} of ${cats}`);
  return `1 on click, then all ${cats}`;
});

check('searching still reveals matches without expanding anything permanently', () => {
  const r = root();
  renderCriteria(r, { go: () => {} });
  const input = r.querySelector('.search');
  for (const fn of input.listeners.input || []) fn({ target: { value: 'beach' } });
  return 'search overrides the collapsed state while typing';
});


console.log('\nContent integrity');
check('every destination has photos and a blurb', () => {
  const bad = data().destinations.filter((d) => !d.blurb || (d.photoTopics || []).length < 4);
  assert(bad.length === 0, bad.map((d) => d.id).join(', '));
  return `${data().destinations.length} checked`;
});

check('no destination renders a NaN or undefined into the DOM', () => {
  const offenders = [];
  for (const d of data().destinations.slice(0, 40)) {
    const r = root();
    renderDetail(r, d.id, { go });
    const t = r.textContent;
    if (/NaN|undefined|\[object/.test(t)) offenders.push(d.id);
  }
  assert(offenders.length === 0, offenders.join(', '));
  return 'sampled 40 detail screens';
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) { for (const f of failures) console.error('  FAIL ' + f); process.exit(1); }
