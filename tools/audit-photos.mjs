#!/usr/bin/env node
/**
 * audit-photos.mjs — find photo matches that are probably wrong.
 *
 * WHY THIS EXISTS
 * `verify-photos.mjs` proves a URL loads. It says nothing about whether the
 * picture is of the right thing. The resolver broadens a topic until Commons
 * returns something, and a broadened match is where the lies come from: an
 * early run reduced "Elven architecture concept forest" to "Elven" and captioned
 * a crucifix in Brittany as Rivendell.
 *
 * This lists, in order of how much was given up:
 *   - topics that resolved to nothing (the app shows a placeholder — honest)
 *   - topics that only matched after broadening (the app shows a photo — check it)
 *
 * Neither is a failure. Both are a to-do list for rewording source topics.
 *
 *   node tools/audit-photos.mjs                  the real world
 *   node tools/audit-photos.mjs --world fiction
 *   node tools/audit-photos.mjs --world fiction --all   don't truncate
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const ALL = args.includes('--all');
const WORLD_ID = (() => {
  const i = args.indexOf('--world');
  return i >= 0 && args[i + 1] ? args[i + 1] : 'real';
})();

const registry = JSON.parse(await readFile(join(ROOT, 'data', 'worlds.json'), 'utf8'));
const world = registry.worlds.find((w) => w.id === WORLD_ID);
if (!world) {
  console.error(`Unknown world "${WORLD_ID}" — try ${registry.worlds.map((w) => w.id).join(' or ')}`);
  process.exit(1);
}

const DIR = join(ROOT, 'data', world.dir);
const destinations = JSON.parse(await readFile(join(DIR, 'destinations.json'), 'utf8'));
const byId = new Map(destinations.map((d) => [d.id, d]));

let store = { photos: {} };
try {
  store = JSON.parse(await readFile(join(DIR, 'photos.json'), 'utf8'));
} catch {
  console.error(`No photos.json for ${world.label} yet — run: node tools/build-photos.mjs --world ${WORLD_ID}\n`);
  process.exit(1);
}

const missing = [];
const broadened = [];
let total = 0;
let clean = 0;

for (const [id, arr] of Object.entries(store.photos || {})) {
  const dest = byId.get(id);
  for (const rec of arr || []) {
    total++;
    if (!rec.full) { missing.push({ id, name: dest?.name || id, topic: rec.topic }); continue; }
    if (rec.wanted) {
      const kept = rec.topic.split(' ').length;
      const asked = rec.wanted.split(' ').length;
      broadened.push({
        id, name: dest?.name || id,
        wanted: rec.wanted, got: rec.topic,
        lost: asked - kept,
        file: decodeURIComponent((rec.source || '').split('/').pop() || '')
      });
      continue;
    }
    clean++;
  }
}

broadened.sort((a, b) => b.lost - a.lost || a.name.localeCompare(b.name));

// How big each gallery actually ends up, now that unresolved topics are dropped
// rather than drawn as gradients.
const galleries = {};
const thin = [];
for (const [id, arr] of Object.entries(store.photos || {})) {
  const real = (arr || []).filter((r) => r.full).length;
  galleries[real] = (galleries[real] || 0) + 1;
  if (real < 2) thin.push({ id, name: byId.get(id)?.name || id, real, of: (arr || []).length });
}

const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
console.log(`\n${world.label} photos — ${total} topics across ${Object.keys(store.photos).length} destinations\n`);
console.log(`  exact match      ${String(clean).padStart(4)}  (${pct(clean)}%)`);
console.log(`  broadened        ${String(broadened.length).padStart(4)}  (${pct(broadened.length)}%)   ← check these`);
console.log(`  no image found   ${String(missing.length).padStart(4)}  (${pct(missing.length)}%)   ← placeholder shown`);

console.log('\n  Gallery sizes (real photographs per destination):');
for (const n of Object.keys(galleries).map(Number).sort((a, b) => a - b)) {
  const bar = '█'.repeat(Math.max(1, Math.round(galleries[n] / 4)));
  console.log(`    ${n} photo${n === 1 ? ' ' : 's'}  ${String(galleries[n]).padStart(4)}  ${bar}`);
}
if (thin.length) {
  console.log(`\n  Under two photographs — reword their topics:\n`);
  for (const t of thin) console.log(`    ${t.name.padEnd(28)} ${t.real}/${t.of}`);
}

const show = (list, n) => (ALL ? list : list.slice(0, n));

if (broadened.length) {
  console.log('\n  Broadened matches, most words dropped first:\n');
  for (const b of show(broadened, 30)) {
    console.log(`    ${b.name}`);
    console.log(`      asked : ${b.wanted}`);
    console.log(`      got   : ${b.got}   →  ${b.file}`);
  }
  if (!ALL && broadened.length > 30) console.log(`    …and ${broadened.length - 30} more (--all)`);
}

if (missing.length) {
  console.log('\n  No image found — reword these in the source data:\n');
  for (const m of show(missing, 40)) console.log(`    ${m.name.padEnd(28)} ${m.topic}`);
  if (!ALL && missing.length > 40) console.log(`    …and ${missing.length - 40} more (--all)`);
}

console.log('');
