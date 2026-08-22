import { h, mount } from '../util/dom.js';
import { data } from '../data.js';
import * as store from '../state.js';
import { photosFor, imgEl } from '../images.js';
import {
  scoreDestination, monthCurve, MONTHS, MONTHS_SHORT, estimateFlightHours, dailyCost, crowdWord,
  COST_TIERS, costTierLabel, periodLabel
} from '../scoring.js';
import {
  scoreRing, breakdownTable, ragChip, toggleButton, infoButton, hasInfo, openInfo, mapsLink
} from './components.js';

export function renderDetail(root, id, { go }) {
  const { destById, criteriaById } = data();
  const dest = destById.get(id);

  if (!dest) {
    mount(root, h('section', { class: 'screen' },
      h('p', null, 'That destination could not be found.'),
      h('button', { class: 'btn btn--primary', onclick: () => go('#/results') }, 'Back to matches')));
    return;
  }

  const prefs = store.state.prefs;
  const result = scoreDestination(dest, prefs, criteriaById);
  const { curve, best, worst } = monthCurve(dest, prefs, criteriaById);

  // A world with no calendar gets no month picker and no month chart. Its
  // climate is still real and still varies, so it is reported as a range
  // instead of at a point you were never able to choose.
  const timeModel = data().world.timeModel;
  const timeless = timeModel === 'none';

  // Fiction is illustrated with photographs of real places standing in for
  // somewhere that does not exist. Captioning the Rivendell gallery "Kaitoke
  // Regional Park New Zealand" answers a question nobody asked and breaks the
  // illusion the rest of the page is maintaining, so in a stand-in world the
  // real subject is named once, in the credits, where attribution belongs.
  const standIn = !!data().world.standInPhotos;
  const when = periodLabel(prefs.month, timeModel);

  /** Mean of a twelve-month series — what "typical" means with no month. */
  const mean = (a) => (Array.isArray(a) ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  /** The value to print: this month's, or the year's average. */
  const at = (a) => (Array.isArray(a) ? (timeless ? mean(a) : Math.round(a[m])) : null);
  const photos = photosFor(dest);
  const m = prefs.month;
  const rerender = () => renderDetail(root, id, { go });

  const flightHours = prefs.home ? estimateFlightHours(prefs.home, dest) : null;
  const style = prefs.targets.budgetStyle;
  const nights = prefs.targets.tripNights ?? 7;
  const noHostels = !!prefs.targets.noHostels;
  const dayCost = dailyCost(dest, style, m, { noHostels }) ?? 0;

  mount(root,
    h('section', { class: 'screen screen--detail' },

      h('button', { class: 'backlink', onclick: () => history.back() }, '← Back'),

      // ---- hero -----------------------------------------------------------
      h('div', { class: 'detail__hero' },
        h('button', {
          class: 'detail__heroImg',
          onclick: () => openLightbox(photos, 0, { standIn, name: dest.name }),
          'aria-label': 'Open photo gallery'
        }, imgEl(photos[0], {
            sizeHint: 'full',
            alt: standIn ? dest.name : `${dest.name} — ${photos[0].topic}`
          })),
        h('div', { class: 'detail__heroOverlay' },
          h('h1', null, dest.name),
          h('p', null, `${dest.region ? dest.region + ' · ' : ''}${dest.country} · ${dest.continent}`)
        ),
        infoButton(dest, { className: 'info-btn info-btn--hero', stop: false }),
        h('div', { class: 'detail__heroScore' },
          scoreRing(result.overall, { size: 84, stroke: 7, label: 'match' }))
      ),

      // ---- gallery --------------------------------------------------------
      // A short gallery should fill the width rather than trail off; a long one
      // scrolls sideways as before.
      h('div', { class: 'gallery' + (photos.length <= 4 ? ' gallery--few' : '') },
        photos.map((p, i) =>
          h('button', {
            class: 'gallery__item', onclick: () => openLightbox(photos, i, { standIn, name: dest.name }),
            'aria-label': standIn ? `View photo ${i + 1} of ${dest.name}` : `View photo: ${p.topic}`
          },
            imgEl(p, { className: 'gallery__img' }),
            standIn ? null : h('span', { class: 'gallery__cap' }, p.topic)
          )
        )
      ),
      photos.some((p) => p.isPlaceholder)
        ? h('p', { class: 'notice' },
            'No photograph found for this one — run ',
            h('code', null, data().world.id === 'real' ? 'npm run photos' : 'npm run photos:fiction'),
            ' to try again.')
        : null,

      h('p', { class: 'detail__blurb' }, dest.blurb),

      // The hero caption says where this is; this says where that is.
      mapsLink(dest, { className: 'detail__map', label: '🗺 Show on Google Maps' }),

      hasInfo(dest)
        ? h('button', { class: 'detail__source', onclick: () => openInfo(dest) },
            'ⓘ  About this place and where it comes from')
        : null,

      // ---- actions --------------------------------------------------------
      h('div', { class: 'detail__actions' },
        toggleButton({
          on: store.isShortlisted(dest.id), labels: ['☆ Save', '★ Saved'],
          act: () => store.toggleShortlist(dest.id), state: () => store.isShortlisted(dest.id)
        }),
        toggleButton({
          on: store.isComparing(dest.id), labels: ['⇄ Compare', '✓ Comparing'],
          act: () => store.toggleCompare(dest.id), state: () => store.isComparing(dest.id)
        }),
        toggleButton({
          on: store.isBeenThere(dest.id), labels: ['Been there', '✓ Been there'],
          act: () => store.toggleBeenThere(dest.id), state: () => store.isBeenThere(dest.id)
        })
      ),

      // ---- headline verdict ----------------------------------------------
      h('div', { class: 'panel' },
        h('h2', null, timeless ? 'What it is like' : `In ${when}`),
        h('div', { class: 'facts' },
          fact('🌡️', timeless ? 'Typical high' : 'Daytime high', `${at(dest.climate.tempHigh)}°C`,
            timeless ? `${Math.min(...dest.climate.tempHigh)}° to ${Math.max(...dest.climate.tempHigh)}° across the year` : null),
          fact('☀️', 'Sunshine', `${at(dest.climate.sunHours)}h a day`),
          fact('☂️', 'Rainy days', `${at(dest.climate.rainDays)} a month`),
          dest.climate.seaTemp ? fact('🌊', 'Sea', `${at(dest.climate.seaTemp)}°C`) : null,
          dest.climate.snowDepth ? fact('❄️', 'Snow', at(dest.climate.snowDepth) > 0 ? `~${at(dest.climate.snowDepth)}cm` : 'None') : null,
          fact('👥', 'Busy-ness', crowdWord(at(dest.crowd))),
          dest.costTier
            ? fact('💰', 'Cost', costTierLabel(dest.costTier), 'to visit')
            : fact('💷', 'Cost a day', `£${dayCost}`, `${style} travel`),
          dest.costTier
            ? null
            : fact('🧾', `${nights} nights`, `£${(dayCost * nights).toLocaleString('en-GB')}`, 'excl. flights'),
          flightHours != null ? fact('✈️', 'Flight', `~${flightHours}h`, prefs.home.label) : null
        )
      ),

      result.highlights.length
        ? h('div', { class: 'panel' },
            h('h2', null, 'Why it matches'),
            h('div', { class: 'chips-row' }, result.highlights.map((c) => ragChip(c, { showDetail: true }))))
        : null,

      result.watchOuts.length
        ? h('div', { class: 'panel panel--warn' },
            h('h2', null, 'Watch out for'),
            h('div', { class: 'chips-row' }, result.watchOuts.map((c) => ragChip(c, { showDetail: true }))))
        : null,

      // ---- when to go -----------------------------------------------------
      // A chart of twelve months you cannot pick between would only invite a
      // choice that does not exist here.
      timeless ? null : h('div', { class: 'panel' },
        h('h2', null, 'When to go'),
        h('p', { class: 'panel__hint' },
          `Your criteria scored against every month. Best: ${MONTHS[best]} (${curve[best]}%). `
          + `Worst: ${MONTHS[worst]} (${curve[worst]}%).`),
        h('div', { class: 'curve' },
          curve.map((v, i) =>
            h('button', {
              class: 'curve__bar' + (i === m ? ' is-current' : '') + (i === best ? ' is-best' : ''),
              title: `${MONTHS[i]}: ${v}%`,
              onclick: () => { store.setMonth(i); rerender(); }
            },
              h('span', { class: 'curve__fill', style: { height: Math.max(4, v) + '%' } }),
              h('span', { class: 'curve__val' }, v),
              h('span', { class: 'curve__month' }, MONTHS_SHORT[i])
            )
          )
        )
      ),

      // ---- full breakdown -------------------------------------------------
      h('div', { class: 'panel' },
        h('h2', null, 'Full score breakdown'),
        h('p', { class: 'panel__hint' },
          `${result.coverage} criteria scored`
          + (result.unknowns ? `, ${result.unknowns} with no data (excluded from the total)` : '')
          + (result.penalised ? ` · penalised for missing ${result.dealbreakers} must-have${result.dealbreakers === 1 ? '' : 's'}` : '')),
        breakdownTable(result)
      ),

      // ---- costs ----------------------------------------------------------
      dest.costTier
        ? h('div', { class: 'panel' },
            h('h2', null, 'What it would cost you'),
            h('div', { class: 'costs' },
              COST_TIERS.map((t) =>
                h('div', { class: 'costs__item' + (t.id === dest.costTier ? ' is-on' : '') },
                  h('span', { class: 'costs__label' }, t.label),
                  h('strong', null, t.id === dest.costTier ? 'This place' : '—'),
                  h('span', { class: 'costs__total' }, t.help)
                ))
            ),
            h('p', { class: 'panel__hint' },
              'Currencies here are not comparable, so cost is a three-step judgement rather than a price.')
          )
        : h('div', { class: 'panel' },
            h('h2', null, 'Typical daily cost'),
            h('div', { class: 'costs' },
              ['budget', 'mid', 'luxury'].map((k) => {
                const perDay = dailyCost(dest, k, m, { noHostels }) ?? 0;
                return h('div', { class: 'costs__item' + (k === style ? ' is-on' : '') },
                  h('span', { class: 'costs__label' }, k === 'mid' ? 'Mid-range' : k[0].toUpperCase() + k.slice(1)),
                  h('strong', null, '£' + perDay.toLocaleString('en-GB')),
                  h('span', { class: 'costs__total' }, `£${(perDay * nights).toLocaleString('en-GB')} total`)
                );
              })
            ),
            h('p', { class: 'panel__hint' },
              `Per person, excluding flights, adjusted for ${when} prices and a ${nights}-night trip. Indicative only.`)
          ),

      // ---- attribution ----------------------------------------------------
      photos.some((p) => p.credit)
        ? h('div', { class: 'panel panel--muted' },
            h('h2', null, 'Photo credits'),
            standIn
              ? h('p', { class: 'panel__hint' },
                  'Photographs of real places, standing in for somewhere that is not.')
              : null,
            h('ul', { class: 'credits' },
              photos.filter((p) => p.credit).map((p) =>
                h('li', null,
                  h('em', null, p.topic), ' — ', p.credit,
                  p.license ? ` (${p.license})` : '',
                  p.source ? h('a', { href: p.source, target: '_blank', rel: 'noopener' }, ' source') : null)))
          )
        : null
    )
  );

  // Scroll to the top only when this is a different destination than last time,
  // so changing the month on the curve doesn't fling you back up the page.
  if (lastRenderedId !== id) {
    lastRenderedId = id;
    root.scrollTop = 0;
    window.scrollTo(0, 0);
  }
}

let lastRenderedId = null;

function fact(icon, label, value, sub = null) {
  return h('div', { class: 'fact' },
    h('span', { class: 'fact__icon' }, icon),
    h('span', { class: 'fact__label' }, label),
    h('strong', { class: 'fact__value' }, value),
    sub ? h('span', { class: 'fact__sub' }, sub) : null
  );
}

// ---------------------------------------------------------------------------
// Lightbox
// ---------------------------------------------------------------------------

function openLightbox(photos, startIndex, { standIn = false, name = '' } = {}) {
  let i = startIndex;

  const img = h('img', { class: 'lightbox__img', alt: standIn ? name : photos[i].topic });
  const cap = h('div', { class: 'lightbox__cap' });
  const counter = h('span', { class: 'lightbox__counter' });

  const paint = () => {
    const p = photos[i];
    img.src = p.full;
    img.alt = standIn ? name : p.topic;
    counter.textContent = `${i + 1} / ${photos.length}`;
    cap.replaceChildren(
      h('strong', null, standIn ? name : p.topic),
      p.credit ? h('span', null, ` · ${p.credit}${p.license ? ' · ' + p.license : ''}`) : null
    );
  };

  const step = (d) => { i = (i + d + photos.length) % photos.length; paint(); };

  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
  };

  const overlay = h('div', {
    class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photo viewer',
    onclick: (e) => { if (e.target === overlay) close(); }
  },
    h('button', { class: 'lightbox__close', onclick: () => close(), 'aria-label': 'Close' }, '✕'),
    h('button', { class: 'lightbox__nav lightbox__nav--prev', onclick: () => step(-1), 'aria-label': 'Previous' }, '‹'),
    img,
    h('button', { class: 'lightbox__nav lightbox__nav--next', onclick: () => step(1), 'aria-label': 'Next' }, '›'),
    h('div', { class: 'lightbox__bar' }, cap, counter)
  );

  function close() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    document.body.classList.remove('is-locked');
  }

  paint();
  document.addEventListener('keydown', onKey);
  document.body.classList.add('is-locked');
  document.body.appendChild(overlay);
}
