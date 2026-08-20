#!/usr/bin/env node
/**
 * Photo-pipeline tests. Pure logic, no network.
 *
 * WHY THIS EXISTS
 * The photo resolver is the one part of the project that can produce something
 * confidently, plausibly wrong: a real photograph, correctly licensed, of
 * entirely the wrong thing. Every failure below actually shipped —
 *
 *   "Elven architecture concept forest" -> "Elven"        a commune in Brittany
 *   "Giant hand small person engraving" -> "Giant hand"   a mountain bike
 *   "Frozen tundra ice plain"           -> "Frozen tundra" Lambeau Field
 *   "Empty Italian piazza dusk"         -> "Empty Italian" a Crimean War photo
 *
 * — and each is pinned here so it cannot come back. A missing photo is fine;
 * the app draws a captioned placeholder. A wrong one is a lie.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { queryVariants, onTopic } from './build-photos.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log('\nPhoto pipeline tests\n');

console.log('Broadening keeps the subject');

check('the topic as written is always tried first', () => {
  for (const t of ['Positano cliffside village Amalfi', 'Misty forest waterfall', 'Hobbiton']) {
    assert(queryVariants(t)[0] === t, `first variant for "${t}" was not the topic itself`);
  }
  return '3 topics';
});

check('a name is never broadened down to one word', () => {
  const bad = [];
  for (const t of [
    'Elven architecture concept forest',
    'Positano cliffside village Amalfi',
    'Kaitoke Regional Park New Zealand Rivendell'
  ]) {
    for (const v of queryVariants(t)) {
      if (v !== t && v.split(' ').length < 2) bad.push(`${t} -> ${v}`);
    }
  }
  assert(bad.length === 0, bad.join(', '));
  return 'floor of two words holds';
});

check('at least half of every named topic survives broadening', () => {
  const topics = [
    'Elven architecture concept forest', 'Giant hand small person engraving',
    'Waikato rolling green farmland New Zealand', 'Snowy Highland village cottages'
  ];
  for (const t of topics) {
    const floor = Math.max(2, Math.ceil(t.split(' ').length / 2));
    for (const v of queryVariants(t)) {
      if (v === t) continue;
      assert(v.split(' ').length >= floor,
        `"${t}" broadened to "${v}", below the floor of ${floor} words`);
    }
  }
  return `${topics.length} topics`;
});

check('a descriptive topic gives up at most one word', () => {
  // A description has no name to fall back on, so every word dropped is a word
  // of meaning gone — and the survivor becomes the caption. "Norse great hall
  // interior" may become "Norse great hall"; it must never become "Norse
  // great", which is how an engraving of a Viking raid got captioned as a hall.
  for (const t of [
    'Cobbled alley overhanging buildings',
    'Norse great hall interior',
    'Giant hand small person engraving'
  ]) {
    const vs = queryVariants(t);
    const n = t.split(' ').length;
    assert(vs.length <= 2, `"${t}" produced ${vs.length} variants: ${JSON.stringify(vs)}`);
    for (const v of vs) {
      assert(v.split(' ').length >= n - 1, `"${t}" broadened all the way to "${v}"`);
    }
  }
  assert(!queryVariants('Norse great hall interior').includes('Norse great'),
    '"Norse great" is still reachable');
  return 'one word, no more';
});

check('a named topic falls back towards the name', () => {
  const vs = queryVariants('Kaitoke Regional Park New Zealand Rivendell');
  assert(vs.includes('Kaitoke Regional Park'), `got ${JSON.stringify(vs)}`);
  return 'Kaitoke Regional Park reachable';
});

console.log('\nResults have to be about the query');

check('the four matches that actually shipped are now rejected', () => {
  const lies = [
    ['Giant hand small', 'File:Giant Anthem 29er X3.jpg'],
    ['Frozen tundra', 'File:Lambeau Field.jpg'],
    ['Empty Italian', 'File:Valley of the shadow of death.jpg'],
    ['Viking hall', 'File:2300 Arena Exterior.jpg']
  ];
  for (const [q, title] of lies) {
    assert(!onTopic(q, title), `"${q}" still accepts ${title}`);
  }
  return `${lies.length} pinned`;
});

check('genuine matches still pass', () => {
  const good = [
    ['Cobbled alley', 'File:Cobbled Back Alley off Cranmer Road, Bradford.jpg'],
    ['Victorian shopfront', 'File:Victorian shopfronts - The Struet.jpg'],
    ['Viking longhouse', 'File:Replica Viking Longhouse.jpg'],
    ['Bleak mountain', 'File:Bleak mountain (Unsplash).jpg']
  ];
  for (const [q, title] of good) {
    assert(onTopic(q, title), `"${q}" wrongly rejected ${title}`);
  }
  return `${good.length} kept`;
});

check('a single-word query only needs its one word', () => {
  assert(onTopic('Hobbiton', 'File:Hobbiton Matamata New Zealand.jpg'), 'exact name rejected');
  assert(!onTopic('Hobbiton', 'File:Rolling hills.jpg'), 'unrelated file accepted');
  return 'one content word, one hit required';
});

check('an uninformative title is rescued by its description', () => {
  // Commons titles are often "DSC08797". The description is read too.
  assert(onTopic('Endless city towers', 'File:DSC08797.jpg An endless city of towers at dusk'),
    'description was not consulted');
  return 'description counts';
});

console.log('\nWhat is already stored');

for (const worldId of ['real', 'fiction']) {
  const registry = JSON.parse(await readFile(join(ROOT, 'data', 'worlds.json'), 'utf8'));
  const world = registry.worlds.find((w) => w.id === worldId);
  let store = null;
  try {
    store = JSON.parse(await readFile(join(ROOT, 'data', world.dir, 'photos.json'), 'utf8'));
  } catch { /* not resolved yet */ }

  if (!store) {
    console.log(`  – ${world.label}: no photos.json yet, skipped`);
    continue;
  }

  const records = Object.values(store.photos || {}).flat().filter((r) => r.full);

  check(`${world.label}: every stored photo carries its attribution`, () => {
    const bare = records.filter((r) => !r.credit || !r.license);
    assert(bare.length === 0, `${bare.length} records have no credit or licence`);
    return `${records.length} photos, all credited`;
  });

  check(`${world.label}: thumbnails use a width Wikimedia will serve`, () => {
    // 480px returned HTTP 400 and silently placeholder'd every card image.
    const ok = [120, 250, 500, 960, 1280, 1920, 2560];
    const bad = records.filter((r) => {
      const m = /\/(\d+)px-/.exec(r.thumb || '');
      return m && !ok.includes(Number(m[1]));
    });
    assert(bad.length === 0, `${bad.length} thumbnails use an unsupported width`);
    return `all in ${ok.join('/')}`;
  });

  check(`${world.label}: no book scans or schematics slipped through`, () => {
    const bad = records.filter((r) => /\.djvu?$|\.pdf$|\.svg$/i.test(decodeURIComponent(r.source || '')));
    assert(bad.length === 0,
      `${bad.length} records point at a document, e.g. ${decodeURIComponent(bad[0]?.source || '')}`);
    return 'photographs and plates only';
  });
}

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) { for (const f of failures) console.error('  FAIL ' + f); process.exit(1); }
