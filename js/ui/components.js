import { h, svg, mount } from '../util/dom.js';
import { imgEl, heroPhoto } from '../images.js';
import {
  MONTHS, MONTHS_SHORT, IMPORTANCE_LABELS, crowdWord, BUDGET_STYLES, budgetSpread,
  COST_TIERS, costTierLabel, SEASONS, seasonOf, periodLabel,
  styleForBudget, sensibleFlightHours, NO_FLIGHT_LIMIT
} from '../scoring.js';
import { data } from '../data.js';
import { mapsUrl } from '../maps.js';
import * as store from '../state.js';

/**
 * Criteria whose weight and target both live on the Trip screen rather than in
 * the Criteria list. Identified by KIND, not by id, so each world gets the right
 * set automatically — the real world has flight time, fiction has a cost tier.
 *
 * They describe the shape of the trip itself, so they belong beside the month
 * and travel style. Listing them in both places is what made the screens
 * confusing in the first place.
 */
export const TRIP_KINDS = ['temp', 'crowd', 'budget', 'tier', 'flight'];
export const isTripCriterion = (c) => TRIP_KINDS.includes(c.kind);
export const tripCriteria = (criteria) => criteria.filter(isTripCriterion);

// ---------------------------------------------------------------------------
// Score ring
// ---------------------------------------------------------------------------

export function scoreRing(percent, { size = 62, stroke = 6, label = null } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const band = percent >= 70 ? 'green' : percent >= 45 ? 'amber' : 'red';

  return h('div', { class: `ring ring--${band}`, style: { width: size + 'px', height: size + 'px' } },
    svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, 'aria-hidden': 'true' },
      svg('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke, class: 'ring__track' }),
      svg('circle', {
        cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke, class: 'ring__value',
        'stroke-dasharray': `${(c * percent) / 100} ${c}`,
        'stroke-linecap': 'round',
        transform: `rotate(-90 ${size / 2} ${size / 2})`
      })
    ),
    h('div', { class: 'ring__label' },
      h('strong', null, percent),
      h('span', null, '%'),
      label ? h('em', null, label) : null
    )
  );
}

// ---------------------------------------------------------------------------
// Red / amber / green chips
// ---------------------------------------------------------------------------

export function ragChip(item, { showDetail = false } = {}) {
  return h('span', {
    class: `chip chip--${item.rag}`,
    title: `${item.criterion.label} — ${item.detail} (${IMPORTANCE_LABELS[item.importance]})`
  },
    h('span', { class: 'chip__icon' }, item.criterion.icon),
    h('span', { class: 'chip__label' }, item.criterion.label),
    showDetail ? h('span', { class: 'chip__detail' }, item.detail) : null
  );
}

/** The full explain-the-score table used on the detail screen. */
export function breakdownTable(result) {
  const byCat = new Map();
  for (const item of result.breakdown) {
    const cat = item.criterion.cat;
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(item);
  }

  return h('div', { class: 'breakdown' },
    [...byCat.entries()].map(([, items]) =>
      h('div', { class: 'breakdown__group' },
        items.map((item) =>
          h('div', { class: `bd-row bd-row--${item.rag}` },
            h('span', { class: 'bd-row__icon' }, item.criterion.icon),
            h('div', { class: 'bd-row__main' },
              h('div', { class: 'bd-row__label' },
                item.criterion.label,
                item.importance === 3 ? h('span', { class: 'tag tag--must' }, 'must have') : null,
                item.importance === 2 ? h('span', { class: 'tag' }, 'important') : null
              ),
              h('div', { class: 'bd-row__detail' }, item.detail)
            ),
            h('div', { class: 'bd-row__bar' },
              h('div', {
                class: 'bd-row__fill',
                style: { width: item.score == null ? '0%' : Math.round(item.score * 100) + '%' }
              })
            ),
            h('div', { class: 'bd-row__score' }, item.score == null ? '—' : Math.round(item.score * 100))
          )
        )
      )
    )
  );
}

// ---------------------------------------------------------------------------
// Destination card
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {Function} opts.onOpen   navigate to the detail screen
 * @param {Function} [opts.onToggle] called after Save/Compare changes, so the
 *        caller can refresh anything outside this card. The card updates its own
 *        buttons in place — re-rendering the list would lose the scroll position.
 */
export function destinationCard(result, { rank = null, onOpen, onToggle = () => {} } = {}) {
  const d = result.dest;
  const photo = heroPhoto(d);
  const shortlisted = store.isShortlisted(d.id);
  const comparing = store.isComparing(d.id);

  const chips = [...result.highlights.slice(0, 3), ...result.watchOuts.slice(0, 2)];

  return h('article', { class: 'card', dataset: { id: d.id } },
    h('button', {
      class: 'card__media', onclick: () => onOpen(d.id),
      'aria-label': `Open ${d.name}`
    },
      imgEl(photo, {
        className: 'card__img',
        alt: photo.caption && photo.caption !== photo.topic ? d.name : `${d.name} — ${photo.topic}`
      }),
      rank != null ? h('span', { class: 'card__rank' }, '#' + rank) : null,
      h('div', { class: 'card__ring' }, scoreRing(result.overall, { size: 54, stroke: 5 }))
    ),

    h('div', { class: 'card__body' },
      h('div', { class: 'card__head' },
        h('button', { class: 'card__title', onclick: () => onOpen(d.id) },
          h('h3', null, d.name),
          h('span', { class: 'card__where' }, `${d.region ? d.region + ', ' : ''}${d.country}`)
        ),
        infoButton(d)
      ),
      h('p', { class: 'card__blurb' }, d.blurb),

      chips.length ? h('div', { class: 'card__chips' }, chips.map((c) => ragChip(c))) : null,

      result.penalised
        ? h('p', { class: 'card__warn' },
            `Misses ${result.dealbreakers} of your must-haves`)
        : null,

      h('div', { class: 'card__actions' },
        toggleButton({
          on: shortlisted,
          labels: ['☆ Save', '★ Saved'],
          act: () => store.toggleShortlist(d.id),
          state: () => store.isShortlisted(d.id),
          after: onToggle
        }),
        toggleButton({
          on: comparing,
          labels: ['⇄ Compare', '✓ Comparing'],
          act: () => store.toggleCompare(d.id),
          state: () => store.isComparing(d.id),
          after: onToggle
        }),
        mapsLink(d),
        h('button', { class: 'btn btn--primary', onclick: () => onOpen(d.id) }, 'Details')
      )
    )
  );
}

/**
 * "Where actually is this?" — a link out to Google Maps.
 *
 * Only for worlds whose places exist: `mappable` is false for fiction, where
 * the honest answer is that there is nowhere to point at.
 *
 * Framed at the scale of the place: see js/maps.js. The link searches for the
 * feature by name so Google fits its own bounds — an island frames as an
 * island — and carries the curated coordinates as the starting viewport.
 */
export function mapsLink(dest, { className = 'btn btn--ghost', label = '🗺 Map' } = {}) {
  if (!data().world.mappable) return null;
  if (!Number.isFinite(dest.lat) || !Number.isFinite(dest.lon)) return null;
  return h('a', {
    class: className,
    href: mapsUrl(dest),
    target: '_blank',
    rel: 'noopener noreferrer',
    title: `Show ${dest.name} on Google Maps`,
    'aria-label': `Show ${dest.name} on Google Maps — opens in a new tab`,
    // Cards and rows are clickable in their own right; opening a map should not
    // also open the destination behind it.
    onclick: (e) => e.stopPropagation()
  }, label);
}

/** A button that repaints only itself when toggled. */
export function toggleButton({ on, labels, act, state, after }) {
  const btn = h('button', {
    class: 'btn btn--ghost' + (on ? ' is-on' : ''),
    'aria-pressed': on ? 'true' : 'false',
    onclick: () => {
      act();
      const now = state();
      btn.className = 'btn btn--ghost' + (now ? ' is-on' : '');
      btn.setAttribute('aria-pressed', now ? 'true' : 'false');
      btn.textContent = labels[now ? 1 : 0];
      after(now);
    }
  }, labels[on ? 1 : 0]);
  return btn;
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export function importancePicker(criterion, current, onChange) {
  return h('div', { class: 'imp', role: 'radiogroup', 'aria-label': criterion.label },
    IMPORTANCE_LABELS.map((label, level) =>
      h('button', {
        class: `imp__btn imp__btn--${level}` + (current === level ? ' is-on' : ''),
        role: 'radio',
        'aria-checked': current === level ? 'true' : 'false',
        title: label,
        onclick: () => onChange(level)
      }, level === 0 ? '–' : '●'.repeat(level))
    )
  );
}

/**
 * A slider that says what its two ends MEAN.
 *
 * A bare 0-100 track labelled "Atmosphere" tells you nothing about
 * which direction is which, so every scale-style preference gets explicit end
 * labels and a live plain-English readout of the current value.
 */
export function rangeField({
  label, min, max, step = 1, value, onInput,
  format = String, leftLabel, rightLabel, hint = null
}) {
  const readout = h('span', { class: 'range__readout' }, format(value));

  const input = h('input', {
    type: 'range', min, max, step, value,
    class: 'range__input',
    'aria-label': label,
    oninput: (e) => {
      const v = Number(e.target.value);
      readout.textContent = format(v);
      onInput(v);
    }
  });

  return h('div', { class: 'range' },
    h('div', { class: 'range__head' },
      h('span', { class: 'range__label' }, label),
      readout
    ),
    input,
    h('div', { class: 'range__ends' },
      h('span', null, leftLabel),
      h('span', null, rightLabel)
    ),
    hint ? h('p', { class: 'range__hint' }, hint) : null
  );
}

export { crowdWord };

export function slider({ min, max, step = 1, value, onInput, format = String, id }) {
  const out = h('output', { class: 'slider__value' }, format(value));
  const input = h('input', {
    type: 'range', min, max, step, value, id,
    class: 'slider__input',
    oninput: (e) => {
      const v = Number(e.target.value);
      out.textContent = format(v);
      onInput(v);
    }
  });
  return h('div', { class: 'slider' }, input, out);
}

export function monthPicker(current, onChange) {
  return h('div', { class: 'months', role: 'radiogroup', 'aria-label': 'Travel month' },
    MONTHS_SHORT.map((m, i) =>
      h('button', {
        class: 'months__btn' + (current === i ? ' is-on' : ''),
        role: 'radio', 'aria-checked': current === i ? 'true' : 'false',
        onclick: () => onChange(i)
      }, m)
    )
  );
}

/**
 * The same question as monthPicker, for a world with no calendar. Picking a
 * season sets the month at the middle of it, so the engine is unchanged.
 */
export function seasonPicker(current, onChange) {
  const now = seasonOf(current).id;
  return h('div', { class: 'seasons', role: 'radiogroup', 'aria-label': 'Season of travel' },
    SEASONS.map((s) =>
      h('button', {
        class: 'seasons__btn' + (now === s.id ? ' is-on' : ''),
        role: 'radio', 'aria-checked': now === s.id ? 'true' : 'false',
        onclick: () => onChange(s.month)
      },
        h('span', { class: 'seasons__label' }, s.label),
        h('span', { class: 'seasons__help' }, s.help)
      )
    )
  );
}

/**
 * Whichever of these the world asks for — or nothing at all, for a world with
 * no calendar. Nobody sets out for Mordor in June.
 */
export function timePicker(timeModel, current, onChange) {
  if (timeModel === 'none') return null;
  return timeModel === 'seasons' ? seasonPicker(current, onChange) : monthPicker(current, onChange);
}

/** "June", "Winter", or null where the question does not apply. */
export const when = (prefs) => periodLabel(prefs.month, data().world.timeModel);

export function segmented(options, current, onChange, { label = '' } = {}) {
  return h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label },
    options.map((o) =>
      h('button', {
        class: 'seg__btn' + (current === o.id ? ' is-on' : ''),
        role: 'radio', 'aria-checked': current === o.id ? 'true' : 'false',
        title: o.help || '',
        onclick: () => onChange(o.id)
      }, o.label)
    )
  );
}

export function field(labelText, control, hint = null) {
  return h('div', { class: 'field' },
    h('label', { class: 'field__label' }, labelText),
    control,
    hint ? h('p', { class: 'field__hint' }, hint) : null
  );
}

export function emptyState(icon, title, body, action = null) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty__icon' }, icon),
    h('h2', null, title),
    h('p', null, body),
    action
  );
}

/**
 * Live reality check against the actual catalogue. Travel style and daily spend
 * are set on different screens, so it is easy to end up asking for something no
 * destination can satisfy — say luxury at £50 a day. Say so, with numbers.
 */
function budgetNote(prefs) {
  const style = BUDGET_STYLES.find((b) => b.id === prefs.targets.budgetStyle);
  const plain = (style?.label || 'mid-range').toLowerCase();
  const label = prefs.targets.noHostels && prefs.targets.budgetStyle === 'budget'
    ? `${plain} prices without hostels`
    : `${plain} prices`;
  const noHostels = !!prefs.targets.noHostels;
  const spread = budgetSpread(data().destinations, prefs.targets.budgetStyle, prefs.month, { noHostels });
  if (!spread) return { text: `At ${label}, excluding flights.`, level: '' };

  const value = prefs.targets.budgetPerDay;
  const n = spread.withinBudget(value);
  if (n === 0) {
    return {
      level: ' is-bad',
      text: `Nothing costs under £${value} a day at ${label} — the cheapest is £${spread.min}. `
        + 'Everywhere will score badly on Cost.'
    };
  }
  const pct = Math.round((n / spread.count) * 100);
  return {
    level: pct < 10 ? ' is-warn' : '',
    text: `${n} of ${spread.count} destinations (${pct}%) fit at this budget. `
      + `Typical is £${spread.median} a day, excluding flights.`
  };
}

/**
 * What you spend, asked once.
 *
 * Travel style and daily budget used to be two controls in two different blocks
 * of the same screen, each carrying a note explaining that the other one lived
 * somewhere else. They were never two questions: what you are willing to spend
 * per day IS whether you are in a dorm or a suite. So there is one slider now,
 * and the tier under it is read off the live catalogue.
 */
export function moneyControl(onChange = () => {}) {
  const wrap = h('div', { class: 'money' });

  const paint = () => {
    const prefs = store.state.prefs;
    const styleId = prefs.targets.budgetStyle;
    const style = BUDGET_STYLES.find((b) => b.id === styleId) || {};
    const note = budgetNote(prefs);
    const noteEl = h('p', { class: 'budget-note' + note.level }, note.text);

    const slider = rangeField({
      label: 'What you can spend, per person, per day',
      min: 20, max: 700, step: 10,
      value: prefs.targets.budgetPerDay,
      format: (v) => '£' + v + (v >= 700 ? '+' : ''),
      leftLabel: '\u2190 £20',
      rightLabel: '£700+ \u2192',
      onInput: (v) => {
        const before = store.state.prefs.targets.budgetStyle;
        store.update((s) => {
          s.prefs.targets.budgetPerDay = v;
          s.prefs.targets.budgetStyle = styleForBudget(data().destinations, v, s.prefs.month,
            { noHostels: !!s.prefs.targets.noHostels });
        });
        // Repaint the whole control only when the tier itself changed, so
        // dragging the slider does not rebuild it under the user's finger.
        if (store.state.prefs.targets.budgetStyle !== before) { paint(); onChange(); return; }
        const n = budgetNote(store.state.prefs);
        noteEl.className = 'budget-note' + n.level;
        noteEl.textContent = n.text;
        onChange();
      }
    });

    const children = [
      slider,
      h('p', { class: 'money__tier' },
        h('strong', null, 'That is ' + (style.label || 'mid-range').toLowerCase() + ' travel'),
        h('span', null, style.help ? ' \u2014 ' + style.help.toLowerCase() : ''))
    ];

    // Only the cheapest tier assumes a dorm bed, so only it gets the question.
    if (styleId === 'budget') {
      children.push(
        h('label', { class: 'switch switch--inline' },
          h('input', {
            type: 'checkbox',
            checked: !prefs.targets.noHostels,
            onchange: (e) => {
              store.update((s) => { s.prefs.targets.noHostels = !e.target.checked; });
              paint();
              onChange();
            }
          }),
          h('span', null, 'Hostels are fine')),
        h('p', { class: 'range__hint' },
          prefs.targets.noHostels
            ? 'Pricing the cheapest private room instead, which is the biggest single line on a budget day.'
            : 'At this level prices assume a dorm bed. Untick to price the cheapest private room instead.')
      );
    }

    children.push(noteEl);
    mount(wrap, ...children);
  };

  paint();
  return wrap;
}

/** The listed origin closest to a pair of coordinates. */
function nearestOrigin(origins, lat, lon) {
  let best = origins[0];
  let bestD = Infinity;
  for (const o of origins) {
    const dx = (o.lon - lon) * Math.cos(lat * Math.PI / 180);
    const d = (o.lat - lat) ** 2 + dx ** 2;
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

/**
 * Where you are travelling from.
 *
 * Seventy-eight airports in one flat select is a scroll, not a choice. This
 * filters as you type, groups whatever is left by country, and will find the
 * nearest listed airport if the browser is willing to say where you are.
 */
export function originPicker(origins, onChange = () => {}) {
  const wrap = h('div', { class: 'origin' });
  let query = '';
  let status = null;

  const choose = (o) => {
    store.update((s) => {
      s.prefs.home = o ? { id: o.id, label: o.label, lat: o.lat, lon: o.lon } : null;
    });
    query = '';
    paint();
    onChange();
  };

  const paint = () => {
    const prefs = store.state.prefs;
    const q = query.trim().toLowerCase();
    const matches = origins.filter((o) => !q
      || o.label.toLowerCase().includes(q)
      || o.id.toLowerCase().includes(q)
      || (o.country || '').toLowerCase().includes(q));

    // Grouped by country, in the file's own order, so the likeliest answers
    // stay at the top instead of being alphabetised into the middle.
    const groups = new Map();
    for (const o of matches) {
      const k = o.country || 'Elsewhere';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(o);
    }

    const select = h('select', {
      class: 'select',
      size: q ? Math.min(9, matches.length + groups.size) : 1,
      'aria-label': 'Departure airport',
      onchange: (e) => choose(origins.find((x) => x.id === e.target.value))
    },
      q ? null : h('option', { value: '' }, '\u2014 not bothered about flight time \u2014'),
      [...groups.entries()].map(([country, list]) =>
        h('optgroup', { label: country },
          list.map((o) => h('option',
            { value: o.id, selected: prefs.home && prefs.home.id === o.id },
            o.label + ' (' + o.id + ')')))));

    const search = h('input', {
      type: 'search',
      class: 'input',
      value: query,
      placeholder: 'Search airport, city or country\u2026',
      'aria-label': 'Search for your departure airport',
      oninput: (e) => { query = e.target.value; status = null; paint(); }
    });

    const locate = (typeof navigator !== 'undefined' && navigator.geolocation)
      ? h('button', {
          class: 'btn btn--ghost btn--sm',
          type: 'button',
          onclick: () => {
            status = 'Finding you\u2026';
            paint();
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                const near = nearestOrigin(origins, pos.coords.latitude, pos.coords.longitude);
                status = 'Nearest listed airport: ' + near.label;
                choose(near);
              },
              () => { status = 'Could not get your location \u2014 pick one below.'; paint(); },
              { timeout: 8000, maximumAge: 600000 }
            );
          }
        }, '\u{1F4CD} Use my location')
      : null;

    mount(wrap,
      h('div', { class: 'origin__row' }, search, locate),
      select,
      status ? h('p', { class: 'field__hint' }, status) : null,
      (q && !matches.length)
        ? h('p', { class: 'field__hint' }, 'Nothing matches \u201C' + query + '\u201D.')
        : null);
  };

  paint();
  return wrap;
}

/**
 * Whether a trip of this length can absorb the flight it takes to get there.
 *
 * Shown before any destination is picked, because the answer changes what is
 * worth searching for at all: four nights and a twelve-hour flight is not a
 * holiday with a long journey, it is a journey with a holiday attached.
 */
export function travelTimeNote(prefs) {
  const nights = prefs.targets && prefs.targets.tripNights ? prefs.targets.tripNights : 7;
  const ceiling = sensibleFlightHours(nights);
  if (ceiling === null) {
    return 'At ' + nightsPhrase(nights) + ', even the far side of the world is a small part of '
      + 'the trip \u2014 travel time barely matters here.';
  }
  // Below a couple of hours the honest answer is qualitative: quoting a
  // 1h ceiling reads as a glitch even though the arithmetic is right.
  if (ceiling < 2) {
    return nightsPhrase(nights, true) + ' is short enough that any flight is a real slice of it. '
      + 'Somewhere close, or a longer trip.';
  }
  return 'At ' + nightsPhrase(nights) + ', a flight much over ' + ceiling + 'h costs you the best '
    + 'part of a day at each end. Longer trips absorb longer flights.';
}

const nightsPhrase = (n, cap = false) => {
  const s = n === 1 ? '1 night' : n + ' nights';
  return cap ? s.charAt(0).toUpperCase() + s.slice(1) : s;
};

/**
 * The inline "which end do you want?" control for criteria that are scored
 * against a target rather than "more is better".
 */
export function targetControl(criterion, prefs, go) {
  switch (criterion.kind) {
    case 'crowd':
      return h('div', { class: 'crit__target' },
        rangeField({
          label: 'How busy do you want it to feel?',
          min: 0, max: 100, step: 5,
          value: prefs.targets.peacefulness,
          format: crowdWord,
          leftLabel: '← Deserted',
          rightLabel: 'Buzzing →',
          hint: when(prefs)
            ? `Scored against how busy each place actually gets in ${when(prefs)}.`
            : 'Scored against how busy each place usually is.',
          onInput: (v) => store.setTarget('peacefulness', v)
        })
      );

    case 'temp':
      return h('div', { class: 'crit__target' },
        rangeField({
          label: 'Your ideal daytime temperature',
          min: 0, max: 40,
          value: prefs.targets.temperature,
          format: (v) => `${v}°C`,
          leftLabel: '← Cold',
          rightLabel: 'Very hot →',
          hint: when(prefs)
            ? `Compared with each destination's average high in ${when(prefs)}.`
            : "Compared with each destination's typical daytime high.",
          onInput: (v) => store.setTarget('temperature', v)
        })
      );

    case 'budget': {
      // The slider itself lives once, in "What you'll spend" on the Trip screen.
      // Repeating it here is what made money feel like two settings that could
      // disagree with each other.
      const style = BUDGET_STYLES.find((b) => b.id === prefs.targets.budgetStyle) || {};
      return h('div', { class: 'crit__target' },
        h('p', { class: 'range__hint' },
          'Scored against £' + prefs.targets.budgetPerDay + ' a day ('
          + (style.label || 'mid-range').toLowerCase() + '), set under ',
          h('button', { class: 'linkish', onclick: () => go('#/setup') }, 'Trip'),
          '.')
      );
    }

    case 'tier': {
      // Repaints itself. segmented() renders its highlight once, so without
      // this the selection stored fine and nothing on screen moved: the tick
      // stayed put, the readout kept the old label, and the control looked
      // broken even though the scoring behind it had changed.
      const readout = h('span', { class: 'range__readout' });
      const segEl = h('div', { class: 'seg-slot' });
      const hint = h('p', { class: 'range__hint' });

      const paint = () => {
        const cur = store.state.prefs.targets.costTier ?? 2;
        readout.textContent = costTierLabel(cur);
        hint.textContent = (COST_TIERS.find((t) => t.id === cur) || {}).help
          + '. Grander places score lower, and anything beyond it scores much lower.';
        mount(segEl, segmented(
          COST_TIERS.map((t) => ({ id: t.id, label: t.label, help: t.help })),
          cur,
          (id) => { store.setTarget('costTier', id); paint(); },
          { label: 'Kind of trip' }
        ));
      };
      paint();

      return h('div', { class: 'crit__target' },
        h('div', { class: 'range' },
          h('div', { class: 'range__head' },
            h('span', { class: 'range__label' }, 'What sort of trip do you want?'),
            readout
          ),
          segEl,
          hint
        )
      );
    }

    case 'flight':
      if (!prefs.home) {
        return h('div', { class: 'crit__target' },
          h('p', { class: 'range__hint' },
            'Set your home airport under ',
            h('button', { class: 'linkish', onclick: () => go('#/setup') }, 'Trip'),
            ' before this can be scored.')
        );
      }
      return h('div', { class: 'crit__target' },
        rangeField({
          label: `Maximum flight time from ${prefs.home.label}`,
          min: 1, max: NO_FLIGHT_LIMIT,
          value: prefs.targets.maxFlightHours ?? NO_FLIGHT_LIMIT,
          format: (v) => (v >= NO_FLIGHT_LIMIT ? 'No limit' : `${v}h`),
          leftLabel: '← 1h',
          rightLabel: 'No limit →',
          hint: 'At No limit, a long flight only counts against a place when it eats into a short trip.',
          onInput: (v) => store.setTarget('maxFlightHours', v)
        })
      );

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// "Where is this from?" — the ⓘ button and its panel
// ---------------------------------------------------------------------------

/**
 * The work a destination comes from, if this world documents its sources.
 * Keyed by country code, because in fiction a "country" IS the universe.
 */
export function sourceOf(dest) {
  const all = data().sources || {};
  return all[dest.cc] || null;
}

/** Is there anything worth opening a panel for? */
export function hasInfo(dest) {
  return Boolean(dest.about || sourceOf(dest));
}

/**
 * A small ⓘ button that opens the panel. Returns null when there is nothing to
 * show, so callers can drop it straight into a tree without checking first.
 *
 * `stop` is on by default because these usually sit inside a bigger button that
 * opens the destination.
 */
export function infoButton(dest, { className = 'info-btn', stop = true } = {}) {
  if (!hasInfo(dest)) return null;
  return h('button', {
    class: className,
    title: `About ${dest.name}`,
    'aria-label': `About ${dest.name} and where it comes from`,
    onclick: (e) => {
      if (stop) { e.preventDefault(); e.stopPropagation(); }
      openInfo(dest);
    }
  }, 'ⓘ');
}

const YEAR = (y) =>
  typeof y !== 'number' ? null : y < 0 ? `c. ${Math.abs(y)} BC` : String(y);

/** Modal panel: what the place is, and which story it came out of. */
export function openInfo(dest) {
  const src = sourceOf(dest);
  const returnFocus = document.activeElement;

  const onKey = (e) => { if (e.key === 'Escape') close(); };

  const byline = src
    ? [src.creator, YEAR(src.year), src.medium].filter(Boolean).join(' · ')
    : null;

  const panel = h('div', { class: 'infosheet__panel', role: 'document' },
    h('button', { class: 'infosheet__close', onclick: () => close(), 'aria-label': 'Close' }, '✕'),

    h('h2', { class: 'infosheet__title', id: 'infosheetTitle' }, dest.name),
    h('p', { class: 'infosheet__where' },
      `${dest.region ? dest.region + ' · ' : ''}${dest.country}`),

    h('div', { class: 'infosheet__body' },
      h('h3', null, 'The place'),
      h('p', null, dest.about || dest.blurb),

      dest.tags && dest.tags.length
        ? h('div', { class: 'infosheet__tags' }, dest.tags.map((t) => h('span', { class: 'tag' }, t)))
        : null,

      src
        ? h('div', { class: 'infosheet__src' },
            h('h3', null, 'Where it comes from'),
            h('p', { class: 'infosheet__work' },
              h('strong', null, src.work),
              byline ? h('span', { class: 'infosheet__byline' }, byline) : null
            ),
            h('p', null, src.text),
            src.also ? h('p', { class: 'infosheet__also' }, 'Also: ' + src.also) : null
          )
        : null
    ),

    h('p', { class: 'infosheet__foot' },
      'Descriptions and ratings are our own reading of the source material. '
      + 'Names and settings belong to their creators.')
  );

  const overlay = h('div', {
    class: 'infosheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'infosheetTitle',
    onclick: (e) => { if (e.target === overlay) close(); }
  }, panel);

  function close() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    document.body.classList.remove('is-locked');
    if (returnFocus && returnFocus.focus) returnFocus.focus();
  }

  document.addEventListener('keydown', onKey);
  document.body.classList.add('is-locked');
  document.body.appendChild(overlay);
  panel.querySelector('.infosheet__close').focus();
}
