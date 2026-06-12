/**
 * Account display + dedup helpers — fallback chain across the three
 * address fields the account can carry:
 *
 *   Physical (state + location)      authoritative — actual farm location
 *   Billing  (billingState + billingCity)
 *   Shipping (shippingState + shippingCity)
 *
 * For both the "subtitle on collisions" rendering and the duplicate
 * detection in the form, we look at Physical first, then fall back to
 * Billing, then Shipping. This matches the rep mental model: same-named
 * farms in different states are the most common ambiguity, and the
 * Physical state is what tells you "this is the IA Visser, not the WI
 * Visser."
 */

import type { Account } from './data';

/** Strip out punctuation, collapse whitespace, lowercase. */
function normalize(name: string): string {
  return (name || '').trim().toLowerCase().replace(/[.,'"&()]/g, '').replace(/\s+/g, ' ');
}

/**
 * Best (state, city) pair for the account, using the fallback chain
 * physical → billing → shipping. Empty string fields are skipped, so
 * an account with only a shipping address still gets a useful answer.
 */
export function bestStateCity(a: Pick<Account, 'state' | 'location' | 'billingState' | 'billingCity' | 'shippingState' | 'shippingCity'>): { state: string; city: string } {
  const chain: { state?: string | null; city?: string | null }[] = [
    { state: a.state,          city: a.location },     // physical (legacy column names)
    { state: a.billingState,   city: a.billingCity },
    { state: a.shippingState,  city: a.shippingCity },
  ];
  let state = '';
  let city = '';
  for (const entry of chain) {
    if (!state && entry.state && entry.state.trim()) state = entry.state.trim();
    if (!city && entry.city && entry.city.trim())    city = entry.city.trim();
    if (state && city) break;
  }
  return { state, city };
}

/**
 * Given the full account list, return a Map from accountId → subtitle.
 * Subtitle is "" for accounts whose name is unique; otherwise it's
 * "City, ST" (or fewer pieces if only one is present) using the
 * fallback chain above.
 */
export function buildAccountSubtitleMap(accounts: Pick<Account, 'id' | 'name' | 'state' | 'location' | 'billingState' | 'billingCity' | 'shippingState' | 'shippingCity' | 'country'>[]): Map<string, string> {
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
    const { state, city } = bestStateCity(a);
    let sub: string;
    if (city && state) sub = `${city}, ${state}`;
    else if (state) sub = state;
    else if (city) sub = city;
    else if (a.country) sub = a.country.trim();
    else sub = '(no location)';
    out.set(a.id, sub);
  }
  return out;
}

/**
 * Same-account heuristic — name AND best-effort state must match.
 * The state on each side is resolved through the same fallback
 * chain so it doesn't matter whether the rep typed it in Physical,
 * Billing, or Shipping.
 */
export function isLikelySameAccount(
  a: Pick<Account, 'name' | 'state' | 'billingState' | 'shippingState'>,
  b: Pick<Account, 'name' | 'state' | 'billingState' | 'shippingState'>,
): boolean {
  if (normalize(a.name) !== normalize(b.name)) return false;
  const sa = bestState(a);
  const sb = bestState(b);
  if (!sa || !sb) return true;
  return sa === sb;
}

function bestState(a: Pick<Account, 'state' | 'billingState' | 'shippingState'>): string {
  return (a.state || a.billingState || a.shippingState || '').trim().toLowerCase();
}
