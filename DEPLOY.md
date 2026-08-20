# Deploying

The short version: **connect the GitHub repo to Netlify and leave the build
command empty.** Push whenever you like; it costs essentially nothing.

---

## Why this is cheap

Netlify meters **build minutes**, not deploys. A site with no build command has
nothing to build, so a push costs no build minutes at all — it uploads the files
whose contents changed and swaps them in.

That works here because this project has an unusual property: **the deployable
site is already in the repository.** `npm run build` regenerates
`data/destinations.json`, `vacation-guru.html` and the service worker's cache
stamp on your machine, and those results are committed. Netlify is a file host,
not a build service.

Bandwidth stays small for a second reason: **we do not host a single
photograph.** Every image streams from `upload.wikimedia.org` under its own
licence, which is also why the repo is 9 MB rather than 2 GB. A first visit
transfers about 1.8 MB of HTML, CSS, JS and JSON — considerably less gzipped —
and the service worker caches it, so repeat visits transfer almost nothing.

There is also no `npm install` step, because there are no dependencies.

---

## One-time setup

1. Push this repo to GitHub (see below).
2. In Netlify: **Add new site → Import an existing project → GitHub**, pick the
   repo.
3. When it asks for build settings:
   - **Build command:** *leave completely empty*
   - **Publish directory:** `.`

   `netlify.toml` already declares both, so it should offer exactly that. If
   Netlify guesses `npm run build`, clear it — otherwise every push spends build
   minutes regenerating files that are already correct in the repo.
4. Deploy.

Netlify will now redeploy on every push to `main`. That is the behaviour you
want; it is the *building* you were paying for, not the deploying.

---

## The everyday loop

```bash
# change data, criteria, code — whatever
npm run photos:fiction        # or npm run photos, if you touched real topics
npm run build                 # regenerate destinations.json + the bundle
npm test                      # 100+ checks, no browser, no network

git add -A
git commit -m "More Discworld"
git push
```

Netlify picks it up. No build minutes.

**Batch your pushes if you want fewer deploys.** Nothing forces you to push
after every commit — commit as often as you like locally and push once when a
batch of work is done.

---

## The one rule

**Run `npm run build` before you commit.**

Netlify never builds anything, so whatever is committed is exactly what gets
served. Edit a destination shard without rebuilding and the site keeps serving
the old data forever, with no error anywhere.

The GitHub Actions workflow in `.github/workflows/check.yml` exists to catch
precisely that: it rebuilds from source and fails the check if the result
differs from what you committed. It runs on GitHub's minutes, not Netlify's.

One exception worth knowing: if you run `npm run photos` and commit
`data/photos.json` *without* rebuilding, the site still serves the new photos
correctly. The service worker is **network-first for data** and only cache-first
for the app shell, so fresh JSON always wins. You would only be shipping a stale
`vacation-guru.html`, which is the offline download rather than the site itself.

---

## Pushing to GitHub

```bash
gh repo create vacation-guru --private --source=. --remote=origin --push
```

Use `--public` instead of `--private` if you want it public. Two practical
differences:

- **Public** repos get unlimited free GitHub Actions minutes. Private repos get
  a monthly allowance, which this workflow will not come close to exhausting.
- Netlify can deploy from either.

---

## Share links

Once the site is up:

| Link | Opens |
| --- | --- |
| `https://<site>/` | the real world |
| `https://<site>/fiction` | the fictional catalogue |
| `https://<site>/real` | the real one, explicitly |
| `https://<site>/?world=fiction#/place/rivendell` | Rivendell, directly |

`/fiction` and `/real` are redirects declared in `netlify.toml`, so they work
the moment the site deploys — no configuration in the Netlify UI.

The 🔗 button in the top bar copies a link to whatever is currently on screen,
world included.

---

## If you want *zero* deploys for data updates

You almost certainly do not need this, but it exists.

The app fetches `data/*.json` at runtime and the service worker is network-first
for it. So the data could be served from somewhere other than Netlify — a
separate GitHub repo behind jsDelivr, say — and updating destinations or photos
would then be a `git push` that never touches Netlify at all.

I would not start here. It adds a cross-origin dependency, puts a third-party
CDN's caching between you and your own data, and breaks the property that
`vacation-guru.html` is a genuinely self-contained file you can email to
somebody. Given that a no-build deploy already costs essentially nothing, the
trade is bad. Reach for it only if Netlify's numbers ever say otherwise.

---

## Checking the deployed site

```bash
npm run verify:photos              # do the real world's photo URLs still load?
npm run verify:photos:fiction
npm run audit:photos:fiction       # did any topic resolve to the wrong thing?
```

Neither needs the site to be deployed; they check the data that gets deployed.
