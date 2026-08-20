import { h, mount } from '../util/dom.js';
import { data } from '../data.js';
import * as store from '../state.js';
import { scoreDestination, ragOf, dailyCost, costTierLabel } from '../scoring.js';
import { heroPhoto, imgEl } from '../images.js';
import { scoreRing, emptyState, infoButton, when} from './components.js';

export function renderCompare(root, { go }) {
  const { destById, criteriaById } = data();
  const prefs = store.state.prefs;
  const ids = store.state.compare;

  if (ids.length < 2) {
    mount(root, h('section', { class: 'screen' },
      emptyState('⇄', 'Pick two or three to compare',
        'Tap Compare on any destination card, then come back here to see them side by side, criterion by criterion.',
        h('button', { class: 'btn btn--lg btn--primary', onclick: () => go('#/results') }, 'Browse matches'))));
    return;
  }

  const results = ids.map((id) => destById.get(id))
    .filter(Boolean)
    .map((d) => scoreDestination(d, prefs, criteriaById));

  // Every criterion the user actually rated, ordered by importance then name.
  const rated = Object.entries(prefs.weights)
    .filter(([, v]) => v > 0)
    .map(([id, imp]) => ({ criterion: criteriaById.get(id), importance: imp }))
    .filter((x) => x.criterion)
    .sort((a, b) => b.importance - a.importance || a.criterion.label.localeCompare(b.criterion.label));

  const scoreOf = (result, critId) => result.breakdown.find((b) => b.id === critId);

  const rerender = () => renderCompare(root, { go });

  mount(root,
    h('section', { class: 'screen screen--compare' },
      h('header', { class: 'results__head' },
        h('div', null,
          h('h1', null, 'Head to head'),
          h('p', { class: 'results__sub' }, `Scored for ${when(prefs)}`)),
        h('button', {
          class: 'btn btn--ghost',
          onclick: () => { store.update((s) => { s.compare = []; }, { persist: false }); rerender(); }
        }, 'Clear')
      ),

      h('div', { class: 'cmp', style: { '--cols': results.length } },

        // header row
        h('div', { class: 'cmp__row cmp__row--head' },
          h('div', { class: 'cmp__label' }),
          results.map((r) =>
            h('div', { class: 'cmp__cell cmp__cell--head' },
              h('button', { class: 'cmp__thumb', onclick: () => go('#/place/' + r.dest.id) },
                imgEl(heroPhoto(r.dest), { className: 'cmp__img' })),
              h('h3', null, r.dest.name, infoButton(r.dest, { className: 'info-btn info-btn--inline' })),
              h('span', { class: 'cmp__where' }, r.dest.country),
              scoreRing(r.overall, { size: 52, stroke: 5 }),
              h('button', {
                class: 'btn btn--ghost btn--sm',
                onclick: () => { store.toggleCompare(r.dest.id); rerender(); }
              }, 'Remove')
            )
          )
        ),

        // one row per rated criterion
        rated.map(({ criterion, importance }) =>
          h('div', { class: 'cmp__row' },
            h('div', { class: 'cmp__label' },
              h('span', { class: 'cmp__labelIcon' }, criterion.icon),
              h('span', null, criterion.label),
              importance === 3 ? h('span', { class: 'tag tag--must' }, 'must') : null
            ),
            results.map((r) => {
              const item = scoreOf(r, criterion.id);
              const pct = item && item.score != null ? Math.round(item.score * 100) : null;
              const best = Math.max(...results.map((x) => {
                const b = scoreOf(x, criterion.id);
                return b && b.score != null ? b.score : -1;
              }));
              const isBest = pct != null && item.score === best && results.length > 1;
              return h('div', {
                class: `cmp__cell cmp__cell--${item ? ragOf(item.score) : 'grey'}` + (isBest ? ' is-best' : ''),
                title: item ? item.detail : 'No data'
              },
                h('span', { class: 'cmp__score' }, pct == null ? '—' : pct),
                h('span', { class: 'cmp__detail' }, item ? item.detail : 'No data')
              );
            })
          )
        ),

        // cost row
        h('div', { class: 'cmp__row' },
          h('div', { class: 'cmp__label' },
            h('span', { class: 'cmp__labelIcon' }, '💷'),
            h('span', null, results[0].dest.costTier ? 'Cost' : 'Cost a day')),
          results.map((r) => {
            if (r.dest.costTier) {
              return h('div', { class: 'cmp__cell' },
                h('span', { class: 'cmp__score' }, costTierLabel(r.dest.costTier)));
            }
            const v = dailyCost(r.dest, prefs.targets.budgetStyle, prefs.month) ?? 0;
            const nights = prefs.targets.tripNights ?? 7;
            return h('div', { class: 'cmp__cell' },
              h('span', { class: 'cmp__score' }, '£' + v),
              h('span', { class: 'cmp__detail' }, `£${(v * nights).toLocaleString('en-GB')} total`));
          })
        )
      )
    )
  );
}
