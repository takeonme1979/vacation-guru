/**
 * Photo resolution, behind one function so the storage strategy can change
 * without touching any screen.
 *
 * Order of preference per photo:
 *   1. bundled thumbnail on disk   (offline, instant)
 *   2. remote full-size URL        (streams, then browser-cached)
 *   3. generated gradient placeholder captioned with the topic
 *
 * Until tools/build-photos.mjs has run there is no photos.json, so every
 * destination falls through to (3) and the app still works completely.
 */

import { data } from './data.js';

const PALETTES = [
  ['#0ea5e9', '#0369a1'], ['#14b8a6', '#0f766e'], ['#f59e0b', '#b45309'],
  ['#8b5cf6', '#6d28d9'], ['#ec4899', '#9d174d'], ['#22c55e', '#15803d'],
  ['#f43f5e', '#9f1239'], ['#06b6d4', '#0e7490'], ['#a3a35c', '#5c5c2e']
];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

/** A captioned gradient, so an unresolved photo still tells you what it would show. */
export function placeholderFor(topic, seed = topic) {
  const [a, b] = PALETTES[hash(seed) % PALETTES.length];
  const angle = (hash(seed + 'x') % 60) + 20;
  const words = String(topic).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > 20) { lines.push(line.trim()); line = w; }
    else line += ' ' + w;
  }
  if (line.trim()) lines.push(line.trim());

  const text = lines.slice(0, 3).map((l, i) =>
    `<text x="50%" y="${50 + (i - (Math.min(lines.length, 3) - 1) / 2) * 9}%" text-anchor="middle" ` +
    `font-family="system-ui,sans-serif" font-size="7" font-weight="600" fill="rgba(255,255,255,.92)">` +
    `${escapeXml(l)}</text>`).join('');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice">` +
    `<defs><linearGradient id="g" gradientTransform="rotate(${angle})">` +
    `<stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/>` +
    `</linearGradient></defs><rect width="160" height="100" fill="url(#g)"/>${text}</svg>`;

  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

/**
 * How many pictures a destination needs before padding stops.
 *
 * Six was never a requirement, only a target. Some fictional places simply have
 * no photographable referent — nobody has been to Magrathea — and four real
 * photographs followed by two captioned gradients looks worse, and says less,
 * than four real photographs. So once a place has this many resolved images the
 * unresolved ones are dropped rather than drawn.
 */
const ENOUGH = 2;

/** Below ENOUGH, pad with placeholders — but not to six of them. */
const MAX_PLACEHOLDERS = 3;

/**
 * @returns {Array<{topic,thumb,full,credit,license,source,isPlaceholder}>}
 */
export function photosFor(dest) {
  const resolved = data().photos[dest.id] || [];
  const topics = dest.photoTopics || [];
  const n = Math.max(topics.length, resolved.length);

  const real = [];
  const gaps = [];

  for (let i = 0; i < n; i++) {
    const r = resolved[i];
    const topic = (r && r.topic) || topics[i] || dest.name;
    if (r && (r.thumb || r.full)) {
      real.push({
        topic,
        thumb: r.thumb || r.full,
        full: r.full || r.thumb,
        credit: r.credit || '',
        license: r.license || '',
        source: r.source || '',
        isPlaceholder: false
      });
    } else {
      const ph = placeholderFor(topic, dest.id + i);
      gaps.push({ topic, thumb: ph, full: ph, credit: '', license: '', source: '', isPlaceholder: true });
    }
  }

  if (real.length >= ENOUGH) return real;
  return [...real, ...gaps.slice(0, Math.max(MAX_PLACEHOLDERS, ENOUGH - real.length))];
}

/**
 * The photo used on result cards and compare thumbnails.
 *
 * Deliberately NOT just photos[0]: if that single topic failed to resolve, the
 * card showed a placeholder while the detail page below it had five perfectly
 * good pictures. Prefer the first one that actually resolved.
 */
export function heroPhoto(dest) {
  const photos = photosFor(dest);
  return photos.find((p) => !p.isPlaceholder) || photos[0];
}

/** <img> with lazy loading and a placeholder swap if the network copy fails. */
export function imgEl(photo, { className = '', sizeHint = 'thumb', alt = null } = {}) {
  const el = document.createElement('img');
  el.className = className;
  el.loading = 'lazy';
  el.decoding = 'async';
  el.alt = alt ?? photo.topic;
  el.src = sizeHint === 'full' ? photo.full : photo.thumb;
  if (!photo.isPlaceholder) {
    el.addEventListener('error', () => { el.src = placeholderFor(photo.topic); }, { once: true });
  }
  return el;
}
