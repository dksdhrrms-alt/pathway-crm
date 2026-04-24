import * as XLSX from 'xlsx';

export interface RawRow {
  [key: string]: string | number | null;
}

// ── Monday.com detection ────────────────────────────────────────────────────

function isMondayComFile(firstRows: unknown[][]): boolean {
  if (firstRows.length < 3) return false;
  const a1 = String(firstRows[0]?.[0] ?? '').trim();
  const a2 = String(firstRows[1]?.[0] ?? '').trim();
  return (
    a1.toUpperCase().includes('USA_') ||
    a2.toUpperCase().includes('USA_') ||
    a1.includes('Customer') ||
    a2.includes('Customer')
  );
}

function findHeaderRow(rows: unknown[][]): number {
  let bestIdx = 0;
  let bestCount = 0;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i];
    if (!row) continue;
    const count = (row as unknown[]).filter((c) => c !== '' && c !== null && c !== undefined).length;
    if (count > bestCount) { bestCount = count; bestIdx = i; }
  }
  return bestIdx;
}

// ── Monday.com date parsing ─────────────────────────────────────────────────

function parseMondayDate(raw: string): string {
  if (!raw) return new Date().toISOString().split('T')[0];
  const match = String(raw).match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+,\s+\d{4}/);
  if (match) {
    const d = new Date(match[0]);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  return new Date().toISOString().split('T')[0];
}

// Extract a person's name from a cell that may also contain a date / metadata.
// Monday.com "Date" columns often look like:
//   "Jan 15, 2026" + a separate "Created by" sub-text → exported as "Jan 15, 2026 Sarah Mitchell"
// Returns the name portion (or '' if none found).
export function extractNameFromCell(raw: string): string {
  if (!raw) return '';
  let s = String(raw)
    .replace(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d+,?\s+\d{2,4}/gi, '')
    .replace(/\d{4}-\d{2}-\d{2}/g, '')
    .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, '')
    .replace(/\b(created|updated|added|modified|edited|by|at|on|am|pm)\b/gi, '')
    .replace(/[,\-:|()\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Prefer "First Last" capitalized pattern; fall back to whatever is left
  const m = s.match(/([A-Z][\p{L}'.-]+(?:\s+[A-Z][\p{L}'.-]+)+)/u);
  return m ? m[1].trim() : s;
}

// Fuzzy match a name string to a list of CRM users. Returns best match or null.
export function fuzzyMatchUser<T extends { id: string; name: string }>(query: string, users: T[]): T | null {
  if (!query || users.length === 0) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9À-ſ一-鿿가-힯\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const q = norm(query);
  if (!q) return null;

  // 1. Exact match
  for (const u of users) if (norm(u.name) === q) return u;

  // 2. Token overlap scoring
  const qTokens = q.split(' ').filter((t) => t.length >= 2);
  if (qTokens.length === 0) return null;

  let bestScore = 0;
  let best: T | null = null;
  for (const u of users) {
    const un = norm(u.name);
    const uTokens = un.split(' ').filter((t) => t.length >= 2);
    let score = 0;
    for (const t of qTokens) {
      if (uTokens.includes(t)) score += 3;
      else if (uTokens.some((ut) => ut.startsWith(t) || t.startsWith(ut))) score += 1;
    }
    // Bonus when one fully contains the other
    if (un.includes(q) || q.includes(un)) score += 2;
    if (score > bestScore) { bestScore = score; best = u; }
  }
  // Require at least one full token hit (score 3+) to consider it a match
  return bestScore >= 3 ? best : null;
}

// ── Species → Industry/Category mapping ─────────────────────────────────────

function mapSpeciesToIndustry(species: string): string {
  const s = (species || '').trim();
  switch (s) {
    case 'Ruminant': return 'Dairy/Beef';
    case 'Broilers': case 'Layers': case 'Primary Breeders': case 'Turkeys': return 'Poultry';
    case 'Swines': return 'Swine';
    case 'Aquaculture': return 'Aquaculture';
    case 'PREMIX/Feed Plant': return 'Feed Mill';
    case 'Multi': return 'Multi-Species';
    case 'Research/Trials': return 'Research';
    case 'University': return 'University';
    default: return 'Other';
  }
}

function mapSpeciesToCategory(species: string): string {
  const s = (species || '').trim();
  switch (s) {
    case 'Ruminant': return 'ruminants';
    case 'Broilers': case 'Layers': case 'Primary Breeders': case 'Turkeys':
    case 'Swines': case 'Aquaculture': case 'Multi': return 'monogastrics';
    default: return 'familyb2b';
  }
}

function mapContactStatus(raw: string): string {
  const s = (raw || '').trim().toLowerCase();
  if (s.includes('active') || s.includes('working')) return 'active';
  if (s.includes('inactive') || s.includes('done')) return 'inactive';
  return 'active';
}

// ── Main parser ─────────────────────────────────────────────────────────────

export function parseImportFile(buffer: ArrayBuffer, fileName: string): { headers: string[]; rows: RawRow[] } {
  if (fileName.toLowerCase().endsWith('.csv')) return parseCSV(buffer);
  return parseExcel(buffer);
}

function parseCSV(buffer: ArrayBuffer): { headers: string[]; rows: RawRow[] } {
  const text = new TextDecoder('utf-8').decode(new Uint8Array(buffer));
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]);
  const rows: RawRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    if (vals.every((v) => !v.trim())) continue;
    const row: RawRow = {};
    headers.forEach((h, j) => { row[h] = vals[j]?.trim() ?? ''; });
    rows.push(row);
  }
  return { headers, rows };
}

function parseExcel(buffer: ArrayBuffer): { headers: string[]; rows: RawRow[] } {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const allRows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
  if (allRows.length === 0) return { headers: [], rows: [] };

  const isMonday = isMondayComFile(allRows);
  const headerRowIdx = isMonday ? findHeaderRow(allRows) : 0;
  const dataStartIdx = headerRowIdx + 1;

  console.log(`[ImportParser] Sheet: "${sheetName}", Monday: ${isMonday}, HeaderRow: ${headerRowIdx}, TotalRows: ${allRows.length}, DataStart: ${dataStartIdx}`);

  const rawHeaders = allRows[headerRowIdx] as (string | number | null)[];
  const headers = rawHeaders.map((h) => String(h ?? '').trim());

  const skipValues = new Set(['이름', 'name', 'customer person', 'customer', 'usa_customer person', 'usa_company']);
  const rows: RawRow[] = [];

  for (let i = dataStartIdx; i < allRows.length; i++) {
    const vals = allRows[i] as (string | number | null)[];
    if (!vals || vals.every((v) => v === '' || v === null || v === undefined)) continue;
    const col0 = String(vals[0] ?? '').trim().toLowerCase();
    if (skipValues.has(col0) || col0.startsWith('usa_')) continue;
    if (!col0 || col0.length < 2) continue;

    const row: RawRow = {};
    headers.forEach((h, j) => {
      let val = vals[j];
      if (val && typeof val === 'object' && 'getTime' in (val as object)) {
        const d = val as Date;
        val = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      }
      row[h] = val ?? '';
    });
    rows.push(row);
  }

  console.log(`[ImportParser] Parsed ${rows.length} rows. First 3:`, rows.slice(0, 3));
  return { headers: headers.filter((h) => h), rows };
}

// ── Dedicated Monday.com parsers (used by ImportModal) ──────────────────────

export interface ParsedAccount {
  name: string;
  industry: string;
  category: string;
  ownerName: string;
  ownerNameFromDate: string; // Extracted from Q column (Date) for fuzzy matching fallback
  country: string;
  employee: number | null;
  phone: string;
  website: string;
  location: string;
  createdAt: string;
}

function formatPhone(raw: string): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
}

export interface ParsedContact {
  firstName: string;
  lastName: string;
  species: string;
  accountName: string;
  country: string;
  ownerName: string;
  ownerNameFromDate: string; // Extracted from Q column (Date) for fuzzy matching fallback
  position: string;
  isKeyMan: boolean;
  phone: string;
  tel: string;
  email: string;
  status: string;
  createdAt: string;
}

export function parseMondayCompanies(buffer: ArrayBuffer): ParsedAccount[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const allRows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });

  // Row 0: 'USA_Company' (title)
  // Row 1: 'Customer' (category)
  // Row 2: headers
  // Row 3+: data
  const dataRows = allRows.slice(3);

  console.log(`[MondayCompanies] Total rows: ${allRows.length}, Data rows: ${dataRows.length}`);

  return dataRows
    .filter((row) => {
      const name = String((row as unknown[])[0] ?? '').trim();
      return (
        name.length > 0 &&
        name !== '이름' &&
        name !== 'Customer' &&
        !name.startsWith('USA_') &&
        !/^[ㄱ-ㅎㅏ-ㅣ가-힣\s]+$/.test(name)
      );
    })
    .map((row, idx) => {
      const r = row as (string | number | null)[];
      const species = String(r[5] ?? '').trim();
      const qRaw = String(r[16] ?? '');
      const ownerNameFromDate = extractNameFromCell(qRaw);
      if (idx < 3) console.log(`[MondayCompanies] Row ${idx}:`, { name: r[0], species: r[5], salesOwner: r[6], country: r[8], qRaw, extractedName: ownerNameFromDate });
      return {
        name: String(r[0] ?? '').trim(),
        industry: mapSpeciesToIndustry(species),
        category: mapSpeciesToCategory(species),
        ownerName: String(r[6] ?? '').trim(),
        ownerNameFromDate,
        country: String(r[8] ?? '').trim(),
        employee: r[9] ? Number(r[9]) || null : null,
        phone: formatPhone(String(r[11] ?? '').trim()),
        website: String(r[13] ?? '').trim(),
        location: String(r[14] ?? '').trim(),
        createdAt: parseMondayDate(qRaw),
      };
    })
    .filter((a) => a.name.length > 0);
}

export function parseMondayContacts(buffer: ArrayBuffer): ParsedContact[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const allRows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });

  const dataRows = allRows.slice(3);

  console.log(`[MondayContacts] Total rows: ${allRows.length}, Data rows: ${dataRows.length}`);

  return dataRows
    .filter((row) => {
      const name = String((row as unknown[])[0] ?? '').trim();
      return name.length > 1 && name !== '이름' && name !== 'Customer Person' && !name.startsWith('USA_');
    })
    .map((row) => {
      const r = row as (string | number | null)[];
      const fullName = String(r[0] ?? '').trim();
      const parts = fullName.split(/\s+/);
      // Q column (r[16]) often holds a "Date + Created by" combo on Monday.com — try it first,
      // fall back to the dedicated Date column at r[13] (Col N).
      const qRaw = String(r[16] ?? '');
      const dateRaw = String(r[13] ?? '');
      const ownerNameFromDate = extractNameFromCell(qRaw) || extractNameFromCell(dateRaw);
      return {
        firstName: parts[0] || fullName,
        lastName: parts.slice(1).join(' ') || '',
        species: String(r[3] ?? '').trim(),         // Col D: Species
        accountName: String(r[4] ?? '').trim(),      // Col E: USA_Company
        country: String(r[5] ?? '').trim(),          // Col F: Country
        ownerName: String(r[6] ?? '').trim(),        // Col G: Sales
        ownerNameFromDate,
        position: String(r[8] ?? '').trim(),         // Col I: Position
        isKeyMan: String(r[9] ?? '').trim().toLowerCase() === 'v', // Col J: Key Man
        phone: String(r[10] || r[11] || '').trim(),  // Col K: CellPhone, fallback Col L: Tel
        tel: String(r[11] ?? '').trim(),             // Col L: Tel (stored separately)
        email: String(r[12] ?? '').trim(),           // Col M: Email
        status: mapContactStatus(String(r[15] ?? '')), // Col P: Status
        createdAt: parseMondayDate(qRaw || dateRaw), // Q (Date) preferred, fallback N
      };
    })
    .filter((c) => c.firstName.length > 0);
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { result.push(current); current = ''; continue; }
    current += ch;
  }
  result.push(current);
  return result;
}

// ── Auto-detect column mapping ──────────────────────────────────────────────

const ACCOUNT_FIELD_MAP: Record<string, string[]> = {
  name: ['name', '이름', 'company', 'account', 'account name', 'company name', 'organization'],
  industry: ['industry', 'sector', 'type', 'category', 'species'],
  location: ['location', 'city', 'state', 'address', 'region'],
  annualRevenue: ['revenue', 'annual revenue', 'annual_revenue', 'arr'],
  website: ['website', 'url', 'web', 'site', 'web site'],
  ownerName: ['owner', 'account manager', 'rep', 'sales rep', 'assigned to', 'sales'],
  country: ['country'],
  phone: ['phone', 'telephone', 'tel'],
};

const CONTACT_FIELD_MAP: Record<string, string[]> = {
  firstName: ['first name', 'first', 'firstname', 'given name', '이름'],
  lastName: ['last name', 'last', 'lastname', 'surname', 'family name'],
  title: ['title', 'job title', 'position', 'role', 'designation'],
  accountName: ['company', 'account', 'account name', 'organization', 'company name', 'usa_company'],
  phone: ['phone', 'mobile', 'tel', 'telephone', 'phone number', 'cell', 'cellphone', 'cell phone'],
  email: ['email', 'email address', 'e-mail', 'mail'],
  linkedIn: ['linkedin', 'linkedin url', 'linkedin profile'],
};

export function autoMapColumns(headers: string[], type: 'accounts' | 'contacts'): Record<string, string> {
  const fieldMap = type === 'accounts' ? ACCOUNT_FIELD_MAP : CONTACT_FIELD_MAP;
  const mapping: Record<string, string> = {};
  for (const header of headers) {
    const lower = header.toLowerCase().trim();
    for (const [crmField, variations] of Object.entries(fieldMap)) {
      if (Object.values(mapping).includes(crmField)) continue;
      if (variations.includes(lower) || variations.some((v) => lower.includes(v))) {
        mapping[header] = crmField;
        break;
      }
    }
  }
  return mapping;
}

export function generateAccountTemplate(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Account Name', 'Industry', 'Location', 'Annual Revenue', 'Website', 'Owner', 'Country', 'Phone'],
    ['Acme Corp', 'Poultry', 'Atlanta, GA', 5000000, 'https://acme.com', 'Sarah Mitchell', 'USA', '(555) 123-4567'],
  ]), 'Accounts');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export function generateContactTemplate(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['First Name', 'Last Name', 'Title', 'Company', 'Phone', 'Email', 'LinkedIn'],
    ['Jane', 'Smith', 'VP Operations', 'Acme Corp', '(555) 123-4567', 'jane@acme.com', 'https://linkedin.com/in/janesmith'],
  ]), 'Contacts');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}
