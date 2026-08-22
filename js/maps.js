/**
 * Links out to Google Maps, framed at the scale of the place.
 *
 * Linking by coordinate was the obvious thing and the wrong thing: given a bare
 * lat/lon there is no feature to fit, so Google drops a pin and picks a zoom
 * close enough to read street names. Right for a restaurant, useless for an
 * island — Cyprus arrived as a few streets outside Nicosia.
 *
 * Searching for the NAME instead makes Google fit the feature's own bounds, so
 * Cyprus frames as an island and Naxos frames as an island, and this file never
 * has to know how big either of them is. That matters: the catalogue spans
 * Madagascar and Heligoland, both filed under "island", so any zoom this code
 * guessed would be wrong for most of them.
 *
 * Deliberately no explicit zoom in the URL. Google's documented search form
 * takes none, and pinning one would re-introduce exactly the bug being fixed.
 */

/**
 * The searchable heart of a destination name.
 *
 * Editorial names are written to read well in a list, not to be typed into a
 * map: "Sifnos & Folegandros", "Iceland & the South Coast", "The Cotswolds".
 * Google wants one feature, so take the first one named and drop the article.
 * "St Kitts & Nevis" becomes "St Kitts", which still frames the right place.
 */
export function searchName(dest) {
  return String(dest.name || '')
    // Split on an ampersand or a dash, never on a comma: "George Town, Penang"
    // is a single place written with a comma, and cutting there loses Penang.
    .split(/\s+[&—–]\s+/)[0]
    .trim()
    .replace(/^The\s+/i, '')
    // A few names carry an editorial aside rather than more place: "Iguazú from
    // the Argentine Side" is a sentence, and only the first word is findable.
    .replace(/\s+from\s+the\s+.*$/i, '')
    .trim();
}

/**
 * The query Google is asked to find.
 *
 * The country is appended so "Naxos" cannot land in Sicily — unless the place
 * IS the country, where "Cyprus, Cyprus" only reads as a mistake.
 */
export function mapsQuery(dest) {
  const name = searchName(dest);
  const country = String(dest.country || '').trim();
  if (!country || name.toLowerCase() === country.toLowerCase()) return name;
  return `${name}, ${country}`;
}

/** A Google Maps URL that frames this place at its own scale. */
export function mapsUrl(dest) {
  return 'https://www.google.com/maps/search/?api=1&query='
    + encodeURIComponent(mapsQuery(dest));
}
