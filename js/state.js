/**
 * App state: one object, one change event, persisted on write.
 *
 * Everything a traveller chooses is scoped to a WORLD, because the real world
 * and fiction have different criteria — a preference for "Dragons" means
 * nothing in Lisbon. Switching worlds keeps both sets of answers intact.
 *
 * `state.prefs`, `state.shortlist` etc. are accessors onto the active world, so
 * every screen can go on reading `store.state.prefs` without knowing any of this.
 */

import * as storage from './util/storage.js';
import { emptyPrefs } from './scoring.js';

const KEY = 'state-v2';

const listeners = new Set();

const blankWorld = () => ({
  prefs: emptyPrefs(),
  shortlist: [],
  beenThere: [],
  compare: [],
  lastPreset: null
});

export const state = {
  world: 'real',
  byWorld: { real: blankWorld() },
  seenIntro: false,

  /** The active world's slice, created on demand. */
  get current() {
    if (!this.byWorld[this.world]) this.byWorld[this.world] = blankWorld();
    return this.byWorld[this.world];
  },

  get prefs() { return this.current.prefs; },
  set prefs(v) { this.current.prefs = v; },
  get shortlist() { return this.current.shortlist; },
  set shortlist(v) { this.current.shortlist = v; },
  get beenThere() { return this.current.beenThere; },
  set beenThere(v) { this.current.beenThere = v; },
  get compare() { return this.current.compare; },
  set compare(v) { this.current.compare = v; },
  get lastPreset() { return this.current.lastPreset; },
  set lastPreset(v) { this.current.lastPreset = v; }
};

let saveTimer = null;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(state);
}

/** Mutate via a callback, then persist and notify. */
export function update(mutator, { persist = true, silent = false } = {}) {
  mutator(state);
  if (persist) scheduleSave();
  if (!silent) emit();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 250);
}

export async function save() {
  const byWorld = {};
  for (const [id, w] of Object.entries(state.byWorld)) {
    byWorld[id] = {
      prefs: w.prefs,
      shortlist: w.shortlist,
      beenThere: w.beenThere,
      lastPreset: w.lastPreset
    };
  }
  await storage.set(KEY, { world: state.world, byWorld, seenIntro: state.seenIntro });
}

export async function restore() {
  const saved = await storage.get(KEY, null);
  if (!saved) return;

  state.world = saved.world || 'real';
  state.seenIntro = !!saved.seenIntro;
  state.byWorld = {};

  for (const [id, w] of Object.entries(saved.byWorld || {})) {
    const base = emptyPrefs();
    state.byWorld[id] = {
      prefs: {
        ...base,
        ...(w.prefs || {}),
        targets: { ...base.targets, ...((w.prefs || {}).targets || {}) },
        filters: { ...base.filters, ...((w.prefs || {}).filters || {}) }
      },
      shortlist: w.shortlist || [],
      beenThere: w.beenThere || [],
      compare: [],                       // never persisted; it's a scratch selection
      lastPreset: w.lastPreset || null
    };
  }
  if (!state.byWorld[state.world]) state.byWorld[state.world] = blankWorld();
}

/**
 * Make a world active, and bring its preferences into line with what that world
 * can actually be asked.
 *
 * The world's own metadata is a required argument rather than something a
 * caller may optionally apply afterwards, because forgetting it fails silently
 * and expensively: a world with no calendar must carry `month: null`, since
 * that is what tells the engine to read every climate series across the whole
 * year. A stale month left behind would score every fictional realm as if it
 * were June, with nothing on screen to say so.
 */
export function setWorld(id, world) {
  update((s) => {
    s.world = id;
    if (!world) return;
    if (world.timeModel === 'none') s.prefs.month = null;
    else if (s.prefs.month == null) s.prefs.month = new Date().getMonth();
  });
}

export async function resetAll() {
  // Starting over must not resurrect a month in a world that has no calendar —
  // blankWorld() cannot know which world it is being made for.
  const month = state.prefs.month;
  state.byWorld = { [state.world]: blankWorld() };
  state.prefs.month = month;
  await storage.remove(KEY);
  emit();
}

/**
 * Start the questionnaire again.
 *
 * The line this draws: it clears everything you have said you WANT, and keeps
 * the practical facts of the trip. Weights, the criterion targets a preset may
 * have moved, and the preset itself all go. Your month, trip length, travel
 * style, home airport, saved list and been-there list all stay, because none of
 * those is a criterion and losing them would be a nasty surprise.
 *
 * Clearing weights alone was not enough: picking Beach & Chill also pushes the
 * temperature target to 28 and the atmosphere target to 30, and those survived
 * a "Clear all" invisibly, quietly shaping the next search.
 */
export function clearCriteria() {
  const fresh = emptyPrefs().targets;
  update((s) => {
    s.prefs.weights = {};
    s.prefs.filters = { ...s.prefs.filters, continents: [], types: [] };
    s.lastPreset = null;
    for (const k of ['temperature', 'peacefulness', 'costTier', 'maxFlightHours']) {
      s.prefs.targets[k] = fresh[k];
    }
  });
}

/** Is there anything to clear? */
export function hasCriteria() {
  const p = state.prefs;
  return Object.values(p.weights || {}).some(Boolean)
    || (p.filters?.continents || []).length > 0
    || (p.filters?.types || []).length > 0;
}

// ---- convenience mutators --------------------------------------------------

export function setImportance(criterionId, level) {
  update((s) => {
    if (level) s.prefs.weights[criterionId] = level;
    else delete s.prefs.weights[criterionId];
    s.lastPreset = null;
  });
}

export function setTarget(key, value) {
  update((s) => { s.prefs.targets[key] = value; });
}

export function setMonth(month) {
  update((s) => { s.prefs.month = month; });
}

export function toggleShortlist(id) {
  update((s) => {
    const i = s.shortlist.indexOf(id);
    if (i >= 0) s.shortlist.splice(i, 1); else s.shortlist.push(id);
  });
}

export function toggleBeenThere(id) {
  update((s) => {
    const i = s.beenThere.indexOf(id);
    if (i >= 0) s.beenThere.splice(i, 1); else s.beenThere.push(id);
  });
}

export function toggleCompare(id) {
  update((s) => {
    const i = s.compare.indexOf(id);
    if (i >= 0) s.compare.splice(i, 1);
    else if (s.compare.length < 3) s.compare.push(id);
  }, { persist: false });
}

export const isShortlisted = (id) => state.shortlist.includes(id);
export const isBeenThere = (id) => state.beenThere.includes(id);
export const isComparing = (id) => state.compare.includes(id);
