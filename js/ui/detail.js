import { h, mount } from '../util/dom.js';
import { data } from '../data.js';
import * as store from '../state.js';
import { photosFor, imgEl } from '../images.js';
import {
  scoreDestination, monthCurve, MONTHS, MONTHS_SHORT, estimateFlightHours, dailyCost, crowdWord,
  COST_TIERS, costTierLabel, SEASONS, seasonCurve, periodLabel
} from '../scoring.js';
import { scoreRing, breakdownTable, ragChip, toggleButton, infoButton, hasInfo, openInfo } from './components.js';

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

  // Twelve months where the world has a calendar, four seasons where it does
  // not. The underlying curve is the same 12 points either way; the seasonal
  // view just averages each three.
  const timeModel = data().world.timeModel;
  const seasonal = timeModel === 'seasons';
  const when = periodLabel(prefs.month, timeModel);
  const bars = seasonal ? seasonCurve(curve) : curve;
  const barLabels = seasonal ? SEASONS.map((x) => x.label) : MONTHS_SHORT;
  const barMonths = seasonal ? SEASONS.map((x) => x.month) : curve.map((_, i) => i);
  const currentBar = seasonal ? SEASONS.findIndex((x) => x.months.includes(prefs.month)) : prefs.month;
  const bestBar = bars.indexOf(Math.max(...bars));
  const worstBar = bars.indexOf(Math.min(...bars));
  const photos = photosFor(dest);
  const m = prefs.month;
  const rerender = () => renderDetail(root, id, { go });

  const flightHours = prefs.home ? estimateFlightHours(prefs.home, dest) : null;
  const style = prefs.targets.budgetStyle;
  const nights = prefs.targets.tripNights ?? 7;
  const dayCost = dailyCost(dest, style, m) ?? 0;

  mount(root,
    h('section', { class: 'screen screen--detail' },

      h('button', { class: 'backlink', onclick: () => history.back() }, '← Back'),

      // ---- hero -----------------------------------------------------------
      h('div', { class: 'detail__hero' },
        h('button', {
          class: 'detail__heroImg',
          onclick: () => openLightbox(photos, 0),
          'aria-label': 'Open photo gallery'
        }, imgEl(photos[0], { sizeHint: 'full', alt: `${dest.name} — ${photos[0].topic}` })),
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
            class: 'gallery__item', onclick: () => openLightbox(photos, i),
            'aria-label': `View photo: ${p.topic}`
          },
            imgEl(p, { className: 'gallery__img' }),
            h('span', { class: 'gallery__cap' }, p.topic)
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
        h('h2', null, `In ${when}`),
        h('div', { class: 'facts' },
          fact('🌡️', 'Daytime high', `${Math.round(dest.climate.tempHigh[m])}°C`),
          fact('☀️', 'Sunshine', `${dest.climate.sunHours[m]}h a day`),
          fact('☂️', 'Rainy days', `${dest.climate.rainDays[m]} a month`),
          dest.climate.seaTemp ? fact('🌊', 'Sea', `${dest.climate.seaTemp[m]}°C`) : null,
          dest.climate.snowDepth ? fact('❄️', 'Snow', dest.climate.snowDepth[m] > 0 ? `~${dest.climate.snowDepth[m]}cm` : 'None') : null,
          fact('👥', 'Busy-ness', crowdWord(dest.crowd[m])),
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
      h('div', { class: 'panel' },
        h('h2', null, seasonal ? 'When to set out' : 'When to go'),
        h('p', { class: 'panel__hint' },
          seasonal
            ? `Your criteria scored across the year. Best: ${SEASONS[bestBar].label} `
              + `(${bars[bestBar]}%). Worst: ${SEASONS[worstBar].label} (${bars[worstBar]}%).`
            : `Your criteria scored against every month. Best: ${MONTHS[best]} (${curve[best]}%). `
              + `Worst: ${MONTHS[worst]} (${curve[worst]}%).`),
        h('div', { class: 'curve' + (seasonal ? ' curve--seasons' : '') },
          bars.map((v, i) =>
            h('button', {
              class: 'curve__bar' + (i === currentBar ? ' is-current' : '') + (i === bestBar ? ' is-best' : ''),
              title: `${barLabels[i]}: ${v}%`,
              onclick: () => { store.setMonth(barMonths[i]); rerender(); }
            },
              h('span', { class: 'curve__fill', style: { height: Math.max(4, v) + '%' } }),
              h('span', { class: 'curve__val' }, v),
              h('span', { class: 'curve__month' }, barLabels[i])
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
                const perDay = dailyCost(dest, k, m) ?? 0;
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

function openLightbox(photos, startIndex) {
  let i = startIndex;

  const img = h('img', { class: 'lightbox__img', alt: photos[i].topic });
  const cap = h('div', { class: 'lightbox__cap' });
  const counter = h('span', { class: 'lightbox__counter' });

  const paint = () => {
    const p = photos[i];
    img.src = p.full;
    img.alt = p.topic;
    counter.textContent = `${i + 1} / ${photos.length}`;
    cap.replaceChildren(
      h('strong', null, p.topic),
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
