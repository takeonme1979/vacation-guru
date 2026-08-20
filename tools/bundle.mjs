#!/usr/bin/env node
/**
 * bundle.mjs — build `vacation-guru.html`, one self-contained file you can
 * double-click.
 *
 * WHY THIS EXISTS
 * Browsers refuse to load ES modules over `file://` (CORS, origin "null"), so
 * opening the multi-file `index.html` from disk leaves the page stuck on its
 * loading text — the entry script never executes at all. This flattens the
 * module graph into one classic script, inlines the CSS and all the JSON, and
 * shims `fetch()` so the data layer needs no changes.
 *
 * The multi-file version remains the real source; this is a build artefact.
 *
 *   node tools/bundle.mjs            -> vacation-guru.html
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, posix } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vacation-guru.html');

/** Dependency order — imports are resolved eagerly, so parents come last. */
const MODULES = [
  'util/dom.js',
  'util/storage.js',
  'scoring.js',
  'data.js',
  'images.js',
  'state.js',
  'ui/components.js',
  'ui/setup.js',
  'ui/criteria.js',
  'ui/results.js',
  'ui/detail.js',
  'ui/compare.js',
  'ui/browse.js',
  'main.js'
];

const PER_WORLD_FILES = ['criteria.json', 'destinations.json', 'meta.json', 'origins.json', 'photos.json', 'sources.json'];

// ---------------------------------------------------------------------------
// Module transform: ES module syntax -> registry calls
// ---------------------------------------------------------------------------

/** `./x.js` relative to `ui/setup.js` -> `ui/x.js` */
function resolveSpecifier(fromModule, spec) {
  const base = posix.dirname(fromModule);
  return posix.normalize(posix.join(base === '.' ? '' : base, spec)).replace(/^\.\//, '');
}

function transform(modulePath, src) {
  const exported = new Set();
  let out = src;

  // ---- imports ----------------------------------------------------------
  // import * as ns from '...'
  out = out.replace(
    /^import\s+\*\s+as\s+([A-Za-z0-9_$]+)\s+from\s+['"]([^'"]+)['"];?/gm,
    (_m, ns, spec) => `const ${ns} = __req(${JSON.stringify(resolveSpecifier(modulePath, spec))});`
  );

  // import { a, b as c } from '...'   (may span lines)
  out = out.replace(
    /^import\s*\{([\s\S]*?)\}\s*from\s+['"]([^'"]+)['"];?/gm,
    (_m, names, spec) => {
      const bindings = names
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const as = s.split(/\s+as\s+/);
          return as.length === 2 ? `${as[0].trim()}: ${as[1].trim()}` : s;
        })
        .join(', ');
      return `const { ${bindings} } = __req(${JSON.stringify(resolveSpecifier(modulePath, spec))});`;
    }
  );

  // ---- exports ----------------------------------------------------------
  const record = (re, group = 2) => {
    let m;
    while ((m = re.exec(out)) !== null) exported.add(m[group]);
  };
  record(/^export\s+(async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)/gm);
  record(/^export\s+(const|let|var)\s+([A-Za-z0-9_$]+)/gm);
  record(/^export\s+class\s+([A-Za-z0-9_$]+)/gm, 1);

  // `export { a, b as c }`
  out = out.replace(/^export\s*\{([^}]*)\};?/gm, (_m, names) => {
    names.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => {
      const as = s.split(/\s+as\s+/);
      exported.add((as[1] || as[0]).trim());
    });
    return '';
  });

  // Strip the keyword now that we know the names.
  out = out.replace(/^export\s+(?=(async\s+)?function|const|let|var|class)/gm, '');

  if (/^\s*export\s+default/m.test(out)) {
    throw new Error(`${modulePath}: "export default" is not supported by the bundler`);
  }
  if (/^\s*import\s/m.test(out)) {
    throw new Error(`${modulePath}: an import statement was not transformed:\n` +
      out.split('\n').filter((l) => /^\s*import\s/.test(l)).join('\n'));
  }

  // `import.meta.url` is a syntax error in a classic script.
  out = out.replace(/import\.meta\.url/g, 'document.baseURI');

  const assigns = [...exported].map((n) => `  __x.${n} = ${n};`).join('\n');

  return `__mods[${JSON.stringify(modulePath)}] = function (__x) {\n${out}\n${assigns}\n};`;
}

// ---------------------------------------------------------------------------

async function main() {
  const css = await readFile(join(ROOT, 'css', 'styles.css'), 'utf8');

  // Every world's data, keyed by its path under data/ — NOT by basename, since
  // each world has its own criteria.json and they would collide.
  const registry = JSON.parse(await readFile(join(ROOT, 'data', 'worlds.json'), 'utf8'));
  const data = { 'worlds.json': registry };

  for (const world of registry.worlds) {
    const prefix = world.dir === '.' ? '' : world.dir + '/';
    for (const f of PER_WORLD_FILES) {
      const key = prefix + f;
      try {
        data[key] = JSON.parse(await readFile(join(ROOT, 'data', world.dir, f), 'utf8'));
      } catch {
        if (f === 'photos.json') data[key] = { photos: {} };
        else if (f === 'origins.json') data[key] = { origins: [] };
        else if (f === 'sources.json') data[key] = { sources: {} };
        else throw new Error(`missing required data file: ${key}`);
      }
    }
  }

  const modules = [];
  for (const m of MODULES) {
    const src = await readFile(join(ROOT, 'js', m), 'utf8');
    modules.push(transform(m, src));
  }

  const script = `
(function () {
  'use strict';

  // ---- inlined data; shadows window.fetch for every module below ----------
  var __DATA = ${JSON.stringify(data)};
  function fetch(url) {
    // Key on the path under data/, so fiction/criteria.json and criteria.json
    // stay distinct.
    var clean = String(url).split('?')[0];
    var name = clean.indexOf('/data/') >= 0 ? clean.split('/data/')[1] : clean.split('/').pop();
    if (Object.prototype.hasOwnProperty.call(__DATA, name)) {
      return Promise.resolve({
        ok: true, status: 200,
        json: function () { return Promise.resolve(__DATA[name]); }
      });
    }
    return Promise.reject(new Error('not bundled: ' + name));
  }

  // ---- tiny module registry ----------------------------------------------
  var __mods = {};
  var __cache = {};
  function __req(path) {
    if (Object.prototype.hasOwnProperty.call(__cache, path)) return __cache[path];
    if (!__mods[path]) throw new Error('module not found: ' + path);
    var __x = __cache[path] = {};
    __mods[path](__x);
    return __x;
  }

${modules.join('\n\n')}

  __req('main.js');
})();
`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f172a">
<meta name="description" content="Find the holiday destination that actually fits what you want.">
<title>Vacation Guru</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧭</text></svg>">
<style>
${css}
</style>
</head>
<body>

<div id="app">
  <header id="topbar">
    <a class="brand" href="#/setup">
      <span class="brand__mark" aria-hidden="true">🧭</span>
      <span class="brand__name">Vacation&nbsp;Guru</span>
    </a>
    <div class="topbar__right">
      <div id="worldSwitch" class="worlds"></div>
      <button id="themeToggle" class="icon-btn" aria-label="Switch colour theme" title="Switch theme">◐</button>
    </div>
  </header>

  <main id="screen" tabindex="-1">
    <div class="boot">Loading destinations…</div>
  </main>

  <nav id="tabbar" aria-label="Main"></nav>
</div>

<script>
  (function () {
    var KEY = 'vacationguru:theme';
    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) {}
    if (saved) document.documentElement.dataset.theme = saved;
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#themeToggle')) return;
      var cur = document.documentElement.dataset.theme;
      var next = cur === 'dark' ? 'light' : cur === 'light' ? '' : 'dark';
      if (next) document.documentElement.dataset.theme = next;
      else delete document.documentElement.dataset.theme;
      try { next ? localStorage.setItem(KEY, next) : localStorage.removeItem(KEY); } catch (e) {}
    });
  })();
</script>

<script>
${script}
</script>
</body>
</html>
`;

  await writeFile(OUT, html, 'utf8');

  const mb = (Buffer.byteLength(html) / 1024 / 1024).toFixed(2);
  console.log(`\n✓ vacation-guru.html  (${mb} MB, ${MODULES.length} modules, ${Object.keys(data).length} data files)`);
  console.log('  Double-click it. No server, no install.\n');
}

main().catch((e) => { console.error('\nBundle failed: ' + e.message + '\n'); process.exit(1); });
