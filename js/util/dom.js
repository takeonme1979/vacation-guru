/**
 * Tiny hyperscript. Builds real DOM nodes — no innerHTML anywhere in the app,
 * so destination text and photo captions can never inject markup.
 */

export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);

  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') setStyles(el, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;                 // only ever used with our own literals
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }

  append(el, children);
  return el;
}

/**
 * Apply inline styles.
 *
 * Custom properties MUST go through setProperty — `Object.assign(el.style, …)`
 * silently no-ops on them, which left `--cols` unset on the compare grid and
 * made `repeat(var(--cols), …)` invalid, collapsing the whole side-by-side
 * table into one stacked column.
 */
function setStyles(el, styles) {
  for (const [prop, value] of Object.entries(styles)) {
    if (value === null || value === undefined) continue;
    if (prop.startsWith('--')) el.style.setProperty(prop, String(value));
    else el.style[prop] = value;
  }
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Replace everything inside `parent` with `nodes`. */
export function mount(parent, ...nodes) {
  parent.replaceChildren();
  append(parent, nodes);
  return parent;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** SVG builder — needed because createElement() will not do namespaced nodes. */
export function svg(tag, props = null, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function debounce(fn, ms = 120) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
