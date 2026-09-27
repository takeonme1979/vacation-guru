import { h, mount } from '../util/dom.js';
import { data } from '../data.js';
import * as store from '../state.js';
import {
  applyPreset, BUDGET_STYLES, prefsSummary, crowdWord, periodLabel,
  styleForBudget, MAX_PER_COUNTRY
} from '../scoring.js';
import {
  timePicker, rangeField, importancePicker, targetControl, tripCriteria,
  moneyControl, originPicker, travelTimeNote
} from './components.js';

const money = (n) => '£' + Math.round(n).toLocaleString('en-GB');

/** "5 nights" / "1 week" / "2 weeks + 3 nights" */
export function nightsLabel(n) {
  if (n === 1) return '1 night';
  if (n < 7) return `${n} nights`;
  const weeks = Math.floor(n / 7);
  const rest = n % 7;
  const w = weeks === 1 ? '1 week' : `${weeks} weeks`;
  return rest ? `${w} + ${rest} night${rest === 1 ? '' : 's'}` : w;
}



export function renderSetup(root, { go }) {
  const { presets, continents, origins, destinations, criteria, world, usesMoney } = data();
  const prefs = store.state.prefs;
  const summary = prefsSummary(prefs);
  const rerender = () => renderSetup(root, { go });

  const timeless = world.timeModel === 'none';
  const when = periodLabel(prefs.month, world.timeModel);

  // Travel style is derived from the daily budget, and the boundaries between
  // tiers move with the month. Re-derive on render so a month change can never
  // leave the two disagreeing.
  if (usesMoney) {
    const derived = styleForBudget(destinations, prefs.targets.budgetPerDay, prefs.month,
      { noHostels: !!prefs.targets.noHostels });
    if (derived !== prefs.targets.budgetStyle) {
      store.update((st) => { st.prefs.targets.budgetStyle = derived; });
    }
  }

  // Repainted in place when trip length changes, so the judgement about how
  // much holiday a flight would eat keeps up with the slider.
  const travelNoteEl = h('p', { class: 'block__note' });
  const paintTravelNote = () => { travelNoteEl.textContent = travelTimeNote(store.state.prefs); };
  paintTravelNote();

  const summaryEl = h('div', { class: 'sticky-actions__summary' });
  const paintSummary = () => {
    const p2 = store.state.prefs;
    const st = BUDGET_STYLES.find((b) => b.id === p2.targets.budgetStyle) || {};
    summaryEl.textContent = summary.chosen
      ? [`${summary.chosen} criteria`, when,
         usesMoney ? nightsLabel(p2.targets.tripNights) : null,
         usesMoney ? `${money(p2.targets.budgetPerDay)}/day · ${st.label}` : null]
          .filter(Boolean).join(' · ')
      : [when, usesMoney ? nightsLabel(p2.targets.tripNights) : null]
          .filter(Boolean).join(' · ') + ' — now choose what matters';
  };

  mount(root,
    h('section', { class: 'screen screen--setup' },

      h('header', { class: 'hero' },
        h('h1', null, world.id === 'real' ? 'Your trip' : 'Your expedition'),
        h('p', null,
          (usesMoney
            ? 'When you can go, how long for, where from, what you can spend — and the handful of '
              + 'things that are a '
            : 'The handful of things that are a ')
          + `question of degree rather than yes-or-no. Everything else is under Criteria. `
          + `We score ${data().meta.destinations} destinations against ${data().meta.totalCriteria} of them.`)
      ),

      // ---- presets --------------------------------------------------------
      h('div', { class: 'block' },
        h('h2', { class: 'block__title' }, 'Start from a trip type'),
        h('p', { class: 'block__hint' },
          'Optional shortcut that fills in a sensible set of criteria. Finish this page first — '
          + (usesMoney
              ? 'the month and what you can spend change the answers as much as the criteria do.'
              : 'what you are prepared to spend changes the answers as much as the criteria do.')),
        h('div', { class: 'presets' },
          presets.map((p) =>
            h('button', {
              class: 'preset' + (store.state.lastPreset === p.id ? ' is-on' : ''),
              onclick: () => {
                store.update((s) => {
                  s.prefs = applyPreset(s.prefs, p);
                  s.lastPreset = p.id;
                });
                rerender();
              }
            },
              h('span', { class: 'preset__icon' }, p.icon),
              h('span', { class: 'preset__label' }, p.label)
            )
          )
        ),
        store.state.lastPreset
          ? h('p', { class: 'preset__applied' },
              `✓ ${presets.find((p) => p.id === store.state.lastPreset)?.label} applied — `
              + `${summary.chosen} criteria set.`)
          : null
      ),

      // ---- when --------------------------------------------------------
      // Only where there is a calendar to ask about. Middle-earth has no June,
      // and pretending otherwise put a control on the page whose answer meant
      // nothing; the engine reads those places across the whole year instead.
      // Trip length goes with it — it only ever fed the total-cost sum, and a
      // world that prices in tiers has no use for it either.
      timeless ? null : h('div', { class: 'block' },
        h('h2', { class: 'block__title' }, 'When are you going?'),
        h('p', { class: 'block__hint' },
          'Everything weather-related, plus crowds and prices, is scored against this month.'),
        timePicker(world.timeModel, prefs.month, (m) => { store.setMonth(m); rerender(); }),

        usesMoney
          ? rangeField({
              label: 'How long for?',
              min: 1, max: 30, value: prefs.targets.tripNights,
              format: nightsLabel,
              leftLabel: '← 1 night', rightLabel: '30 nights →',
              hint: 'Sets the total cost of the trip, and how much of it a long flight would eat.',
              onInput: (v) => { store.setTarget('tripNights', v); paintTravelNote(); }
            })
          : null
      ),

      // ---- travelling from -------------------------------------------------
      // "Flying from" assumes aeroplanes, so it does not belong in a world
      // without them.
      origins.length ? h('div', { class: 'block' },
        h('h2', { class: 'block__title' }, 'Travel from'),
        h('p', { class: 'block__hint' },
          'Sets the flight time shown on every destination, and how much of the trip it '
          + 'would cost you. Leave it blank and Travel Time is skipped.'),

        originPicker(origins, () => rerender()),

        // The judgement the app could always have made and never did: a flight
        // is not long or short in the abstract, only relative to the holiday.
        prefs.home ? travelNoteEl : null
      ) : null,

      // ---- what you'll spend -----------------------------------------------
      // One control. Travel style used to be a second, separate one, and the
      // pair could contradict each other — luxury at £50 a day being the
      // obvious case. The tier is now read off the budget.
      usesMoney ? h('div', { class: 'block' },
        h('h2', { class: 'block__title' }, "What you'll spend"),
        h('p', { class: 'block__hint' },
          'This decides which prices we look up for every destination — a dorm bed or a suite — '
          + 'so it changes every cost in the app, whether or not Cost is one of your criteria.'),

        moneyControl(() => paintSummary())
      ) : null,

      // ---- what you want from the trip -------------------------------------
      // Weight AND target together, here rather than in the Criteria list —
      // these four describe the shape of the trip, so they belong next to the
      // month and travel style they depend on.
      h('div', { class: 'block' },
        h('h2', { class: 'block__title' }, 'What you want from it'),
        h('p', { class: 'block__hint' },
          'Rate how much each matters, then say what you actually want. '
          + 'Left on “–” means it is ignored entirely.'),

        h('div', { class: 'cat__body cat__body--flush' },
          tripCriteria(criteria).map((c) => {
            const id = c.id;
            const level = prefs.weights[id] || 0;
            return h('div', { class: 'crit-wrap' + (level ? ' is-set' : '') },
              h('div', { class: 'crit' },
                h('span', { class: 'crit__icon' }, c.icon),
                h('div', { class: 'crit__text' },
                  h('span', { class: 'crit__label' }, c.label),
                  h('span', { class: 'crit__help' }, c.help)
                ),
                importancePicker(c, level, (next) => {
                  store.setImportance(id, next);
                  rerender();
                })
              ),
              level ? targetControl(c, prefs, go) : null
            );
          })
        )
      ),

      // ---- narrowing ------------------------------------------------------
      h('div', { class: 'block' },
        h('h2', { class: 'block__title' }, 'Narrow it down'),
        h('p', { class: 'block__hint' }, 'Optional. Leave everything off to search the whole world.'),

        h('div', { class: 'chips-row' },
          continents.map((c) =>
            h('button', {
              class: 'filter-chip' + (prefs.filters.continents.includes(c) ? ' is-on' : ''),
              onclick: () => {
                store.update((s) => {
                  const arr = s.prefs.filters.continents;
                  const i = arr.indexOf(c);
                  if (i >= 0) arr.splice(i, 1); else arr.push(c);
                });
                rerender();
              }
            }, c)
          )
        ),

        h('label', { class: 'switch' },
          h('input', {
            type: 'checkbox', checked: prefs.strict,
            onchange: (e) => store.update((s) => { s.prefs.strict = e.target.checked; })
          }),
          h('span', null, 'Strict mode — hide anything that fails a “must have”')
        ),

        h('label', { class: 'switch' },
          h('input', {
            type: 'checkbox', checked: prefs.maxPerCountry > 0,
            onchange: (e) => store.update((s) => { s.prefs.maxPerCountry = e.target.checked ? MAX_PER_COUNTRY : 0; })
          }),
          h('span', null, `Mix it up — at most ${MAX_PER_COUNTRY} results per ${usesMoney ? 'country' : 'universe'} near the top`)
        )
      ),

      // ---- start again ----------------------------------------------------
      // Only shown when there is something to clear, so it can never surprise
      // anybody by appearing next to an empty questionnaire.
      store.hasCriteria()
        ? h('div', { class: 'block block--quiet' },
            h('button', {
              class: 'btn btn--ghost',
              onclick: () => { store.clearCriteria(); rerender(); }
            }, 'Clear all criteria'),
            h('p', { class: 'block__hint' },
              'Clears every criterion, every filter, and anything a trip type set for you. '
              + (usesMoney
                  ? 'Your month, trip length, budget and saved places all stay.'
                  : 'Your saved places stay.'))
          )
        : null,

      // ---- go -------------------------------------------------------------
      h('div', { class: 'sticky-actions' },
        summaryEl,
        h('button', { class: 'btn btn--lg btn--secondary', onclick: () => go('#/criteria') },
          summary.chosen ? 'Criteria' : 'Choose your criteria'),
        h('button', {
          class: 'btn btn--lg btn--primary',
          disabled: summary.chosen === 0,
          onclick: () => go('#/results')
        }, summary.chosen ? 'See my matches' : 'Pick some criteria first')
      )
    )
  );

  paintSummary();
}
