#!/usr/bin/env node
/**
 * A quick human-readable read-out of what each fiction preset actually returns.
 * Not a test — a sanity check you can eyeball. `node tools/preview-fiction.mjs`
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { installDom } from './dom-shim.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
installDom({ fetchFile: async (url) => {
  const p = url instanceof URL ? fileURLToPath(url) : join(ROOT, String(url));
  try { return { ok: true, status: 200, json: async () => JSON.parse(await readFile(p, 'utf8')) }; }
  catch { return { ok: false, status: 404, json: async () => { throw new Error('404'); } }; }
}});

const { loadAll } = await import('../js/data.js');
const S = await import('../js/scoring.js');

const world = process.argv[2] || 'fiction';
const d = await loadAll(world);
console.log(`\n${d.destinations.length} destinations · ${Object.keys(d.sources).length} works credited\n`);

for (const preset of d.presets) {
  const prefs = S.applyPreset(S.emptyPrefs(), preset);
  prefs.month = 5;
  const ranked = S.rankDestinations(d.destinations, prefs, d.criteriaById).results.slice(0, 4);
  console.log(preset.label.toUpperCase());
  for (const r of ranked) console.log(`   ${String(r.overall).padStart(3)}%  ${r.dest.name.padEnd(28)} ${r.dest.country}`);
  console.log('');
}
