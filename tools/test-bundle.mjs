#!/usr/bin/env node
/**
 * Verifies that vacation-guru.html actually BOOTS, not merely that it built.
 *
 * The whole point of the bundle is that it works with no server, so this
 * executes its script against the DOM shim with `fetch` deliberately removed —
 * if anything still tries to reach the network, it fails here rather than on
 * the user's machine.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInThisContext } from 'node:vm';
import { installDom, countNodes } from './dom-shim.mjs';

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

const html = await readFile(join(ROOT, 'vacation-guru.html'), 'utf8');

console.log(`\nSingle-file bundle tests — vacation-guru.html (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)\n`);

console.log('Structure');
check('is one self-contained file', () => {
  assert(!/<script[^>]+\bsrc=/.test(html), 'has an external <script src>');
  assert(!/<link[^>]+stylesheet/.test(html), 'has an external stylesheet');
  return 'no external script or stylesheet references';
});

check('uses a classic script, not a module', () => {
  assert(!/type=["']module["']/.test(html), 'still declares type="module" — blocked on file://');
  assert(!/\bimport\.meta\b/.test(html), 'import.meta survives, which is a syntax error in a classic script');
  assert(!/^\s*import\s+[\{*]/m.test(html), 'an untransformed import statement survived');
  return 'classic script, no import syntax';
});

check('data is inlined', () => {
  assert(html.includes('destinations.json'), 'destination data not inlined');
  assert(html.includes('criteria.json'), 'criteria not inlined');
  return '5 data files embedded';
});

// ---------------------------------------------------------------------------

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const appScript = scripts[scripts.length - 1];

const { screen, body } = installDom();
// No fetch at all: the bundle must be entirely self-sufficient.
delete global.fetch;

console.log('\nExecution');
check('bundle script parses and runs', () => {
  runInThisContext(appScript, { filename: 'vacation-guru.html' });
  return `${(appScript.length / 1024).toFixed(0)} KB of script`;
});

// boot() is async — let its promise chain settle.
await new Promise((r) => setTimeout(r, 60));

check('it renders the setup screen with no network', () => {
  const n = countNodes(screen);
  assert(n > 100, `only ${n} nodes rendered — probably still on the loading message`);
  assert(!/Loading destinations/.test(screen.textContent), 'still showing the loading message');
  assert(!/Could not load/.test(screen.textContent), 'showed the data-load error');
  return `${n} nodes`;
});

check('presets and month picker are present', () => {
  assert(screen.querySelectorAll('.preset').length >= 8, 'presets missing');
  assert(screen.querySelectorAll('.months__btn').length === 12, 'month picker missing');
  return `${screen.querySelectorAll('.preset').length} presets, 12 months`;
});

check('the tab bar rendered', () => {
  // Assert on WHICH tabs, not how many — a hardcoded count fails every time a
  // screen is added, without telling you whether anything is actually wrong.
  const want = ['Trip', 'Criteria', 'Matches', 'Browse', 'Saved', 'Compare'];
  const got = body.querySelectorAll('.tab').map((t) => t.textContent.replace(/[^A-Za-z]/g, ''));
  for (const w of want) {
    assert(got.some((g) => g.includes(w)), `no "${w}" tab — got ${got.join(', ')}`);
  }
  return `${got.length} tabs: ${want.join(', ')}`;
});

check('choosing a preset produces scored results', () => {
  screen.querySelectorAll('.preset')[0].click();     // Beach & Chill
  global.location.hash = '#/results';
  // The bundle's router listens on window hashchange, which the shim does not
  // dispatch, so drive it the same way a tab tap would.
  body.querySelectorAll('.tab')[2].click();
  const cards = screen.querySelectorAll('.card').length;
  assert(cards > 0, 'no result cards rendered');
  const rings = screen.querySelectorAll('.ring__label').length;
  assert(rings > 0, 'no score rings');
  return `${cards} cards with scores`;
});

check('no NaN or undefined leaked into the page', () => {
  const t = screen.textContent;
  assert(!/NaN|undefined|\[object /.test(t), 'found placeholder junk in rendered text');
  return 'clean';
});

// ---------------------------------------------------------------------------
// A second boot, from a link that names a world.
//
// The world used to live only in localStorage, so a link to a fictional realm
// opened whichever world the recipient last looked at. Re-running the bundle
// against a fresh DOM proves the address is now what decides.

console.log('\nA shared link opens the world it names');

const second = installDom({ search: '?world=fiction' });
delete global.fetch;

check('?world=fiction boots straight into fiction', () => {
  runInThisContext(appScript, { filename: 'vacation-guru.html#fiction' });
  return 'bundle re-executed against a fiction link';
});

await new Promise((r) => setTimeout(r, 60));

check('it is really the fictional catalogue, not the real one', () => {
  const t = second.screen.textContent;
  assert(!/Loading destinations/.test(t), 'still on the loading message');
  // Fiction has no calendar, so the month picker must be absent; the real
  // world's setup screen always has twelve of them.
  assert(second.screen.querySelectorAll('.months__btn').length === 0,
    'a month picker rendered — this is the real world, not fiction');
  assert(/expedition|realm/i.test(t) || /Shoestring|Lavish/.test(t),
    'nothing on screen identifies this as the fictional world');
  return 'fiction, with no calendar';
});

check('the world switch shows fiction as the active one', () => {
  const on = second.body.querySelectorAll('.worlds__btn.is-on').map((b) => b.textContent);
  assert(on.length === 1, `${on.length} worlds marked active`);
  assert(/Fiction/i.test(on[0]), `active world reads "${on[0]}"`);
  return on[0];
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) { for (const f of failures) console.error('  FAIL ' + f); process.exit(1); }
