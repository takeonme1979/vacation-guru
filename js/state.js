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

export function setWorld(id) {
  update((s) => { s.world = id; });
}

export async function resetAll() {
  state.byWorld = { [state.world]: blankWorld() };
  await storage.remove(KEY);
  emit();
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
