import { h, mount, $ } from './util/dom.js';
import { loadAll, loadWorlds, worlds, worldMeta, activeWorld } from './data.js';
import * as store from './state.js';
import { renderSetup } from './ui/setup.js';
import { renderCriteria } from './ui/criteria.js';
import { renderResults, renderShortlist, resetPaging } from './ui/results.js';
import { renderDetail } from './ui/detail.js';
import { renderCompare } from './ui/compare.js';
import { renderBrowse, resetBrowse } from './ui/browse.js';

const screenEl = () => $('#screen');

const TABS = [
  { hash: '#/setup', label: 'Trip', icon: '🧭' },
  { hash: '#/criteria', label: 'Criteria', icon: '🎚️' },
  { hash: '#/results', label: 'Matches', icon: '🌍' },
  { hash: '#/browse', label: 'Browse', icon: '📖' },
  { hash: '#/saved', label: 'Saved', icon: '★' },
  { hash: '#/compare', label: 'Compare', icon: '⇄' }
];

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

/**
 * Which list a destination page was opened from, so the tab bar keeps pointing
 * at where you actually came from. A place has no tab of its own.
 */
let lastList = '#/results';

function route() {
  const raw = location.hash || '#/setup';
  const parts = raw.replace(/^#\//, '').split('/');
  const root = screenEl();
  const ctx = { go };

  if (['results', 'browse', 'saved'].includes(parts[0])) lastList = '#/' + parts[0];

  switch (parts[0]) {
    case 'criteria': renderCriteria(root, ctx); break;
    case 'results': renderResults(root, ctx); break;
    case 'browse': renderBrowse(root, ctx); break;
    case 'saved': renderShortlist(root, ctx); break;
    case 'compare': renderCompare(root, ctx); break;
    case 'place': renderDetail(root, parts[1], ctx); break;
    case 'setup':
    default: renderSetup(root, ctx); break;
  }

  paintTabs();
  if (parts[0] !== 'place') window.scrollTo(0, 0);
}

function paintTabs() {
  const nav = $('#tabbar');
  if (!nav) return;
  const current = location.hash || '#/setup';
  mount(nav,
    TABS.map((t) => {
      const active = current.startsWith(t.hash) ||
        (current.startsWith('#/place') && t.hash === lastList);
      const badge = t.hash === '#/saved' ? store.state.shortlist.length
        : t.hash === '#/compare' ? store.state.compare.length : 0;
      return h('button', {
        class: 'tab' + (active ? ' is-on' : ''),
        onclick: () => go(t.hash),
        'aria-current': active ? 'page' : null
      },
        h('span', { class: 'tab__icon' }, t.icon),
        h('span', { class: 'tab__label' }, t.label),
        badge ? h('span', { class: 'tab__badge' }, badge) : null
      );
    })
  );
}

function fatal(message, detail) {
  mount(screenEl(),
    h('section', { class: 'screen' },
      h('div', { class: 'empty' },
        h('div', { class: 'empty__icon' }, '⚠️'),
        h('h2', null, message),
        h('p', null, detail),
        h('pre', { class: 'empty__pre' },
          'cd "d:\\Claude\\Vacation Guru"\nnpm start\n\nthen open http://localhost:5173')
      )
    )
  );
}

/** Applies a world's visual identity to the document. */
function applyWorldTheme(id) {
  const w = worlds().find((x) => x.id === id);
  if (w && w.theme) document.documentElement.dataset.world = w.theme;
  else delete document.documentElement.dataset.world;
}

function paintWorldSwitch() {
  const el = $('#worldSwitch');
  if (!el) return;
  mount(el,
    worlds().map((w) =>
      h('button', {
        class: 'worlds__btn' + (w.id === activeWorld() ? ' is-on' : ''),
        title: w.tagline,
        'aria-pressed': w.id === activeWorld() ? 'true' : 'false',
        onclick: () => switchWorld(w.id)
      },
        h('span', { class: 'worlds__icon' }, w.icon),
        h('span', { class: 'worlds__label' }, w.short)
      )
    )
  );
}

/**
 * Which world a link is asking for.
 *
 * The world used to live only in localStorage, which made it impossible to
 * share: a link to a fictional realm opened whichever world the recipient last
 * looked at. It is now part of the address, so a URL means the same thing to
 * everybody. `/fiction` is redirected to `?world=fiction` by netlify.toml.
 */
function worldFromUrl() {
  try {
    const q = new URLSearchParams(location.search || '').get('world');
    if (q) return q;
    const seg = String(location.pathname || '').replace(/\/+$/, '').split('/').pop();
    return worlds().some((w) => w.id === seg) ? seg : null;
  } catch {
    return null;
  }
}

/**
 * Keep the address bar honest, so copying it always shares what you see.
 *
 * Guarded because this is a nicety, not a mechanism. Opening
 * vacation-guru.html straight off the disk gives a file:// URL, where some
 * browsers refuse replaceState outright — and an app that will not start
 * because it could not tidy its own address bar would be a poor trade.
 */
function writeWorldToUrl(id) {
  if (typeof history === 'undefined' || typeof history.replaceState !== 'function') return;
  if (String(location.protocol) === 'file:') return;
  try {
    const url = new URL(location.href);
    const isDefault = id === (worlds()[0] && worlds()[0].id);
    if (isDefault) url.searchParams.delete('world');
    else url.searchParams.set('world', id);
    // replaceState, not pushState: switching worlds should not fill the back
    // button with entries that look identical.
    history.replaceState(null, '', url.toString());
  } catch {
    /* Not being able to rewrite the URL changes nothing about the app. */
  }
}

/**
 * Copy a link to exactly what is on screen — the world and the hash route.
 *
 * Everything needed is already in the address bar, so this is a convenience
 * rather than a mechanism: it saves reaching for the URL, and on a phone it
 * hands off to the native share sheet.
 */
async function shareCurrentView() {
  const btn = $('#shareBtn');
  const url = location.href;
  const say = (text) => {
    if (!btn) return;
    const before = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = before; }, 1600);
  };

  const meta = worldMeta();
  const title = meta ? `Vacation Guru — ${meta.label}` : 'Vacation Guru';

  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch {
      // Cancelled, or unavailable in this context — fall through to copying.
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    say('✓');
  } catch {
    // Clipboard access can be refused; showing the link beats silence.
    if (typeof window !== 'undefined' && window.prompt) window.prompt('Copy this link:', url);
  }
}

/** Swap datasets. Each world keeps its own answers, so nothing is lost. */
async function switchWorld(id) {
  if (id === activeWorld()) return;
  const loaded = await loadAll(id);
  store.setWorld(id, loaded.world);
  writeWorldToUrl(id);
  applyWorldTheme(id);
  paintWorldSwitch();
  resetPaging();
  resetBrowse();
  route();
}

async function boot() {
  try {
    await loadWorlds();
    await store.restore();

    // A world named in the link wins over the one remembered from last time —
    // that is the whole point of being able to send somebody a link.
    const asked = worldFromUrl();
    const wanted = worlds().some((w) => w.id === asked) ? asked : store.state.world;

    const loaded = await loadAll(wanted);
    store.setWorld(wanted, loaded.world);
    writeWorldToUrl(wanted);
  } catch (e) {
    fatal('Could not load the destination data',
      e.message || 'Vacation Guru uses ES modules and fetch(), which browsers block on file:// URLs. Serve the folder over HTTP instead:');
    return;
  }

  try {
    await bootApp();
  } catch (e) {
    // Anything thrown after the data loads used to leave the page sitting on
    // the loading message with the cause only in the console.
    fatal('Something went wrong starting the app', String(e && e.message || e));
    throw e;
  }
}

async function bootApp() {
  applyWorldTheme(store.state.world);
  paintWorldSwitch();

  // Re-render the current screen whenever state changes, so save/compare
  // buttons and tab badges never drift from the truth.
  let pending = false;
  store.subscribe(() => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => { pending = false; paintTabs(); });
  });

  const shareBtn = $('#shareBtn');
  if (shareBtn) shareBtn.addEventListener('click', shareCurrentView);

  window.addEventListener('hashchange', () => {
    if ((location.hash || '').startsWith('#/results')) resetPaging();
    route();
  });

  route();

  // Tells the boot guard in index.html to stand down.
  if (typeof window !== 'undefined') window.__vgBooted = true;

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => { /* offline cache is optional */ });
  }
}

boot();
