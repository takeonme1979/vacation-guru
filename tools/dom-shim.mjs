/**
 * A DOM small enough to fit in one file and real enough to render the app.
 *
 * The UI only ever builds nodes through `h()` in js/util/dom.js, so this covers
 * exactly the surface that uses — which is enough to render every screen in Node
 * and click things, with no browser and no dependencies.
 */

class ClassList {
  constructor(el) { this.el = el; }
  _set() { return new Set(String(this.el.className).split(/\s+/).filter(Boolean)); }
  _put(s) { this.el.className = [...s].join(' '); }
  add(...c) { const s = this._set(); c.forEach((x) => s.add(x)); this._put(s); }
  remove(...c) { const s = this._set(); c.forEach((x) => s.delete(x)); this._put(s); }
  toggle(c) { const s = this._set(); s.has(c) ? s.delete(c) : s.add(c); this._put(s); }
  contains(c) { return this._set().has(c); }
}

export class Nd {
  constructor(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = [];
    this.attributes = {};
    this.dataset = {};
    // Mirror CSSStyleDeclaration closely enough that custom properties behave
    // as they do in a browser — a plain object would hide the very bug that
    // broke the compare grid.
    this.style = Object.defineProperty({}, 'setProperty', {
      enumerable: false,
      value(prop, value) { this[prop] = String(value); }
    });
    this.listeners = {};
    this.className = '';
    this.parentNode = null;
    this._text = '';
    this.scrollTop = 0;
  }
  get classList() { return new ClassList(this); }
  get children() { return this.childNodes.filter((c) => c instanceof Nd); }
  get textContent() {
    if (this._text) return this._text;
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v) { this.childNodes = []; this._text = String(v); }
  set innerHTML(v) { this.childNodes = []; this._text = String(v).replace(/<[^>]*>/g, ''); }
  appendChild(c) { c.parentNode = this; this.childNodes.push(c); return c; }
  replaceChildren(...n) { this.childNodes = []; this._text = ''; n.forEach((x) => this.appendChild(x)); }
  remove() {
    if (this.parentNode) {
      this.parentNode.childNodes = this.parentNode.childNodes.filter((c) => c !== this);
    }
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  click() { this.fire('click'); }
  /** Dispatch any event type to this node's listeners. */
  fire(type, ev = {}) {
    const e = { target: this, preventDefault() {}, stopPropagation() {}, ...ev };
    for (const fn of [...(this.listeners[type] || [])]) fn(e);
  }
  focus() {}
  closest() { return null; }
  *walk() { yield this; for (const c of this.childNodes) if (c instanceof Nd) yield* c.walk(); }
  querySelectorAll(sel) {
    const out = [];
    for (const n of this.walk()) if (matches(n, sel)) out.push(n);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

class Txt {
  constructor(t) { this._t = String(t); }
  get textContent() { return this._t; }
}

/**
 * Selector matching: an optional tag, an optional #id, and any number of
 * .classes.
 *
 * Compound class selectors are supported because not supporting them failed
 * silently: `.worlds__btn.is-on` was read as one class name called
 * "worlds__btn.is-on", matched nothing, and a test asserting that exactly one
 * world was marked active could never have passed no matter what the app did.
 * A shim that quietly answers "no" is worse than one that throws.
 */
function matches(node, sel) {
  const m = /^([a-zA-Z][\w-]*)?(#[\w-]+)?((?:\.[\w-]+)*)$/.exec(String(sel).trim());
  if (!m) throw new Error(`dom-shim: unsupported selector "${sel}"`);
  const [, tag, id, classes] = m;
  if (!tag && !id && !classes) return false;
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  if (id && node.attributes.id !== id.slice(1)) return false;
  if (classes) {
    const have = String(node.className || '').split(/\s+/);
    for (const c of classes.split('.').filter(Boolean)) if (!have.includes(c)) return false;
  }
  return true;
}

/**
 * Installs the shim onto globalThis.
 * @param {object} opts
 * @param {(url:string)=>Promise<any>} [opts.fetchFile] resolves a URL to text
 * @returns {{body:Nd, screen:Nd, storage:Map}}
 */
export function installDom({ fetchFile = null, hash = '#/setup', search = '' } = {}) {
  // Mirror the real shell in index.html, or code that looks up #tabbar / #topbar
  // silently no-ops and the tests pass for the wrong reason.
  const body = new Nd('body');
  const app = new Nd('div');
  app.attributes.id = 'app';

  const topbar = new Nd('header');
  topbar.attributes.id = 'topbar';

  // The top bar's own controls. Without these, paintWorldSwitch() looked up a
  // node that was not there, returned early, and every test passed while the
  // world switch rendered nothing at all.
  const worldSwitch = new Nd('div');
  worldSwitch.attributes.id = 'worldSwitch';
  worldSwitch.className = 'worlds';

  const shareBtn = new Nd('button');
  shareBtn.attributes.id = 'shareBtn';
  shareBtn.className = 'icon-btn';

  const themeToggle = new Nd('button');
  themeToggle.attributes.id = 'themeToggle';
  themeToggle.className = 'icon-btn';

  topbar.appendChild(worldSwitch);
  topbar.appendChild(shareBtn);
  topbar.appendChild(themeToggle);

  const screen = new Nd('main');
  screen.attributes.id = 'screen';

  const tabbar = new Nd('nav');
  tabbar.attributes.id = 'tabbar';

  app.appendChild(topbar);
  app.appendChild(screen);
  app.appendChild(tabbar);
  body.appendChild(app);

  const documentElement = new Nd('html');
  documentElement.dataset = {};

  global.document = {
    body,
    documentElement,
    baseURI: 'http://localhost/',
    createElement: (t) => new Nd(t),
    createElementNS: (_ns, t) => new Nd(t),
    createTextNode: (t) => new Txt(t),
    addEventListener() {},
    removeEventListener() {},
    querySelector: (s) => (matches(body, s) ? body : body.querySelector(s)),
    querySelectorAll: (s) => body.querySelectorAll(s)
  };
  global.Node = Nd;
  global.HTMLElement = Nd;

  const storage = new Map();
  global.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k)
  };

  // A realistic-enough Location and History. These exist because the app reads
  // the world out of the address (?world=fiction) and writes it back, and a
  // shim missing pathname/search/replaceState hid that from every test.
  global.location = {
    hash,
    protocol: 'http:',
    href: 'http://localhost/' + search,
    origin: 'http://localhost',
    pathname: '/',
    search
  };
  global.history = {
    back() {},
    pushState() {},
    replaceState(_state, _title, url) {
      if (!url) return;
      const next = new URL(String(url), global.location.href);
      global.location.href = next.href;
      global.location.pathname = next.pathname;
      global.location.search = next.search;
    }
  };
  // Node 24 defines `navigator` as a getter-only global, so plain assignment throws.
  Object.defineProperty(global, 'navigator', {
    value: { userAgent: 'node' }, configurable: true, writable: true
  });
  global.window = {
    localStorage: global.localStorage,
    location: global.location,
    document: global.document,
    scrollTo() {},
    addEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} })
  };
  global.queueMicrotask ||= (fn) => Promise.resolve().then(fn);

  if (fetchFile) global.fetch = fetchFile;

  return { body, screen, tabbar, topbar, worldSwitch, shareBtn, storage, Nd };
}

export const countNodes = (n) => [...n.walk()].length;
