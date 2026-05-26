/**
 * Multi-sheet Opportunities pipeline workbook generator.
 *
 * Generates an XLSX with five tabs:
 *   1. Summary         — KPIs + Stage breakdown + Top 10 deals
 *   2. All Deals       — flat list, sortable/filterable in Excel
 *   3. By Stage        — grouped by stage with sub-totals
 *   4. Forecast        — next 6 months expected weighted revenue
 *   5. Closed History  — Won / Lost deals + Win Rate by Owner
 *
 * Designed for opening in Excel during a sales review meeting: open
 * Summary first for the snapshot, then drill into specific tabs as
 * questions come up. Each sheet is self-contained — no cross-references
 * the user has to look up elsewhere.
 *
 * Cell-level coloring isn't used because the sheetjs community build
 * doesn't reliably render style.fill across viewers. We rely on
 * structural emphasis instead (header rows, separator rows, sub-totals).
 */

import * as XLSX from 'xlsx';
import type { Opportunity, Account, Stage } from './data';
import { annualizedRevenue } from './data';
import type { AppUser } from './users';

interface BuildArgs {
  opportunities: Opportunity[];
  accounts: Account[];
  users: AppUser[];
  /** Human-readable label for the current scope (e.g. "Personal — Dave Ahn"). */
  scopeLabel: string;
}

const OPEN_STAGES_ORDER: Stage[] = [
  'Prospect',
  'Prospecting',
  'Qualified',
  'Qualification',
  'Trial Started',
  'Proposal',
  'Negotiation',
];

const ALL_STAGES_ORDER: Stage[] = [
  ...OPEN_STAGES_ORDER,
  'Closed Won',
  'Closed Lost',
];

function isOpen(stage: Stage): boolean {
  return stage !== 'Closed Won' && stage !== 'Closed Lost';
}

function fmtUSD(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n || 0);
}

function fmtDate(d?: string): string {
  if (!d) return '';
  const parsed = new Date(d + 'T00:00:00');
  if (isNaN(parsed.getTime())) return d;
  return parsed.toISOString().split('T')[0];
}

function daysUntil(d?: string): number | '' {
  if (!d) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const close = new Date(d + 'T00:00:00');
  return Math.round((close.getTime() - today.getTime()) / 86400000);
}

const CURRENT_YEAR = new Date().getFullYear();

// ─────────────────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────────────────

export function buildOpportunitiesWorkbook(args: BuildArgs): XLSX.WorkBook {
  const { opportunities, accounts, users, scopeLabel } = args;
  const accountById = new Map(accounts.map((a) => [a.id, a.name]));
  const userById = new Map(users.map((u) => [u.id, u.name]));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(opportunities, accountById, scopeLabel), 'Summary');
  XLSX.utils.book_append_sheet(wb, buildAllDealsSheet(opportunities, accountById, userById), 'All Deals');
  XLSX.utils.book_append_sheet(wb, buildByStageSheet(opportunities, accountById, userById), 'By Stage');
  XLSX.utils.book_append_sheet(wb, buildForecastSheet(opportunities), 'Forecast');
  XLSX.utils.book_append_sheet(wb, buildClosedHistorySheet(opportunities, accountById, userById), 'Closed History');
  return wb;
}

export function downloadOpportunitiesWorkbook(args: BuildArgs, filename: string): void {
  const wb = buildOpportunitiesWorkbook(args);
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────
//  Sheet builders
// ─────────────────────────────────────────────────────────────────────────

function buildSummarySheet(
  opps: Opportunity[],
  accountById: Map<string, string>,
  scopeLabel: string,
): XLSX.WorkSheet {
  const open = opps.filter((o) => isOpen(o.stage));
  const wonAll = opps.filter((o) => o.stage === 'Closed Won');
  const lostAll = opps.filter((o) => o.stage === 'Closed Lost');
  const wonYTD = wonAll.filter((o) => (o.closeDate || '').startsWith(String(CURRENT_YEAR)));
  const lostYTD = lostAll.filter((o) => (o.closeDate || '').startsWith(String(CURRENT_YEAR)));

  const openPipeline = open.reduce((s, o) => s + (o.amount || 0), 0);
  const weighted = open.reduce((s, o) => s + ((o.amount || 0) * ((o.probability || 0) / 100)), 0);
  const wonAmount = wonYTD.reduce((s, o) => s + (o.amount || 0), 0);
  const wonAnnual = wonYTD.reduce((s, o) => s + annualizedRevenue(o.amount || 0, o.expectedStartDate, CURRENT_YEAR), 0);
  const winRate = (wonYTD.length + lostYTD.length) > 0
    ? Math.round((wonYTD.length / (wonYTD.length + lostYTD.length)) * 100)
    : 0;
  const avgDealSize = wonAll.length > 0
    ? Math.round(wonAll.reduce((s, o) => s + (o.amount || 0), 0) / wonAll.length)
    : 0;

  const rows: (string | number)[][] = [
    ['Pipeline Snapshot'],
    ['Scope', scopeLabel],
    ['Generated', new Date().toLocaleString('en-US')],
    [],
    ['KPI', 'Value'],
    ['Open deals (#)', open.length],
    ['Open pipeline (monthly $)', openPipeline],
    ['Weighted pipeline (monthly $)', Math.round(weighted)],
    ['Won YTD (#)', wonYTD.length],
    ['Won YTD (monthly $)', wonAmount],
    ['Won YTD (annualized $, this calendar year)', Math.round(wonAnnual)],
    ['Win rate YTD', `${winRate}%`],
    ['Avg deal size (all-time won)', avgDealSize],
    [],
    ['Stage breakdown'],
    ['Stage', 'Count', 'Monthly $', 'Annual $ (current yr)', 'Weighted $', 'Avg probability'],
  ];

  for (const stage of ALL_STAGES_ORDER) {
    const inStage = opps.filter((o) => o.stage === stage);
    if (inStage.length === 0) continue;
    const monthly = inStage.reduce((s, o) => s + (o.amount || 0), 0);
    const annual = inStage.reduce((s, o) => s + annualizedRevenue(o.amount || 0, o.expectedStartDate, CURRENT_YEAR), 0);
    const w = inStage.reduce((s, o) => s + ((o.amount || 0) * ((o.probability || 0) / 100)), 0);
    const avgProb = Math.round(inStage.reduce((s, o) => s + (o.probability || 0), 0) / inStage.length);
    rows.push([stage, inStage.length, monthly, Math.round(annual), Math.round(w), `${avgProb}%`]);
  }

  rows.push([]);
  rows.push(['Top 10 open deals by monthly amount']);
  rows.push(['Rank', 'Deal', 'Account', 'Stage', 'Monthly $', 'Probability', 'Close date']);
  const top10 = [...open].sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, 10);
  top10.forEach((o, i) => {
    rows.push([
      i + 1,
      o.name,
      accountById.get(o.accountId) ?? '',
      o.stage,
      o.amount || 0,
      `${o.probability ?? 0}%`,
      fmtDate(o.closeDate),
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 38 }, { wch: 28 }, { wch: 22 }, { wch: 26 }, { wch: 20 }, { wch: 18 }, { wch: 14 },
  ];
  return ws;
}

function buildAllDealsSheet(
  opps: Opportunity[],
  accountById: Map<string, string>,
  userById: Map<string, string>,
): XLSX.WorkSheet {
  const sorted = [...opps].sort((a, b) => (a.closeDate || '').localeCompare(b.closeDate || ''));
  const header = [
    'Deal Name', 'Account', 'Stage', 'Monthly $', 'Annual $ (current yr)',
    'Probability', 'Weighted Monthly $', 'Close Date', 'Expected Start',
    'Days to Close', 'Created', 'Owner', 'Next Step', 'Lead Source', 'Competitor',
  ];
  const body = sorted.map((o) => [
    o.name,
    accountById.get(o.accountId) ?? '',
    o.stage,
    o.amount || 0,
    Math.round(annualizedRevenue(o.amount || 0, o.expectedStartDate, CURRENT_YEAR)),
    `${o.probability ?? 0}%`,
    Math.round((o.amount || 0) * ((o.probability || 0) / 100)),
    fmtDate(o.closeDate),
    fmtDate(o.expectedStartDate),
    daysUntil(o.closeDate),
    fmtDate(o.createdDate),
    userById.get(o.ownerId) ?? o.ownerName ?? '',
    o.nextStep ?? '',
    o.leadSource ?? '',
    o.competitor ?? '',
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  ws['!cols'] = [
    { wch: 32 }, { wch: 26 }, { wch: 15 }, { wch: 12 }, { wch: 18 },
    { wch: 12 }, { wch: 18 }, { wch: 12 }, { wch: 14 },
    { wch: 13 }, { wch: 12 }, { wch: 20 }, { wch: 30 }, { wch: 16 }, { wch: 18 },
  ];
  // Freeze header row so column titles stay visible while scrolling.
  ws['!freeze'] = { ySplit: 1 };
  return ws;
}

function buildByStageSheet(
  opps: Opportunity[],
  accountById: Map<string, string>,
  userById: Map<string, string>,
): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    ['Pipeline by Stage'],
    ['(open stages first, then closed; subtotals after each stage)'],
    [],
  ];
  const subHeader = ['Deal Name', 'Account', 'Monthly $', 'Annual $', 'Probability', 'Weighted $', 'Close Date', 'Owner'];

  for (const stage of ALL_STAGES_ORDER) {
    const inStage = opps
      .filter((o) => o.stage === stage)
      .sort((a, b) => (b.amount || 0) - (a.amount || 0));
    if (inStage.length === 0) continue;

    rows.push([]);
    rows.push([`▼ ${stage} — ${inStage.length} deal${inStage.length === 1 ? '' : 's'}`]);
    rows.push(subHeader);

    let stageMonthly = 0;
    let stageAnnual = 0;
    let stageWeighted = 0;
    for (const o of inStage) {
      const monthly = o.amount || 0;
      const annual = Math.round(annualizedRevenue(monthly, o.expectedStartDate, CURRENT_YEAR));
      const w = Math.round(monthly * ((o.probability || 0) / 100));
      stageMonthly += monthly;
      stageAnnual += annual;
      stageWeighted += w;
      rows.push([
        o.name,
        accountById.get(o.accountId) ?? '',
        monthly,
        annual,
        `${o.probability ?? 0}%`,
        w,
        fmtDate(o.closeDate),
        userById.get(o.ownerId) ?? o.ownerName ?? '',
      ]);
    }
    rows.push(['', 'Subtotal', stageMonthly, stageAnnual, '', stageWeighted, '', '']);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 32 }, { wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 20 },
  ];
  return ws;
}

function buildForecastSheet(opps: Opportunity[]): XLSX.WorkSheet {
  // Build next 6 months starting from the current month.
  const months: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
    months.push({ key, label });
  }

  const rows: (string | number)[][] = [
    ['Forecast — Next 6 Months'],
    ['Open opportunities expected to close in each calendar month.'],
    ['Weighted = Monthly $ × (Probability ÷ 100). Annual = monthly × 12 (single-month view of perpetual MRR).'],
    [],
    ['Month', 'Open Count', 'Pipeline Monthly $', 'Weighted Monthly $', 'Avg Probability'],
  ];

  let totalCount = 0;
  let totalMonthly = 0;
  let totalWeighted = 0;
  for (const m of months) {
    const inMonth = opps.filter((o) =>
      isOpen(o.stage) &&
      (o.closeDate || '').startsWith(m.key)
    );
    const monthly = inMonth.reduce((s, o) => s + (o.amount || 0), 0);
    const weighted = inMonth.reduce((s, o) => s + ((o.amount || 0) * ((o.probability || 0) / 100)), 0);
    const avgProb = inMonth.length > 0
      ? Math.round(inMonth.reduce((s, o) => s + (o.probability || 0), 0) / inMonth.length)
      : 0;
    totalCount += inMonth.length;
    totalMonthly += monthly;
    totalWeighted += weighted;
    rows.push([m.label, inMonth.length, monthly, Math.round(weighted), inMonth.length > 0 ? `${avgProb}%` : '']);
  }
  rows.push(['Total (6 months)', totalCount, totalMonthly, Math.round(totalWeighted), '']);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 22 }, { wch: 22 }, { wch: 16 }];
  return ws;
}

function buildClosedHistorySheet(
  opps: Opportunity[],
  accountById: Map<string, string>,
  userById: Map<string, string>,
): XLSX.WorkSheet {
  const won = opps.filter((o) => o.stage === 'Closed Won')
    .sort((a, b) => (b.closeDate || '').localeCompare(a.closeDate || ''));
  const lost = opps.filter((o) => o.stage === 'Closed Lost')
    .sort((a, b) => (b.closeDate || '').localeCompare(a.closeDate || ''));

  const rows: (string | number)[][] = [
    ['Closed History'],
    [],
    ['🏆 Closed Won'],
    ['Deal Name', 'Account', 'Monthly $', 'Annual $', 'Close Date', 'Owner', 'Lead Source'],
  ];
  for (const o of won) {
    rows.push([
      o.name,
      accountById.get(o.accountId) ?? '',
      o.amount || 0,
      Math.round(annualizedRevenue(o.amount || 0, o.expectedStartDate, CURRENT_YEAR)),
      fmtDate(o.closeDate),
      userById.get(o.ownerId) ?? o.ownerName ?? '',
      o.leadSource ?? '',
    ]);
  }

  rows.push([]);
  rows.push(['💔 Closed Lost']);
  rows.push(['Deal Name', 'Account', 'Monthly $', 'Close Date', 'Owner', 'Competitor', 'Lead Source']);
  for (const o of lost) {
    rows.push([
      o.name,
      accountById.get(o.accountId) ?? '',
      o.amount || 0,
      fmtDate(o.closeDate),
      userById.get(o.ownerId) ?? o.ownerName ?? '',
      o.competitor ?? '',
      o.leadSource ?? '',
    ]);
  }

  // Win rate by owner (only counts deals that have actually closed — open
  // ones are excluded so the rate isn't diluted by in-flight deals).
  rows.push([]);
  rows.push(['Win Rate by Owner (closed deals only)']);
  rows.push(['Owner', 'Won', 'Lost', 'Win Rate', 'Won $ (monthly)', 'Lost $ (monthly)']);
  const ownersSeen = new Set<string>([...won, ...lost].map((o) => o.ownerId));
  const ownerStats: { owner: string; won: number; lost: number; wAmt: number; lAmt: number }[] = [];
  for (const ownerId of ownersSeen) {
    const w = won.filter((o) => o.ownerId === ownerId);
    const l = lost.filter((o) => o.ownerId === ownerId);
    ownerStats.push({
      owner: userById.get(ownerId) ?? '(unknown)',
      won: w.length,
      lost: l.length,
      wAmt: w.reduce((s, o) => s + (o.amount || 0), 0),
      lAmt: l.reduce((s, o) => s + (o.amount || 0), 0),
    });
  }
  ownerStats.sort((a, b) => b.won - a.won);
  for (const s of ownerStats) {
    const rate = (s.won + s.lost) > 0 ? Math.round((s.won / (s.won + s.lost)) * 100) : 0;
    rows.push([s.owner, s.won, s.lost, `${rate}%`, s.wAmt, s.lAmt]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 32 }, { wch: 26 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 20 }, { wch: 18 },
  ];
  return ws;
}
