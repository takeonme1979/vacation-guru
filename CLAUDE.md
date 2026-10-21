# Vacation Guru

Offline-first holiday destination matcher, scored on-device across ~90
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

## Photo hosts and the live CSP (fixed 2026-09-27)

- Commons now returns thumbnails on **`thumb.wikimedia.org`** as well as
  `upload.wikimedia.org`. The CSP in `netlify.toml` only allowed the latter,
  so 557 photos (~100 destinations, all the new old towns) showed
  placeholders on the live site while looking fine locally (no CSP locally).
  Both hosts are now in `img-src` and `connect-src`, and
  `tools/test-photos.mjs` fails if any photo host is missing from either.
- An installed service worker keeps the CSP it was delivered with, so a CSP
  change only reaches returning visitors when `sw.js` changes. `netlify.toml`
  is now part of the `CACHE_VERSION` fingerprint in `build-data.mjs` for that
  reason — always rebuild after editing it.

## Christmas Markets (added 2026-09-28)

- New rated criterion **`christmasMarkets`** (Culture, after Markets &
  Bazaars), with a **calendar gate**: `gate.months` in `criteria.json` is 12
  factors Jan..Dec (Jan 0.2, Nov 0.5, Dec 1, else 0), handled in
  `scoreCriterion` alongside the climate gates. Out of season it scores 0
  with "No Christmas markets this month".
- Archetype baseline 0; 197 destinations rated by judgement (Nuremberg 99,
  Strasbourg/Alsace 99, Dresden 98, Vienna 97, Cologne/Salzburg/Prague/
  Tallinn/Zagreb 95…). Unrated = no notable market.

## Fiction catalogue: The Lands Between (added 2026-10-01)

- New destination **`lands-between`** (Elden Ring) in
  `data/fiction/destinations/08-games-and-dystopias.json`, alongside the
  other game worlds (Tamriel, Hyrule, Faerûn, Azeroth, Mushroom Kingdom).
  Country code `ELDN` (new row in `countries.json` and `sources.json`).
  Archetype `dark-realm` — full judged `r` block, not just the archetype
  default (scenery 96, combat 98, ruins 96, safety 3, familyFriendly 3).
- Photorealistic AI-generated imagery (not Wikimedia stand-ins) is being
  rolled out across the fiction catalogue separately — see the ComfyUI
  pipeline at `D:\AI\ComfyUI\vg\` (outside this repo). Lands Between's six
  images were generated as part of that; nothing from that pipeline is
  wired into `photos.json` yet.
- **Revert path for that rollout:** `photo-reserve/` (in this folder, ~700 MB,
  excluded via `.git/info/exclude`, never committed) holds a 2026-09-30
  snapshot of the fiction JSON plus full-size originals of every Wikimedia
  fiction photo. Moved here from `D:\Claude\vacation-guru-photo-reserve`.
- Full rebuild + `npm test` run clean before committing (348 destinations,
  154 tests, zero failures).

## Four more video game worlds (added 2026-10-02)

- **Rapture** (`rapture-bioshock`, BioShock), **City 17** (`city-17`,
  Half-Life 2), **Yharnam** (`yharnam`, Bloodborne), **The House of Hades**
  (`house-of-hades`, Hades) — all in `08-games-and-dystopias.json` alongside
  the Lands Between. New country codes `RAPT`/`CMBN`/`YHRN`/`HADS`.
  Chosen deliberately to cover genres the existing game-world roster
  (Elder Scrolls, Zelda, Forgotten Realms, Warcraft, Mario, Elden Ring —
  all fantasy-RPG) didn't: underwater dystopia, occupied-Earth sci-fi,
  Gothic horror, and a modern Greek-myth retelling that sits next to Dante's
  Inferno and the Odyssey without duplicating either.
- 352 destinations now. Rebuild + `npm test` clean before committing.

## Real-world photo mismatch pass (2026-10-20)

- Audited the real-world photo set (704 destinations, 4224 topics) for
  genuinely wrong matches — not just loosely-topical ones. Worst case found:
  Prague Castle's topic resolved to the Golden Gate Bridge. Others: Tunisia's
  Star Wars set topic resolved to a plant called "desert rocket"; a Bahamas
  yacht topic resolved to a yacht photographed in Poole, Dorset; Wanaka's ski
  field topic resolved to Lake Wakatipu at Queenstown (the wrong lake).
- Fixed by rewording the source `photos` topic strings (23 destinations) so
  the search has a specific place-name anchor, then re-running
  `tools/build-photos.mjs --force --only <ids>` — never by hand-editing
  `data/photos.json` directly, since it's regenerated from `destinations.json`
  (itself built from the shards) on every build.
- `tools/build-photos.mjs` reads the *built* `data/destinations.json`, not
  the source shards — a shard edit needs `node tools/build-data.mjs` before
  re-running the photo resolver, or it re-resolves against stale topic text.
- `--force --only <id>` re-resolves *every* topic for that destination, not
  just the one you changed. Commons search isn't fully stable run-to-run, so
  this can silently swap a previously-fine photo for a worse one on a topic
  you never touched — caught one this way (the Bahamas yacht/Dorset mismatch
  above came from this, not from a deliberate edit). Diff `photos.json`
  before/after by path (ignoring the upload/thumb host, which rotates even
  for an unchanged match) to catch this.
- `REJECT_ALWAYS` in `build-photos.mjs` strengthened: `\bmap\b` doesn't match
  inside compound words like "OpenStreetMap" (no word boundary mid-string),
  so added literal `openstreetmap`, `locator`, `banknote`/`bank note`,
  `currency` to the reject regex.
- **Second pass (2026-10-21), covering what the first pass skipped:** fetched
  Wikimedia categories for all 4102 resolved photos and cross-checked each
  against its destination's actual country (plus demonym aliases — "Holland"
  for Netherlands, "Fort-de-France" false-matching "France", etc.). Found 38
  candidates, 19 real: Amritsar's Golden Temple resolved to Kyoto's
  Kinkaku-ji; Cartagena, Colombia's clock tower resolved to Cartagena, Spain's;
  Tikal's "Flores island" resolved to Flores, Indonesia; Yala's safari topic
  broadened down to plain "Yala" and resolved to Yala, Thailand. Also a
  same-day full-catalogue sweep for cemetery/grave/memorial-tagged photos
  (the original complaint that started this whole effort) — one real hit:
  Cinque Terre's "terraced vineyards" topic resolved to a cemetery photo.
  Everywhere else that keyword showed up (Recoleta Cemetery in Buenos Aires,
  the Mausoleum at Halicarnassus in Bodrum, the Hiroshima Peace Memorial) was
  genuinely significant to that destination, not a mismatch.
- A Commons search result that shares a filename-metadata batch with an
  unwanted photo (same photographer, same shoot, overlapping place-name
  words) can keep outranking the photo you actually want no matter how you
  reword the topic — reword toward the OTHER photo's own distinguishing
  words instead of adding more of the words it already shares. Cinque
  Terre's vineyard topic kept losing to a cemetery photo from the same
  photoshoot until the topic was reworded to "Vineyards Terraces Volastra"
  — the vineyard photo's own title — instead of "Corniglia ... terraced
  vineyards", which both photos' titles matched equally well.
- Still not exhaustive: the ~3050 photos with no country name anywhere in
  their title/categories were sampled (40 of them) rather than checked in
  full — every sampled one was fine, so this bucket is low-yield, but it's
  sampled, not cleared.

- **Third pass (2026-10-21): the full "broadened" list.** `tools/audit-photos.mjs
  --all` lists every topic where `queryVariants()` had to shorten the search
  before anything matched (632 of them) — this is the single highest-yield
  bucket, since broadening down to one or two generic words is exactly the
  mechanism that caused most of the mismatches found across all three
  passes. Read all 632 by hand (not just the ones a heuristic flagged) and
  found ~39 more real mismatches, mostly name collisions between a real
  place and a differently-located one that happens to share a word:
  Monaco's skyline resolved to Guangzhou, China (both searched well on
  "skyline"); the Wachau's "Dürnstein blue church" resolved to Ulm, Germany
  (missing umlaut — "Durnstein" without it ranks differently on Commons than
  "Dürnstein"); Jersey's "Jersey Royal potatoes" resolved to New Jersey, USA
  farming; Anguilla's "Meads Bay" resolved to Bristol Temple Meads railway
  station; Eleuthera's "Glass Window Bridge" resolved to a literal window at
  a pub called The Bridge Inn; the Channel Islands' Sark resolved to
  California's Channel Islands. A few were wrong-content-type rather than
  wrong-place: Provence's market topic resolved to a Van Gogh painting,
  Panama's sloth topic resolved to an 1880s canal-company stock certificate,
  Hawke's Bay's cycle-trail topic resolved to 1931 earthquake committee
  meeting minutes (a PDF, not even nominally a photo).
- **A topic with no capital letters silently resolves to nothing.**
  `queryVariants()` requires `/[A-Z]/.test(candidate)` on every variant it's
  willing to try, including the full query itself — reasoning that a query
  with no proper noun has stopped being about a place. Wrote a replacement
  topic as all-lowercase once ("humpback whale ocean tail fluke") and it
  produced zero variants, hence zero search attempts, for no logged reason.
  If a fresh topic rewrite resolves to nothing with no entry in the
  resolver's own "no usable image" list explaining why, check capitalization
  before anything else.
- **A topic fixed in the source but never re-resolved stays stale.** Fixed
  Yala's "coastal lagoon" topic (was resolving to Panama, the country, via
  the real Panama's own "Panama Island") by editing the shard, but moved on
  to the next finding without re-running `build-data.mjs` + `build-photos.mjs
  --only yala-lk` for it specifically. `photos.json` kept the old Panama
  photo for an entire extra pass until a blanket before/after diff caught
  it. A topic edit does nothing to `photos.json` until the resolver actually
  re-runs for that destination.
- `--force --only <ids>` across a large batch (here, 37 destinations at
  once) is slow enough under today's Commons rate limiting to exceed even a
  20-minute background timeout and get killed mid-run — harmlessly, since
  `build-photos.mjs` writes `photos.json` incrementally and already-written
  destinations survive; just resume with the remaining `--only` ids.
- Transboundary features spanning two countries (Victoria Falls, visible
  from both Zambia and Zimbabwe; the Ai-Ais/Richtersveld park straddling
  Namibia and South Africa; the Sundarbans spanning Bangladesh and India)
  were judged case by case rather than auto-flagged or auto-fixed — a photo
  from the "wrong" side of a shared landmark isn't the same kind of error as
  Monaco vs. Guangzhou, and sometimes (Victoria Falls) was left alone.

- **Fourth pass (2026-10-21): proper-noun overlap on the "exact match"
  bucket.** The ~3050 exact-match photos with no country name anywhere in
  their metadata (sampled, not fully checked, in the second pass) still
  hid same-country/same-word collisions a country-level check can't see.
  Re-ran the check requiring the topic's own specific proper nouns (not
  just the country) to appear in the photo's title/categories. Found 6
  more: Mycenae's "lion gate" resolved to the Lion Gate at Hattusa, Turkey
  (both ancient sites use that name for their own gate); Mykonos's beach
  topic resolved to Agia Napa, Cyprus; Montréal's mural topic resolved to
  Vancouver's mural festival; Los Cabos' grey whale topic resolved to
  Cabrillo National Monument in San Diego; Florence's countryside topic
  resolved to the Florence American Cemetery (a real, correctly-located
  site — just a solemn one for a "rolling hills" topic); Ruaha's elephant
  topic resolved to a train.
- Re-verify collateral changes after *every* `--force` batch, not just the
  first one — two more turned up fixing the proper-noun batch itself:
  Montréal's untouched bagel topic drifted to a Vancouver bagel shop, and
  Los Cabos' untouched desert-coast topic drifted to a Sahara dust-storm
  satellite image. Neither was touched by that round's edits; both were
  caught only by diffing the full photos.json against the very first
  pre-session baseline, not against the previous round's output.
- Four passes in, the remaining unknown is whatever survives a proper-noun
  check with no country AND no specific-enough proper noun to test against
  — a short, generic topic whose match is simply wrong in a way neither
  heuristic can see. Not pursued further; diminishing returns against the
  3+ hours already spent, and zero real misses found in the last ~700
  entries checked this way.

- **Fifth pass: replicas and content-type on the full set.** A cheap
  category-keyword sweep (no new API calls, reused the category cache)
  for `replica`/`reproduction` and for illustration/engraving/poster/stamp
  found 3 more real ones out of 15 flagged: Xi'an's Terracotta Army topic
  resolved to a replica display at Buscot Park, England; Big Sur's "Point
  Sur Lighthouse" topic resolved to Pigeon Point Lighthouse, a different
  lighthouse on the same coast; Guernsey's coastal-cliff topic resolved to
  a replica WWII gun at a wartime battery (right island, wrong subject).
  Most of the 15 flagged were correct and intentional — Lascaux's own
  topic says "replica" because the real cave is closed to visitors and
  Lascaux II is the official substitute; the painting/fresco hits were
  all genuinely significant site art (Ohrid's Byzantine frescoes, Bagan's
  temple murals, Delft's own pottery-painting craft).
