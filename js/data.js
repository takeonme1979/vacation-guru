/**
 * Data loading.
 *
 * The app can hold several independent WORLDS — the real one, and fiction —
 * each a complete dataset with its own criteria, archetypes and destinations.
 * The scoring engine is identical for all of them; only the data differs.
 *
 * Everything is static JSON fetched once per world and held in memory, which is
 * what makes the whole thing work offline.
 */

const BASE = new URL('../data/', import.meta.url);

const cache = new Map();     // worldId -> prepared dataset
let registry = null;         // worlds.json
let activeId = null;

async function json(path) {
  const res = await fetch(new URL(path, BASE));
  if (!res.ok) {
    throw new Error(`Could not load ${path} (${res.status}). If you opened index.html directly, `
      + 'open vacation-guru.html instead, or start the local server — see README.');
  }
  return res.json();
}

/** The list of selectable worlds. */
export async function loadWorlds() {
  if (!registry) registry = await json('worlds.json');
  return registry.worlds;
}

export function worlds() {
  return registry ? registry.worlds : [];
}

export function worldMeta(id = activeId) {
  return worlds().find((w) => w.id === id) || null;
}

export function activeWorld() {
  return activeId;
}

/**
 * Load a world and make it active. Safe to call repeatedly — each world is
 * fetched once and then reused.
 */
export async function loadAll(worldId = 'real') {
  await loadWorlds();
  const world = worlds().find((w) => w.id === worldId);
  if (!world) throw new Error(`Unknown world "${worldId}"`);

  if (cache.has(worldId)) {
    activeId = worldId;
    return cache.get(worldId);
  }

  const dir = world.dir === '.' ? '' : world.dir + '/';

  const [criteriaDoc, destinations, meta, originsDoc, photos, sourcesDoc] = await Promise.all([
    json(dir + 'criteria.json'),
    json(dir + 'destinations.json'),
    json(dir + 'meta.json'),
    json(dir + 'origins.json').catch(() => ({ origins: [] })),   // fiction has no airports
    json(dir + 'photos.json').catch(() => ({ photos: {} })),     // optional until resolved
    json(dir + 'sources.json').catch(() => ({ sources: {} }))    // "where is this from?"
  ]);

  const criteriaById = new Map(criteriaDoc.criteria.map((c) => [c.id, c]));
  const categories = criteriaDoc.categories.map((cat) => ({
    ...cat,
    criteria: criteriaDoc.criteria.filter((c) => c.cat === cat.id)
  }));

  const prepared = {
    world,
    criteria: criteriaDoc.criteria,
    criteriaById,
    categories,
    presets: criteriaDoc.presets,
    destinations,
    destById: new Map(destinations.map((d) => [d.id, d])),
    continents: [...new Set(destinations.map((d) => d.continent))].sort(),
    types: [...new Set(destinations.map((d) => d.type))].sort(),
    meta,
    origins: originsDoc.origins || [],
    photos: photos.photos || {},
    /** cc -> { work, creator, year, medium, text } for the ⓘ panel. */
    sources: sourcesDoc.sources || {},
    /** True when this world prices things in real money rather than tiers. */
    usesMoney: destinations.some((d) => d.costPerDay)
  };

  cache.set(worldId, prepared);
  activeId = worldId;
  return prepared;
}

export function data() {
  const d = cache.get(activeId);
  if (!d) throw new Error('loadAll() has not finished yet');
  return d;
}
