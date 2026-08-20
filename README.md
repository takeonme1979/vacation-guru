# Vacation Guru

Tell it what you actually want from a holiday and which month you can travel, and it
scores every destination it knows about — then shows you the best fits **with the
reasons**, red/amber/green, criterion by criterion.

All the matching happens on-device against bundled JSON. No accounts, no API keys,
no network calls while you use it.

---

## Running it

### Easiest — no server, no install

Double-click **`vacation-guru.html`**. That's the whole app in one 0.55 MB file:
every module, the stylesheet and all the data inlined.

> Opening the multi-file `index.html` from disk **will not work**, and this is why:
> browsers block ES modules on `file://` URLs (origin `null`), so the entry script
> never executes and the page sits on "Loading destinations…" for ever. `index.html`
> now detects this and says so on the page rather than hanging silently — but the
> single file is the thing to open if you just want to use the app.

### Development

```bash
cd "d:/Claude/Vacation Guru"
npm start
```

Then open **http://localhost:5173**. This serves the real multi-file source, so
edits show up on refresh with no build step. Run `npm run bundle` to regenerate the
single file after changing anything.

| Command | What it does |
| --- | --- |
| `npm start` | Serve the multi-file app on :5173 |
| `npm run build` | Merge the data layers, then rebuild the single file |
| `npm run bundle` | Rebuild `vacation-guru.html` only |
| `npm test` | Scoring + render + bundle suites (49 checks) |
| `npm run check` | Strict build + all tests (what CI would run) |
| `npm run photos` | Resolve photo topics to real Creative Commons images |
| `npm run photos:download` | …and save thumbnails locally for offline use |

---

## How the matching works

You rate any criterion you care about on a four-point scale. Anything left alone is
**ignored entirely** — it never enters the maths — so you only answer the questions
you actually have opinions about.

| Level | Weight |
| --- | --- |
| Not bothered | excluded |
| Nice to have | ×1 |
| Important | ×3 |
| Must have | ×7 |

The weights are deliberately super-linear so a must-have genuinely dominates.

**Score** = `Σ(weight × criterionScore) ÷ Σ(weight)`, then a compounding ×0.72
penalty for each *must-have* that scores below 40%. Strict mode removes those
destinations instead of penalising them.

Three details that matter more than the formula:

- **Missing data is dropped from the denominator, never scored as zero.** If you
  haven't set a home airport, Travel Time is skipped rather than counting as a miss.
  Genuine absences are different: a landlocked city scores a real 0 for sea
  temperature and says *"Landlocked"*.
- **Everything seasonal is scored against your travel month**, not an annual
  average. Santorini is a very different proposition in May and August, and the app
  says so — including a 12-month curve on each destination showing when to go.
- **Some activities are gated by the season.** A ski resort has a world-class
  `skiing` rating all year, but that rating is multiplied by a monthly snow-cover
  factor, so the Dolomites drop from 97% in February to 18% in July instead of
  cheerfully recommending July skiing. Swimming and snorkelling are gated the same
  way on sea temperature.

### Criterion kinds

| Kind | Behaviour |
| --- | --- |
| `max` | Higher stored rating is better. Optionally seasonally gated. |
| `season` | Read from a climate series for your month (sunshine, rain, humidity, sea temp, snow). |
| `temp` | Distance from your target temperature, ±14°C tolerance. |
| `crowd` | Distance from your preferred busy-ness, using that month's crowd level. |
| `budget` | Daily cost at your travel style, adjusted for that month's price index. |
| `flight` | Great-circle distance from your home airport → estimated hours. |

---

## Data model

Ratings are authored in **three layers** that merge in order. This is why 103
destinations do not require 8,137 hand-typed numbers, and why the numbers stay
internally consistent.

```
data/archetypes.json     what a place is like because of its FORM
                         ("ski-resort", "tropical-island", "capital-city")
        ↓ overridden by
data/countries.json      what is true because of WHERE it is
                         (safety, English spoken, vegan-friendliness, visas…)
        ↓ overridden by
data/destinations/*.json the individual place — identity, climate, costs,
                         photo topics, and only the ratings that differ
        ↓ npm run build
data/destinations.json   flat runtime file the app actually loads
```

Only `max`-kind criteria carry a stored rating (79 of the 88). The rest are computed
at scoring time and **cannot** be overridden — `build-data.mjs` rejects the file if
you try.

### Adding a destination

Add an object to any file in `data/destinations/` and run `npm run build`:

```jsonc
{
  "id": "kyoto-jp",                    // unique, kebab-case
  "name": "Kyoto",
  "country": "JP",                     // must exist in countries.json
  "region": "Kansai",
  "continent": "Asia",
  "lat": 35.011, "lon": 135.768,
  "type": "city",
  "arch": "historic-city",             // must exist in archetypes.json
  "blurb": "One or two sentences with a real point of view.",
  "tags": ["temples", "food"],
  "climate": {                         // all arrays are Jan..Dec, length 12
    "tempHigh": [...], "tempLow": [...], "rainDays": [...],
    "sunHours": [...], "humidity": [...],
    "seaTemp":  [...],                 // optional — omit if landlocked
    "snowDepth": [...]                 // optional, cm at nearest skiable terrain
  },
  "crowd":      [...],                 // 0-100 busy-ness by month
  "priceIndex": [...],                 // 0-100 relative to this place's own peak
  "cost": { "budget": 55, "mid": 120, "luxury": 300 },   // £/person/day
  "r": { "historicSites": 98, "religiousSites": 96 },    // only what differs
  "photos": ["Fushimi Inari torii gates", "..."]         // 6 topics, see below
}
```

The build is strict on purpose and will refuse to produce output on:

- a rating for a criterion that doesn't exist, or one that's computed at runtime
- a climate array that isn't exactly 12 numbers, or is outside a plausible range
- `tempHigh` below `tempLow` in any month
- cost tiers that don't increase
- a `skiing` rating ≥ 40 with no `snowDepth` series (it would silently score 0)
- duplicate ids, bad lat/lon, unknown country or archetype

---

## Photos

Each destination lists **six photo topics** describing what each photo should *show* —
not a URL. `npm run photos` resolves every topic against the Wikimedia Commons API,
picks the best landscape-orientation image with a reusable licence, and records the
URL plus the attribution the licence requires. Topics that resolve to nothing are
reported so you can reword them.

Until you run it, the app draws captioned gradient placeholders — it is fully usable
with no photos at all.

The resolver takes a world: `npm run photos:fiction` does the same for the fictional
catalogue. Broadening is capped at half the topic's words — an early run collapsed
"Elven architecture concept forest" to "Elven", a commune in Brittany, and captioned a
roadside crucifix as Rivendell.

### Photographs vs illustration

Worlds declare a `photoPolicy` in `data/worlds.json`.

- **`photo`** (the real world) rejects engravings, drawings and paintings. A drawing
  of Barcelona is just a worse picture of somewhere you could go and photograph today.
- **`any`** (fiction) accepts them, because for Lilliput there was never a photograph:
  Grandville's 1838 plates *are* the primary source. Portrait orientation stops being
  penalised too, since book plates and frontispieces are usually taller than wide.

**We do not use fan art.** It belongs to the artist who drew it, and no licence on
Commons covers it. The fiction topics instead point at real filming locations —
Hobbiton, Dubrovnik, Skellig Michael, Chott el Djerid, Ballintoy — and at
public-domain illustration by Grandville, Rackham, Tenniel, Denslow, Doré and
Schoonover. Anything unresolvable stays a captioned gradient, which is honest.

**Storage strategy:** thumbnails bundled (offline, instant), full-size streamed and
cached on first view. `npm run photos:download` writes the thumbnails into
`assets/img/thumbs/` and rewrites the paths — about 45MB for 618 photos, which stays
well under Google Play's 200MB base-bundle cap and Apple's 200MB cellular threshold.
Going fully offline for full-size images too would be roughly 175MB in AVIF.

---

## Porting to Android / iOS

The app is deliberately built so this is a wrap, not a rewrite:

```bash
npm install @capacitor/core @capacitor/cli
npx cap init "Vacation Guru" com.yourname.vacationguru --web-dir=.
npx cap add android
npx cap add ios
npx cap sync
```

What was done to keep that path open:

- **No framework, no build step, no bundler.** Plain ES modules that a WebView loads
  directly.
- **`js/scoring.js` has zero dependencies and zero browser APIs.** Pure ES2020. It
  runs unchanged in Node (that's how the tests work), and would transliterate to
  Kotlin or Swift almost line for line if you ever wanted a fully native version.
- **All persistence goes through `js/util/storage.js`**, three async functions.
  Swap their bodies for `@capacitor/preferences` and nothing else changes — every
  caller already awaits them.
- **All rendering goes through `h()` in `js/util/dom.js`.** Real DOM nodes, no
  `innerHTML` for any data-derived string, so no XSS surface and an easy mapping to
  React/React Native components later.
- **Responsive from 320px up**, with a bottom tab bar on phones that becomes a side
  rail at ≥860px, and `env(safe-area-inset-*)` respected for notches.
- **`sw.js`** already caches the shell and data for offline use as a PWA — you can
  "Add to Home Screen" today without any native packaging at all.

---

## Layout

```
index.html            app shell
app.webmanifest       PWA manifest
sw.js                 service worker (offline shell + photo cache)
css/styles.css        design system; light/dark via tokens
js/
  main.js             bootstrap + hash router
  scoring.js          ← the engine. pure, portable, tested
  data.js             loads and indexes the JSON
  state.js            app state, persistence, subscriptions
  images.js           photo resolution + placeholder generation
  ui/                 one module per screen (setup, criteria, results,
                      browse, detail, compare)
  util/               dom.js (hyperscript), storage.js
data/
  worlds.json         the world registry — one entry per dataset
  criteria.json       88 criteria in 9 categories, + 10 presets
  archetypes.json     17 place-shape baselines
  countries.json      113 country context baselines
  origins.json        80 home airports for flight-time estimates
  destinations/       authoring source, sharded by region
  destinations.json   ← generated, do not edit
  photos.json         ← generated by npm run photos
  fiction/            a second, complete world in the same shape
    sources.json      what each universe is FROM — the ⓘ panel
tools/
  build-data.mjs      merge + validate, every world in the registry
  build-photos.mjs    resolve photo topics
  test-scoring.mjs    behavioural tests
  preview-fiction.mjs eyeball what each preset returns
  serve.mjs           static server
```

### Time, where there isn't a calendar

"Are you going to Mordor in June?" is a silly question, and so is "for how many
nights?". Fiction asks neither.

Worlds declare a `timeModel` in `data/worlds.json`. The real world keeps
`months` and its twelve-tile picker. Fiction is `none`: no month, no season, no
trip length, and no month chart on a destination page — a chart you cannot pick
from only invites a choice that does not exist.

The climate data is unchanged and still varies across the year; **a null month
tells the engine to read every series as its annual mean** instead of at a
point. So a fictional realm answers "what is this place like, generally", which
is the only question that can honestly be asked of it. Detail pages report a
range alongside the average — Winterfell reads *Typical high 8°C, -2° to 19°
across the year*.

Enforcing this is `setWorld(id, world)`, which takes the world's metadata as a
**required** argument rather than leaving it to a separate call a caller might
forget. Forgetting would fail silently and expensively: every fictional realm
would quietly be scored as if it were June, with nothing on screen to say so.

Two tests guard it. One renders the trip, matches, compare and detail screens in
fiction and fails if any of them prints the name of a month or a season. The
other finds the destination whose score varies most across the year and checks
that the timeless score lands *inside* that range rather than on top of any
single month of it.

### Sharing a link

The world is part of the address, not just localStorage — otherwise a link to a
fictional realm opened whichever world the recipient happened to look at last.

```
/fiction                      the fictional catalogue
/real                         the real one
/?world=fiction#/place/rivendell     one realm, directly
```

`/fiction` and `/real` are 302 redirects to the query form (see `netlify.toml`).
A 200 rewrite would look tidier in the address bar and would break the moment
somebody typed a trailing slash, since every relative path would then resolve
one directory too deep.

Switching worlds rewrites the address with `replaceState`, so the address bar
always describes what is on screen and copying it always shares the right thing.
The 🔗 button in the top bar does the same in one tap, using the native share
sheet where there is one.

That rewrite is guarded, and deliberately skipped on `file://`. Some browsers
refuse `replaceState` there, and `vacation-guru.html` is meant to be opened
straight off a disk — an app that would not start because it could not tidy its
own address bar is a bad trade.

### Browsing the catalogue

Matches shows the top of a ranked list, which is right for choosing and useless for
seeing what is actually in here. The **Browse** tab lists every destination in the
active world, grouped by region, world, kind or A–Z, with a free-text search over
names, countries, regions, kinds and tags, and multi-select filters for each facet
plus cost band, saved-only and been-there.

Its filters are deliberately **separate from the ones on the Trip screen**. Those
change what gets scored and recommended; these only change what this list shows you.
Browsing must never quietly rewrite your search — there is a test for exactly that.

### Where a place comes from

Every fictional destination carries an ⓘ button. It opens a panel with the
place itself and then the work it came from — title, creator, year, medium and a
short note in our own words. The work details live once per universe in
`data/fiction/sources.json` rather than being repeated on every destination; the
per-place paragraph is the optional `about` field on a destination.

`build-data.mjs` warns if a universe has destinations but no source note, and
`test-worlds.mjs` fails if any note is missing a creator or is too thin to be
worth reading. It is a generic mechanism: drop a `sources.json` into any world
and its places get the same button.

---

## Tests

`npm test` runs five suites, none of which needs a browser or any dependency.

**`test-scoring.mjs` (26 checks)** asserts that recommendations are *sensible*, not
that arithmetic is correct — a ski search must return snow, a beach search must
return beaches, scores must stay monotonic, missing data must never masquerade as a
bad match. It has already caught two real bugs: the seasonal-gating problem (July
skiing in the Dolomites) and a discontinuity where a destination slightly over
budget outranked one comfortably under it.

**`test-render.mjs` (29 checks)** uses the DOM shim in `tools/dom-shim.mjs` to
actually render every screen in Node, including every detail page, then clicks
presets, importance buttons and month tiles to confirm state updates. It fails on
any `NaN`/`undefined` reaching the DOM. It has caught two bugs the browser hid: a
CSS custom property silently dropped by `Object.assign`, which collapsed the whole
compare grid into one column, and a `replaceChildren(x, null)` that would have
rendered the literal text "null" on a button.

**`test-worlds.mjs` (25 checks)** proves fiction runs through the same code path as
the real world, that switching worlds keeps both sets of answers, that a world with
no money, no aeroplanes and no calendar renders controls for none of them, that every universe is
credited, and that browsing never rewrites your saved preferences.

**`test-photos.mjs` (15 checks)** is pure logic, no network. The resolver is the one
part of this project that can produce something confidently, plausibly wrong: a real
photograph, correctly licensed, of entirely the wrong thing. Four such matches
shipped — a mountain bike for "Giant hand", Lambeau Field for "Frozen tundra", a
Crimean War photograph for "Empty Italian", an arena for "Viking hall" — and each is
pinned here so it cannot come back.

**`test-bundle.mjs` (12 checks)** executes `vacation-guru.html` with `fetch`
**deleted**, proving the single file really is self-sufficient — it boots, renders,
and scores a preset with no network whatsoever.

`npm run audit:photos` (and `audit:photos:fiction`) is the human half: it reports
every topic that only matched after broadening, worst first, so you can reword the
source topic. A missing photo is fine — the app draws a captioned placeholder. A
wrong one is a lie.

`npm run check` adds a strict build where warnings are fatal.

---

## Status

Two complete worlds, one engine.

| | Real | Fiction |
| --- | --- | --- |
| Destinations | 289 | 128 |
| Countries / universes | 104 | 47 |
| Criteria | 88 (79 rated) | 78 (70 rated) |
| Rated data points | 22,831 | 8,960 |
| Photo topics | 1,734 | 768 |

**289 destinations across 104 countries**, covering every inhabited continent:

| Region | Destinations |
| --- | --- |
| Europe | 100 |
| Asia | 74 |
| North America | 40 |
| Africa | 25 |
| South America | 21 |
| Caribbean | 12 |
| Oceania | 17 |

22,831 rated data points, plus a 12-month climate, crowd and price
profile for every destination.

The fictional catalogue spans 47 universes — Middle-earth, Westeros, the Star Wars
galaxy, the Federation, Arrakis, Discworld, Narnia, Hogwarts, Earthsea, Tamriel,
Hyrule, Faerûn, Azeroth, the Culture, Trantor, Gallifrey, Barsoom, Wakanda, Panem,
Airstrip One and the rest — with every work credited behind the ⓘ button.

Engine, UI, offline support, photo pipeline and tooling are complete.
