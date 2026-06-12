/**
 * Account display helpers — auto-disambiguation for same-named accounts.
 *
 * As Pathway expanded out of the Midwest the rep team started hitting
 * legitimate same-name farms in different states ("Visser Dairy" in WI
 * and IA, "DeGroot Farms" in MN and SD, etc.). Showing the bare name in
 * dropdowns/lists/search hides that distinction and either looks like a
 * dup or risks routing emails / activities to the wrong farm.
 *
 * Strategy (no schema changes — uses existing state/city columns):
 *   1. Build a normalized-name → count map of all accounts.
 *   2. For any account whose normalized name collides with another,
 *      surface a small "subtitle" of state (and city when available).
 *   3. Unique names are returned with an empty subtitle so common-case
 *      lists stay clean.
 */

import type { Account } from './data';

/** Strip out punctuation, collapse whitespace, lowercase. */
function normalize(name: string): string {
  return (name || '').trim().toLowerCase().replace(/[.,'"&()]/g, '').replace(/\s+/g, ' ');
}

/**
 * Given the full account list, return a Map from accountId → subtitle.
 * Subtitle is an empty string for accounts whose name is unique;
 * otherwise it's "City, ST" (or just "ST" / "City" if only one piece
 * is present). Pass this map into list/search components so they can
 * render a small caption under or beside the account name.
 */
export function buildAccountSubtitleMap(accounts: Pick<Account, 'id' | 'name' | 'state' | 'location' | 'country'>[]): Map<string, string> {
  // Count how many accounts share each normalized name.
  const counts = new Map<string, number>();
  for (const a of accounts) {
    const n = normalize(a.name);
    if (!n) continue;
    counts.set(n, (counts.get(n) || 0) + 1);
  }

  const out = new Map<string, string>();
  for (const a of accounts) {
    const n = normalize(a.name);
    if (!n || (counts.get(n) || 0) < 2) {
      out.set(a.id, '');
      continue;
    }
    // Collision — build a subtitle from state + location/city.
    const st = (a.state || '').trim();
    const city = (a.location || '').trim();
    let sub: string;
    if (city && st) sub = `${city}, ${st}`;
    else if (st) sub = st;
    else if (city) sub = city;
    else if (a.country) sub = a.country.trim(); // last-resort fallback
    else sub = '(no location)';
    out.set(a.id, sub);
  }
  return out;
}

/**
 * Detect whether two accounts that share a name appear to actually
 * be the same record (vs. a same-named-different-location case).
 * Used by the duplicate-warning logic in AccountForm so it only
 * blocks the obvious dups and demotes far-away collisions to an
 * informational hint.
 */
export function isLikelySameAccount(
  a: Pick<Account, 'name' | 'state'>,
  b: Pick<Account, 'name' | 'state'>,
): boolean {
  if (normalize(a.name) !== normalize(b.name)) return false;
  const sa = (a.state || '').trim().toLowerCase();
  const sb = (b.state || '').trim().toLowerCase();
  // If either side has no state we err toward "could be a real dup"
  // because we don't have evidence to prove they're different.
  if (!sa || !sb) return true;
  return sa === sb;
}
