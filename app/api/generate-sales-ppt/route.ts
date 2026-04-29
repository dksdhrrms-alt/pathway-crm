import { NextRequest, NextResponse } from 'next/server';
// JSZip MUST be a top-level static import — Vercel's serverless bundler does
// not resolve `await import('jszip')` correctly when invoked transitively from
// pptxgenjs (results in 500 "Cannot find module 'jszip'" at runtime).
// Importing it here forces it into the function bundle.
import 'jszip';

// Sales Meeting PPT — replicates the "Cumulative Achievement" template:
//   - Bold title top-left
//   - Two annotation lines (Annual + current-month budget vs achievement)
//   - Combo chart: bar (cumulative achievement/budget) + line (cumulative sales)
//   - Bottom table: monthly Cum.% row
//   - Pathway navy decorative shape bottom-right
//
// pptxgenjs is still loaded dynamically (it's heavier and only the value, not
// types, is needed at runtime — see the dynamic import inside POST below).
export const runtime = 'nodejs';
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PptxRow = any[];

interface SaleRow { date?: string; accountName?: string; productName?: string; category?: string; amount?: number | string; }
interface BudgetRow { year?: number; month?: number; category?: string; amount?: number | string; }

interface RequestBody {
  year: number;
  quarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'YTD';
  saleRecords?: SaleRow[];
  budgets?: BudgetRow[];
  category?: string;        // e.g. 'monogastrics' / 'ruminants' / 'latam' / 'familyb2b' / 'all'
}

const PRIMARY_NAVY = '0F2A47';   // dark navy for title and bars
const ACCENT_GOLD = 'E5A623';    // line color
const TEXT_DARK = '1F2937';
const TEXT_GRAY = '6B7280';

const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function fmt$(n: number): string {
  return '$ ' + Math.round(n).toLocaleString('en-US');
}
function fmtK(n: number): string {
  return Math.round(n / 1000).toLocaleString('en-US');
}

function categoryLabel(cat: string): string {
  if (!cat || cat === 'all') return 'Total';
  if (cat === 'monogastrics') return 'Monogastric';
  if (cat === 'ruminants') return 'Ruminant';
  if (cat === 'latam') return 'LATAM';
  if (cat === 'familyb2b') return 'Family/B2B';
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { year, saleRecords = [], budgets = [], category = 'all' } = body;
  if (!year) return NextResponse.json({ error: 'year required' }, { status: 400 });

  try {

  // Compute currently selected month — use latest month with sales data, fallback to current month
  const today = new Date();
  const currentMonth = year === today.getFullYear() ? today.getMonth() + 1 : 12;

  // Filter to selected category + year
  const matchCat = (rowCat?: string) => category === 'all' || (rowCat || '').toLowerCase() === category.toLowerCase();
  const yearSales = saleRecords.filter((r) => {
    if (!matchCat(r.category)) return false;
    const m = String(r.date || '').match(/^(\d{4})-(\d{2})/);
    return !!m && parseInt(m[1], 10) === year;
  });
  const yearBudgets = budgets.filter((b) => Number(b.year) === year && matchCat(b.category));

  // Monthly aggregation (1-12 indexed)
  const monthlySales = new Array(12).fill(0);
  yearSales.forEach((r) => {
    const m = String(r.date || '').match(/^\d{4}-(\d{2})/);
    if (!m) return;
    const idx = parseInt(m[1], 10) - 1;
    if (idx >= 0 && idx < 12) monthlySales[idx] += Number(r.amount) || 0;
  });
  const monthlyBudgets = new Array(12).fill(0);
  yearBudgets.forEach((b) => {
    const idx = (Number(b.month) || 0) - 1;
    if (idx >= 0 && idx < 12) monthlyBudgets[idx] += Number(b.amount) || 0;
  });

  // Cumulative running totals
  const cumSales: number[] = [];
  const cumBudget: number[] = [];
  let s = 0, bg = 0;
  for (let i = 0; i < 12; i++) {
    s += monthlySales[i]; bg += monthlyBudgets[i];
    cumSales.push(s);
    cumBudget.push(bg);
  }
  const annualBudget = cumBudget[11];
  const annualAchievement = cumSales[11];
  const annualPct = annualBudget > 0 ? Math.round((annualAchievement / annualBudget) * 100) : 0;

  const cmIdx = currentMonth - 1;
  const cmName = MONTH_NAMES[cmIdx];
  const cmBudget = monthlyBudgets[cmIdx] || 0;
  const cmSales = monthlySales[cmIdx] || 0;
  const cmPct = cmBudget > 0 ? Math.round((cmSales / cmBudget) * 100) : 0;

  // Cumulative % per month
  const cumPctByMonth = cumBudget.map((b, i) => (b > 0 ? Math.round((cumSales[i] / b) * 100) : 0));

  // ── Build PPT ────────────────────────────────────────────────────────
  // pptxgenjs lazy-loaded; jszip is statically imported at the top of the file
  // so Vercel's bundler ships it with the function (dynamic import broke 500).
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';                // 13.33 x 7.5 inches
  pptx.title = `Pathway Intermediates USA — ${categoryLabel(category)} Cumulative Achievement ${year}`;
  pptx.author = 'Pathway Intermediates USA';

  // Slide 1: Title
  {
    const t = pptx.addSlide();
    t.background = { color: PRIMARY_NAVY };
    t.addText('PATHWAY INTERMEDIATES USA', { x: 0.5, y: 2.2, w: 12.3, h: 0.5, fontSize: 16, color: 'A7C7E7', fontFace: 'Calibri', bold: true, align: 'center' });
    t.addText(`${categoryLabel(category)} Sales Meeting`, { x: 0.5, y: 2.9, w: 12.3, h: 1.2, fontSize: 48, color: 'FFFFFF', fontFace: 'Calibri', bold: true, align: 'center' });
    t.addText(`${year}`, { x: 0.5, y: 4.3, w: 12.3, h: 0.6, fontSize: 28, color: 'E5A623', fontFace: 'Calibri', align: 'center' });
    t.addText(`Generated ${today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, { x: 0.5, y: 6.7, w: 12.3, h: 0.3, fontSize: 11, color: 'A7C7E7', fontFace: 'Calibri', align: 'center' });
  }

  // Slide 2: Cumulative Achievement (matches template)
  {
    const s = pptx.addSlide();
    s.background = { color: 'FFFFFF' };

    // Title
    s.addText('Cumulative Achievement', { x: 0.4, y: 0.25, w: 11, h: 0.85, fontSize: 36, color: PRIMARY_NAVY, fontFace: 'Calibri', bold: true, italic: true });

    // Pathway logo top-right — render as text for now. (Vercel serverless
    // functions don't bundle files in `public/`, so addImage with `path:`
    // throws a 500. To restore an actual logo, fetch the URL or embed base64.)
    s.addText('PATHWAY', { x: 11.0, y: 0.3, w: 2.0, h: 0.3, fontSize: 14, color: PRIMARY_NAVY, fontFace: 'Calibri', bold: true, align: 'right' });
    s.addText('INTERMEDIATES', { x: 11.0, y: 0.6, w: 2.0, h: 0.3, fontSize: 10, color: PRIMARY_NAVY, fontFace: 'Calibri', align: 'right' });

    // Annotation lines
    s.addText(`Annual Budget & Achievement: ${fmt$(annualBudget)} / ${fmt$(annualAchievement)} (${annualPct}%)`, { x: 0.4, y: 1.25, w: 12.5, h: 0.35, fontSize: 14, color: TEXT_DARK, fontFace: 'Calibri' });
    s.addText(`${cmName} Budget & Achievement: ${fmt$(cmBudget)} / ${fmt$(cmSales)} (${cmPct}%)`, { x: 0.4, y: 1.65, w: 12.5, h: 0.35, fontSize: 14, color: TEXT_DARK, fontFace: 'Calibri' });

    // Combo chart (bar + line)
    const chartBarData = [{ name: 'Cumulative Achievement', labels: MONTH_NAMES, values: cumBudget.map((v) => Math.round(v / 1000)) }];
    const chartLineData = [{ name: 'Cumulative Sales', labels: MONTH_NAMES, values: cumSales.map((v) => Math.round(v / 1000)) }];

    // pptxgenjs combo signature is overloaded; cast to any to bypass strict TS
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s as any).addChart(
      [
        { type: pptx.ChartType.bar, data: chartBarData, options: { barDir: 'col', barGrouping: 'clustered', chartColors: [PRIMARY_NAVY] } },
        { type: pptx.ChartType.line, data: chartLineData, options: { secondaryValAxis: true, secondaryCatAxis: true, chartColors: [ACCENT_GOLD], lineDataSymbol: 'circle', lineDataSymbolSize: 8, lineSize: 2 } },
      ],
      {
        x: 0.5, y: 2.2, w: 12.3, h: 4.0,
        showLegend: true, legendPos: 't', legendFontSize: 10, legendFontFace: 'Calibri',
        showCatAxisTitle: false,
        valAxisLabelFontSize: 9, valAxisLabelColor: TEXT_GRAY,
        catAxisLabelFontSize: 10, catAxisLabelColor: TEXT_DARK, catAxisLabelFontFace: 'Calibri',
        showTitle: false,
        showValAxisTitle: true, valAxisTitle: '$1,000', valAxisTitleFontSize: 10, valAxisTitleColor: TEXT_GRAY,
        showDataLabels: true, dataLabelFontSize: 9, dataLabelColor: TEXT_DARK, dataLabelPosition: 'outEnd', dataLabelFormatCode: '#,##0',
        plotArea: { fill: { color: 'F3F4F6' } },
      }
    );

    // Bottom monthly cum.% table
    const headerRow: PptxRow = [
      { text: '', options: { fill: { color: PRIMARY_NAVY }, color: 'FFFFFF', bold: true } },
      ...MONTH_NAMES.map((m) => ({ text: m, options: { fill: { color: PRIMARY_NAVY }, color: 'FFFFFF', bold: true, align: 'center' as const } })),
    ];
    const cumRow: PptxRow = [
      { text: 'Cum.', options: { bold: true, color: TEXT_DARK, fill: { color: 'FFFFFF' } } },
      ...cumPctByMonth.map((p, i) => {
        // Show empty for future months (no sales data)
        const showVal = i <= cmIdx && cumBudget[i] > 0;
        return { text: showVal ? `${p}%` : '', options: { color: TEXT_DARK, align: 'center' as const, fill: { color: 'FFFFFF' } } };
      }),
    ];
    s.addTable([headerRow, cumRow], {
      x: 0.5, y: 6.35, w: 12.3,
      colW: [0.9, ...new Array(12).fill(11.4 / 12)],
      fontSize: 10, fontFace: 'Calibri',
      border: { type: 'solid', pt: 0.5, color: 'D1D5DB' },
    });

    // Decorative navy curve bottom-right (approximated with rounded shape)
    s.addShape('rect', { x: 12.0, y: 6.8, w: 1.5, h: 0.7, fill: { color: PRIMARY_NAVY }, rectRadius: 0.35 });
  }

  const buf = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  const filename = `Sales-Meeting-${categoryLabel(category)}-${year}-${cmName}.pptx`;
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
  } catch (err) {
    console.error('[PPT] Generation failed:', err);
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? (err.stack || '').split('\n').slice(0, 8).join('\n') : '';
    return NextResponse.json(
      { error: 'PPT generation failed', detail: msg, stack },
      { status: 500 }
    );
  }
}
