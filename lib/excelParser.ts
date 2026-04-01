import * as XLSX from 'xlsx';

export type SalesCategory = 'monogastrics' | 'ruminants' | 'latam' | 'familyb2b';

export interface SaleRecord {
  id: string;
  date: string;
  customerPO: string;
  poNumber: string;
  ownerName: string;
  accountName: string;
  productName: string;
  volumeKg: number;
  amount: number;
  unitPrice: number;
  paymentDue: string;
  paymentStatus: string;
  state: string;
  team: string;
  country: string;
  category: SalesCategory;
  uploadBatchId: string;
}

export interface UploadHistoryEntry {
  id: string;
  uploadedAt: string;
  uploadedBy: string;
  fileName: string;
  recordCount: number;
  skippedCount: number;
}

export interface ParseResult {
  records: SaleRecord[];
  errors: { row: number; reason: string }[];
  totalRows: number;
}

export const CATEGORY_BADGE: Record<SalesCategory, { bg: string; text: string }> = {
  monogastrics: { bg: '#E6F1FB', text: '#185FA5' },
  ruminants: { bg: '#E1F5EE', text: '#0F6E56' },
  latam: { bg: '#FAEEDA', text: '#854F0B' },
  familyb2b: { bg: '#EEEDFE', text: '#534AB7' },
};

export const CATEGORY_LABELS: Record<SalesCategory | 'all', string> = {
  all: 'All',
  monogastrics: 'Monogastrics',
  ruminants: 'Ruminants',
  latam: 'LATAM',
  familyb2b: 'Family / B2B',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseExcelDate(v: any): string {
  if (!v) return '';

  let d: Date;

  if (v instanceof Date) {
    d = v;
  } else if (typeof v === 'number') {
    // Excel serial number → UTC date
    d = new Date(Math.round((v - 25569) * 86400 * 1000));
  } else {
    d = new Date(v);
  }

  if (isNaN(d.getTime())) return '';

  // CRITICAL: Always use UTC methods.
  // xlsx stores dates as UTC midnight — local methods cause timezone shift.
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function inferCategory(team: string): SalesCategory {
  const t = (team || '').trim();
  switch (t) {
    case 'Poultry': return 'monogastrics';
    case 'Ruminant': return 'ruminants';
    case 'LATAM': return 'latam';
    case 'Family/B2B': return 'familyb2b';
    default: return 'familyb2b';
  }
}

export function parseExcelFile(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });

  const sheetName = wb.SheetNames.find((n) => n.toLowerCase().includes('sales')) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const records: SaleRecord[] = [];
  const errors: { row: number; reason: string }[] = [];

  // Find header row
  let startRow = 0;
  for (let i = 0; i < Math.min(raw.length, 10); i++) {
    const row = raw[i];
    const cellB = String(row?.[1] ?? '').toLowerCase();
    if (cellB.includes('date') || cellB.includes('inv')) {
      startRow = i + 1;
      break;
    }
  }
  if (startRow === 0) startRow = 1;

  for (let i = startRow; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row.every((c) => c === '' || c === null || c === undefined)) continue;

    // Col B (index 1) = INV DATE
    const date = parseExcelDate(row[1]);
    // Col F (index 5) = Account
    const accountName = String(row[5] ?? '').trim();
    // Col I (index 8) = Sales Amount (USD) — force numeric
    const rawAmt = row[8];
    const amount = typeof rawAmt === 'number' ? rawAmt : parseFloat(String(rawAmt || '0').replace(/[,$]/g, '')) || 0;

    if (!date) { errors.push({ row: i + 1, reason: 'Missing date' }); continue; }
    if (!accountName) { errors.push({ row: i + 1, reason: 'Missing account' }); continue; }
    if (amount === 0) { errors.push({ row: i + 1, reason: 'Zero or missing amount' }); continue; }

    // Col Y (index 24) = Team — handle null/undefined
    const teamRaw = row[24];
    const team = teamRaw ? String(teamRaw).trim() : '';
    // Col AA (index 26) = Country
    const country = String(row[26] ?? '').trim();

    // Col H = volumeKg, Col J = unitPrice — force numeric
    const rawVol = row[7];
    const rawPrice = row[9];

    records.push({
      id: `sale-${Date.now()}-${i}`,
      date,
      customerPO: String(row[2] ?? '').trim(),   // Col C
      poNumber: String(row[3] ?? '').trim(),      // Col D
      ownerName: String(row[4] ?? '').trim(),     // Col E
      accountName,                                 // Col F
      productName: String(row[6] ?? '').trim(),   // Col G
      volumeKg: typeof rawVol === 'number' ? rawVol : parseFloat(String(rawVol || '0').replace(/[,$]/g, '')) || 0,
      amount,                                      // Col I
      unitPrice: typeof rawPrice === 'number' ? rawPrice : parseFloat(String(rawPrice || '0').replace(/[,$]/g, '')) || 0,
      paymentDue: parseExcelDate(row[10]),
      paymentStatus: String(row[12] ?? '').trim(),
      state: String(row[23] ?? '').trim(),        // Col X
      team,
      country,
      category: inferCategory(team),
      uploadBatchId: '',
    });
  }

  return { records, errors, totalRows: raw.length - startRow };
}

function makeDupKey(r: SaleRecord): string {
  // Use PO + product + volume + amount for exact match
  if (r.poNumber) return `${r.poNumber}|${r.productName}|${r.volumeKg}|${r.amount}`;
  // Fallback if no PO: date + account + product + amount
  return `${r.date}|${r.accountName}|${r.productName}|${r.amount}`;
}

export function findDuplicates(
  newRecords: SaleRecord[],
  existing: SaleRecord[],
  skipDuplicates = true
): { unique: SaleRecord[]; duplicates: SaleRecord[] } {
  if (!skipDuplicates) return { unique: newRecords, duplicates: [] };
  const existingKeys = new Set(existing.map(makeDupKey));
  const unique: SaleRecord[] = [];
  const duplicates: SaleRecord[] = [];
  for (const r of newRecords) {
    const key = makeDupKey(r);
    if (existingKeys.has(key)) { duplicates.push(r); }
    else { unique.push(r); existingKeys.add(key); }
  }
  return { unique, duplicates };
}

export function generateTemplate(): ArrayBuffer {
  const headers = [
    '', 'INV DATE', 'Customer PO#', 'PO', 'Account Manager', 'Account',
    'Product', 'Sales vol (KG)', 'Sales Amount (USD)', 'UNIT PRICE (USD)',
    'Payment Due', '', 'PAYMENT', '', '', '', '', '', '', '', '', '', '',
    'State', 'Team', '', 'Country',
  ];
  const sampleRow = [
    '', '2026-03-15', 'CPO-001', 'PO-2026-001', 'Sarah Mitchell', 'Tyson Foods',
    'Feed Additive Premium', 5000, 25000, 5.00,
    '2026-04-15', '', 'Pending', '', '', '', '', '', '', '', '', '', '',
    'AR', 'Poultry', '', 'USA',
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sales');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}
