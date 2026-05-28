/**
 * POST /api/reports/monthly-presentation
 *
 * Generates a one-slide PPT styled after the legacy
 * "PI US Sales Meeting" deck — Cumulative Achievement view.
 *
 * Body: { reportType: 'monogastrics' | 'ruminants' | 'latam' | 'familyb2b' | 'all',
 *         year: number, month: number  // 1..12 (the "selected month")  }
 *
 * Slide layout:
 *   - Title (top-left):  "Cumulative Achievement (TEAM)"
 *   - Logo (top-right):  Pathway Intermediates
 *   - 2 metric lines under title:
 *       Annual Budget & Achievement:  $X / $Y (Z%)
 *       <MON> Budget & Achievement:   $X / $Y (Z%)
 *   - Line chart (center): two series over Jan..Dec
 *       a) Cumulative Sales  — annual cumulative budget (all 12 months)
 *       b) Cumulative Achievement — cumulative actual (Jan..selected month only)
 *   - Bottom red-headed table: Cum. achievement % per month (Jan..selected month)
 *
 * Math (matches the source deck):
 *   monthlyBudget[m]    = sales_budgets where year=Y, month=m, category=cat
 *   monthlyActual[m]    = sum(sale_records where date starts YYYY-MM, category=cat)
 *   cumBudget[m]        = Σ monthlyBudget[1..m]
 *   cumActual[m]        = Σ monthlyActual[1..m]   (only up to selected month)
 *   annualBudget        = cumBudget[12]
 *   annualAchievement   = cumActual[selected]
 *   annualAchievementPct= annualAchievement / annualBudget * 100
 *   monthAchievementPct[m] = cumActual[m] / cumBudget[m] * 100  (table row)
 *
 * Returns a .pptx binary download.
 */

import { auth } from '@/auth';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import PptxGenJS from 'pptxgenjs';

export const runtime = 'nodejs';

const CAT_LABELS: Record<string, string> = {
  monogastrics: 'MONOGASTRICS',
  ruminants:    'RUMINANT',
  latam:        'LATAM',
  familyb2b:    'FAMILY / B2B',
  all:          'TOTAL (ALL TEAMS)',
};

const MONTH_SHORT = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const MONTH_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Colors lifted from the source deck.
const NAVY  = '0B2E4F';   // titles, table header, achievement bars
const GOLD  = 'E8A33D';   // cumulative-sales budget line
const TEXT  = '222222';   // body text

function fmtUSD(n: number): string {
  return '$ ' + new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n || 0));
}

function pct(numer: number, denom: number): number {
  if (!denom) return 0;
  return Math.round((numer / denom) * 100);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { reportType?: string; year?: number; month?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const reportType = (body.reportType ?? '').toLowerCase();
  const year       = Number(body.year);
  const month      = Number(body.month);

  if (!CAT_LABELS[reportType]) {
    return NextResponse.json({ error: `Unknown reportType "${reportType}"` }, { status: 400 });
  }
  if (!Number.isFinite(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: 'year must be a 4-digit integer' }, { status: 400 });
  }
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: 'month must be 1..12' }, { status: 400 });
  }

  // ── Fetch sale_records + sales_budgets ────────────────────────────
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url || !key) {
    return NextResponse.json({ error: 'Supabase env vars missing' }, { status: 500 });
  }
  const sb = createClient(url, key);

  // 3,000-row safety margin on sale_records mirrors the weekly-report route.
  const [s1, s2, s3, bRes] = await Promise.all([
    sb.from('sale_records').select('date,amount,category').range(0, 999),
    sb.from('sale_records').select('date,amount,category').range(1000, 1999),
    sb.from('sale_records').select('date,amount,category').range(2000, 2999),
    sb.from('sales_budgets').select('year,month,category,budget_amount').range(0, 999),
  ]);
  const records = [...(s1.data || []), ...(s2.data || []), ...(s3.data || [])] as Array<{
    date?: string; amount?: number | string; category?: string;
  }>;
  const budgets = (bRes.data || []) as Array<{
    year?: number; month?: number; category?: string; budget_amount?: number | string;
  }>;

  // ── Aggregate into monthly buckets for the selected (year, category) ──
  // monthlyBudget[1..12], monthlyActual[1..12]. Index 0 unused for clarity.
  const monthlyBudget: number[] = Array(13).fill(0);
  const monthlyActual: number[] = Array(13).fill(0);

  for (const b of budgets) {
    if (Number(b.year) !== year) continue;
    if (reportType !== 'all' && b.category !== reportType) continue;
    const m = Number(b.month);
    if (m >= 1 && m <= 12) monthlyBudget[m] += Number(b.budget_amount) || 0;
  }
  for (const r of records) {
    const d = String(r.date || '');
    if (!d.startsWith(`${year}-`)) continue;
    if (reportType !== 'all' && r.category !== reportType) continue;
    const m = Number(d.slice(5, 7));
    if (m >= 1 && m <= 12) monthlyActual[m] += Number(r.amount) || 0;
  }

  // Cumulative series (1..12). Actual is only valid through `month`.
  const cumBudget: number[] = Array(13).fill(0);
  const cumActualThrough: number[] = Array(13).fill(0);  // up to selected month
  for (let m = 1; m <= 12; m++) {
    cumBudget[m] = cumBudget[m - 1] + monthlyBudget[m];
    if (m <= month) {
      cumActualThrough[m] = cumActualThrough[m - 1] + monthlyActual[m];
    }
  }

  const annualBudget        = cumBudget[12];
  const annualAchievement   = cumActualThrough[month];
  const annualAchievementPct = pct(annualAchievement, annualBudget);

  const monthBudget         = monthlyBudget[month];
  const monthAchievement    = monthlyActual[month];
  const monthAchievementPct = pct(monthAchievement, monthBudget);

  // Per-month cumulative achievement % (table row)
  const monthlyCumPct: number[] = Array(13).fill(0);
  for (let m = 1; m <= month; m++) {
    monthlyCumPct[m] = pct(cumActualThrough[m], cumBudget[m]);
  }

  // ── Build the PPT ─────────────────────────────────────────────────
  // pptxgenjs default canvas is 10" × 5.625" (16:9). Coordinates below
  // are in inches (the library's default unit).
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';   // 13.33" × 7.5"
  pres.title  = `Cumulative Achievement — ${CAT_LABELS[reportType]} ${MONTH_LONG[month - 1]} ${year}`;

  const slide = pres.addSlide();
  slide.background = { color: 'FFFFFF' };

  // ── Decorative navy sweep at bottom-right corner ─────────
  // Quarter-ellipse pushed past the bottom-right corner so only the
  // curve shows — sized to clear the achievement table to its left.
  slide.addShape(pres.ShapeType.ellipse, {
    x: 12.2, y: 6.6, w: 3.2, h: 2.8,
    fill: { color: NAVY }, line: { color: NAVY, width: 0 },
  });

  // ── Pathway logo intentionally omitted. PNG embedding rendered
  //    inconsistently across PowerPoint versions (color shift on the
  //    gradient + occasional cache miss on Vercel cold starts). The
  //    bottom-right navy sweep + the centered title carry the brand
  //    weight on their own.

  // ── Title (top-left) ─────────
  // Black (not navy) — matches the source deck's tone better against the
  // gold/navy chart palette.
  slide.addText(`Cumulative Achievement (${CAT_LABELS[reportType]})`, {
    x: 0.4, y: 0.25, w: 10, h: 0.7,
    fontFace: 'Calibri', fontSize: 32, bold: true, color: '111111',
  });

  // ── Metric lines ─────────
  const metricLine1 = `Annual Budget & Achievement: ${fmtUSD(annualBudget)} / ${fmtUSD(annualAchievement)} (${annualAchievementPct}%)`;
  const metricLine2 = `${MONTH_SHORT[month - 1]} Budget & Achievement: ${fmtUSD(monthBudget)} / ${fmtUSD(monthAchievement)} (${monthAchievementPct}%)`;
  slide.addText(metricLine1, {
    x: 0.7, y: 1.05, w: 10, h: 0.32,
    fontFace: 'Calibri', fontSize: 13, color: TEXT,
  });
  slide.addText(metricLine2, {
    x: 0.7, y: 1.40, w: 10, h: 0.32,
    fontFace: 'Calibri', fontSize: 13, color: TEXT,
  });

  // ── Combo chart: Achievement = NAVY BARS, Sales (Budget) = GOLD LINE ─────────
  // Values are divided by 1000 to match the original's "$1,000" axis label.
  // Bar series uses null for the future months (after `month`) so only the
  // achieved-through-now bars render; the budget line keeps going to Dec.
  const labels = MONTH_SHORT;
  const cumActualForChart: (number | null)[] = [];
  for (let m = 1; m <= 12; m++) {
    cumActualForChart.push(m <= month ? Math.round(cumActualThrough[m] / 1000) : null);
  }
  const cumBudgetForChart = cumBudget.slice(1, 13).map((v) => Math.round(v / 1000));

  // pptxgenjs combo chart: array of { type, data, options }. Order
  // matters — drawing the bars first lets the line render on top.
  slide.addChart(
    [
      {
        type: pres.ChartType.bar,
        data: [{
          name: 'Cumulative Achievement',
          labels,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          values: cumActualForChart as any,
        }],
        options: {
          barDir: 'col',
          barGrouping: 'clustered',
          chartColors: [NAVY],
          showValue: true,
          dataLabelFontSize: 10,
          dataLabelFontBold: true,
          // White-on-navy inside the bar avoids the collision with the
          // gold line's data labels that sat just above the bar tops.
          dataLabelColor: 'FFFFFF',
          dataLabelPosition: 'inEnd',
        },
      },
      {
        type: pres.ChartType.line,
        data: [{
          name: 'Cumulative Sales',
          labels,
          values: cumBudgetForChart,
        }],
        options: {
          chartColors: [GOLD],
          lineDataSymbol: 'circle',
          lineDataSymbolSize: 7,
          lineDataSymbolLineColor: GOLD,
          lineDataSymbolLineSize: 2,
          lineSize: 2.5,
          showValue: true,
          dataLabelFontSize: 9,
          dataLabelColor: '666666',
          dataLabelPosition: 't',
        },
      },
    ],
    {
      x: 0.6, y: 1.85, w: 11.5, h: 4.0,
      showLegend: true,
      legendPos: 't',
      legendFontSize: 11,
      legendColor: TEXT,
      catAxisLabelFontSize: 10,
      catAxisLabelColor: '111111',
      valAxisLabelFontSize: 9,
      valAxisLabelColor: '555555',
      valAxisTitle: '$1,000',
      valAxisTitleFontSize: 10,
      showValAxisTitle: true,
      valGridLine: { style: 'solid', size: 0.5, color: 'EAEAEA' },
      catGridLine: { style: 'none' },
      showTitle: false,
    },
  );

  // ── Bottom achievement table — NAVY HEADER ─────────
  const tableY = 6.05;
  const rowCells: { text: string; options?: object }[][] = [];
  // Header row (navy + white). Empty top-left cell to align with the "Cum." label below.
  rowCells.push([
    { text: '', options: { fill: { color: NAVY }, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle', fontSize: 11 } },
    ...MONTH_SHORT.map((m) => ({
      text: m,
      options: { fill: { color: NAVY }, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle', fontSize: 11 },
    })),
  ]);
  // Data row
  const dataRow: { text: string; options?: object }[] = [
    { text: 'Cum.', options: { fill: { color: 'F5F5F5' }, color: '111111', bold: true, align: 'center', valign: 'middle', fontSize: 11 } },
  ];
  for (let m = 1; m <= 12; m++) {
    const v = m <= month ? `${monthlyCumPct[m]}%` : '';
    dataRow.push({
      text: v,
      options: { color: '111111', align: 'center', valign: 'middle', fontSize: 11, fill: { color: 'FFFFFF' } },
    });
  }
  rowCells.push(dataRow);

  slide.addTable(rowCells, {
    x: 0.6, y: tableY, w: 11.5, h: 0.9,
    colW: [1.1, ...Array(12).fill(0.8666)],
    border: { type: 'solid', color: 'D0D0D0', pt: 0.5 },
    fontFace: 'Calibri',
  });

  // ── Stream the file back ─────────
  // pres.write returns ArrayBuffer when given outputType: 'arraybuffer'.
  const buffer = await pres.write({ outputType: 'nodebuffer' }) as Buffer;

  const filename = `PI_${CAT_LABELS[reportType].replace(/[^A-Z0-9]/gi, '_')}_${MONTH_SHORT[month - 1]}_${year}.pptx`;

  return new Response(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
