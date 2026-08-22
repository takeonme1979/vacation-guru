import { h, mount, debounce } from '../util/dom.js';
import { data } from '../data.js';
import * as store from '../state.js';
import { scoreDestination, prefsSummary, ragOf, costTierLabel } from '../scoring.js';
import { heroPhoto, imgEl } from '../images.js';
import { infoButton, segmented, emptyState, mapsLink } from './components.js';

/**
 * The full catalogue.
 *
 * Matches only ever shows you the top of a ranked list, which is right for
 * choosing but useless for browsing — there was no way to see what is actually
 * in here. This screen lists every destination in the active world, searchable,
 * filterable and grouped, and works identically for both worlds because it
 * reads nothing Earth-specific: name, region, country, type, tags and (if you
 * have rated anything) the score the same engine gives it.
 *
 * The filters here are DIFFERENT from the ones on the Trip screen. Those change
 * what gets scored and recommended; these only change what this list shows you.
 * Browsing should never quietly rewrite your search.
 */

const GROUPINGS = [
  { id: 'continent', label: 'Region', of: (d) => d.continent },
  { id: 'country', label: 'World', of: (d) => d.country },
  { id: 'type', label: 'Kind', of: (d) => d.type },
  { id: 'az', label: 'A–Z', of: (d) => sortName(d).charAt(0).toUpperCase() },
  { id: 'none', label: 'Flat', of: () => '' }
];

const SORTS = [
  { id: 'name', label: 'Name' },
  { id: 'score', label: 'Match' },
  { id: 'cost', label: 'Cost' }
];

/** "The Shire" files under S, like a decent library. */
const sortName = (d) => d.name.replace(/^(The|A|An)\s+/i, '');

/** Three cost bands, whichever money model the world uses. */
const BANDS = [
  { id: 1, label: 'Low' },
  { id: 2, label: 'Middling' },
  { id: 3, label: 'High' }
];
function bandOf(d) {
  if (d.costTier) return d.costTier;
  if (!d.costPerDay) return null;
  return d.costPerDay.mid < 100 ? 1 : d.costPerDay.mid <= 150 ? 2 : 3;
}
function bandLabel(d) {
  if (d.costTier) return costTierLabel(d.costTier);
  const b = bandOf(d);
  return b ? BANDS[b - 1].label : null;
}

// Kept across visits so coming back from a destination page puts you back where
// you were, rather than at the top of an alphabetised list of several hundred.
let filterText = '';
let grouping = 'continent';
let sortBy = 'name';
let closedGroups = new Set();
let filtersOpen = false;
const picked = { continents: new Set(), countries: new Set(), types: new Set(), bands: new Set() };
let savedOnly = false;
let hideBeen = false;

export function resetBrowse() {
  filterText = '';
  grouping = 'continent';
  sortBy = 'name';
  closedGroups = new Set();
  clearFilters();
}

function clearFilters() {
  for (const k of Object.keys(picked)) picked[k].clear();
  savedOnly = false;
  hideBeen = false;
}

const activeFilterCount = () =>
  picked.continents.size + picked.countries.size + picked.types.size + picked.bands.size
  + (savedOnly ? 1 : 0) + (hideBeen ? 1 : 0);

export function renderBrowse(root, { go }) {
  const { destinations, criteriaById, world, meta } = data();
  const prefs = store.state.prefs;
  const scored = prefsSummary(prefs).chosen > 0;

  // Score once per render, not once per row — several hundred destinations
  // across ~80 criteria is enough work to notice inside a sort comparator.
  const scores = new Map();
  if (scored) {
    for (const d of destinations) scores.set(d.id, scoreDestination(d, prefs, criteriaById).overall);
  }

  const facets = {
    continents: [...new Set(destinations.map((d) => d.continent))].sort(),
    countries: [...new Set(destinations.map((d) => d.country))].sort(),
    types: [...new Set(destinations.map((d) => d.type))].sort(),
    bands: BANDS.filter((b) => destinations.some((d) => bandOf(d) === b.id))
  };

  // ---- shell: built once, so the search box is never replaced -------------
  const listEl = h('div', { class: 'browse__list' });
  const countEl = h('p', { class: 'browse__count' });
  const filterPanel = h('div', { class: 'browse__filters', hidden: !filtersOpen });
  const groupEl = h('span', { class: 'browse__control' });
  const sortEl = h('span', { class: 'browse__control' });

  const searchEl = h('input', {
    type: 'search', class: 'search', value: filterText,
    placeholder: world.id === 'real'
      ? 'Search places, countries, tags…'
      : 'Search realms, universes, tags…',
    oninput: debounce((e) => { filterText = e.target.value; paint(); }, 140)
  });

  const filterBtn = h('button', {
    class: 'btn btn--ghost browse__filterBtn',
    'aria-expanded': filtersOpen ? 'true' : 'false',
    onclick: () => {
      filtersOpen = !filtersOpen;
      filterPanel.hidden = !filtersOpen;
      filterBtn.setAttribute('aria-expanded', filtersOpen ? 'true' : 'false');
      syncFilterUi();
    }
  });
  // Created once and only shown when something is actually set, so ticking a
  // chip reveals the escape hatch immediately rather than on the next repaint.
  const clearBtn = h('button', {
    class: 'btn btn--ghost btn--sm', hidden: true,
    onclick: () => { clearFilters(); paintFilters(); syncFilterUi(); paint(); }
  }, 'Clear filters');

  /** Keeps the Filters button badge and the Clear button honest. */
  function syncFilterUi() {
    const n = activeFilterCount();
    // replaceChildren() is not h() — it has no idea what to do with a null, and
    // would render the literal string. Build the list, then spread it.
    const parts = [h('span', null, filtersOpen ? 'Hide filters' : 'Filters')];
    if (n) parts.push(h('span', { class: 'browse__filterCount' }, n));
    filterBtn.replaceChildren(...parts);
    clearBtn.hidden = !n;
  }

  const paintGroup = () => mount(groupEl,
    segmented(GROUPINGS, grouping, (id) => {
      grouping = id;
      closedGroups = new Set();
      paintGroup();
      paint();
    }, { label: 'Group by' }));

  const paintSort = () => mount(sortEl,
    segmented(SORTS.filter((s) => s.id !== 'score' || scored), sortBy, (id) => {
      sortBy = id; paintSort(); paint();
    }, { label: 'Sort by' }));

  /** A row of multi-select chips backed by one of the `picked` sets. */
  function facetRow(title, set, options, { scroll = false } = {}) {
    if (options.length < 2) return null;
    const chips = h('div', { class: 'browse__chips' + (scroll ? ' browse__chips--scroll' : '') },
      options.map((o) => {
        const id = typeof o === 'object' ? o.id : o;
        const label = typeof o === 'object' ? o.label : o;
        const btn = h('button', {
          class: 'browse__chip' + (set.has(id) ? ' is-on' : ''),
          'aria-pressed': set.has(id) ? 'true' : 'false',
          onclick: () => {
            if (set.has(id)) set.delete(id); else set.add(id);
            btn.className = 'browse__chip' + (set.has(id) ? ' is-on' : '');
            btn.setAttribute('aria-pressed', set.has(id) ? 'true' : 'false');
            syncFilterUi();
            paint();
          }
        }, String(label));
        return btn;
      })
    );
    return h('div', { class: 'browse__facet' },
      h('h3', { class: 'browse__facetTitle' }, title),
      chips
    );
  }

  function switchRow(label, get, set) {
    const input = h('input', {
      type: 'checkbox', checked: get(),
      onchange: (e) => { set(e.target.checked); syncFilterUi(); paint(); }
    });
    return h('label', { class: 'switch switch--inline' }, input, h('span', null, label));
  }

  function paintFilters() {
    mount(filterPanel,
      facetRow(world.id === 'real' ? 'Region' : 'Genre', picked.continents, facets.continents),
      facetRow('Kind of place', picked.types, facets.types, { scroll: facets.types.length > 14 }),
      facetRow('Cost', picked.bands, facets.bands),
      facetRow(world.id === 'real' ? 'Country' : 'Universe', picked.countries, facets.countries, { scroll: true }),
      h('div', { class: 'browse__facet browse__facet--switches' },
        switchRow(`Only my ${store.state.shortlist.length} saved`, () => savedOnly, (v) => { savedOnly = v; }),
        world.id === 'real'
          ? switchRow(`Hide the ${store.state.beenThere.length} I've been to`, () => hideBeen, (v) => { hideBeen = v; })
          : null,
        clearBtn
      )
    );
  }

  function matches(d, needle) {
    if (needle && ![d.name, d.country, d.region || '', d.type, ...(d.tags || [])]
      .join(' ').toLowerCase().includes(needle)) return false;
    if (picked.continents.size && !picked.continents.has(d.continent)) return false;
    if (picked.countries.size && !picked.countries.has(d.country)) return false;
    if (picked.types.size && !picked.types.has(d.type)) return false;
    if (picked.bands.size && !picked.bands.has(bandOf(d))) return false;
    if (savedOnly && !store.isShortlisted(d.id)) return false;
    if (hideBeen && store.state.beenThere.includes(d.id)) return false;
    return true;
  }

  function paint() {
    const needle = filterText.trim().toLowerCase();
    const hits = destinations.filter((d) => matches(d, needle));
    const narrowed = needle || activeFilterCount();

    countEl.textContent = narrowed
      ? `${hits.length} of ${destinations.length} shown`
      : `${destinations.length} in all · ${meta.countries} ${world.id === 'real' ? 'countries' : 'universes'}`;

    if (!hits.length) {
      mount(listEl, emptyState('🔍', 'Nothing left after that',
        'Loosen a filter or try a shorter word — names, countries, kinds and tags are all searched.',
        activeFilterCount()
          ? h('button', {
              class: 'btn btn--primary',
              onclick: () => { clearFilters(); paintFilters(); syncFilterUi(); paint(); }
            }, 'Clear filters')
          : null));
      return;
    }

    const groupOf = GROUPINGS.find((g) => g.id === grouping).of;
    const groups = new Map();
    for (const d of hits) {
      const key = groupOf(d);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d);
    }

    const byName = (a, b) => sortName(a).localeCompare(sortName(b));
    const compare = {
      name: byName,
      score: (a, b) => (scores.get(b.id) - scores.get(a.id)) || byName(a, b),
      cost: (a, b) => ((bandOf(a) ?? 9) - (bandOf(b) ?? 9)) || byName(a, b)
    }[scored || sortBy !== 'score' ? sortBy : 'name'];

    const order = [...groups.keys()].sort((a, b) => String(a).localeCompare(String(b)));

    mount(listEl, order.map((key) => {
      const items = groups.get(key).slice().sort(compare);
      // Searching should show you what it found, not make you open it.
      const open = narrowed || grouping === 'none' ? true : !closedGroups.has(key);

      const head = grouping === 'none' ? null : h('button', {
        class: 'browse__groupHead',
        'aria-expanded': open ? 'true' : 'false',
        onclick: () => {
          if (closedGroups.has(key)) closedGroups.delete(key);
          else closedGroups.add(key);
          paint();
        }
      },
        h('span', { class: 'browse__groupCaret' }, open ? '▾' : '▸'),
        h('span', { class: 'browse__groupName' }, String(key)),
        h('span', { class: 'browse__groupCount' }, items.length)
      );

      return h('section', { class: 'browse__group' },
        head,
        open ? h('div', { class: 'browse__rows' }, items.map((d) => row(d, { go, scored, scores }))) : null
      );
    }));
  }

  syncFilterUi();
  paintFilters();
  paintGroup();
  paintSort();
  paint();

  mount(root,
    h('section', { class: 'screen screen--browse' },
      h('header', { class: 'browse__head' },
        h('h1', null, world.id === 'real' ? 'Every destination' : 'Every realm'),
        countEl
      ),

      h('div', { class: 'browse__bar' },
        h('div', { class: 'browse__searchRow' }, searchEl, filterBtn),
        filterPanel,
        h('div', { class: 'browse__controls' },
          h('span', { class: 'browse__controlLabel' }, 'Group'), groupEl,
          h('span', { class: 'browse__controlLabel' }, 'Sort'), sortEl
        )
      ),

      scored
        ? null
        : h('p', { class: 'notice' },
            'Rate a few criteria and every entry here picks up its match score too.'),

      listEl
    )
  );
}

/** One destination: thumbnail, name, where, tags, score, info, save. */
function row(d, { go, scored, scores }) {
  const pct = scored ? scores.get(d.id) : null;
  const saved = store.isShortlisted(d.id);

  const star = h('button', {
    class: 'browse__star' + (saved ? ' is-on' : ''),
    title: saved ? 'Saved' : 'Save',
    'aria-label': `${saved ? 'Remove' : 'Save'} ${d.name}`,
    'aria-pressed': saved ? 'true' : 'false',
    onclick: (e) => {
      e.stopPropagation();
      store.toggleShortlist(d.id);
      const now = store.isShortlisted(d.id);
      star.className = 'browse__star' + (now ? ' is-on' : '');
      star.setAttribute('aria-pressed', now ? 'true' : 'false');
      star.textContent = now ? '★' : '☆';
    }
  }, saved ? '★' : '☆');

  const cost = bandLabel(d);

  return h('div', { class: 'browse__row' },
    h('button', {
      class: 'browse__open', onclick: () => go('#/place/' + d.id),
      'aria-label': `Open ${d.name}`
    },
      imgEl(heroPhoto(d), { className: 'browse__thumb' }),
      h('span', { class: 'browse__text' },
        h('span', { class: 'browse__name' }, d.name),
        h('span', { class: 'browse__where' }, `${d.region ? d.region + ' · ' : ''}${d.country}`),
        h('span', { class: 'browse__tags' },
          (d.tags || []).slice(0, 3).map((t) => h('span', { class: 'browse__tag' }, t)),
          cost ? h('span', { class: 'browse__tag browse__tag--cost' }, cost) : null
        )
      ),
      pct != null
        ? h('span', { class: `browse__pct browse__pct--${ragOf(pct / 100)}` }, pct + '%')
        : null
    ),
    mapsLink(d, { className: 'browse__map', label: '🗺' }),
    infoButton(d, { className: 'info-btn info-btn--row' }),
    star
  );
}
