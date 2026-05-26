/**
 * Multi-sheet Account 360° workbook generator.
 *
 * Produces a single XLSX containing everything we know about ONE account,
 * with each related entity on its own sheet:
 *
 *   1. Profile          — header info, KPIs, summary, notes
 *   2. Activities       — all touchpoints (Calls, Meetings, Emails, Notes)
 *   3. Contacts         — people linked to this account
 *   4. Opportunities    — all deals (open + closed)
 *   5. Tasks            — open + completed
 *   6. Purchase History — sale records matched by account name
 *
 * Typical use cases:
 *   - Account handover when a rep leaves
 *   - QBR / customer review meeting prep
 *   - Backup before merging or deleting an account
 *   - Compliance / audit trail
 *
 * Like exportOpportunities.ts, this skips cell-level coloring (sheetjs
 * community edition rendering is unreliable) and relies on structural
 * emphasis — separator rows, header bands, freeze panes.
 */

import * as XLSX from 'xlsx';
import type { Account, Contact, Opportunity, Activity, Task } from './data';
import { annualizedRevenue } from './data';
import type { AppUser } from './users';
import type { SaleRecord } from './excelParser';

interface BuildArgs {
  account: Account;
  contacts: Contact[];
  opportunities: Opportunity[];
  activities: Activity[];
  tasks: Task[];
  saleRecords: SaleRecord[];
  users: AppUser[];
  /** Parent + sibling accounts so the Profile sheet can show hierarchy. */
  allAccounts: Account[];
}

const CURRENT_YEAR = new Date().getFullYear();

function nameOfUser(users: AppUser[], id?: string): string {
  if (!id) return '';
  return users.find((u) => u.id === id)?.name ?? id;
}

function fmtDate(d?: string): string {
  if (!d) return '';
  const parsed = new Date(d + (d.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(parsed.getTime())) return d;
  return parsed.toISOString().split('T')[0];
}

function isOpen(stage: string): boolean {
  return stage !== 'Closed Won' && stage !== 'Closed Lost';
}

// ─────────────────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────────────────

export function buildAccountWorkbook(args: BuildArgs): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildProfileSheet(args), 'Profile');
  XLSX.utils.book_append_sheet(wb, buildActivitiesSheet(args), 'Activities');
  XLSX.utils.book_append_sheet(wb, buildContactsSheet(args), 'Contacts');
  XLSX.utils.book_append_sheet(wb, buildOpportunitiesSheet(args), 'Opportunities');
  XLSX.utils.book_append_sheet(wb, buildTasksSheet(args), 'Tasks');
  XLSX.utils.book_append_sheet(wb, buildPurchasesSheet(args), 'Purchase History');
  return wb;
}

export function downloadAccountWorkbook(args: BuildArgs, filename: string): void {
  const wb = buildAccountWorkbook(args);
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────
//  Sheet builders
// ─────────────────────────────────────────────────────────────────────────

function buildProfileSheet(args: BuildArgs): XLSX.WorkSheet {
  const { account, contacts, opportunities, activities, tasks, saleRecords, users, allAccounts } = args;

  // KPIs (mirrors what the in-app account header shows so the export
  // matches what the user sees on screen)
  const open = opportunities.filter((o) => isOpen(o.stage));
  const pipelineValue = open.reduce((s, o) => s + (o.amount || 0), 0);
  const totalPurchases = saleRecords.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const sortedSales = [...saleRecords].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const lastPurchaseDate = sortedSales[0]?.date ? fmtDate(sortedSales[0].date) : '';
  const sortedActs = [...activities].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const lastContactDate = sortedActs[0]?.date ? fmtDate(sortedActs[0].date) : '';

  const parent = account.parentAccountId
    ? allAccounts.find((a) => a.id === account.parentAccountId)?.name ?? ''
    : '';
  const children = allAccounts.filter((a) => a.parentAccountId === account.id).map((a) => a.name);

  const rows: (string | number)[][] = [
    ['Account 360° Snapshot'],
    ['Generated', new Date().toLocaleString('en-US')],
    [],
    ['— Identity —'],
    ['Name', account.name],
    ['ID', account.id],
    ['Industry', String(account.industry ?? '')],
    ['Category', account.category ?? ''],
    ['Company Type', account.companyType ?? ''],
    ['Country', account.country ?? ''],
    ['State', account.state ?? ''],
    ['Location', account.location ?? ''],
    ['Phone', account.phone ?? ''],
    ['Website', account.website ?? ''],
    ['Employee Count', account.employee ?? ''],
    ['Annual Revenue ($)', account.annualRevenue ?? 0],
    ['Owner', nameOfUser(users, account.ownerId)],
    ['Created', fmtDate(account.createdAt)],
    [],
    ['— Hierarchy —'],
    ['Parent account', parent || '(none)'],
    ['Child accounts', children.length === 0 ? '(none)' : children.join(', ')],
    [],
    ['— KPIs (this account + children) —'],
    ['Total purchases ($, all-time)', totalPurchases],
    ['Last purchase date', lastPurchaseDate || '—'],
    ['Open deals (#)', open.length],
    ['Pipeline value (monthly $)', pipelineValue],
    ['Last contact date', lastContactDate || '—'],
    ['Activities (total #)', activities.length],
    ['Contacts (#)', contacts.length],
    ['Tasks open (#)', tasks.filter((t) => t.status !== 'Completed').length],
    ['Tasks completed (#)', tasks.filter((t) => t.status === 'Completed').length],
  ];

  if (account.notes && account.notes.trim()) {
    rows.push([]);
    rows.push(['— Notes —']);
    // Split notes into reasonable-width lines.
    for (const line of account.notes.split(/\r?\n/)) rows.push([line]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 32 }, { wch: 60 }];
  return ws;
}

function buildActivitiesSheet(args: BuildArgs): XLSX.WorkSheet {
  const { activities, contacts, users } = args;
  const contactNameById = new Map(
    contacts.map((c) => [c.id, `${c.firstName} ${c.lastName}`.trim()]),
  );

  const header = ['Date', 'Type', 'Subject', 'Description', 'Purpose', 'Contact', 'Logged By'];
  const sorted = [...activities].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const body = sorted.map((a) => [
    fmtDate(a.date),
    a.type,
    a.subject ?? '',
    a.description ?? '',
    a.purpose ?? '',
    a.contactId ? contactNameById.get(a.contactId) ?? '' : '',
    nameOfUser(users, a.ownerId),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  ws['!cols'] = [
    { wch: 12 }, { wch: 12 }, { wch: 36 }, { wch: 50 }, { wch: 24 }, { wch: 20 }, { wch: 20 },
  ];
  ws['!freeze'] = { ySplit: 1 };
  return ws;
}

function buildContactsSheet(args: BuildArgs): XLSX.WorkSheet {
  const { contacts, users } = args;
  const header = [
    'Name', 'Title', 'Position', 'Email', 'Phone', 'Tel',
    'Country', 'State', 'Species', 'Key Contact?', 'Owner', 'LinkedIn', 'Birthday', 'Anniversary', 'Notes',
  ];
  const body = contacts.map((c) => [
    `${c.firstName} ${c.lastName}`.trim(),
    c.title ?? '',
    c.position ?? '',
    c.email ?? '',
    c.phone ?? '',
    c.tel ?? '',
    c.country ?? '',
    c.state ?? '',
    c.species ?? '',
    c.isKeyMan ? 'Yes' : '',
    nameOfUser(users, c.ownerId),
    c.linkedIn ?? '',
    fmtDate(c.birthday),
    fmtDate(c.anniversary),
    c.notes ?? '',
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  ws['!cols'] = [
    { wch: 24 }, { wch: 22 }, { wch: 18 }, { wch: 28 }, { wch: 16 }, { wch: 16 },
    { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 20 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 40 },
  ];
  ws['!freeze'] = { ySplit: 1 };
  return ws;
}

function buildOpportunitiesSheet(args: BuildArgs): XLSX.WorkSheet {
  const { opportunities, users } = args;
  const header = [
    'Deal Name', 'Stage', 'Monthly $', 'Annual $ (current yr)', 'Probability',
    'Weighted Monthly $', 'Close Date', 'Expected Start', 'Created', 'Owner',
    'Next Step', 'Lead Source', 'Competitor',
  ];
  // Open deals first (by close date asc), then closed (by close date desc)
  const open = opportunities
    .filter((o) => isOpen(o.stage))
    .sort((a, b) => (a.closeDate || '').localeCompare(b.closeDate || ''));
  const closed = opportunities
    .filter((o) => !isOpen(o.stage))
    .sort((a, b) => (b.closeDate || '').localeCompare(a.closeDate || ''));

  const rows: (string | number)[][] = [header];
  if (open.length > 0) {
    rows.push([`▼ Open — ${open.length} deal${open.length === 1 ? '' : 's'}`]);
    for (const o of open) rows.push(oppRow(o, users));
  }
  if (closed.length > 0) {
    rows.push([]);
    rows.push([`▼ Closed — ${closed.length} deal${closed.length === 1 ? '' : 's'}`]);
    for (const o of closed) rows.push(oppRow(o, users));
  }
  if (open.length === 0 && closed.length === 0) {
    rows.push(['(no opportunities)']);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 32 }, { wch: 15 }, { wch: 12 }, { wch: 20 }, { wch: 12 },
    { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 20 },
    { wch: 28 }, { wch: 16 }, { wch: 18 },
  ];
  return ws;
}

function oppRow(o: Opportunity, users: AppUser[]): (string | number)[] {
  const monthly = o.amount || 0;
  const annual = Math.round(annualizedRevenue(monthly, o.expectedStartDate, CURRENT_YEAR));
  const weighted = Math.round(monthly * ((o.probability || 0) / 100));
  return [
    o.name,
    o.stage,
    monthly,
    annual,
    `${o.probability ?? 0}%`,
    weighted,
    fmtDate(o.closeDate),
    fmtDate(o.expectedStartDate),
    fmtDate(o.createdDate),
    nameOfUser(users, o.ownerId),
    o.nextStep ?? '',
    o.leadSource ?? '',
    o.competitor ?? '',
  ];
}

function buildTasksSheet(args: BuildArgs): XLSX.WorkSheet {
  const { tasks, users, contacts } = args;
  const contactNameById = new Map(
    contacts.map((c) => [c.id, `${c.firstName} ${c.lastName}`.trim()]),
  );

  const header = ['Subject', 'Status', 'Priority', 'Due Date', 'Owner', 'Linked Contact', 'Description'];
  const open = tasks.filter((t) => t.status !== 'Completed').sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  const done = tasks.filter((t) => t.status === 'Completed').sort((a, b) => (b.dueDate || '').localeCompare(a.dueDate || ''));

  const rows: (string | number)[][] = [header];
  if (open.length > 0) {
    rows.push([`▼ Open — ${open.length}`]);
    for (const t of open) rows.push([
      t.subject,
      t.status,
      t.priority,
      fmtDate(t.dueDate),
      nameOfUser(users, t.ownerId),
      t.relatedContactId ? contactNameById.get(t.relatedContactId) ?? '' : '',
      t.description ?? '',
    ]);
  }
  if (done.length > 0) {
    rows.push([]);
    rows.push([`▼ Completed — ${done.length}`]);
    for (const t of done) rows.push([
      t.subject,
      t.status,
      t.priority,
      fmtDate(t.dueDate),
      nameOfUser(users, t.ownerId),
      t.relatedContactId ? contactNameById.get(t.relatedContactId) ?? '' : '',
      t.description ?? '',
    ]);
  }
  if (open.length === 0 && done.length === 0) {
    rows.push(['(no tasks)']);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 32 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 22 }, { wch: 50 },
  ];
  return ws;
}

function buildPurchasesSheet(args: BuildArgs): XLSX.WorkSheet {
  const { saleRecords } = args;
  const header = ['Date', 'Product', 'Volume (kg)', 'Unit Price', 'Amount', 'Category', 'Payment Status', 'PO Number', 'Customer PO'];
  const sorted = [...saleRecords].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const rows: (string | number)[][] = [header];
  let totalAmount = 0;
  let totalVolume = 0;
  for (const r of sorted) {
    const amt = Number(r.amount) || 0;
    const vol = Number(r.volumeKg) || 0;
    totalAmount += amt;
    totalVolume += vol;
    rows.push([
      fmtDate(r.date),
      r.productName ?? '',
      vol,
      Number(r.unitPrice) || 0,
      amt,
      r.category ?? '',
      r.paymentStatus ?? '',
      r.poNumber ?? '',
      r.customerPO ?? '',
    ]);
  }
  if (sorted.length === 0) {
    rows.push(['(no purchase records)']);
  } else {
    rows.push([]);
    rows.push(['Totals', '', totalVolume, '', Math.round(totalAmount), '', '', '', '']);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 12 }, { wch: 26 }, { wch: 13 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
  ];
  ws['!freeze'] = { ySplit: 1 };
  return ws;
}
