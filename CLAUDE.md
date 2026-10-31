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

- Two parallel threads of photo-quality work are active:
  1. Fiction catalogue — replacing weak/redundant/mismatched photos with
     bespoke AI-generated images (see "Wiring AI-generated photos into the
     fiction catalogue" below). 7 destinations done; more will follow as
     the user flags further ones via `D:\AI\ComfyUI\vg\fiction-browser.html`.
  2. Real-world catalogue — **full first-pass visual coverage complete**
     (see "Real-world photo mismatch pass" below): all 692 destinations
     with a resolved hero photo have been looked at once, across 37
     passes, 30 real mismatches found and fixed. `tools/photo-review-log.json`
     has the full record. Resuming now means a second pass over the same
     destinations (likely much lower yield) — worth confirming with the
     user before restarting rather than assuming it's wanted.

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
- **Ciudad Real & Almagro** (`ciudad-real-es`, added 2026-10-31) appended
  to the same shard: La Mancha, theatre 90 (Corral de Comedias / Almagro
  classical theatre festival, hence the July crowd/price bump), wine 86
  (Valdepeñas), transfer 1.5h (Madrid airport + AVE). Photos visually checked.
  Note `peacefulness` is computed at runtime — the build rejects it in `r`.
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

- **Sixth pass (2026-10-21): actually looking at the photos.** Five text
  heuristics in a row had diminishing returns, so switched to downloading
  and visually opening a spread sample of hero (first) photos. Found two
  real mismatches no text check had caught: Dubrovnik's "city walls
  aerial" topic was showing Ston — a real, nearby, but different walled
  town — and Aarhus's "rainbow panorama" topic was showing the ARoS
  museum's plain interior staircase (filename said "Treppenhaus") instead
  of the actual rainbow-glass rooftop walkway. Both had been read over
  without concern in earlier passes' text review; seeing the image made
  the mismatch obvious in a way the asked/got topic pair alone did not.
  Also caught, from the free `destId` dump used to build the sample
  (zero cost): Menorca's cove topic resolving to a beach explicitly
  titled and categorized as Mallorca — a different island. The only
  reason the proper-noun check (pass four) missed it: the photo's one
  "Menorca" category hit was *Canal de Menorca*, the strait between the
  two islands, not the island itself — a word match that was real but
  contextually wrong. A same-word category on an adjacent/connecting
  feature is a blind spot no automated check here closes.
- **Satellite imagery was a bigger, structural problem, not isolated
  mismatches.** The `REJECT_ORBITAL` filter only tested the file's title
  and URL — but Commons' satellite photography (Copernicus, Landsat,
  NASA Earth Observatory, ESA, Planet Labs, Envisat, Maxar) frequently
  ships under an innocuous filename like "Bazaruto Archipelago National
  Park, Mozambique.jpg", with the giveaway ("Copernicus Sentinel-2
  imagery", "NASA Earth Observatory images by...") only in the credit.
  Extended the check to the credit/Artist field, then found 13 more
  satellite composites already resolved and sitting in `photos.json` from
  *before* this session even started — including two of this session's
  own earlier "fixes" (Ravenna's lagoon from round 1, Los Cabos' desert
  coast from round 4) that had picked a satellite photo and gone
  undetected because its filename alone looked fine. A free, no-API-call
  sweep of `photos.json`'s already-stored `credit` field (never checked
  against before) found these at zero cost — worth doing before any new
  Commons queries, since the data already answers the question.
  `REJECT_ORBITAL` now also matches `planet labs`, `maxar`,
  `digitalglobe`, `european space agency`, `envisat`, `earth observatory`,
  and an `ESA\d{4}`-style catalogue-number pattern, alongside the
  original Copernicus/MODIS/Landsat/Sentinel/NASA/ISS terms.
- Four Bazaruto/Mozambique topics and a few others now sit unresolved
  (honest placeholder) rather than showing the best available match,
  because the best available match on Commons for those specific scenes
  was *only* satellite imagery — no ground photo exists. Unresolved is
  the correct outcome there, not a regression.
- A same-destination duplicate-image check (two topics in one
  destination's gallery resolving to the identical file) and a
  cross-destination reuse check (the same file used by two different
  destinations) were both run and found **zero real problems** — every
  cross-destination reuse was a legitimate shared landmark between
  adjacent/overlapping destinations (Maroon Bells near both Aspen and
  Denver, Aitutaki within the Cook Islands, Dahab's Blue Hole shared by
  the Sinai and Red Sea destinations). Worth running once, not worth
  repeating.
- Separately noticed, not a photo issue: the destination `id:
  "lake-malawi-mz"` has `name: "Mozambique's Coast"` — a stale id left
  over from an earlier rename, in `data/destinations/16-africa-more.json`.
  Harmless (photos.json is keyed consistently off the same id either
  way) but worth a deliberate rename if anyone's reading the id as
  documentation.

- **Seventh pass (2026-10-21): a second visual-inspection sample, 25 more
  hero photos.** Two more real finds, same pattern as pass six — plausible
  in text, wrong once seen: Black Forest's "fir trees" topic was showing
  a mowed suburban field with electricity pylons (filename: "Black Forest
  Power Line1.JPG" — technically within the region's boundary, but no
  forest in the frame at all); Easter Island's "Moai statues" topic was
  showing a **museum exhibit replica** — a single moai indoors on a tiled
  pedestal, railed off, with a Spanish "no sentarse / no sacar piedras"
  sign and a printed photo backdrop standing in for the real landscape.
  Everything else in the 25-photo sample checked out, including one
  photo worth noting as a *non*-issue: Verona's opera topic resolved to
  an authentic 1958 black-and-white photo of an actual Nabucco
  performance in the Arena — old, but not a mismatch, so left alone.
  Two visual passes (50 photos total) have now each found roughly 2 real
  mismatches text heuristics missed — a steady, non-trivial hit rate that
  the earlier text-only passes had stopped matching by their final
  rounds. If continuing this work later, another visual sample is likely
  still worth more than a sixth text heuristic.

- **Eighth pass (2026-10-22): a third visual sample, 25 more hero photos.**
  One real find, a new failure mode: the Azores' "Sete Cidades crater
  lake" topic resolved to a file literally titled "...– 360° panorama" —
  a raw equirectangular panorama with a visibly curved horizon and the
  photographer's tripod/camera gear in frame, not a normal photo. A free
  catalogue-wide check for other 360°-panorama files (same pattern as the
  satellite-credit sweep — check what's already in `photos.json` before
  spending API calls) found exactly one other, Atacama's night-sky topic,
  which was left alone: a night-sky panorama has no horizon to look
  warped, so unlike the Azores case it isn't visually a problem. The rest
  of the 25-photo sample checked out clean, including a correct-but-dull
  one (Glasgow's Kelvingrove topic shows the right museum, just obscured
  behind a sportsground fence — not a mismatch, just not a great photo).
  Three visual passes, 70 photos, 5 real finds — the hit rate is holding
  up; still the better move than another text heuristic if resuming.

- **Ninth pass (2026-10-22): a fourth visual sample, 25 more hero photos.**
  One real find, the clearest case yet of a mislabeled Commons upload:
  Denver's "Red Rocks amphitheatre Colorado" topic resolved to
  `Red_Rocks_Amphitheatre,_Colorado_18.jpg` — a file in that exact
  numbered series (`..._1.jpg`, `..._3.jpg`, `..._16.jpg` are all genuine
  amphitheatre photos) that actually shows an unrelated decorative floor
  plaque with an engraved architecture quote. Nothing about the title or
  categories would catch this — the file is simply mislabeled at the
  source. Reworded to a phrase that avoids that one file in the series.
  Four visual passes, 95 photos, 6 real finds (~6%) — still worth doing;
  not yet seeing the hit rate taper the way the text heuristics did.

- **Tenth pass (2026-10-22): a fifth visual sample, 25 more hero photos.**
  One real find: Huaraz's "Laguna 69 Peru turquoise" topic (the famous
  glacial lake) resolved to a fox photographed on the trail up to it —
  filename ended in "raposa" (Portuguese for fox), from the same
  photographer's series as the lake shots but not the lake itself.
  Reworded to a phrase that surfaces the actual lake photo. Five visual
  passes, 120 photos, 7 real finds (~6%) — the hit rate across ~500 photos
  sampled so far (text heuristics + visual) holds around this level;
  continuing to sample the remaining ~580 destinations not yet reviewed
  by any method is still the most productive next step if resuming.

- **Permanent review log, `tools/photo-review-log.json` (added 2026-10-23).**
  Passes 1-10 never recorded which specific destinations had been visually
  sampled and found clean — only the real finds got named in this file — so
  there was no way to avoid re-sampling the same ~120 already-checked
  destinations when resuming. This file now records every destination
  reviewed (pass, date, method, clean/fixed, and a note for anything
  non-obvious), seeded with every fix from passes 1-10 as best as they
  could be reconstructed from this file's own prose. **Pull the next
  sample's candidates by excluding `Object.keys(log.reviewed)`, and log
  every destination touched — clean ones too — before ending a pass.**

- **Eleventh pass (2026-10-23): first pass using the new log, 25 more hero
  photos.** One real find: Banaue & the Cordilleras' "Batad rice terraces
  amphitheatre" topic resolved to Tappiyah Falls — a real waterfall
  actually in Batad, but with no terraces anywhere in frame. Same shape as
  the Florence/cemetery case in pass four: correctly located, wrong
  subject for what the topic promises. Reworded to "Batad rice terraces
  panoramic viewpoint"; re-resolving incidentally also improved the
  destination's second topic (Banaue's own terraces had itself been
  pulling a Batad photo, now pulls a genuine Banaue one). Two others
  looked suspicious at first glance and turned out fine on checking their
  title/credit: Guernsey, Sark & Herm's "Sark island" topic shows the
  Seigneurie, Sark's actual landmark building, not a landscape shot but
  not wrong; the Solomon Islands' "Gizo" topic is a genuine, correctly
  titled aerial coastal photo with a US Navy vessel incidentally in frame.
  Six visual passes, 145 photos, 8 real finds — still worth doing.

- **Twelfth pass (2026-10-24): 25 more hero photos.** One real find: Moorea's
  "bungalows Tahiti" topic resolved to the Musée de Tahiti — a museum
  building, not bungalows at all. Checked directly against Commons: there
  is no photo of Moorea's own overwater bungalows findable under any
  generic phrasing ("Moorea overwater bungalows", "Moorea lagoon resort",
  etc. all return nothing or unrelated results) — the only way to surface
  one was to name the actual resort, "Sofitel Moorea overwater bungalows".
  **When a topic keeps coming up empty or wrong under every generic
  rewording, search Commons directly for the specific hotel/landmark/event
  name behind the scene — a generic description often has no dedicated
  photo, but the specific place that provides the scene usually does.**
  Two others looked questionable but checked out: Savannah's "squares
  Spanish moss" topic shows the Oglethorpe Monument, a real statue
  genuinely standing in one of Savannah's squares, just not showing moss
  specifically. Seven visual passes, 170 photos, 9 real finds.

- **Thirteenth pass (2026-10-24): 25 more hero photos.** Two real finds.
  Niseko's "powder skiing Japan" topic resolved to an indoor hotel bar
  (a New Year's Eve party photo) — no snow or skiing anywhere in frame.
  Doha's "Museum of Islamic Art" topic hit a mislabeled Commons file —
  title says the museum, content shows an unrelated spiral minaret tower
  — same failure class as Denver's Red Rocks file in pass 9, except this
  time **the correct and incorrect files share an identical generic
  title** ("Museum of Islamic Art, Doha"), so a descriptive reword
  ("...courtyard arches") still matched the wrong file; only anchoring on
  the one candidate with a genuinely distinct title ("...Park, Doha")
  broke the tie. **When two files share a title, describing the content
  you want doesn't help — you have to find a title word unique to the
  right file.**
- **A `--force --only` re-resolve on one destination can introduce a new
  mismatch on a topic you didn't touch, not just on the one you edited** —
  re-fixing Niseko's ski topic collaterally re-resolved its onsen topic
  from a correct (if unremarkable) match to Tsunagi Onsen, a real hot
  spring ~600km away in Morioka, Iwate — caught only by noticing the name
  didn't sound like a Hokkaido place and checking its Commons categories.
  Fixed, then **re-resolved that one topic WITHOUT `--force`** — the
  resolver's reuse-skip cache leaves every topic whose text didn't change
  untouched on a non-force run, so this is the safer default whenever
  only one topic in a multi-topic destination actually needs re-resolving;
  reserve `--force` for when every topic genuinely needs a fresh query.
  Eight visual passes, 195 photos, 11 real finds.

- **Fourteenth pass (2026-10-24): 25 more hero photos.** Two real finds,
  both unusually stubborn to fix. Lake Balaton's "beach" topic resolved to
  a hospital therapy pool ("Balatonfüred Heart Hospital. Beach pool.").
  The one Commons file with an exactly-matching title turned out to be
  only 500×332px — too small to generate the site's 1280px full image, so
  the resolver silently skipped it regardless of rewording. **When a topic
  keeps resolving wrong despite an apparently perfect-title file existing,
  check that file's own resolution before assuming the search/matching
  logic is at fault.** Fixed by anchoring on a 4000px alternative
  ("Kisfaludy Beach, Balatonfüred"). Genoa's "Via Garibaldi palazzi" topic
  resolved to a UNESCO building-designator plaque; worse, **Genoa has
  multiple roads named after Garibaldi** (including an unrelated car
  tunnel), so every generic rewording of the street name kept re-matching
  one wrong file or the other — fixed only by abandoning the street name
  entirely and anchoring on a uniquely-titled photo from the official
  UNESCO documentation series instead ("Genoa Strade Nuove Palazzi dei
  Rolli"). **A `--force` re-resolve, even restricted to one destination
  with `--only`, is not needed when just one topic's text changed** — use
  the bare (non-force) resolver run so only that changed topic re-queries;
  this session did it both ways this pass and the non-force path left the
  other 5 topics provably untouched, confirmed by immediate reuse counts.
  Nine visual passes, 220 photos, 13 real finds.

- **Fifteenth pass (2026-10-24): 25 more hero photos, zero real finds.**
  Three looked questionable and all turned out legitimate on checking
  title/metadata: Muscat's mosque topic shows an unexpected painted
  ceiling but is part of a genuinely-titled photo series from the actual
  complex; Toruń's "Gothic old town" topic shows the Town Hall's interior
  ("wnętrza ratusza"), the right building, just not the exterior street
  view; Skopje's bazaar topic is a genuinely-titled elevated view over the
  district rather than a street-level shot. First fully clean pass since
  the eleventh — a reminder that not every pass finds something, and a
  clean pass is itself useful signal, not a wasted one.

- **Sixteenth pass (2026-10-24): 25 more hero photos, zero real finds.**
  Second clean pass in a row. Two more candidates checked and cleared the
  same way as pass fifteen's: Cape Town's "Table Mountain" topic shows a
  close-up of exposed summit-plateau rock/fynbos rather than a skyline
  silhouette, but is genuinely part of a titled Table Mountain photo
  series; Johannesburg's Apartheid Museum topic shows an interior
  installation (suspended rock-filled cages behind a flag), a real and
  evocative exhibit at the actual museum. 189 destinations now logged
  (27% of 704) across 16 passes; the unreviewed remainder keeps shrinking
  as a straightforward random sample each time, no special selection
  needed.

- **Seventeenth pass (2026-10-24): 25 more hero photos.** One real find,
  a double mismatch: Quito's "old town colonial Ecuador" topic resolved
  to a historical engraving of **Cayambe** — a different Ecuadorian town
  entirely, nothing to do with Quito — and it wasn't even a photo, an
  antique book-plate illustration that slipped past the "no book scans or
  schematics" test because it's a hand-drawn engraving, not a flat scanned
  page (that test's filter was built around scanned documents, not
  illustrated plates — a gap worth remembering for future finds of this
  shape). Fixed by anchoring on a genuine high-resolution photo of the
  colonial old town from El Panecillo hill. 214 destinations now logged
  (30% of 704) across 17 passes, 14 real finds.

- **Eighteenth pass (2026-10-24): 25 more hero photos.** One real find,
  another replica case: Trier's "Porta Nigra Roman gate" topic resolved
  to a small bronze tactile scale model sitting on a plinth (the real
  gate blurred out of focus behind it) — same failure class as Easter
  Island's museum-replica photo in pass 7 and a reminder that this
  failure mode recurs across completely unrelated destinations and is
  worth specifically checking for whenever a monument photo looks
  slightly *too* small or oddly framed relative to the people around it.
  Fixed by anchoring on a 20,000px full-resolution genuine exterior shot.
  Two others double-checked and cleared: Yasawa Islands' "beach" topic is
  a genuinely-titled close-up composition, not a mismatch; Ifrane's
  alpine-looking lake photo is real — Ifrane is nicknamed "the Switzerland
  of Morocco" for exactly this scenery. 239 destinations now logged (34%
  of 704) across 18 passes, 15 real finds.

- **Nineteenth pass (2026-10-24): 25 more hero photos.** One real find,
  the same broadening failure mode as several earlier passes: Sifnos's
  "Folegandros chora cliff village Greece" topic (the destination covers
  both islands) broadened down to generic "cliff village Greece" and
  matched the Cliffs Of Santorini instead — a third, unrelated Cycladic
  island. Fixed by anchoring on a specific, correctly-titled Folegandros
  Chora photo. 264 destinations now logged (37% of 704) across 19 passes,
  16 real finds.

- **Twentieth pass (2026-10-24): 25 more hero photos.** One real find, a
  literal-word-match mismatch: Uruguay's "Punta del Este La Mano
  sculpture" topic resolved to a jewelry product photo titled "Hand and
  power stone bracelets" — matched on nothing but the word "hand". Fixed
  by anchoring on the sculpture's own Spanish name, "La mano de Punta del
  Este". 289 destinations now logged (41% of 704) across 20 passes, 17
  real finds.

- **Twenty-first pass (2026-10-24): 25 more hero photos, zero real
  finds.** Fully clean pass. 314 destinations now logged (45% of 704)
  across 21 passes, 17 real finds overall.

- **Twenty-second pass (2026-10-24): 25 more hero photos.** Two real
  finds, both a new variant of the recurring "right place, wrong subject"
  pattern — genuinely located at the destination, correctly titled, but
  not showing what the topic promises. Tobago's "Pigeon Point beach"
  topic resolved to the park's entrance booth/parking kiosk, not the
  beach; fixed by anchoring on the site's iconic thatched-roof jetty
  photo instead. Cairo's "Pyramids of Giza" topic resolved to a photo
  genuinely taken at Giza during the real "Forever is Now" art
  exhibition, but the pyramids are reduced to a small background detail
  behind a dominant modern wire sculpture that dominates the frame; fixed
  by anchoring on an actual panorama of all the pyramids. Two others
  checked and cleared the same way: Coimbra's library topic shows the
  genuine entrance portal, not the interior, but is correctly titled;
  Portland's food-cart topic shows an adjacent bar building but is
  verified via Commons categories as a real photo from the actual
  "Cartside Food Carts" location series. 339 destinations now logged
  (48% of 704) across 22 passes, 19 real finds.

- **Twenty-third pass (2026-10-24): 25 more hero photos, zero real
  finds.** Fully clean. Three checked and cleared: Delft's market-square
  topic is a genuine 1743 Rijksmuseum engraving (same precedent as
  Heidelberg, pass 13); Chiang Mai's temple topic shows a painted village
  mural rather than the golden chedi, but is part of the temple's own
  numbered photo series; Poznań's market-square topic shows an
  archaeological dig, a real and correctly-dated renovation at the actual
  square. 364 destinations now logged (52% of 704, past the halfway
  point) across 23 passes, 19 real finds overall.

- **Twenty-fourth pass (2026-10-24): 25 more hero photos.** One real
  find, a new content-type case: Alaska's "Denali mountain" topic
  resolved to a hand-painted National Park Service panorama illustration
  by Heinrich Berann — genuine official NPS artwork, but artwork, not a
  photograph, with its "without_labels" filename making it easy to
  mistake for a photo at a glance. Same shape as the Quito/Cayambe
  engraving (pass 17) and the Trier tactile model (pass 18) — the content
  type itself was wrong, not just the place. Fixed by anchoring on a
  genuine aerial photograph, "Wonder Lake and Denali." One other checked
  and cleared: Lübeck's Holstentor topic shows an interior vaulted
  ceiling rather than the famous twin-towered exterior, but is genuinely
  categorized as part of the monument. 389 destinations now logged (55%
  of 704) across 24 passes, 20 real finds.

- **Twenty-fifth pass (2026-10-24): 25 more hero photos, zero real
  finds.** Fully clean. Three more checked and cleared the same way:
  Sarajevo's Baščaršija topic shows a tourist info board (correctly
  located, poor hero shot); Loire's Chambord topic shows an antique
  carriage from a real 2016 exhibition held at the château; Canberra's
  War Memorial topic shows ANZAC Parade toward Parliament House, taken
  from the Memorial's own steps. 414 destinations now logged (59% of
  704) across 25 passes, 20 real finds overall.

- **Twenty-sixth pass (2026-10-24): 25 more hero photos, zero real
  finds.** Fully clean — third clean pass in a row. Trinidad's Carnival
  topic shows costume mannequins at a "Mas Camp" (a real masquerade
  costume workshop), correctly located in Port of Spain, checked and
  cleared. 439 destinations now logged (62% of 704) across 26 passes, 20
  real finds overall.

- **Twenty-seventh pass (2026-10-24): 24 of 25 hero photos (Quebec
  City's download failed repeatedly and was left unlogged for a future
  pass), zero real finds.** Fourth clean pass in a row. 463 destinations
  now logged (66% of 704) across 27 passes, 20
  real finds overall. The hit rate has visibly tapered since the mid-20s
  passes (zero finds in passes 21, 23, 25, 26, 27) — consistent with the
  project's standing observation that the easiest, most obvious
  mismatches surface first.

- **Twenty-eighth pass (2026-10-24): 25 more hero photos, zero real
  finds.** Fifth clean pass in a row. Two checked and cleared: St Kitts'
  fortress topic shows a plantation-style cottage (part of the actual
  fortress grounds, a real numbered photo series); Biarritz's beach-surf
  topic shows a distant nighttime view of the Basque coast from the
  Ibardin pass — correct region, genuinely titled, but about as weak a
  representative shot as this project has found without crossing into
  outright mismatch. 488 destinations now logged (69% of 704) across 28
  passes, 20 real finds overall.

- **Twenty-ninth pass (2026-10-24): 25 more hero photos.** Two real
  finds, breaking the clean streak. Hunter Valley's topic broadened from
  "vineyard rows" down to generic "Hunter Valley" and resolved to a
  genuine open-cut coal mine in the same region — the wrong subject for
  a wine-tourism destination even though it's a real place with that
  exact name. Fixed by anchoring on a specific high-resolution photo
  from the real "Hunter Valley Vineyards" series. Stewart Island's "kiwi
  bird" topic resolved to a taxidermy specimen at Otago Museum — in
  Dunedin, not even on Stewart Island, and not alive. Commons has
  essentially no usable photos of wild kiwis (they're nocturnal and
  rarely photographed); fixed by anchoring on a genuine live kiwi
  photographed at a sanctuary at night — not from Stewart Island
  specifically, but a live bird is a meaningfully better representation
  than a taxidermy mount from a different city entirely. **When no photo
  of the literal specified subject exists, a live/authentic example of
  the general subject beats a technically-closer but fundamentally wrong
  one (taxidermy, replica, model).** 513 destinations now logged (73% of
  704) across 29 passes, 22 real finds overall.

- **Thirtieth pass (2026-10-24): 25 more hero photos.** One real find,
  the same "right place, wrong subject the topic promises" shape as
  Tobago (pass 22): Liverpool's "Albert Dock waterfront" topic resolved
  to a photo of a portable tennis court set up at the dock — genuinely
  there, but with no warehouse architecture or waterfront visible at
  all. Fixed by anchoring on an aerial photo of the actual brick
  warehouse waterfront. 538 destinations now logged (76% of 704) across
  30 passes, 23 real finds overall — only ~166 destinations remain
  unreviewed, so full catalogue coverage is close.

- **Thirty-first pass (2026-10-24): 25 more hero photos, zero real
  finds.** Fully clean. Noticed Glasgow has two separate catalog entries
  (`glasgow-uk`, reviewed pass 8, and `glasgow-gb`, this pass) — both
  show Kelvingrove with a similar minor foreground obstruction; neither
  is a mismatch, just worth knowing the id split exists if the catalogue
  is ever de-duplicated. 563 destinations now logged (80% of 704) across
  31 passes, 23 real finds overall.

- **Thirty-second pass (2026-10-24): 25 more hero photos.** One real
  find during the sample, plus a second found via a free sweep. Åland's
  "archipelago" topic resolved to a NASA satellite image credited to
  "Jesse Allen and Robert Simmon" — well-known NASA Earth Observatory
  visualizers, confirmed via Commons categories ("satellite pictures",
  "PD NASA") — that evaded `REJECT_ORBITAL` because neither the filename
  nor those credited names contain any of the filter's trigger words.
  This is a structural gap, not a one-off, so (same technique as the
  real-world sixth pass) **swept the already-resolved `photos.json` for
  other photos credited to the same NASA visualizer names, at zero API
  cost** — found one more: Samburu & Laikipia's "Ewaso Nyiro river" topic
  (index 2, not the sampled hero photo), also a NASA satellite image,
  also credited to Jesse Allen. Both fixed by anchoring on genuine ground
  photos. **`build-photos.mjs`'s `REJECT_ORBITAL` only matches
  institutional/mission keywords, not the individual visualizer names
  NASA Earth Observatory credits its imagery to** — a worthwhile future
  addition to the filter itself, not just a one-off fix, since Jesse
  Allen and Robert Simmon alone are credited on a large fraction of all
  Earth Observatory releases. **Fixed `REJECT_ORBITAL` itself** to add
  `jesse allen|robert simmon|lauren dauphin|joshua stevens` (the two
  confirmed from this session's finds, plus two more frequently-credited
  NASA EO visualizers added preventively, not independently confirmed) —
  this only affects future resolver runs, not already-resolved entries;
  `npm test` still 154/154 after the change. 588 destinations now logged
  (84% of 704) across 32 passes, 25 real finds overall.

- **Thirty-third pass (2026-10-24): 25 more hero photos.** One real
  find, a second instance of the map/illustration content-type issue
  first seen with Denali in pass 24: Glacier National Park's "Going to
  the Sun Road" topic resolved to a literal park map, credited to Tom
  Patterson — an NPS cartographer, not a photographer. Fixed by
  anchoring on a genuine photo of the actual road. Ran a free sweep (same
  technique as the satellite-credit sweep) for other photos credited to
  Tom Patterson or Heinrich Berann across the whole catalogue — zero
  other instances found. One other checked and cleared: Bath's "Royal
  Crescent" topic is genuinely titled and confirmed correct, not
  confused with the similar-looking Circus nearby. 613 destinations now
  logged (87% of 704) across 33 passes, 26 real finds overall.

- **Thirty-fourth pass (2026-10-24): 25 more hero photos.** One real
  find, a species mismatch: Borneo (Sabah)'s "Orangutan Borneo Sepilok"
  topic resolved to a file literally titled "Macaque at Sepilok
  orangutan sanctuary" — right sanctuary, wrong primate entirely (a
  macaque, not an ape). Fixed by anchoring on a genuine orangutan photo
  from the same photographer's own series at the same sanctuary. 638
  destinations now logged (91% of 704) across 34 passes, 27 real finds
  overall.

- **Thirty-fifth pass (2026-10-24): 25 more hero photos.** One real
  find, a case with no clean fix available: Samaná & Las Terrenas'
  "Humpback whale Samana Bay" topic resolved to a river photo from Los
  Haitises — a different, nearby national park, no whale at all. The
  only genuine live-whale photo for this exact location is 720px wide,
  just under the resolver's 800px quality floor, so it was never even a
  candidate — a reminder that **"no good photo was found" sometimes means
  a good photo exists but is too small**, worth checking before assuming
  none exists. Used a full articulated whale skeleton at a dedicated
  whale museum in Samaná instead: not alive, but genuinely whale-related
  and at the right place — the best real option available, same
  trade-off reasoning as the Stewart Island kiwi case in pass 29. Two
  others checked and cleared: Ethiopia's rock-hewn-church topic shows a
  genuine excavated passage within the actual Lalibela complex;
  Sundarbans' topic shows a Purple Sunbird genuinely photographed within
  the real wildlife sanctuary. 663 destinations now logged (94% of 704)
  across 35 passes, 28 real finds overall.

- **Thirty-sixth pass (2026-10-24): 25 more hero photos.** One real find
  and one long-standing download mystery solved. Anguilla's "Shoal Bay
  East" topic resolved to "Brittle stars at East Shoal" — an unrelated
  underwater macro photo from a different dive site entirely (a name
  collision on "shoal" + "east"), credited to a photographer known for
  South African marine life, nothing to do with Anguilla. Fixed by
  anchoring on a genuine, correctly-titled Shoal Bay beach photo.
  Separately, **Quebec City's hero photo had failed to download across
  four separate passes (11, 13, 27, 36)** — turned out the file had been
  renamed on Commons (a redirect), leaving the stored thumb URL pointing
  at a stale path that error'd instead of 404'ing; fetching the file's
  *current* URL via a fresh API lookup worked immediately, and the photo
  itself was correct all along. **A download that fails consistently
  across multiple unrelated sessions, rather than failing once and
  succeeding on retry, may mean the stored URL itself has gone stale —
  worth a fresh `action=query&prop=imageinfo` lookup rather than just
  retrying the same URL.** Two others checked and cleared: Oslo's topic
  is a genuine view from the Opera House's own walkable roof; Tunisia's
  Sahara topic shows the real Roman fort ruins that sit at Ksar Ghilane
  itself, correct location. 688 destinations now logged (98% of 704)
  across 36 passes, 29 real finds overall — only ~16 remain.

- **Thirty-seventh pass (2026-10-27): the final 18, completing full
  first-pass coverage.** One real find, a third word-trap case: Churchill's
  "Polar bear Hudson Bay Canada" topic resolved to a photo literally
  titled "Polar bear express" — the name of an Ontario Northland train
  line, not an actual bear (same shape as the Uruguay/hand case, pass 20,
  and the Hunter Valley case, pass 29: a real place/thing sharing the
  search words, scoring well on text match alone). Fixed by anchoring on
  a genuine wild polar bear photo on the actual Hudson Bay shoreline at
  Churchill. **Every one of the 704 real-world destinations with a
  resolved hero photo (692 — the other 12 have no photo at all) is now
  logged in `tools/photo-review-log.json` under its current id.** 14
  stray entries from the original pass-1-10 seed (`tunisia-sw`,
  `bahamas`, `amritsar-in`, etc.) use now-retired ids and don't match any
  current destination — harmless, left as-is rather than cleaned up,
  since the real destinations they referred to are separately covered
  under their current ids. **706 total log entries across 37 passes, 30
  real finds (~4.3% hit rate overall).** Resuming this work means a
  *second* pass over the same 692 destinations — likely much lower
  yield, since every photo has now been looked at once; worth weighing
  against other priorities before diving back in.

## Wiring AI-generated photos into the fiction catalogue (added 2026-10-22)

- User review tool: `D:\AI\ComfyUI\vg\fiction-browser.html` (built by
  `build-fiction-browser.mjs` in the same folder, outside this repo) shows
  every fiction destination's 6-photo gallery; the user clicks to flag bad
  or too-similar photos and exports a plain-text list (destId + photo
  index + topic) to paste back into chat. User preference: replacements
  should be **AI-generated**, not differently-worded Wikimedia searches —
  matches the photorealistic-imagery rollout already underway (see "Fiction
  catalogue: The Lands Between" above).
- **Generation pipeline:** bespoke, hand-written prompts (never templated)
  per `D:\AI\ComfyUI\vg\PROMPTING.md`'s 9 rules — no negative prompts work
  (cfg=1 zeroes them, every correction must be positive), name real
  materials/wear/mundane detail instead of saying "photorealistic", state
  grandeur alongside weathering for fantastical architecture, never use
  Earth vehicle nouns, never request legible text (omit it, or make it
  illegible by physical damage/blur — a request for "abstract eye motif,
  no face, no text, bleached/torn paper" was needed on a retry after a
  first pass rendered genuinely legible Cyrillic-style text and
  propaganda-poster faces), state non-human scale twice with "adults, not
  children" plus a reference object. Run via `node vg/gen.mjs <batch.json>
  <outdir>` against a local ComfyUI server (FLUX.2 klein 9B, ~90-210s per
  image) — lower the server's (and the node script's) Windows process
  priority to BelowNormal before a long run so it doesn't starve
  foreground work; new processes spawn at Normal each run, so re-check
  after every `gen.mjs` invocation.
- **Always visually inspect before wiring in** — two real failures this
  round neither a good prompt nor a first glance caught: a "ring-shaped
  space habitat exterior" render read as an indoor drum chamber (the
  model interpreted "viewing gallery" as interior) until the prompt was
  rewritten around "photographed through a spacecraft window, looking
  back at the full ring, deep space all around" with no gallery/interior
  language at all; a "propaganda poster wall" render produced legible
  Cyrillic-style text and real-looking political portraits even though
  the prompt never asked for either — caught only by cropping and zooming
  the output, not from the thumbnail. Crop-and-zoom any photo with fine
  detail in a corner before trusting it; thumbnail-resolution review can
  miss exactly the failure the "no text" rule exists to prevent.
- **Wiring script:** `tools/wire-generated-photo.mjs <manifest.json>`
  (manifest: `[{destId, index, topic, pngPath, credit}]`). For each entry
  it (1) shells out to `tools/resize-generated.py` to produce a 500px
  thumb and 1280px full JPEG at `assets/img/thumbs/fiction/<id>-<i>.jpg`
  and `assets/img/full/fiction/<id>-<i>.jpg`, (2) finds the destination's
  shard file by scanning `data/fiction/destinations/*.json` for `"id":
  "<destId>"`, then surgically replaces just the Nth string literal in
  that destination's `photos` array (brace-matched + string-literal
  positional scan, never a full `JSON.parse`/`stringify` of the file —
  that reformats the whole file and produces a huge diff), (3) writes the
  matching record directly into `data/fiction/photos.json`.
- **`photos.json`'s own field name is `photos`, not `photoTopics`** (that
  name only exists in some in-memory/runtime code) — the wiring script
  originally guessed wrong and had to be fixed; check the actual shard
  text if extending this script rather than trusting a field name from
  memory.
- **Local images need a real `license` value, not an empty string** —
  `tools/test-photos.mjs`'s attribution test (`Fiction: every stored photo
  carries its attribution`) requires both `credit` and `license` to be
  truthy for every record with a `full` URL. AI-generated records use
  `license: "AI-generated, no copyright claimed"`. First pass left it `""`
  and failed the test for all 33 records in one shot — `npm test` catches
  this immediately, run it before considering a wiring batch done.
- **Why hand-wired `photos.json` records survive a rebuild:**
  `build-photos.mjs`'s reuse-skip check (`!FORCE && prev.full &&
  (prev.wanted ?? prev.topic) === topic`) leaves an entry alone on an
  ordinary (non `--force`) run as long as its `topic` matches the shard's
  current `photos[i]` string exactly — which the wiring script guarantees
  by construction. `npm run build` (= `build-data.mjs` + `bundle.mjs`)
  never touches `photos.json` at all, so routine builds are always safe
  for these records regardless.
- **Local image paths work exactly like remote URLs** — `js/images.js`
  treats `full`/`thumb` as opaque strings, and `netlify.toml`'s CSP
  already allows `img-src 'self'` (no CSP change needed for local
  assets). `assets/` was previously an unused convention (a `--download`
  flag on `build-photos.mjs` that had never actually been run); this is
  the first time it's been populated and committed. `netlify.toml`'s
  `publish = "."` serves the whole repo root, so no deploy config change
  is needed either — committing `assets/` is sufficient.
- First batch: 33 images across the 7 user-flagged destinations (4 + 5 +
  5 + 3 + 5 + 5 + 6). Two destinations' replacement scope grew beyond
  what the user explicitly flagged, after their *existing* photos.json
  records turned out to hide real mismatches once inspected directly:
  abydos's "Ancient stone ring monument" (meant to be the Stargate) had
  resolved to the Chaukhandi tombs in Sindh, Pakistan; ahch-to's "Remote
  island Atlantic cliffs" had resolved to an ISS satellite photo of open
  ocean (`REJECT_ORBITAL` again — see the real-world sixth pass above).
  Both destinations also had unresolved (placeholder) slots alongside
  the flagged ones, filled in the same pass rather than left half-done.
  Full rebuild + `npm test` clean (57+35+28+17+17 = 154 passed) before
  this was left ready to commit.
