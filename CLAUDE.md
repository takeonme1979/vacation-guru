# Vacation Guru

Offline-first holiday destination matcher, scored on-device across ~89
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

## Old Towns (added 2026-09-27)

- New rated criterion **`oldTown`** ("Old Towns", first in the Culture
  category) + a new **"Old Towns" 🏰 preset** on the setup screen
  (`oldTown` must-have, plus architecture/history/walkability).
- Baselines per archetype in `archetypes.json` (historic-city 70, capital
  45, resort/wilderness ~0); ~390 destinations carry their own explicit
  `oldTown` override in their shard's `r` block (Prague 98, Kraków 97,
  Tallinn/Dubrovnik/Bruges 97…). Anything unlisted gets the archetype value.
- New shard `data/destinations/43-old-towns.json`: Pristina, Prizren (both
  country `XK`, Kosovo — new row in `countries.json`), Skopje, Bitola, Veliko
  Tarnovo, Görlitz, Banská Štiavnica, Guimarães & Braga, Safranbolu,
  Mardin, Pingyao, Guanajuato & San Miguel de Allende. Photos resolved.
  `ohrid-mk` was renamed "Lake Ohrid" -> "Ohrid & the Lake" (user asked for
  Ohrid; it already existed, the town just was not obvious from the name).
- Pristina is rated 72 on purpose (small Ottoman quarter, not a showpiece
  old town) so it ranks mid-table on the preset; bump it in the shard if the
  user wants it higher.
- **Live site: https://vacation-guru.netlify.app** (deploys on push to `main`;
  check `data/meta.json`'s `builtId` against the local one to confirm).
- **Deployed 2026-09-27** (commit 3301845, CI green) — this push also
  carried the backlog of earlier uncommitted work (shards 36-42, fiction).
- **Ground transfer (added 2026-09-27):** optional `"transfer"` hours per
  destination (overland from the nearest well-connected airport; absent =
  an ordinary ~45 min hop). `js/scoring.js` adds anything beyond 0.75h to
  each leg in `travelBurden`, so short trips penalise places like Český
  Krumlov (3h), Zermatt (3.5h), Huaraz (7h); the Travel Time detail and the
  destination page show "+ ~3h overland". 332 destinations carry a value, set
  by judgement. The Old Towns preset rates Travel Time "Important", so a
  weekend search favours easy-to-reach towns; on a week it matters less.
- **No default flight ceiling (2026-09-27, user's call):** `maxFlightHours`
  defaults to `NO_FLIGHT_LIMIT` (24 = "No limit" on the slider), so a 13h
  flight is judged only by how much of the trip it eats. A limit the user
  sets still applies. `restore()` drops a saved 8 (the old silent default).
