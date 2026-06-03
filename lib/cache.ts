/**
 * Tiny localStorage-backed cache with stale-while-revalidate semantics.
 *
 * Why this file exists: PWA cold starts fetched 7 Supabase tables in
 * parallel before unblocking the dashboard, costing users ~4 seconds
 * even on a fast network. With this cache we render the *previous*
 * snapshot synchronously on mount (zero network), then refresh in the
 * background. Subsequent cold starts feel instant; the network roundtrip
 * happens silently and updates the UI when fresh data arrives.
 *
 * Storage choice: localStorage is synchronous (good — lets us read in a
 * useState initializer), simple, and ~5–10 MB on phones — plenty for our
 * dataset (~1 MB total). IndexedDB would be more robust but adds an
 * async layer; the SWR effect needs a synchronous read to render
 * immediately, so localStorage wins for now.
 *
 * Versioning: bump CACHE_VERSION when the row shape changes (e.g. new
 * required field) — every existing cache entry becomes invisible and
 * gets repopulated from the next network fetch.
 *
 * Eviction: each entry carries a timestamp; we treat reads older than
 * MAX_AGE_MS as cache-miss so a long-dormant device isn't permanently
 * stuck on a year-old snapshot.
 *
 * Failure modes are intentionally swallowed: localStorage can throw
 * (quota, private mode, sandbox restrictions). Worst case is the user
 * loses the SWR speedup on this load — never a hard failure.
 */
const CACHE_VERSION = 'v1';
const CACHE_PREFIX = `crm-cache-${CACHE_VERSION}:`;
// 7 days. Older snapshots are likely stale enough that showing the user
// last week's data is misleading — better to gate on the network fetch.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  ts: number;
}

export function cacheGet<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (!entry || typeof entry.ts !== 'number') return null;
    if (Date.now() - entry.ts > MAX_AGE_MS) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export function cacheSet<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: CacheEntry<T> = { data, ts: Date.now() };
    window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Quota exceeded, private mode, etc. — non-fatal: user just won't
    // get the SWR speedup on next cold start.
  }
}

export function cacheClear(): void {
  if (typeof window === 'undefined') return;
  try {
    const keys = Object.keys(window.localStorage);
    for (const k of keys) {
      if (k.startsWith(CACHE_PREFIX)) window.localStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}

// Cache keys used across the app. Centralised so a typo doesn't silently
// produce a perpetual cache-miss.
export const CACHE_KEYS = {
  accounts: 'accounts',
  contacts: 'contacts',
  opportunities: 'opportunities',
  tasks: 'tasks',
  activities: 'activities',
  saleRecords: 'sale-records',
  uploadHistory: 'upload-history',
  // Bumped to v2 when lastLoginAt was added — invalidates pre-existing
  // localStorage caches that lack the field.
  users: 'users-v2',
  accountBudgets: 'account-budgets',
} as const;
