import { h, mount } from '../util/dom.js';
import { data } from '../data.js';
import * as store from '../state.js';
import {
  applyPreset, BUDGET_STYLES, prefsSummary, budgetSpread, crowdWord, periodLabel
} from '../scoring.js';
import {
  field, timePicker, segmented, rangeField, importancePicker, targetControl, tripCriteria
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

  const seasonal = world.timeModel === 'seasons';
  const when = periodLabel(prefs.month, world.timeModel);
  const spread = usesMoney ? budgetSpread(destinations, prefs.targets.budgetStyle, prefs.month) : null;
  const styleMeta = BUDGET_STYLES.find((b) => b.id === prefs.targets.budgetStyle) || {};


  mount(root,
    h('section', { class: 'screen screen--setup' },

      h('header', { class: 'hero' },
        h('h1', null, world.id === 'real' ? 'Your trip' : 'Your expedition'),
        h('p', null,
          (usesMoney
            ? 'When you can go, how long for, how you travel — and the handful of things that are a '
            : 'What season you set out in, and the handful of things that are a ')
          + `question of degree rather than yes-or-no. Everything else is under Criteria. `
          + `We score ${data().meta.destinations} destinations against ${data().meta.totalCriteria} of them.`)
      ),

      // ---- presets --------------------------------------------------------
      h('div', { class: 'block' },
        h('h2', { class: 'block__title' }, 'Start from a trip type'),
        h('p', { class: 'block__hint' },
          'Optional shortcut that fills in a sensible set of criteria. Finish this page first — '
          + (usesMoney
              ? 'the month and travel style change the answers as much as the criteria do.'
              : 'the season you travel changes the answers as much as the criteria do.')),
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

      // ---- when ------------------------------------------------------------
      // A calendar month means nothing in Middle-earth, so fiction asks for a
      // season instead and the engine scores the month in the middle of it.
      // Trip length only ever fed the total-cost sum, so a world that prices in
      // tiers has no use for it at all.
      h('div', { class: 'block' },
        h('h2', { class: 'block__title' },
          seasonal ? 'When do you set out?' : 'When are you going?'),
        h('p', { class: 'block__hint' },
          seasonal
            ? 'Weather, snow and how busy a place gets are all scored against this season.'
            : 'Everything weather-related, plus crowds and prices, is scored against this month.'),
        timePicker(world.timeModel, prefs.month, (m) => { store.setMonth(m); rerender(); }),

        usesMoney
          ? rangeField({
              label: 'How long for?',
              min: 1, max: 30, value: prefs.targets.tripNights,
              format: nightsLabel,
              leftLabel: '← 1 night', rightLabel: '30 nights →',
              hint: 'Used to work out the total cost of the trip.',
              onInput: (v) => store.setTarget('tripNights', v)
            })
          : null
      ),

      // ---- how you travel -------------------------------------------------
      // Travel style prices things in real money and "flying from" assumes
      // aeroplanes, so neither belongs in a world that has neither.
      (usesMoney || origins.length) ? h('div', { class: 'block' },
        h('h2', { class: 'block__title' }, 'How you travel'),
        h('p', { class: 'block__hint' },
          'Travel style decides which prices we look up — a hostel bed or a suite — so it '
          + 'changes every cost shown in the app, whether or not cost is one of your criteria.'),

        usesMoney ? field('Travel style',
          segmented(BUDGET_STYLES, prefs.targets.budgetStyle,
            (id) => {
              store.update((s) => {
                s.prefs.targets.budgetStyle = id;
                // Keep the daily budget anchored to what this tier actually costs,
                // so the two can never sit in an impossible combination.
                const sp = budgetSpread(destinations, id, s.prefs.month);
                if (sp) s.prefs.targets.budgetPerDay = Math.round(sp.median / 10) * 10;
              });
              rerender();
            },
            { label: 'Travel style' }),
          (styleMeta.help || '') + (spread ? ` · typically ${money(spread.p10)}–${money(spread.p90)} a day` : '')) : null,

        origins.length ? field('Flying from',
          h('select', {
            class: 'select',
            onchange: (e) => {
              const o = origins.find((x) => x.id === e.target.value);
              store.update((s) => {
                s.prefs.home = o ? { id: o.id, label: o.label, lat: o.lat, lon: o.lon } : null;
              });
              rerender();
            }
          },
            h('option', { value: '' }, '— not bothered about flight time —'),
            origins.map((o) =>
              h('option', { value: o.id, selected: prefs.home?.id === o.id }, `${o.label} (${o.id})`))
          ),
          'Sets the flight time shown on every destination. Leave blank and Travel Time is skipped.') : null
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
            onchange: (e) => store.update((s) => { s.prefs.maxPerCountry = e.target.checked ? 2 : 0; })
          }),
          h('span', null, 'Mix it up — at most two results per country near the top')
        )
      ),

      // ---- go -------------------------------------------------------------
      h('div', { class: 'sticky-actions' },
        h('div', { class: 'sticky-actions__summary' },
          summary.chosen
            ? [`${summary.chosen} criteria`, when,
               usesMoney ? nightsLabel(prefs.targets.tripNights) : null,
               usesMoney ? styleMeta.label : null].filter(Boolean).join(' · ')
            : [when, usesMoney ? nightsLabel(prefs.targets.tripNights) : null]
                .filter(Boolean).join(' · ') + ' — now choose what matters'),
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
}
