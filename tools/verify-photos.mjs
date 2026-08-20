#!/usr/bin/env node
/**
 * verify-photos.mjs — check that stored photo URLs actually load.
 *
 * WHY THIS EXISTS
 * Every other test asserted that a photo record *existed*, never that its URL
 * resolved. Wikimedia only serves thumbnails at a fixed list of widths, and the
 * 480px ones this project generated returned HTTP 400 — so every card image
 * failed in the browser and silently fell back to a placeholder, while the whole
 * suite stayed green. This closes that gap.
 *
 *   node tools/verify-photos.mjs                 sample 40 of each size
 *   node tools/verify-photos.mjs --world fiction check a different world
 *   node tools/verify-photos.mjs --all           check every URL (slow)
 *   node tools/verify-photos.mjs --n 100         sample size
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const ALL = args.includes('--all');
const N = (() => {
  const i = args.indexOf('--n');
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : 40;
})();
const WORLD_ID = (() => {
  const i = args.indexOf('--world');
  return i >= 0 && args[i + 1] ? args[i + 1] : 'real';
})();

const UA = 'VacationGuru/0.1 (link check)';
// upload.wikimedia.org rate-limits aggressively; a slow check is the point.
const RATE_MS = 1200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Deterministic spread across the catalogue rather than the first N. */
function sample(items, n) {
  if (ALL || items.length <= n) return items;
  const step = items.length / n;
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * step)]);
}

async function head(url) {
  try {
    // Some CDNs dislike HEAD; a ranged GET is cheap and universally supported.
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Range: 'bytes=0-0' }
    });
    return { ok: res.status === 200 || res.status === 206, status: res.status, type: res.headers.get('content-type') || '' };
  } catch (e) {
    return { ok: false, status: 0, type: 'fetch failed: ' + e.message };
  }
}

const registry = JSON.parse(await readFile(join(ROOT, 'data', 'worlds.json'), 'utf8'));
const world = registry.worlds.find((w) => w.id === WORLD_ID);
if (!world) {
  console.error(`Unknown world "${WORLD_ID}" — try ${registry.worlds.map((w) => w.id).join(' or ')}`);
  process.exit(1);
}
const store = JSON.parse(await readFile(join(ROOT, 'data', world.dir, 'photos.json'), 'utf8'));

const thumbs = [];
const fulls = [];
for (const [id, arr] of Object.entries(store.photos || {})) {
  for (const rec of arr) {
    if (rec.thumb) thumbs.push({ id, url: rec.thumb });
    if (rec.full) fulls.push({ id, url: rec.full });
  }
}

console.log(`\nVerifying photo URLs — ${thumbs.length} thumbs, ${fulls.length} full-size`);
console.log(ALL ? '  checking every URL\n' : `  sampling ${Math.min(N, thumbs.length)} of each\n`);

let failed = 0;
for (const [label, list] of [['thumb', sample(thumbs, N)], ['full', sample(fulls, N)]]) {
  let ok = 0;
  const bad = [];
  for (const item of list) {
    const r = await head(item.url);
    if (r.ok && r.type.startsWith('image/')) ok++;
    else bad.push(`${item.id}  HTTP ${r.status} ${r.type}  ${item.url}`);
    await sleep(RATE_MS);
  }
  const pct = Math.round((ok / list.length) * 100);
  console.log(`  ${label.padEnd(6)} ${ok}/${list.length} load (${pct}%)`);
  for (const b of bad.slice(0, 8)) console.log('      ✗ ' + b);
  if (bad.length > 8) console.log(`      …and ${bad.length - 8} more`);
  failed += bad.length;
}

console.log('');
if (failed) {
  console.error(`${failed} URL(s) did not return an image. Wikimedia only serves the widths at https://w.wiki/GHai\n`);
  process.exit(1);
}
console.log('All sampled photo URLs return real images.\n');
