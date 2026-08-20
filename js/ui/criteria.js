import { h, mount, debounce } from '../util/dom.js';
import { data } from '../data.js';
import * as store from '../state.js';
import { prefsSummary, WEIGHTS, IMPORTANCE_LABELS } from '../scoring.js';
import { importancePicker, isTripCriterion } from './components.js';

let filterText = '';

/**
 * Which category accordions are expanded.
 *
 * Starts empty, so every category is collapsed. With nine categories and 84
 * criteria, opening them all made the screen a wall of controls you had to
 * scroll past to find anything. A collapsed list shows the shape of the whole
 * questionnaire at a glance, with a count badge on any category you have
 * already answered.
 */
let openCats = new Set();

export function renderCriteria(root, { go }) {
  const { categories } = data();

  // The shell is built ONCE. Typing in the search box used to re-render the
  // whole screen, which destroyed and recreated the <input> and threw away
  // focus after every single keystroke — so only one letter ever landed.
  // Now only the list below is repainted, and the input is never replaced.
  const listEl = h('div', { class: 'cats' });
  const summaryEl = h('div', { class: 'sticky-actions__summary' });
  const goBtn = h('button', {
    class: 'btn btn--lg btn--primary',
    onclick: () => go('#/results')
  }, 'See my matches');

  const listable = categories.filter((c) => c.criteria.some((x) => !isTripCriterion(x)));
  const allOpen = () => openCats.size >= listable.length;

  const expandBtn = h('button', {
    class: 'btn btn--ghost',
    onclick: () => {
      if (allOpen()) openCats.clear();
      else listable.forEach((c) => openCats.add(c.id));
      expandBtn.textContent = allOpen() ? 'Collapse all' : 'Expand all';
      paintList();
    }
    // Label must reflect the CURRENT state, not a fixed initial one — the
    // button is rebuilt on every render, so hardcoding it made the control lie
    // (and invert) whenever you came back to an already-expanded list.
  }, allOpen() ? 'Collapse all' : 'Expand all');

  const searchEl = h('input', {
    type: 'search', class: 'search', placeholder: 'Search criteria…',
    value: filterText,
    oninput: debounce((e) => { filterText = e.target.value; paintList(); }, 140)
  });

  function paintSummary() {
    const s = prefsSummary(store.state.prefs);
    summaryEl.textContent = s.chosen
      ? `${s.chosen} selected · ${s.mustHaves} must-have${s.mustHaves === 1 ? '' : 's'}`
      : 'Nothing selected yet — rate anything you care about below';
    if (s.chosen) goBtn.removeAttribute('disabled');
    else goBtn.setAttribute('disabled', '');
  }

  function paintList() {
    const prefs = store.state.prefs;
    const needle = filterText.trim().toLowerCase();
    const matches = (c) =>
      !needle || c.label.toLowerCase().includes(needle) || (c.help || '').toLowerCase().includes(needle);

    const blocks = [];
    for (const cat of categories) {
      // Temperature, atmosphere, cost and flight time are set on the Trip screen,
      // where their weight sits next to the trip facts they depend on.
      const shown = cat.criteria.filter((c) => !isTripCriterion(c)).filter(matches);
      if (!shown.length) continue;
      const chosenHere = cat.criteria.filter((c) => prefs.weights[c.id]).length;
      const open = needle ? true : openCats.has(cat.id);

      blocks.push(
        h('div', { class: 'cat' + (open ? ' is-open' : '') },
          h('button', {
            class: 'cat__head',
            'aria-expanded': open ? 'true' : 'false',
            onclick: () => {
              if (openCats.has(cat.id)) openCats.delete(cat.id); else openCats.add(cat.id);
              expandBtn.textContent = allOpen() ? 'Collapse all' : 'Expand all';
              paintList();
            }
          },
            h('span', { class: 'cat__icon' }, cat.icon),
            h('span', { class: 'cat__titles' },
              h('span', { class: 'cat__title' }, cat.label),
              h('span', { class: 'cat__blurb' }, cat.blurb)
            ),
            chosenHere ? h('span', { class: 'cat__count' }, chosenHere) : null,
            h('span', { class: 'cat__chev' }, '⌄')
          ),

          open ? h('div', { class: 'cat__body' },
            shown.map((c) => {
              const level = prefs.weights[c.id] || 0;
              return h('div', { class: 'crit-wrap' + (level ? ' is-set' : '') },
                h('div', { class: 'crit' },
                  h('span', { class: 'crit__icon' }, c.icon),
                  h('div', { class: 'crit__text' },
                    h('span', { class: 'crit__label' }, c.label),
                    h('span', { class: 'crit__help' }, c.help)
                  ),
                  importancePicker(c, level, (next) => {
                    store.setImportance(c.id, next);
                    paintList();
                    paintSummary();
                  })
                )
              );
            })
          ) : null
        )
      );
    }

    if (!blocks.length) {
      blocks.push(h('p', { class: 'cats__none' }, `Nothing matches “${filterText}”.`));
    }
    mount(listEl, blocks);
  }

  mount(root,
    h('section', { class: 'screen screen--criteria' },

      h('header', { class: 'hero hero--tight' },
        h('h1', null, 'What matters to you?'),
        h('p', null,
          'Rate anything you care about. Anything left on “–” is ignored entirely, '
          + 'so you only have to answer the questions you actually have opinions about.'),
        h('p', { class: 'hero__note' },
          'The dots set ', h('strong', null, 'how much it matters'), '. Temperature, how busy you '
          + 'want it, cost and flight time are on a scale rather than “more is better”, so they live '
          + 'on the ', h('button', { class: 'linkish', onclick: () => go('#/setup') }, 'Trip'),
          ' screen with their sliders.')
      ),

      h('div', { class: 'legend' },
        IMPORTANCE_LABELS.map((label, i) =>
          h('span', { class: 'legend__item' },
            h('span', { class: `legend__dot legend__dot--${i}` }, i === 0 ? '–' : '●'.repeat(i)),
            h('span', null, label),
            i > 0 ? h('em', null, `×${WEIGHTS[i]}`) : null
          )
        )
      ),

      h('div', { class: 'toolbar' },
        searchEl,
        expandBtn,
        h('button', {
          class: 'btn btn--ghost',
          onclick: () => {
            store.update((s) => { s.prefs.weights = {}; s.lastPreset = null; });
            openCats.clear();          // a fresh start should look like one
            expandBtn.textContent = 'Expand all';
            paintList();
            paintSummary();
          }
        }, 'Clear all')
      ),

      listEl,

      h('div', { class: 'sticky-actions' },
        summaryEl,
        h('button', { class: 'btn btn--lg btn--secondary', onclick: () => go('#/setup') }, 'Back'),
        goBtn
      )
    )
  );

  paintList();
  paintSummary();
}
