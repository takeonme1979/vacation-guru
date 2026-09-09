# Vacation Guru

Offline-first holiday destination matcher, scored on-device across ~88
criteria — see `README.md` for how the matching/scoring works and
`DEPLOY.md` for hosting. This file is maintained as work progresses —
update it (don't just let it go stale) as current focus changes.

## The one rule that's easy to get wrong

**Generated files are committed on purpose, not gitignored.** `npm run build`
regenerates `data/destinations.json`, `data/photos.json`, `data/meta.json`,
`data/fiction/*.json`, `vacation-guru.html`, and the service worker's cache
stamp in `sw.js` — and all of those are checked in. Netlify has no build
step; it serves exactly what's committed. **Always run `npm run build` (or
`npm run check`) before committing** anything that touches `js/`, `tools/`,
or `data/*` source, or the deployed site will be stale/inconsistent with
source. CI checks that you did this.

## Structure

- `vacation-guru.html` — the single-file bundle (what most people open
  directly; ES modules don't work on `file://`, so this is the distributable).
- `index.html` + `js/` — the real multi-file source (`data.js`, `scoring.js`,
  `state.js`, `main.js`, `maps.js`, `images.js`, `ui/`, `util/`). Served via
  `npm start` on :5173 for development.
- `data/` — destination/criteria/photo data; `data/fiction/` is a separate
  "world" (fictional-place galleries) alongside the real-world data.
- `tools/` — build, bundle, test, and photo-resolution scripts (see
  `package.json` scripts for the full list — `build`, `bundle`, `test`,
  `check`, `photos`, `photos:download`, `audit:photos`, `verify:photos`).

## Working state

- No task list is tracked in this file yet — check `git log` for recent
  work (currently active area: expanding the fiction/sci-fi destination
  catalogue, per the last few commits). Fill in current focus here as work
  happens rather than relying on conversation history to carry it.
