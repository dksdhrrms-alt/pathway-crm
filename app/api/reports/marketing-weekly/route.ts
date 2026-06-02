/**
 * POST /api/reports/marketing-weekly
 *
 * Generates the "R&D Weekly Report" Word document matching the legacy
 * Marketing-team template (R&D Weekly Report_<date>.docx).
 *
 * Document structure (per template):
 *   1. Header line: "<DD Mon YYYY> (<Nth> Week)"  /  author name (right)
 *   2. Focus table — 1 row header + 1 row content (left BLANK; user
 *      fills it in by hand in Word).
 *   3. Spending table — per-team monthly breakdown for the current
 *      quarter, with cumulative + percentage + remaining columns.
 *      Cells that contribute to "cumulative" are shaded light blue.
 *   4. Red caption: "*Values in light blue cells are included in
 *      cumulative spending."
 *   5. Activities table — 4 columns (Team / Completed / On-going /
 *      Plan), 6 fixed rows.
 *
 * Body:
 *   {
 *     weekEndingDate: 'YYYY-MM-DD',
 *     authorName?: string,
 *     activitiesByTeam: { [teamLabel]: {
 *        completed: string;   // one bullet per line
 *        ongoing:   string;
 *        plan:      string;
 *     } },
 *   }
 *
 * Spending data comes from rnd_budgets + rnd_expenses (current year,
 * R&D category). Team list from budget_teams (live, dynamic).
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType,
  PageOrientation, VerticalAlign, LevelFormat,
} from 'docx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Palette (lifted from the source .docx) ──────────────────────────────
const NAVY        = '222A35';   // dark header fill
const LIGHT_BLUE  = 'D9E2F3';   // cumulative-spending cells
const SOFT_BORDER = '8496B0';   // table grid lines
const RED         = 'FF0000';   // caption + Remark column text
const TOTAL_GRAY  = 'F2F2F2';

const border = (color = SOFT_BORDER, size = 4) => ({ style: BorderStyle.SINGLE, size, color });
const allBorders = {
  top: border(), bottom: border(), left: border(), right: border(),
  insideHorizontal: border(), insideVertical: border(),
};

// US Letter content width (8.5" - 2×0.5") in DXA.
const PAGE_CONTENT_WIDTH = 10800;

function p(text: string, opts: { bold?: boolean; size?: number; color?: string; align?: 'left' | 'center' | 'right'; italics?: boolean } = {}) {
  return new Paragraph({
    spacing: { before: 0, after: 0 },
    alignment: opts.align === 'center' ? AlignmentType.CENTER : opts.align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT,
    children: [new TextRun({
      text,
      bold: opts.bold ?? false,
      italics: opts.italics ?? false,
      size: opts.size ?? 18,
      color: opts.color,
      font: 'Calibri',
    })],
  });
}

function bulletLines(text: string): Paragraph[] {
  const lines = (text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [p('')];
  return lines.map((line) => new Paragraph({
    spacing: { before: 0, after: 0 },
    numbering: { reference: 'bullets', level: 0 },
    children: [new TextRun({ text: line, size: 16, font: 'Calibri' })],
  }));
}

function cell(children: Paragraph[], opts: {
  width?: number; shading?: string;
  verticalAlign?: 'top' | 'center';
} = {}) {
  return new TableCell({
    borders: allBorders,
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    verticalAlign: opts.verticalAlign === 'center' ? VerticalAlign.CENTER : VerticalAlign.TOP,
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    shading: opts.shading
      ? { fill: opts.shading, type: ShadingType.CLEAR, color: 'auto' }
      : undefined,
    children,
  });
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0';
  return '$' + Math.round(n).toLocaleString('en-US');
}

const MONTH_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function formatHeaderDate(iso: string): string {
  // "29 May 2026"
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
}

function nthWeekOfMonth(iso: string): number {
  // Return 1-based week-of-month (Mon..Sun weeks). Matches what most
  // marketing-style "5th Week of May" reports use.
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return 1;
  return Math.ceil(d.getDate() / 7);
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

interface ReqBody {
  weekEndingDate: string;
  authorName?: string;
  activitiesByTeam: Record<string, { completed: string; ongoing: string; plan: string }>;
}

export async function POST(req: Request) {
  let body: ReqBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }); }

  if (!body.weekEndingDate) {
    return NextResponse.json({ error: 'weekEndingDate required' }, { status: 400 });
  }

  // ── Spending data ───────────────────────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const dateObj = new Date(body.weekEndingDate + 'T00:00:00');
  const year = dateObj.getFullYear();
  const currentMonth = dateObj.getMonth() + 1;       // 1..12
  // The quarter that contains the current month — three columns shown.
  const quarter = Math.floor((currentMonth - 1) / 3) + 1;            // 1..4
  const quarterMonths = [(quarter - 1) * 3 + 1, (quarter - 1) * 3 + 2, (quarter - 1) * 3 + 3]; // e.g. [4,5,6] for Q2

  const [budgetsRes, expensesRes, teamsRes] = await Promise.all([
    supabase.from('rnd_budgets').select('*').eq('year', year).eq('category', 'rnd'),
    supabase.from('rnd_expenses').select('*').eq('year', year).eq('category', 'rnd').is('archived_at', null),
    supabase.from('budget_teams').select('*').order('sort_order', { ascending: true }),
  ]);

  const teamRows: { id: string; label: string }[] = (teamsRes.data && teamsRes.data.length > 0)
    ? teamsRes.data.map((r) => ({ id: r.id, label: r.label }))
    : [
        { id: 'ruminant', label: 'Ruminant' },
        { id: 'poultry',  label: 'Poultry'  },
        { id: 'swine',    label: 'Swine'    },
        { id: 'latam',    label: 'LATAM'    },
        { id: 'other',    label: 'Other'    },
      ];

  // Per-team stats:
  //   budget    = annual allocation
  //   cumulative = total spent year-to-date (== Σ all expense rows)
  //   monthly[m] = spent in that month (1..12)
  type Stat = {
    teamId: string; label: string; budget: number; cumulative: number;
    monthly: Record<number, number>;
  };
  const budgetRows = budgetsRes.data || [];
  const expenseRows = expensesRes.data || [];

  const stats: Stat[] = teamRows.map((t) => {
    const budget = Number(budgetRows.find((b) => b.team === t.id)?.annual_amount) || 0;
    const teamExps = expenseRows.filter((e) => e.team === t.id);
    const monthly: Record<number, number> = {};
    for (let m = 1; m <= 12; m++) monthly[m] = 0;
    for (const e of teamExps) {
      const m = Number(e.month);
      if (m >= 1 && m <= 12) monthly[m] += Number(e.amount) || 0;
    }
    const cumulative = teamExps.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    return { teamId: t.id, label: t.label, budget, cumulative, monthly };
  });

  const totals: Stat = {
    teamId: '__total__', label: 'Total',
    budget:     stats.reduce((s, t) => s + t.budget, 0),
    cumulative: stats.reduce((s, t) => s + t.cumulative, 0),
    monthly: (() => {
      const m: Record<number, number> = {};
      for (let i = 1; i <= 12; i++) m[i] = stats.reduce((s, t) => s + (t.monthly[i] || 0), 0);
      return m;
    })(),
  };

  // ── Activities fixed sections (match template) ──────────────────────
  const ACTIVITY_TEAMS = ['Poultry', 'Ruminant', 'LATAM', 'R&D', 'Others', 'Travel'];

  // ── Header line: "29 May 2026 (5th Week)"  /  "Author Name" ─────────
  const dateLabel = formatHeaderDate(body.weekEndingDate);
  const weekLabel = `${ordinal(nthWeekOfMonth(body.weekEndingDate))} Week`;
  const author = (body.authorName || '').trim();

  const headerLine = new Paragraph({
    spacing: { before: 0, after: 120 },
    tabStops: [{ type: 'right' as const, position: PAGE_CONTENT_WIDTH }],
    children: [
      new TextRun({ text: `${dateLabel} (${weekLabel})`, size: 22, font: 'Calibri' }),
      new TextRun({ text: '\t' + author, size: 22, font: 'Calibri' }),
    ],
  });

  // ── Focus table — header + intentionally blank content cell ─────────
  const focusTable = new Table({
    width: { size: PAGE_CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [PAGE_CONTENT_WIDTH],
    rows: [
      new TableRow({
        children: [cell(
          [p("This Month's Focus Activities Goals and Progress", { bold: true, align: 'center', size: 20 })],
          { shading: TOTAL_GRAY, width: PAGE_CONTENT_WIDTH },
        )],
      }),
      // Empty content row — user fills it in by hand in Word.
      new TableRow({
        height: { value: 800, rule: 'atLeast' as const },
        children: [cell([p('')], { width: PAGE_CONTENT_WIDTH })],
      }),
    ],
  });

  // ── Spending table ──────────────────────────────────────────────────
  // Columns: (USD) | Annual | Cumulative | % | Q? Mon1 | Q? Mon2 | Q? Mon3
  //          | Remaining (Approved) | Remaining (Tentative) | Remark
  // Total = 10 columns. Distribute widths across PAGE_CONTENT_WIDTH.
  const SP_COLS = {
    label:      1100,
    annual:     1000,
    cumulative: 1100,
    pct:        650,
    month:      800,                     // each of 3 month columns
    approved:   1100,
    tentative:  1100,
    remark:     950,
  };
  const monthCols = [SP_COLS.month, SP_COLS.month, SP_COLS.month];
  const spWidthSum = SP_COLS.label + SP_COLS.annual + SP_COLS.cumulative + SP_COLS.pct
    + monthCols.reduce((a, b) => a + b, 0) + SP_COLS.approved + SP_COLS.tentative + SP_COLS.remark;
  // Adjust the last (Remark) column so we hit PAGE_CONTENT_WIDTH exactly.
  const remarkCol = SP_COLS.remark + (PAGE_CONTENT_WIDTH - spWidthSum);
  const spColWidths = [
    SP_COLS.label, SP_COLS.annual, SP_COLS.cumulative, SP_COLS.pct,
    ...monthCols,
    SP_COLS.approved, SP_COLS.tentative, remarkCol,
  ];

  // Helper to make a numeric cell with optional shading + right-align.
  function numCell(text: string, opts: { width: number; shading?: string; color?: string } = { width: 0 }) {
    return cell([p(text, { align: 'right', size: 16, color: opts.color })], { width: opts.width, shading: opts.shading });
  }

  // Build the header row (column titles).
  const headerCells = [
    cell([p('(USD)', { bold: true, align: 'center', size: 16 })], { shading: TOTAL_GRAY, width: spColWidths[0] }),
    cell([p('Annual', { bold: true, align: 'center', size: 16 }), p('Budget', { bold: true, align: 'center', size: 16 })], { shading: TOTAL_GRAY, width: spColWidths[1] }),
    cell([p('Cumulative', { bold: true, align: 'center', size: 16 }), p('Spending', { bold: true, align: 'center', size: 16 })], { shading: TOTAL_GRAY, width: spColWidths[2] }),
    cell([p('%', { bold: true, align: 'center', size: 16 })], { shading: TOTAL_GRAY, width: spColWidths[3] }),
    ...quarterMonths.map((m, i) =>
      cell([p(`Q${quarter} (${MONTH_SHORT[m - 1]})`, { bold: true, align: 'center', size: 16 })], { shading: TOTAL_GRAY, width: spColWidths[4 + i] }),
    ),
    cell([p('Remaining', { bold: true, align: 'center', size: 16 }), p('(Approved)', { bold: true, align: 'center', size: 16 })], { shading: TOTAL_GRAY, width: spColWidths[7] }),
    cell([p('Remaining', { bold: true, align: 'center', size: 16 }), p('(Tentative)', { bold: true, align: 'center', size: 16 })], { shading: TOTAL_GRAY, width: spColWidths[8] }),
    cell([p('Remark', { bold: true, align: 'center', size: 16, color: RED })], { shading: TOTAL_GRAY, width: spColWidths[9] }),
  ];

  // Body row builder.
  function bodyRow(s: Stat, isTotal: boolean) {
    const pct = s.budget > 0 ? Math.round((s.cumulative / s.budget) * 100) : 0;
    const remainingApproved = s.budget - s.cumulative;
    // Month cell: shaded light blue if the month has already passed
    // within this quarter (i.e. month < currentMonth), since those
    // expenses are now part of the cumulative total. The current month
    // is also shaded because its YTD-portion is in cumulative.
    const labelShading = isTotal ? TOTAL_GRAY : undefined;
    return new TableRow({
      children: [
        cell([p(s.label, { bold: true, size: 16 })], { shading: labelShading, width: spColWidths[0] }),
        numCell(fmtUsd(s.budget), { width: spColWidths[1], shading: labelShading }),
        numCell(fmtUsd(s.cumulative), { width: spColWidths[2], shading: LIGHT_BLUE }),
        numCell(`${pct}%`, { width: spColWidths[3], shading: labelShading }),
        ...quarterMonths.map((m, i) => {
          const v = s.monthly[m] || 0;
          // Shade past-and-current quarter-months light blue (they roll
          // into Cumulative). Future months stay white.
          const shade = m <= currentMonth ? LIGHT_BLUE : labelShading;
          return numCell(fmtUsd(v), { width: spColWidths[4 + i], shading: shade });
        }),
        numCell(fmtUsd(remainingApproved), { width: spColWidths[7], shading: labelShading }),
        // Tentative + Remark are user-maintained — leave blank so Word
        // displays an empty cell the team can edit.
        numCell('', { width: spColWidths[8], shading: labelShading }),
        numCell('', { width: spColWidths[9], shading: labelShading, color: RED }),
      ],
    });
  }

  const spendingTable = new Table({
    width: { size: PAGE_CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: spColWidths,
    rows: [
      new TableRow({ tableHeader: true, children: headerCells }),
      ...stats.map((s) => bodyRow(s, false)),
      bodyRow(totals, true),
    ],
  });

  // ── Activities table ────────────────────────────────────────────────
  const actLabelCol = 1200;
  const actColW = Math.floor((PAGE_CONTENT_WIDTH - actLabelCol) / 3);
  const actCols = [actLabelCol, actColW, actColW, PAGE_CONTENT_WIDTH - actLabelCol - 2 * actColW];

  const activitiesTable = new Table({
    width: { size: PAGE_CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: actCols,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          cell([p('Activities',          { bold: true, color: 'FFFFFF', size: 18, align: 'center' })], { shading: NAVY, width: actCols[0] }),
          cell([p('Completed',           { bold: true, color: 'FFFFFF', size: 18, align: 'center' })], { shading: NAVY, width: actCols[1] }),
          cell([p('On-going (this week)', { bold: true, color: 'FFFFFF', size: 18, align: 'center' })], { shading: NAVY, width: actCols[2] }),
          cell([p('Plan (next week)',    { bold: true, color: 'FFFFFF', size: 18, align: 'center' })], { shading: NAVY, width: actCols[3] }),
        ],
      }),
      ...ACTIVITY_TEAMS.map((teamLabel) => {
        const a = body.activitiesByTeam?.[teamLabel] || { completed: '', ongoing: '', plan: '' };
        return new TableRow({
          children: [
            cell([p(teamLabel, { bold: true, align: 'center', size: 16 })], { width: actCols[0], shading: TOTAL_GRAY, verticalAlign: 'center' }),
            cell(bulletLines(a.completed), { width: actCols[1] }),
            cell(bulletLines(a.ongoing),   { width: actCols[2] }),
            cell(bulletLines(a.plan),      { width: actCols[3] }),
          ],
        });
      }),
    ],
  });

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 240, hanging: 160 } } },
        }],
      }],
    },
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840, orientation: PageOrientation.PORTRAIT },
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
        },
      },
      children: [
        headerLine,
        focusTable,
        new Paragraph({ spacing: { before: 120, after: 0 }, children: [new TextRun({ text: '' })] }),
        spendingTable,
        new Paragraph({
          spacing: { before: 40, after: 120 },
          children: [new TextRun({
            text: '*Values in light blue cells are included in cumulative spending.',
            italics: true, color: RED, size: 16, font: 'Calibri',
          })],
        }),
        activitiesTable,
      ],
    }],
  });

  const buf = await Packer.toBuffer(doc);
  const filename = `R&D Weekly Report_${body.weekEndingDate.replace(/-/g, '.')}.docx`;
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return new Response(ab, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': String(buf.length),
    },
  });
}
