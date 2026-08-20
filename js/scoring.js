/**
 * Vacation Guru — scoring engine.
 *
 * PORTABILITY CONTRACT:
 *   This module is pure ES2020. No DOM, no browser globals, no imports.
 *   It can be dropped unchanged into React Native, a Node CLI, a Web Worker,
 *   or transliterated to Kotlin/Swift. Everything the UI needs to *explain* a
 *   score is returned as data, never rendered here.
 */

// ---------------------------------------------------------------------------
// Weights & thresholds
// ---------------------------------------------------------------------------

/** Importance level -> weight. Deliberately super-linear so "Must have" dominates. */
export const WEIGHTS = [0, 1, 3, 7];

export const IMPORTANCE_LABELS = ['Not bothered', 'Nice to have', 'Important', 'Must have'];

/** Red / amber / green cut-offs on a 0..1 criterion score. */
export const RAG = { green: 0.7, amber: 0.4 };

/** A "Must have" scoring below this counts as a dealbreaker. */
const DEALBREAKER_LIMIT = 0.4;

/** Multiplier applied to the overall score per failed must-have (compounding). */
const DEALBREAKER_PENALTY = 0.72;

/** Tolerances for the "how close is close enough" criterion kinds. */
const TEMP_TOLERANCE_C = 14;   // degrees away from target before score hits 0
const CROWD_TOLERANCE = 55;    // points away from preferred busy-ness before 0

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Seasons, for worlds where a calendar month means nothing.
 *
 * "Are you going to Mordor in June?" is a silly question; "in winter" is not.
 * Middle-earth has no Junes, but it certainly has seasons, and everything the
 * engine actually reads — temperature, rain, snow, crowds — varies across the
 * year exactly as before. So fiction picks a season and the engine scores the
 * month at the middle of it. Nothing in the scoring changes; only the question.
 *
 * `months` lists the three months each season covers, for averaging a 12-point
 * curve down to four bars.
 */
export const SEASONS = [
  { id: 'spring', label: 'Spring', month: 3, months: [2, 3, 4], help: 'Thaw, mud, and the roads open again' },
  { id: 'summer', label: 'Summer', month: 6, months: [5, 6, 7], help: 'The high season for going anywhere' },
  { id: 'autumn', label: 'Autumn', month: 9, months: [8, 9, 10], help: 'Harvest, then the light goes' },
  { id: 'winter', label: 'Winter', month: 0, months: [11, 0, 1], help: 'Passes closed, fires lit, few travellers' }
];

/** Which season a month index falls in. */
export function seasonOf(month) {
  return SEASONS.find((s) => s.months.includes(month)) || SEASONS[3];
}

/**
 * What to call the time you are travelling, in this world's terms.
 *
 * 'months'  a calendar month — the real world
 * 'seasons' Spring/Summer/Autumn/Winter
 * 'none'    there is no answer, because the question does not apply. Callers
 *           must omit the phrase entirely rather than printing anything.
 */
export function periodLabel(month, timeModel = 'months') {
  if (timeModel === 'none' || month == null) return null;
  return timeModel === 'seasons' ? seasonOf(month).label : MONTHS[month];
}

/** Average a 12-month curve down to one value per season. */
export function seasonCurve(curve) {
  return SEASONS.map((s) => Math.round(s.months.reduce((n, m) => n + curve[m], 0) / s.months.length));
}

/**
 * Three-step cost, for worlds where money is not comparable. A fictional realm
 * has no meaningful price per night, but "you could do this on a shoestring" vs
 * "you would need a dragon's hoard" is still a real distinction.
 */
export const COST_TIERS = [
  { id: 1, label: 'Shoestring', help: 'Walk, camp, sleep in barns' },
  { id: 2, label: 'Comfortable', help: 'Inns, passage on a ship, a decent horse' },
  { id: 3, label: 'Lavish', help: 'Palaces, private vessels, people to carry things' }
];

export const costTierLabel = (t) => (COST_TIERS.find((x) => x.id === t) || {}).label || 'Unknown';

export const BUDGET_STYLES = [
  { id: 'budget', label: 'Budget', help: 'Hostels, self-catering, public transport' },
  { id: 'mid', label: 'Mid-range', help: '3-star hotels, restaurants, some taxis' },
  { id: 'luxury', label: 'Luxury', help: '4/5-star, fine dining, private transfers' }
];

// ---------------------------------------------------------------------------
// Small maths helpers
// ---------------------------------------------------------------------------

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

/** Great-circle distance in km. */
export function haversineKm(a, b) {
  if (!a || !b || !isNum(a.lat) || !isNum(b.lat)) return null;
  const R = 6371;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Rough door-to-gate flight time. Below ~1100km assumes a direct short-haul;
 * beyond ~9000km assumes one connection, which is what actually happens.
 */
export function estimateFlightHours(from, to) {
  const km = haversineKm(from, to);
  if (km == null) return null;
  if (km < 60) return 0;
  const cruise = km < 800 ? 620 : km < 3000 ? 750 : 850; // km/h effective
  let hours = km / cruise + 0.6;                          // taxi + climb + descent
  if (km > 9000) hours += 2.0;                            // realistic connection
  else if (km > 5500) hours += 0.5;
  return Math.round(hours * 10) / 10;
}

/** Normalise a raw value onto 0..1 given a [worst, best] scale (either direction). */
function normaliseScale(value, scale) {
  const [worst, best] = scale;
  if (!isNum(value)) return null;
  if (best === worst) return 0;
  return clamp01((value - worst) / (best - worst));
}

/**
 * What one person actually spends per day here, at a given travel style, in a
 * given month. `priceIndex` is 0-100 relative to the destination's own peak, so
 * the same place is cheaper off-season.
 *
 * Single source of truth — the UI reads this rather than repeating the formula.
 */
export function dailyCost(dest, style = 'mid', month = 6) {
  const base = dest.costPerDay ? dest.costPerDay[style] : undefined;
  if (!isNum(base)) return null;
  const idx = Array.isArray(dest.priceIndex) && dest.priceIndex.length === 12 ? dest.priceIndex[month] : 80;
  return Math.round(base * (0.72 + 0.0035 * idx));
}

/**
 * What a given travel style actually costs across the whole catalogue.
 *
 * Travel style and daily budget are two separate things and it is not obvious
 * how they interact, so the UI uses this to show the real spread and to warn
 * when a budget rules out almost everything.
 */
export function budgetSpread(destinations, style = 'mid', month = 6) {
  const costs = destinations
    .map((d) => dailyCost(d, style, month))
    .filter(isNum)
    .sort((a, b) => a - b);
  if (!costs.length) return null;
  const at = (p) => costs[Math.min(costs.length - 1, Math.floor(p * costs.length))];
  return {
    min: costs[0],
    p10: at(0.10),
    median: at(0.50),
    p90: at(0.90),
    max: costs[costs.length - 1],
    count: costs.length,
    withinBudget: (budget) => costs.filter((c) => c <= budget).length
  };
}

/** The mean of a twelve-month series. */
function annualMean(arr) {
  const nums = arr.filter(isNum);
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Read a climate series.
 *
 * A null month means the world has no calendar — nobody sets out for Mordor in
 * June — so the series is read as its annual mean instead of at one point.
 * Every seasonal criterion then answers "what is this place like, generally",
 * which is the only question that can honestly be asked there.
 */
function monthValue(dest, key, month) {
  const arr = dest.climate && dest.climate[key];
  if (!Array.isArray(arr) || arr.length !== 12) return null;
  if (month == null) return annualMean(arr);
  const v = arr[month];
  return isNum(v) ? v : null;
}

// ---------------------------------------------------------------------------
// Per-criterion scoring
// ---------------------------------------------------------------------------

/**
 * Score one criterion for one destination.
 * @returns {{score:number|null, detail:string, value:*}} score is 0..1, or null
 *          when the criterion cannot be judged and should be dropped from the mix.
 */
export function scoreCriterion(criterion, dest, prefs) {
  // Deliberately NOT defaulted: null means "read the whole year".
  const month = prefs.month === undefined ? 6 : prefs.month;
  const timeless = month == null;

  switch (criterion.kind) {
    case 'max': {
      const r = dest.ratings ? dest.ratings[criterion.id] : undefined;
      if (!isNum(r)) return { score: null, detail: 'No data', value: null };
      const base = clamp01(r / 100);

      // Some activities are only as good as the season allows. A resort can be
      // world class for skiing and still be useless in July, so a gated
      // criterion multiplies its standing rating by a monthly availability
      // factor rather than reporting the annual truth all year round.
      if (criterion.gate) {
        const raw = monthValue(dest, criterion.gate.src, month);
        const factor = raw == null
          ? (criterion.gate.absentIs ?? 0)
          : clamp01(normaliseScale(raw, criterion.gate.scale));
        const score = base * factor;
        if (factor < 0.15) {
          return {
            score,
            detail: timeless ? 'Conditions rarely allow it' : (criterion.gate.closed || 'Out of season this month'),
            value: r
          };
        }
        if (factor < 0.85) {
          const why = criterion.gate.limited || 'marginal conditions';
          return {
            score,
            detail: timeless ? `${ratingWord(r)}, but ${why} much of the year`
                             : `${ratingWord(r)}, but ${why} in ${MONTHS[month]}`,
            value: r
          };
        }
        return { score, detail: ratingWord(r), value: r };
      }

      return { score: base, detail: ratingWord(r), value: r };
    }

    case 'season': {
      const v = monthValue(dest, criterion.src, month);
      if (v == null) {
        // Absent sea temp / snow depth is a real answer: there is none.
        const absentMeansZero = criterion.src === 'seaTemp' || criterion.src === 'snowDepth';
        if (absentMeansZero) {
          return { score: 0, detail: criterion.src === 'seaTemp' ? 'Landlocked' : 'No snow', value: null };
        }
        return { score: null, detail: 'No data', value: null };
      }
      const s = normaliseScale(v, criterion.scale);
      return { score: s, detail: seasonDetail(criterion, v), value: v };
    }

    case 'temp': {
      const high = monthValue(dest, 'tempHigh', month);
      if (high == null) return { score: null, detail: 'No data', value: null };
      const target = prefs.targets?.temperature ?? 24;
      const diff = high - target;
      const score = clamp01(1 - Math.abs(diff) / TEMP_TOLERANCE_C);
      const dir = Math.abs(diff) < 2 ? 'spot on' : diff > 0 ? `${Math.round(diff)}°C hotter than you asked` : `${Math.round(-diff)}°C cooler than you asked`;
      return { score, detail: `${Math.round(high)}°C daytime high — ${dir}`, value: high };
    }

    case 'crowd': {
      const series = Array.isArray(dest.crowd) && dest.crowd.length === 12 ? dest.crowd : null;
      const busy = series ? (timeless ? annualMean(series) : series[month]) : null;
      if (!isNum(busy)) return { score: null, detail: 'No data', value: null };
      const target = prefs.targets?.peacefulness ?? 50;
      const score = clamp01(1 - Math.abs(busy - target) / CROWD_TOLERANCE);
      return {
        score,
        detail: timeless ? `${crowdWord(busy)}` : `${crowdWord(busy)} in ${MONTHS[month]}`,
        value: busy
      };
    }

    case 'budget': {
      const style = prefs.targets?.budgetStyle ?? 'mid';
      const cost = dailyCost(dest, style, month);
      if (cost == null) return { score: null, detail: 'No data', value: null };
      const budget = prefs.targets?.budgetPerDay ?? 130;
      // Both branches must meet at cost === budget (0.85) so the score decreases
      // monotonically as a place gets more expensive. Getting this wrong makes
      // somewhere slightly over budget outrank somewhere comfortably under it.
      const ON_BUDGET = 0.85;
      if (cost <= budget) {
        // Comfortably under budget is better than exactly on it, but only mildly.
        const headroom = clamp01((budget - cost) / budget);
        const nights = prefs.targets?.tripNights ?? 7;
        return {
          score: clamp01(ON_BUDGET + (1 - ON_BUDGET) * headroom),
          detail: `~${money(cost)}/day — ${money(cost * nights)} for ${nights} nights, within budget`,
          value: cost
        };
      }
      const over = (cost - budget) / budget;
      const nights = prefs.targets?.tripNights ?? 7;
      return {
        score: clamp01(ON_BUDGET * (1 - over / 0.9)),
        detail: `~${money(cost)}/day — ${money(cost * nights)} for ${nights} nights, ${Math.round(over * 100)}% over budget`,
        value: cost
      };
    }

    case 'tier': {
      const tier = dest.costTier;
      if (!isNum(tier)) return { score: null, detail: 'No data', value: null };
      const want = prefs.targets?.costTier ?? 2;
      const label = costTierLabel(tier);

      if (tier <= want) {
        // Cheaper than you're prepared for is mildly better than exactly right.
        const headroom = (want - tier) / (COST_TIERS.length - 1);
        return {
          score: clamp01(0.85 + 0.15 * headroom),
          detail: `${label} — within what you're prepared to spend`,
          value: tier
        };
      }
      const over = (tier - want) / (COST_TIERS.length - 1);
      return {
        score: clamp01(0.85 * (1 - over / 0.9)),
        detail: `${label} — beyond what you're prepared to spend`,
        value: tier
      };
    }

    case 'flight': {
      const home = prefs.home;
      if (!home || !isNum(home.lat)) return { score: null, detail: 'Set a home airport', value: null };
      const hrs = estimateFlightHours(home, dest);
      if (hrs == null) return { score: null, detail: 'No data', value: null };
      const max = prefs.targets?.maxFlightHours ?? 8;
      if (hrs <= max) return { score: 1, detail: hrs < 0.3 ? 'No flight needed' : `~${hrs}h flight`, value: hrs };
      const over = hrs - max;
      return { score: clamp01(1 - over / 7), detail: `~${hrs}h flight, ${Math.round(over * 10) / 10}h over your limit`, value: hrs };
    }

    default:
      return { score: null, detail: 'Unsupported criterion', value: null };
  }
}

function ratingWord(r) {
  if (r >= 85) return 'World class';
  if (r >= 70) return 'Very good';
  if (r >= 55) return 'Good';
  if (r >= 40) return 'Average';
  if (r >= 20) return 'Limited';
  return 'Essentially none';
}

/**
 * One vocabulary for busy-ness, used both for what YOU asked for and for what a
 * place actually is, so "you want: Quiet" and "Santorini in August: Heaving"
 * are directly comparable instead of being two unrelated scales.
 */
export function crowdWord(b) {
  if (b >= 80) return 'Heaving';
  if (b >= 60) return 'Busy';
  if (b >= 40) return 'Balanced';
  if (b >= 20) return 'Quiet';
  return 'Deserted';
}

function seasonDetail(criterion, v) {
  switch (criterion.src) {
    case 'sunHours': return `${v}h sunshine a day`;
    case 'rainDays': return `${v} rainy days in the month`;
    case 'humidity': return `${v}% humidity`;
    case 'seaTemp': return `Sea around ${v}°C`;
    case 'snowDepth': return v > 0 ? `~${v}cm snow on the ground` : 'No reliable snow';
    default: return String(v);
  }
}

function money(n) {
  return '£' + Math.round(n).toLocaleString('en-GB');
}

export function ragOf(score) {
  if (score == null) return 'grey';
  if (score >= RAG.green) return 'green';
  if (score >= RAG.amber) return 'amber';
  return 'red';
}

// ---------------------------------------------------------------------------
// Whole-destination scoring
// ---------------------------------------------------------------------------

/**
 * @param {object} dest        destination record
 * @param {object} prefs       { weights, targets, month, home, strict }
 * @param {Map}    criteriaById
 * @returns {object} full result with an explainable breakdown
 */
export function scoreDestination(dest, prefs, criteriaById) {
  const weights = prefs.weights || {};
  const breakdown = [];
  let weightedSum = 0;
  let weightTotal = 0;
  let dealbreakers = 0;

  for (const [critId, importance] of Object.entries(weights)) {
    if (!importance) continue;
    const criterion = criteriaById.get(critId);
    if (!criterion) continue;

    const weight = WEIGHTS[importance] ?? 0;
    const { score, detail, value } = scoreCriterion(criterion, dest, prefs);

    // A criterion we cannot judge is dropped from the denominator rather than
    // silently scored zero — otherwise missing data masquerades as a bad match.
    if (score == null) {
      breakdown.push({ id: critId, criterion, importance, weight, score: null, rag: 'grey', detail, value });
      continue;
    }

    const isDealbreaker = importance === 3 && score < DEALBREAKER_LIMIT;
    if (isDealbreaker) dealbreakers++;

    weightedSum += weight * score;
    weightTotal += weight;
    breakdown.push({
      id: critId, criterion, importance, weight, score,
      rag: ragOf(score), detail, value, dealbreaker: isDealbreaker
    });
  }

  const raw = weightTotal > 0 ? weightedSum / weightTotal : 0;
  const penalty = Math.pow(DEALBREAKER_PENALTY, dealbreakers);
  const overall = Math.round(clamp01(raw * penalty) * 100);

  // Rank the breakdown by how much each criterion actually moved the needle.
  breakdown.sort((a, b) => (b.weight * (b.score ?? 0)) - (a.weight * (a.score ?? 0)));

  const scored = breakdown.filter((b) => b.score != null);
  const highlights = scored.filter((b) => b.rag === 'green').slice(0, 4);
  const watchOuts = scored
    .filter((b) => b.rag === 'red' && b.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  return {
    dest,
    id: dest.id,
    overall,
    rawScore: Math.round(raw * 100),
    dealbreakers,
    penalised: dealbreakers > 0,
    breakdown,
    highlights,
    watchOuts,
    coverage: scored.length,
    unknowns: breakdown.length - scored.length
  };
}

// ---------------------------------------------------------------------------
// Ranking the whole catalogue
// ---------------------------------------------------------------------------

/**
 * @param {Array}  destinations
 * @param {object} prefs   as scoreDestination, plus:
 *                         filters: { continents:[], excludeIds:[], types:[] }
 *                         strict:  drop anything failing a must-have
 *                         maxPerCountry: diversity cap (0 = off)
 * @param {Map}    criteriaById
 */
export function rankDestinations(destinations, prefs, criteriaById) {
  const filters = prefs.filters || {};
  const exclude = new Set(filters.excludeIds || []);
  const continents = filters.continents && filters.continents.length ? new Set(filters.continents) : null;
  const types = filters.types && filters.types.length ? new Set(filters.types) : null;

  let results = [];
  let filteredOut = 0;
  let strictDropped = 0;

  for (const dest of destinations) {
    if (exclude.has(dest.id)) { filteredOut++; continue; }
    if (continents && !continents.has(dest.continent)) { filteredOut++; continue; }
    if (types && !types.has(dest.type)) { filteredOut++; continue; }

    const result = scoreDestination(dest, prefs, criteriaById);
    if (prefs.strict && result.dealbreakers > 0) { strictDropped++; continue; }
    results.push(result);
  }

  results.sort((a, b) =>
    b.overall - a.overall ||
    b.rawScore - a.rawScore ||
    a.dest.name.localeCompare(b.dest.name));

  const capped = prefs.maxPerCountry > 0
    ? applyCountryCap(results, prefs.maxPerCountry)
    : results;

  return { results: capped, filteredOut, strictDropped, total: destinations.length };
}

/**
 * Keeps the list from becoming "eight Greek islands". Overflow entries are not
 * discarded, just pushed below everything that made the cap.
 */
function applyCountryCap(results, cap) {
  const seen = new Map();
  const primary = [];
  const overflow = [];
  for (const r of results) {
    const key = r.dest.country || r.dest.id;
    const n = seen.get(key) || 0;
    if (n < cap) { primary.push(r); seen.set(key, n + 1); }
    else overflow.push(r);
  }
  return primary.concat(overflow);
}

// ---------------------------------------------------------------------------
// Preference helpers
// ---------------------------------------------------------------------------

export function emptyPrefs() {
  return {
    weights: {},
    targets: {
      temperature: 24,
      peacefulness: 45,
      budgetPerDay: 130,
      budgetStyle: 'mid',
      costTier: 2,
      maxFlightHours: 8,
      tripNights: 7
    },
    month: new Date().getMonth(),
    home: null,
    strict: false,
    filters: { continents: [], excludeIds: [], types: [] },
    maxPerCountry: 2
  };
}

export function applyPreset(prefs, preset) {
  const next = {
    ...prefs,
    weights: { ...preset.prefs },
    targets: { ...prefs.targets, ...(preset.targets || {}) }
  };
  return next;
}

/** How much of the questionnaire the user has actually engaged with. */
export function prefsSummary(prefs) {
  const vals = Object.values(prefs.weights || {}).filter(Boolean);
  return {
    chosen: vals.length,
    mustHaves: vals.filter((v) => v === 3).length,
    important: vals.filter((v) => v === 2).length,
    weightTotal: vals.reduce((s, v) => s + (WEIGHTS[v] || 0), 0)
  };
}

/**
 * Best month to go, judged with the user's own weights but sweeping the month.
 * Returns the full 12-month curve so the UI can draw it.
 */
export function monthCurve(dest, prefs, criteriaById) {
  const curve = [];
  for (let m = 0; m < 12; m++) {
    const r = scoreDestination(dest, { ...prefs, month: m }, criteriaById);
    curve.push(r.overall);
  }
  const best = curve.indexOf(Math.max(...curve));
  const worst = curve.indexOf(Math.min(...curve));
  return { curve, best, worst };
}
