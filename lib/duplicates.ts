/**
 * Lightweight fuzzy duplicate detector — used by NewAccountModal
 * and NewContactModal to warn the user before they save a row
 * that already exists.
 *
 * HubSpot's #1 Reddit complaint is duplicate records. Pathway hit
 * the same wall: Jason manually merged ~20 duplicate account
 * entries after the Monday imports last month. This library catches
 * them at the source — the moment the user tabs out of the Name
 * field — so merges never happen.
 *
 * Algorithm (deliberately simple + runs client-side; no server call):
 *   1. Normalize both strings — lowercase, strip punctuation, trim
 *      corporate suffixes (Inc, LLC, Co., Ltd., 주식회사, etc.).
 *   2. Exact normalized match → score 1.00
 *   3. One contains the other → 0.90
 *   4. Jaro-Winkler similarity → raw score (0..1)
 *   5. Email domain exact match (for contacts) → +0.15
 *
 * Thresholds the UI uses:
 *   ≥ 0.90   HIGH  — "This looks like a duplicate" (block default)
 *   ≥ 0.75   MED   — "Possible duplicate" (warn, allow save)
 *   < 0.75         — ignore
 */

export interface DupMatch<T> {
  item: T;
  score: number;
  severity: 'high' | 'medium';
  reason: string;
}

const SUFFIX_RE = /\b(inc\.?|incorporated|llc\.?|ltd\.?|limited|co\.?|corp\.?|corporation|company|gmbh|s\.?a\.?|주식회사|\(주\))\b/gi;
const PUNCT_RE = /[.,/#!$%^&*;:{}=\-_`~()'"]/g;

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(SUFFIX_RE, '')
    .replace(PUNCT_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Jaro similarity — base measure before the Winkler prefix boost. */
function jaro(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  if (a === b) return 1;
  const matchDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  return (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
}

/** Jaro-Winkler — adds up to 0.1 for a shared prefix (max 4 chars). */
export function similarity(a: string, b: string): number {
  const base = jaro(a, b);
  if (base < 0.7) return base;
  let prefix = 0;
  for (let i = 0; i < Math.min(a.length, b.length, 4); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return base + prefix * 0.1 * (1 - base);
}

export function findAccountDuplicates<T extends { id: string; name: string }>(
  input: string,
  pool: T[],
  options: { excludeId?: string; limit?: number } = {},
): DupMatch<T>[] {
  const normInput = normalizeName(input);
  if (normInput.length < 2) return [];
  const matches: DupMatch<T>[] = [];
  for (const row of pool) {
    if (options.excludeId && row.id === options.excludeId) continue;
    const normRow = normalizeName(row.name);
    if (!normRow) continue;
    let score = 0;
    let reason = '';
    if (normRow === normInput) {
      score = 1; reason = 'Exact name match';
    } else if (normRow.includes(normInput) || normInput.includes(normRow)) {
      score = 0.9; reason = 'Name contains the other';
    } else {
      score = similarity(normInput, normRow);
      reason = `Similar name (${Math.round(score * 100)}% match)`;
    }
    if (score >= 0.75) {
      matches.push({
        item: row,
        score,
        severity: score >= 0.9 ? 'high' : 'medium',
        reason,
      });
    }
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, options.limit ?? 5);
}

export interface ContactMatchInput {
  firstName: string;
  lastName: string;
  email?: string;
}

export interface ContactPoolItem {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  accountId?: string;
}

export function findContactDuplicates<T extends ContactPoolItem>(
  input: ContactMatchInput,
  pool: T[],
  options: { excludeId?: string; limit?: number } = {},
): DupMatch<T>[] {
  const first = normalizeName(input.firstName);
  const last = normalizeName(input.lastName);
  const email = (input.email || '').toLowerCase().trim();
  const emailDomain = email.includes('@') ? email.split('@')[1] : '';
  if (!first && !last && !email) return [];

  const matches: DupMatch<T>[] = [];
  for (const row of pool) {
    if (options.excludeId && row.id === options.excludeId) continue;

    const rowFirst = normalizeName(row.firstName);
    const rowLast = normalizeName(row.lastName);
    const rowEmail = (row.email || '').toLowerCase();

    // Email exact — strongest signal; return immediately with full score.
    if (email && rowEmail && email === rowEmail) {
      matches.push({ item: row, score: 1, severity: 'high', reason: 'Email exact match' });
      continue;
    }

    const firstSim = first && rowFirst ? similarity(first, rowFirst) : 0;
    const lastSim = last && rowLast ? similarity(last, rowLast) : 0;
    const nameScore = (firstSim * 0.4 + lastSim * 0.6);
    const sameDomain = emailDomain && rowEmail.endsWith('@' + emailDomain);
    const score = Math.min(1, nameScore + (sameDomain ? 0.15 : 0));

    if (score >= 0.75) {
      const bits: string[] = [];
      if (lastSim >= 0.9) bits.push('same last name');
      else if (lastSim >= 0.75) bits.push('similar last name');
      if (firstSim >= 0.9) bits.push('same first name');
      else if (firstSim >= 0.75) bits.push('similar first name');
      if (sameDomain) bits.push('same email domain');
      matches.push({
        item: row,
        score,
        severity: score >= 0.9 ? 'high' : 'medium',
        reason: bits.join(' + ') || `${Math.round(score * 100)}% similar`,
      });
    }
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, options.limit ?? 5);
}
