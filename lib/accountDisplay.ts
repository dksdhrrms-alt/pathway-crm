/**
 * Account display + dedup helpers — fallback chain across the three
 * address fields the account can carry:
 *
 *   Company  (state + location)         authoritative — actual location
 *   Billing  (billingState + billingCity)
 *   Shipping (shippingState + shippingCity)
 *
 * For both the "subtitle on collisions" rendering and the duplicate
 * detection in the form, we look at Company first, then fall back to
 * Billing, then Shipping. Same-named farms in different states are the
 * common ambiguity and the state field disambiguates them.
 *
 * Legacy data note: the `location` column used to be a free-form
 * "Address" textarea, so old rows have full address strings there
 * ("705 Edgemont Ln, Hoffman Estates, IL 60169"). `extractCity` below
 * pulls just the city out so the disambiguation pill reads cleanly.
 */

import type { Account } from './data';

function normalize(name: string): string {
  return (name || '').trim().toLowerCase().replace(/[.,'"&()]/g, '').replace(/\s+/g, ' ');
}

function extractCity(loc?: string | null): string {
  const s = (loc || '').trim();
  if (!s) return '';
  // Short, comma-less → already a city.
  if (s.length <= 25 && !s.includes(',')) return s;
  // Free-form address — split on commas and skip street/state/zip-looking
  // segments. The remaining piece is most likely the city.
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  for (const p of parts) {
    if (/^\d/.test(p)) continue;                 // starts with digit → street
    if (/^[A-Za-z]{2}$/.test(p)) continue;       // bare state code
    if (/^[A-Za-z]{2}\s+\d/.test(p)) continue;   // "IL 60169"
    if (/^\d+(?:-\d+)?$/.test(p)) continue;      // ZIP
    return p;
  }
  return '';
}

export function bestStateCity(a: Pick<Account, 'state' | 'location' | 'billingState' | 'billingCity' | 'shippingState' | 'shippingCity'>): { state: string; city: string } {
  const chain: { state?: string | null; city?: string | null }[] = [
    { state: a.state,         city: a.location },
    { state: a.billingState,  city: a.billingCity },
    { state: a.shippingState, city: a.shippingCity },
  ];
  let state = '';
  let city = '';
  for (const entry of chain) {
    if (!state && entry.state && entry.state.trim()) state = entry.state.trim();
    if (!city) {
      const c = extractCity(entry.city || '');
      if (c) city = c;
    }
    if (state && city) break;
  }
  return { state, city };
}

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
