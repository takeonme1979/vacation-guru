/**
 * Persistence behind one small async interface.
 *
 * PORTING NOTE: on Capacitor, swap the three functions for
 * `@capacitor/preferences` (Preferences.get/set/remove) and nothing else in
 * the app changes — every caller already awaits these.
 */

const PREFIX = 'vacationguru:';
const memory = new Map();

let backend = null;

function detect() {
  if (backend) return backend;
  try {
    const probe = PREFIX + '__probe';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    backend = 'local';
  } catch {
    // Private mode, disabled storage, or a WebView with no localStorage.
    backend = 'memory';
  }
  return backend;
}

export async function get(key, fallback = null) {
  const k = PREFIX + key;
  try {
    const raw = detect() === 'local' ? window.localStorage.getItem(k) : (memory.get(k) ?? null);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function set(key, value) {
  const k = PREFIX + key;
  const raw = JSON.stringify(value);
  try {
    if (detect() === 'local') window.localStorage.setItem(k, raw);
    else memory.set(k, raw);
  } catch {
    // Quota exceeded — fall back to memory so the session still works.
    memory.set(k, raw);
  }
}

export async function remove(key) {
  const k = PREFIX + key;
  try {
    if (detect() === 'local') window.localStorage.removeItem(k);
  } catch { /* ignore */ }
  memory.delete(k);
}
