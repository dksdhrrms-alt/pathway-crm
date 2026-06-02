/**
 * POST /api/reports/marketing-weekly
 *
 * Generates the "R&D Weekly Report" Word document the Marketing team uses
 * for their Friday sync. Matches the legacy template uploaded by the user
 * (R&D Weekly Report_5.29.2026.docx) — same table shapes, navy headers,
 * light-blue cumulative-spending cells.
 *
 * Body:
 *   {
 *     weekEndingDate: 'YYYY-MM-DD',
 *     focusByTeam: { [teamLabel]: string },         // bullet items, one per line
 *     activitiesByTeam: { [teamLabel]: {
 *        completed: string;   // one bullet per line
 *        ongoing:   string;
 *        plan:      string;
 *     } },
 *   }
 *
 * The Spending table is auto-filled from the rnd_budgets + rnd_expenses
 * tables (current year, R&D category) so the user never has to retype it.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, HeadingLevel,
  PageOrientation, VerticalAlign, LevelFormat,
} from 'docx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Palette (lifted from the source .docx) ──────────────────────────────
const NAVY        = '222A35';   // header text + dark header fill
const NAVY_BG     = '222A35';   // header row background (white text on it)
const HEADER_BG   = '4472C4';   // table top row (week-of date band) — Office Blue
const LIGHT_BLUE  = 'D9E2F3';   // cumulative-spending cells
const SOFT_BORDER = '8496B0';   // table grid lines
const RED         = 'FF0000';   // the "*Values in light blue cells…" caption

const border = (color = SOFT_BORDER, size = 4) => ({ style: BorderStyle.SINGLE, size, color });
const allBorders = {
  top: border(), bottom: border(), left: border(), right: border(),
  insideHorizontal: border(), insideVertical: border(),
};

// 8.5" × 11" minus 0.75" margins ≈ content width 9,840 DXA. We use 9,000 to
// give the Activities table a hair of breathing room in print preview.
const PAGE_CONTENT_WIDTH = 9000;

// Helper: Paragraph with a single TextRun, defaulting to 11pt Calibri.
function p(text: string, opts: { bold?: boolean; size?: number; color?: string; align?: 'left' | 'center' | 'right' } = {}) {
  return new Paragraph({
    spacing: { before: 0, after: 0 },
    alignment: opts.align === 'center' ? AlignmentType.CENTER : opts.align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT,
    children: [new TextRun({
      text,
      bold: opts.bold ?? false,
      size: opts.size ?? 22,
      color: opts.color,
      font: 'Calibri',
    })],
  });
}

// Helper: render a multi-line bullet block (each non-empty line → bullet).
function bulletLines(text: string): Paragraph[] {
  const lines = (text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [p('')];
  return lines.map((line) => new Paragraph({
    spacing: { before: 20, after: 20 },
    numbering: { reference: 'bullets', level: 0 },
    children: [new TextRun({ text: line, size: 20, font: 'Calibri' })],
  }));
}

// Helper: build a TableCell with consistent borders, padding, and optional shading.
function cell(children: Paragraph[], opts: {
  width?: number; shading?: string; bold?: boolean; align?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'center';
} = {}) {
  return new TableCell({
    borders: allBorders,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    verticalAlign: opts.verticalAlign === 'center' ? VerticalAlign.CENTER : VerticalAlign.TOP,
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    shading: opts.shading
      ? { fill: opts.shading, type: ShadingType.CLEAR, color: 'auto' }
      : undefined,
    children,
  });
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '$0';
  return '$' + Math.round(n).toLocaleString('en-US');
}

function formatDateLong(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

interface ReqBody {
  weekEndingDate: string;
  focusByTeam: Record<string, string>;
  activitiesByTeam: Record<string, { completed: string; ongoing: string; plan: string }>;
}

export async function POST(req: Request) {
  let body: ReqBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }); }

  if (!body.weekEndingDate) {
    return NextResponse.json({ error: 'weekEndingDate required' }, { status: 400 });
  }

  // ── 1) Fetch Spending data from Supabase (R&D budgets + expenses) ────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const year = new Date(body.weekEndingDate + 'T00:00:00').getFullYear();
  const [budgetsRes, expensesRes, teamsRes] = await Promise.all([
    supabase.from('rnd_budgets').select('*').eq('year', year).eq('category', 'rnd'),
    supabase.from('rnd_expenses').select('*').eq('year', year).eq('category', 'rnd').is('archived_at', null),
    supabase.from('budget_teams').select('*').order('sort_order', { ascending: true }),
  ]);

  // Pull team list — fall back to a hard-coded seed if the dynamic
  // table isn't populated yet on this environment.
  const teamRows: { id: string; label: string }[] = (teamsRes.data && teamsRes.data.length > 0)
    ? teamsRes.data.map((r) => ({ id: r.id, label: r.label }))
    : [
        { id: 'ruminant', label: 'Ruminant' },
        { id: 'poultry',  label: 'Poultry'  },
        { id: 'swine',    label: 'Swine'    },
        { id: 'latam',    label: 'LATAM'    },
        { id: 'other',    label: 'Other'    },
      ];

  // ── 2) Compute per-team spending stats ───────────────────────────────
  type Stat = { teamId: string; label: string; budget: number; spent: number };
  const budgetRows = budgetsRes.data || [];
  const expenseRows = expensesRes.data || [];
  const stats: Stat[] = teamRows.map((t) => {
    const budget = (budgetRows.find((b) => b.team === t.id)?.annual_amount as number) || 0;
    const spent = expenseRows
      .filter((e) => e.team === t.id)
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);
    return { teamId: t.id, label: t.label, budget: Number(budget), spent };
  });
  const totalBudget = stats.reduce((s, t) => s + t.budget, 0);
  const totalSpent  = stats.reduce((s, t) => s + t.spent, 0);

  // ── 3) Activities table — 6 rows (Poultry / Ruminant / LATAM / R&D /
  //                                   Others / Travel) × 4 columns
  // The exact section list is fixed (matches the source template) — the
  // dynamic `budget_teams` list doesn't drive Activities, only Spending.
  const ACTIVITY_TEAMS = ['Poultry', 'Ruminant', 'LATAM', 'R&D', 'Others', 'Travel'];

  // ── 4) Build the document ────────────────────────────────────────────

  // (a) Focus table — single row, four bordered cells matching the template.
  // Source template: one big bordered block with bullets for each team.
  const focusBullets: Paragraph[] = [];
  for (const teamLabel of ['Poultry', 'Ruminant', 'LATAM', 'R&D (New Product Development)']) {
    const text = (body.focusByTeam?.[teamLabel] || '').trim();
    if (!text) continue;
    // First bullet line carries the team label; subsequent lines preserve sub-bullets.
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    focusBullets.push(new Paragraph({
      spacing: { before: 40, after: 0 },
      numbering: { reference: 'bullets', level: 0 },
      children: [
        new TextRun({ text: `${teamLabel}: `, bold: true, size: 22, font: 'Calibri' }),
        new TextRun({ text: lines.join('; '), size: 22, font: 'Calibri' }),
      ],
    }));
  }
  if (focusBullets.length === 0) focusBullets.push(p('(no focus items entered)', { color: '999999', size: 20 }));

  const focusTable = new Table({
    width: { size: PAGE_CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [PAGE_CONTENT_WIDTH],
    rows: [
      new TableRow({
        children: [cell(
          [p("This Month's Focus Activities Goals and Progress", { bold: true, color: 'FFFFFF', size: 24 })],
          { shading: NAVY_BG, width: PAGE_CONTENT_WIDTH },
        )],
      }),
      new TableRow({
        children: [cell(focusBullets, { width: PAGE_CONTENT_WIDTH })],
      }),
    ],
  });

  // (b) Spending table — week-of-date header + per-team budget vs spent.
  const teamCol = 2200;
  const colWidth = Math.floor((PAGE_CONTENT_WIDTH - teamCol) / 3);
  const spendingTable = new Table({
    width: { size: PAGE_CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [teamCol, colWidth, colWidth, PAGE_CONTENT_WIDTH - teamCol - 2 * colWidth],
    rows: [
      // Header (week-of)
      new TableRow({
        children: [cell(
          [p(`Spending — Week ending ${formatDateLong(body.weekEndingDate)}`, { bold: true, color: 'FFFFFF', size: 22 })],
          { shading: HEADER_BG, width: PAGE_CONTENT_WIDTH },
        )],
      }),
      // Column titles
      new TableRow({
        tableHeader: true,
        children: [
          cell([p('Team',      { bold: true, color: NAVY })],                                  { shading: LIGHT_BLUE, width: teamCol }),
          cell([p('Budget',    { bold: true, color: NAVY, align: 'right' })],                  { shading: LIGHT_BLUE, width: colWidth }),
          cell([p('Spent',     { bold: true, color: NAVY, align: 'right' })],                  { shading: LIGHT_BLUE, width: colWidth }),
          cell([p('Remaining', { bold: true, color: NAVY, align: 'right' })],                  { shading: LIGHT_BLUE, width: PAGE_CONTENT_WIDTH - teamCol - 2 * colWidth }),
        ],
      }),
      // Per-team rows
      ...stats.map((s) => new TableRow({
        children: [
          cell([p(s.label,           { bold: true })], { width: teamCol }),
          cell([p(fmtUsd(s.budget),  { align: 'right' })], { width: colWidth }),
          cell([p(fmtUsd(s.spent),   { align: 'right' })], { shading: LIGHT_BLUE, width: colWidth }),
          cell([p(fmtUsd(s.budget - s.spent), { align: 'right' })], { width: PAGE_CONTENT_WIDTH - teamCol - 2 * colWidth }),
        ],
      })),
      // Totals
      new TableRow({
        children: [
          cell([p('Total', { bold: true })], { shading: 'F2F2F2', width: teamCol }),
          cell([p(fmtUsd(totalBudget), { bold: true, align: 'right' })], { shading: 'F2F2F2', width: colWidth }),
          cell([p(fmtUsd(totalSpent),  { bold: true, align: 'right' })], { shading: LIGHT_BLUE, width: colWidth }),
          cell([p(fmtUsd(totalBudget - totalSpent), { bold: true, align: 'right' })], { shading: 'F2F2F2', width: PAGE_CONTENT_WIDTH - teamCol - 2 * colWidth }),
        ],
      }),
    ],
  });

  // (c) Activities table — 4 columns × (1 header + 6 team rows)
  const actLabelCol = 1400;
  const actColWidth = Math.floor((PAGE_CONTENT_WIDTH - actLabelCol) / 3);
  const actCols = [actLabelCol, actColWidth, actColWidth, PAGE_CONTENT_WIDTH - actLabelCol - 2 * actColWidth];

  const activitiesTable = new Table({
    width: { size: PAGE_CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: actCols,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          cell([p('Activities',          { bold: true, color: 'FFFFFF', size: 22 })], { shading: NAVY_BG, width: actCols[0] }),
          cell([p('Completed',           { bold: true, color: 'FFFFFF', size: 22 })], { shading: NAVY_BG, width: actCols[1] }),
          cell([p('On-going (this week)', { bold: true, color: 'FFFFFF', size: 22 })], { shading: NAVY_BG, width: actCols[2] }),
          cell([p('Plan (next week)',    { bold: true, color: 'FFFFFF', size: 22 })], { shading: NAVY_BG, width: actCols[3] }),
        ],
      }),
      ...ACTIVITY_TEAMS.map((teamLabel) => {
        const a = body.activitiesByTeam?.[teamLabel] || { completed: '', ongoing: '', plan: '' };
        return new TableRow({
          children: [
            cell([p(teamLabel, { bold: true })],         { width: actCols[0] }),
            cell(bulletLines(a.completed),               { width: actCols[1] }),
            cell(bulletLines(a.ongoing),                 { width: actCols[2] }),
            cell(bulletLines(a.plan),                    { width: actCols[3] }),
          ],
        });
      }),
    ],
  });

  // ── 5) Assemble document with the three tables + caption ─────────────
  const doc = new Document({
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 360, hanging: 200 } } },
        }],
      }],
    },
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
    },
    sections: [{
      properties: {
        page: {
          size: {
            width: 12240, height: 15840,        // US Letter
            orientation: PageOrientation.PORTRAIT,
          },
          margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },  // 0.75"
        },
      },
      children: [
        new Paragraph({
          spacing: { after: 120 },
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'R&D Weekly Report', bold: true, color: NAVY, size: 36, font: 'Calibri' })],
        }),
        new Paragraph({
          spacing: { after: 240 },
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: `Week ending ${formatDateLong(body.weekEndingDate)}`, size: 22, color: '595959', font: 'Calibri' })],
        }),
        focusTable,
        new Paragraph({ spacing: { before: 200, after: 0 }, children: [new TextRun({ text: '' })] }),
        spendingTable,
        new Paragraph({
          spacing: { before: 60, after: 200 },
          children: [new TextRun({
            text: '*Values in light blue cells are included in cumulative spending.',
            italics: true, color: RED, size: 18, font: 'Calibri',
          })],
        }),
        activitiesTable,
      ],
    }],
  });

  const buf = await Packer.toBuffer(doc);
  const filename = `R&D Weekly Report_${body.weekEndingDate.replace(/-/g, '.')}.docx`;

  // Hand the bytes to fetch.Response as an ArrayBuffer slice — TS lib
  // doesn't list Buffer / Uint8Array directly in BodyInit, but ArrayBuffer
  // is accepted and the runtime serializes the same way.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return new Response(ab, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': String(buf.length),
    },
  });
}
