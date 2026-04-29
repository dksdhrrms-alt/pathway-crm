import { NextRequest, NextResponse } from 'next/server';
import PptxGenJS from 'pptxgenjs';

// Generate a Sales Meeting PPT from CRM data for a given year + quarter.
// Future: when public/sales-meeting-template.pptx is provided, swap to a
// template-fill approach (e.g. pptx-automizer). For now we render slides
// programmatically with pptxgenjs.
export const runtime = 'nodejs';
export const maxDuration = 60;

interface SaleRow {
  date?: string;
  accountName?: string;
  productName?: string;
  category?: string;
  amount?: number | string;
}

interface RequestBody {
  year: number;
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'YTD';
  saleRecords?: SaleRow[];
  // Optional team summary already prepared by the client
  teamSummary?: { team: string; total: number; recordCount: number }[];
}

const PRIMARY = '1A4731';
const ACCENT = '0F6E56';
const RED = 'B91C1C';
const GRAY_DARK = '374151';
const GRAY_LIGHT = '6B7280';

const QUARTER_MONTHS: Record<string, [number, number]> = {
  Q1: [1, 3],
  Q2: [4, 6],
  Q3: [7, 9],
  Q4: [10, 12],
};

function inRange(dateStr: string, year: number, quarter: string): boolean {
  if (!dateStr) return false;
  const m = dateStr.match(/^(\d{4})-(\d{2})/);
  if (!m) return false;
  const y = parseInt(m[1], 10);
  const mon = parseInt(m[2], 10);
  if (y !== year) return false;
  if (quarter === 'YTD') return true;
  const [start, end] = QUARTER_MONTHS[quarter] || [1, 12];
  return mon >= start && mon <= end;
}

function formatCurrency(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}
function formatCompact(n: number): string {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(0) + 'K';
  return '$' + Math.round(n).toLocaleString('en-US');
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { year, quarter, saleRecords = [] } = body;
  if (!year || !quarter) {
    return NextResponse.json({ error: 'year and quarter required' }, { status: 400 });
  }

  // Filter sales to the period
  const periodSales = saleRecords.filter((r) => inRange(String(r.date || ''), year, quarter));
  const totalAmount = periodSales.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const recordCount = periodSales.length;

  // Aggregate by category
  const byCat: Record<string, { count: number; amount: number }> = {};
  periodSales.forEach((r) => {
    const c = r.category || 'Other';
    if (!byCat[c]) byCat[c] = { count: 0, amount: 0 };
    byCat[c].count += 1;
    byCat[c].amount += Number(r.amount) || 0;
  });
  const categoryRows = Object.entries(byCat)
    .sort(([, a], [, b]) => b.amount - a.amount)
    .map(([cat, v]) => ({ cat, count: v.count, amount: v.amount, pct: totalAmount > 0 ? Math.round((v.amount / totalAmount) * 100) : 0 }));

  // Aggregate by account (top 10)
  const byAcct: Record<string, number> = {};
  periodSales.forEach((r) => {
    const name = r.accountName || 'Unknown';
    byAcct[name] = (byAcct[name] || 0) + (Number(r.amount) || 0);
  });
  const topAccounts = Object.entries(byAcct)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name, amt]) => ({ name, amount: amt, pct: totalAmount > 0 ? Math.round((amt / totalAmount) * 100) : 0 }));

  // Aggregate by month for trend
  const byMonth: Record<string, number> = {};
  periodSales.forEach((r) => {
    const m = String(r.date || '').slice(0, 7);
    if (m) byMonth[m] = (byMonth[m] || 0) + (Number(r.amount) || 0);
  });
  const trend = Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0]));

  // ── Build the PPT ────────────────────────────────────────────────────
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = `Pathway Intermediates USA — Sales Meeting ${year} ${quarter}`;
  pptx.author = 'Pathway Intermediates USA';
  pptx.company = 'Pathway Intermediates USA';

  // Slide 1 — Title
  {
    const s = pptx.addSlide();
    s.background = { color: PRIMARY };
    s.addText('PATHWAY INTERMEDIATES USA', { x: 0.5, y: 1.5, w: 12, h: 0.5, fontSize: 18, color: 'FFFFFF', fontFace: 'Arial', bold: true, align: 'center' });
    s.addText(`Sales Meeting`, { x: 0.5, y: 2.3, w: 12, h: 1, fontSize: 44, color: 'FFFFFF', fontFace: 'Arial', bold: true, align: 'center' });
    s.addText(`${year} · ${quarter}`, { x: 0.5, y: 3.5, w: 12, h: 0.6, fontSize: 28, color: 'D1FAE5', fontFace: 'Arial', align: 'center' });
    s.addText(`Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, { x: 0.5, y: 6.5, w: 12, h: 0.4, fontSize: 12, color: 'A7F3D0', fontFace: 'Arial', align: 'center' });
  }

  // Slide 2 — Executive Summary
  {
    const s = pptx.addSlide();
    s.addText('Executive Summary', { x: 0.5, y: 0.4, w: 12, h: 0.6, fontSize: 28, color: PRIMARY, fontFace: 'Arial', bold: true });
    s.addShape('rect', { x: 0.5, y: 1.1, w: 12, h: 0.04, fill: { color: ACCENT } });

    // KPI cards
    const kpis = [
      { label: 'TOTAL SALES', value: formatCompact(totalAmount), color: PRIMARY },
      { label: 'RECORDS', value: recordCount.toLocaleString(), color: ACCENT },
      { label: 'UNIQUE ACCOUNTS', value: Object.keys(byAcct).length.toLocaleString(), color: '185FA5' },
      { label: 'CATEGORIES', value: Object.keys(byCat).length.toLocaleString(), color: '854F0B' },
    ];
    kpis.forEach((k, i) => {
      const x = 0.5 + i * 3.05;
      s.addShape('rect', { x, y: 1.5, w: 2.85, h: 1.4, fill: { color: 'F9FAFB' }, line: { color: 'E5E7EB', width: 0.5 } });
      s.addText(k.label, { x: x + 0.15, y: 1.6, w: 2.6, h: 0.3, fontSize: 10, color: GRAY_LIGHT, fontFace: 'Arial', bold: true });
      s.addText(k.value, { x: x + 0.15, y: 2.0, w: 2.6, h: 0.7, fontSize: 26, color: k.color, fontFace: 'Arial', bold: true });
    });

    // Highlights bullet
    const highlights: string[] = [];
    if (topAccounts.length > 0) highlights.push(`Top contributor: ${topAccounts[0].name} (${formatCompact(topAccounts[0].amount)}, ${topAccounts[0].pct}% of total)`);
    if (categoryRows.length > 0) highlights.push(`Leading category: ${categoryRows[0].cat} — ${formatCompact(categoryRows[0].amount)} (${categoryRows[0].pct}%)`);
    if (trend.length > 1) {
      const first = trend[0][1]; const last = trend[trend.length - 1][1];
      const delta = first > 0 ? Math.round(((last - first) / first) * 100) : 0;
      highlights.push(`Period trend: ${delta >= 0 ? '+' : ''}${delta}% from ${trend[0][0]} to ${trend[trend.length - 1][0]}`);
    }
    if (highlights.length > 0) {
      s.addText('Highlights', { x: 0.5, y: 3.2, w: 12, h: 0.4, fontSize: 16, color: PRIMARY, fontFace: 'Arial', bold: true });
      s.addText(highlights.map((h) => ({ text: h, options: { bullet: true } })), { x: 0.7, y: 3.7, w: 11.6, h: 2, fontSize: 14, color: GRAY_DARK, fontFace: 'Arial', paraSpaceAfter: 8 });
    }
  }

  // Slide 3 — Sales by Category
  if (categoryRows.length > 0) {
    const s = pptx.addSlide();
    s.addText('Sales by Category', { x: 0.5, y: 0.4, w: 12, h: 0.6, fontSize: 28, color: PRIMARY, fontFace: 'Arial', bold: true });
    s.addShape('rect', { x: 0.5, y: 1.1, w: 12, h: 0.04, fill: { color: ACCENT } });

    const tableData: PptxGenJS.TableRow[] = [
      [
        { text: 'Category', options: { bold: true, color: 'FFFFFF', fill: { color: PRIMARY } } },
        { text: 'Records', options: { bold: true, color: 'FFFFFF', fill: { color: PRIMARY }, align: 'right' } },
        { text: 'Amount', options: { bold: true, color: 'FFFFFF', fill: { color: PRIMARY }, align: 'right' } },
        { text: '%', options: { bold: true, color: 'FFFFFF', fill: { color: PRIMARY }, align: 'right' } },
      ],
      ...categoryRows.map((r) => [
        { text: r.cat, options: { color: GRAY_DARK } },
        { text: r.count.toLocaleString(), options: { color: GRAY_DARK, align: 'right' as const } },
        { text: formatCurrency(r.amount), options: { color: PRIMARY, bold: true, align: 'right' as const } },
        { text: r.pct + '%', options: { color: ACCENT, align: 'right' as const } },
      ]),
    ];
    s.addTable(tableData, { x: 0.5, y: 1.4, w: 12, fontSize: 13, fontFace: 'Arial', colW: [4, 2, 4, 2], border: { type: 'solid', pt: 0.5, color: 'E5E7EB' } });
  }

  // Slide 4 — Top 10 Accounts
  if (topAccounts.length > 0) {
    const s = pptx.addSlide();
    s.addText(`Top ${topAccounts.length} Accounts`, { x: 0.5, y: 0.4, w: 12, h: 0.6, fontSize: 28, color: PRIMARY, fontFace: 'Arial', bold: true });
    s.addShape('rect', { x: 0.5, y: 1.1, w: 12, h: 0.04, fill: { color: ACCENT } });

    const tableData: PptxGenJS.TableRow[] = [
      [
        { text: '#', options: { bold: true, color: 'FFFFFF', fill: { color: PRIMARY }, align: 'center' } },
        { text: 'Account', options: { bold: true, color: 'FFFFFF', fill: { color: PRIMARY } } },
        { text: 'Amount', options: { bold: true, color: 'FFFFFF', fill: { color: PRIMARY }, align: 'right' } },
        { text: '% of Total', options: { bold: true, color: 'FFFFFF', fill: { color: PRIMARY }, align: 'right' } },
      ],
      ...topAccounts.map((r, i) => [
        { text: String(i + 1), options: { color: GRAY_LIGHT, align: 'center' as const } },
        { text: r.name, options: { color: GRAY_DARK, bold: true } },
        { text: formatCurrency(r.amount), options: { color: PRIMARY, bold: true, align: 'right' as const } },
        { text: r.pct + '%', options: { color: i === 0 ? ACCENT : GRAY_LIGHT, bold: i === 0, align: 'right' as const } },
      ]),
    ];
    s.addTable(tableData, { x: 0.5, y: 1.4, w: 12, fontSize: 13, fontFace: 'Arial', colW: [0.7, 7, 2.6, 1.7], border: { type: 'solid', pt: 0.5, color: 'E5E7EB' } });
  }

  // Slide 5 — Monthly Trend (text table for now — chart support depends on viewer)
  if (trend.length > 0) {
    const s = pptx.addSlide();
    s.addText(`Monthly Trend`, { x: 0.5, y: 0.4, w: 12, h: 0.6, fontSize: 28, color: PRIMARY, fontFace: 'Arial', bold: true });
    s.addShape('rect', { x: 0.5, y: 1.1, w: 12, h: 0.04, fill: { color: ACCENT } });

    const maxVal = Math.max(...trend.map(([, v]) => v));
    const barAreaY = 1.7;
    const barAreaH = 4.0;
    const barW = 11 / trend.length;
    trend.forEach(([m, v], i) => {
      const h = maxVal > 0 ? (v / maxVal) * barAreaH : 0;
      const x = 1 + i * barW;
      const y = barAreaY + barAreaH - h;
      s.addShape('rect', { x: x + 0.1, y, w: barW - 0.2, h, fill: { color: ACCENT } });
      s.addText(formatCompact(v), { x, y: y - 0.35, w: barW, h: 0.3, fontSize: 10, color: GRAY_DARK, fontFace: 'Arial', align: 'center' });
      s.addText(m, { x, y: barAreaY + barAreaH + 0.05, w: barW, h: 0.3, fontSize: 10, color: GRAY_LIGHT, fontFace: 'Arial', align: 'center' });
    });
    s.addText(`Total ${formatCurrency(totalAmount)} across ${trend.length} month${trend.length > 1 ? 's' : ''}`, { x: 0.5, y: 6.4, w: 12, h: 0.4, fontSize: 12, color: GRAY_LIGHT, fontFace: 'Arial', align: 'center' });
  }

  // Slide 6 — Closing
  {
    const s = pptx.addSlide();
    s.background = { color: PRIMARY };
    s.addText('Questions & Discussion', { x: 0.5, y: 2.8, w: 12, h: 1, fontSize: 40, color: 'FFFFFF', fontFace: 'Arial', bold: true, align: 'center' });
    s.addText('Pathway Intermediates USA', { x: 0.5, y: 4.0, w: 12, h: 0.5, fontSize: 16, color: 'A7F3D0', fontFace: 'Arial', align: 'center' });
  }

  // ── Stream the file back ─────────────────────────────────────────────
  const buf = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  const filename = `Sales-Meeting-${year}-${quarter}-${new Date().toISOString().split('T')[0]}.pptx`;
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
// Suppress lint: PRIMARY/RED kept for future template variants
void RED;
