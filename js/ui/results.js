import { h, mount } from '../util/dom.js';
import { data } from '../data.js';
import * as store from '../state.js';
import { rankDestinations, prefsSummary } from '../scoring.js';
import { destinationCard, emptyState, when} from './components.js';

let shownCount = 12;

export function resetPaging() { shownCount = 12; }

export function renderResults(root, { go }) {
  const { destinations, criteriaById } = data();
  const prefs = store.state.prefs;
  const summary = prefsSummary(prefs);

  if (!summary.chosen) {
    mount(root, h('section', { class: 'screen' },
      emptyState('🧭', 'No criteria chosen yet',
        'Pick a trip type or rate a few criteria and we will find your matches.',
        h('button', { class: 'btn btn--lg btn--primary', onclick: () => go('#/setup') }, 'Get started'))));
    return;
  }

  const effective = {
    ...prefs,
    filters: {
      ...prefs.filters,
      excludeIds: prefs.filters.hideBeenThere ? store.state.beenThere : []
    }
  };

  const { results, strictDropped } = rankDestinations(destinations, effective, criteriaById);
  const visible = results.slice(0, shownCount);
  const rerender = () => renderResults(root, { go });

  // Repainted in place when a card's Compare button is pressed.
  const compareCta = h('span', { class: 'results__cta' });
  const paintCompareCta = () => {
    const n = store.state.compare.length;
    compareCta.replaceChildren();
    if (n >= 2) {
      compareCta.appendChild(
        h('button', { class: 'btn btn--primary btn--sm', onclick: () => go('#/compare') },
          `Compare ${n}`));
    } else if (n === 1) {
      compareCta.appendChild(h('span', { class: 'results__ctaHint' }, 'Pick one more to compare'));
    }
  };

  mount(root,
    h('section', { class: 'screen screen--results' },

      h('header', { class: 'results__head' },
        h('div', null,
          h('h1', null, 'Your matches'),
          h('p', { class: 'results__sub' },
            [
              `${results.length} destination${results.length === 1 ? '' : 's'}`,
              when(prefs) ? `scored for ${when(prefs)}` : null,
              `${summary.chosen} criteria`,
              strictDropped ? `${strictDropped} hidden by strict mode` : null
            ].filter(Boolean).join(' · '))
        ),
        h('div', { class: 'results__headActions' },
          h('button', { class: 'btn btn--ghost', onclick: () => go('#/setup') }, 'Trip basics'),
          h('button', { class: 'btn btn--ghost', onclick: () => go('#/criteria') }, 'Edit criteria')
        )
      ),

      h('div', { class: 'chips-row chips-row--sticky' },
        h('label', { class: 'switch switch--inline' },
          h('input', {
            type: 'checkbox', checked: !!prefs.filters.hideBeenThere,
            onchange: (e) => {
              store.update((s) => { s.prefs.filters.hideBeenThere = e.target.checked; });
              rerender();
            }
          }),
          h('span', null, `Hide the ${store.state.beenThere.length} I've been to`)
        ),
        compareCta
      ),

      results.length === 0
        ? emptyState('🔍', 'Nothing matched',
            'Strict mode is hiding everything that fails a must-have. Try relaxing a must-have to “Important”, or turn strict mode off.',
            h('button', { class: 'btn btn--primary', onclick: () => go('#/setup') }, 'Adjust settings'))
        : h('div', { class: 'grid' },
            visible.map((r, i) => destinationCard(r, {
              rank: i + 1,
              onOpen: (id) => go('#/place/' + id),
              onToggle: paintCompareCta
            }))
          ),

      results.length > shownCount
        ? h('div', { class: 'more' },
            h('button', {
              class: 'btn btn--lg btn--secondary',
              onclick: () => { shownCount += 12; rerender(); }
            }, `Show ${Math.min(12, results.length - shownCount)} more`))
        : null
    )
  );

  paintCompareCta();
}

export function renderShortlist(root, { go }) {
  const { destById, criteriaById } = data();
  const prefs = store.state.prefs;
  const ids = store.state.shortlist;

  if (!ids.length) {
    mount(root, h('section', { class: 'screen' },
      emptyState('☆', 'Nothing saved yet',
        'Tap Save on any destination and it will appear here, still scored against your current criteria.',
        h('button', { class: 'btn btn--lg btn--primary', onclick: () => go('#/results') }, 'Browse matches'))));
    return;
  }

  const dests = ids.map((id) => destById.get(id)).filter(Boolean);
  const { results } = rankDestinations(dests, { ...prefs, maxPerCountry: 0, strict: false }, criteriaById);

  mount(root,
    h('section', { class: 'screen' },
      h('header', { class: 'results__head' },
        h('div', null,
          h('h1', null, 'Saved'),
          h('p', { class: 'results__sub' }, when(prefs) ? `${results.length} saved · scored for ${when(prefs)}` : `${results.length} saved`)),
        store.state.compare.length >= 2
          ? h('button', { class: 'btn btn--primary', onclick: () => go('#/compare') },
              `Compare ${store.state.compare.length}`)
          : null
      ),
      h('div', { class: 'grid' },
        results.map((r) => {
          const card = destinationCard(r, {
            onOpen: (id) => go('#/place/' + id),
            // Un-saving here should drop just this card, not repaint the screen.
            onToggle: () => { if (!store.isShortlisted(r.dest.id)) card.remove(); }
          });
          return card;
        }))
    )
  );
}
