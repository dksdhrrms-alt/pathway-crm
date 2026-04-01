import { auth } from '@/auth';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, AlignmentType, WidthType, BorderStyle, ShadingType, VerticalAlign } from 'docx';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const CATEGORIES = ['monogastrics', 'ruminants', 'latam', 'familyb2b'];
const CAT_LABELS: Record<string, string> = { monogastrics: 'Poultry', ruminants: 'Ruminant', latam: 'LATAM', familyb2b: 'Family/B2B' };
const TEAM_LABELS: Record<string, string> = { monogastrics: 'Monogastric', ruminants: 'Ruminant', latam: 'LATAM', management: 'Management' };

const brd = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: brd, bottom: brd, left: brd, right: brd };

function c(text: string, o: { bold?: boolean; bg?: string; color?: string; center?: boolean; width?: number } = {}) {
  return new TableCell({ borders, width: { size: o.width || 1000, type: WidthType.DXA },
    shading: o.bg ? { fill: o.bg, type: ShadingType.CLEAR } : undefined,
    verticalAlign: VerticalAlign.CENTER, margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ alignment: o.center ? AlignmentType.CENTER : AlignmentType.LEFT,
      children: [new TextRun({ text: String(text), bold: o.bold || false, size: 18, color: o.color || '000000', font: 'Arial' })] })] });
}

function mc(lines: string[], o: { width?: number; bg?: string } = {}) {
  return new TableCell({ borders, width: { size: o.width || 4000, type: WidthType.DXA },
    shading: o.bg ? { fill: o.bg, type: ShadingType.CLEAR } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: lines.map((l) => new Paragraph({ children: [new TextRun({ text: l, size: 18, font: 'Arial' })] })) });
}

function fmtUSD(n: number) { return n > 0 ? '$' + Math.round(n).toLocaleString('en-US') : '—'; }
function achCol(p: number) { return p >= 80 ? '0F6E56' : p >= 50 ? '854F0B' : 'A32D2D'; }

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Get pre-computed teamSummaries from client
    const { teamSummaries } = await request.json();

    // Fetch ONLY sales data from Supabase (needs batching for >1000 rows)
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');
    const [sb1, sb2, sb3, budRes] = await Promise.all([
      sb.from('sale_records').select('*').range(0, 999),
      sb.from('sale_records').select('*').range(1000, 1999),
      sb.from('sale_records').select('*').range(2000, 2999),
      sb.from('sales_budgets').select('*').range(0, 999),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const records = [...(sb1.data || []), ...(sb2.data || []), ...(sb3.data || [])] as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const budgets = (budRes.data || []) as any[];

    console.log(`[REPORT] Sales: ${records.length} records, ${budgets.length} budgets`);
    Object.entries(teamSummaries || {}).forEach(([t, d]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = d as any;
      console.log(`[REPORT] Team ${t}: acts=${data.activities?.length || 0} tasks=${data.tasks?.length || 0} opps=${data.opportunities?.length || 0}`);
    });

    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const curYear = now.getFullYear();

    // Last 3 months
    const months: { m: number; y: number }[] = [];
    for (let i = 2; i >= 0; i--) { let m = curMonth - i, y = curYear; if (m <= 0) { m += 12; y--; } months.push({ m, y }); }

    // Sales helpers
    const getMonthSales = (cat: string, y: number, m: number) => {
      const pfx = `${y}-${String(m).padStart(2, '0')}`;
      return records.filter((r) => r.date?.startsWith(pfx) && (cat === 'all' || r.category === cat)).reduce((s: number, r: { amount?: number }) => s + (Number(r.amount) || 0), 0);
    };
    const getCumSales = (cat: string, y: number) => records.filter((r) => { const p = (r.date || '').split('-'); return parseInt(p[0]) === y && parseInt(p[1]) <= curMonth && (cat === 'all' || r.category === cat); }).reduce((s: number, r: { amount?: number }) => s + (Number(r.amount) || 0), 0);
    const getBgt = (cat: string, y: number, m: number) => { const f = budgets.find((b) => Number(b.year) === y && Number(b.month) === m && b.category === cat); return Number(f?.budget_amount) || Number(f?.budgetAmount) || 0; };
    const getAnnBgt = (cat: string, y: number) => budgets.filter((b) => Number(b.year) === y && b.category === cat).reduce((s: number, b: { budget_amount?: number }) => s + (Number(b.budget_amount) || 0), 0);

    // Build sales table
    const salesRows = CATEGORIES.map((cat) => {
      const m1 = getMonthSales(cat, months[0].y, months[0].m), m2 = getMonthSales(cat, months[1].y, months[1].m), m3 = getMonthSales(cat, months[2].y, months[2].m);
      const bgt = getBgt(cat, curYear, curMonth), annBgt = getAnnBgt(cat, curYear), cum = getCumSales(cat, curYear);
      const ach = bgt > 0 ? Math.round((m3 / bgt) * 100) : 0, cumAch = annBgt > 0 ? Math.round((cum / annBgt) * 100) : 0;
      return { label: CAT_LABELS[cat], m1, m2, m3, bgt, ach, annBgt, cum, cumAch };
    });
    const total = { label: 'Total', m1: salesRows.reduce((s, r) => s + r.m1, 0), m2: salesRows.reduce((s, r) => s + r.m2, 0), m3: salesRows.reduce((s, r) => s + r.m3, 0), bgt: salesRows.reduce((s, r) => s + r.bgt, 0), ach: 0, annBgt: salesRows.reduce((s, r) => s + r.annBgt, 0), cum: salesRows.reduce((s, r) => s + r.cum, 0), cumAch: 0 };
    total.ach = total.bgt > 0 ? Math.round((total.m3 / total.bgt) * 100) : 0;
    total.cumAch = total.annBgt > 0 ? Math.round((total.cum / total.annBgt) * 100) : 0;
    const allRows = [...salesRows, total];

    // AI Summaries using pre-computed team data from client
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const hasAI = apiKey && !apiKey.includes('placeholder');
    const aiSummaries: Record<string, { thisWeek: string; nextWeek: string }> = {};

    for (const team of ['monogastrics', 'ruminants', 'latam', 'management']) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (teamSummaries?.[team] || { activities: [], tasks: [], opportunities: [] }) as any;
      const actCount = data.activities?.length || 0;
      const taskCount = data.tasks?.length || 0;
      const oppCount = data.opportunities?.length || 0;

      if (hasAI && (actCount > 0 || taskCount > 0)) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const actText = (data.activities || []).slice(0, 15).map((a: any) => `- [${a.type || 'Note'}] ${a.subject || ''}`).join('\n') || 'None';
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const oppText = (data.opportunities || []).slice(0, 8).map((o: any) => `- ${o.name || ''} $${Number(o.amount) || 0} ${o.stage || ''}`).join('\n') || 'None';
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const taskText = (data.tasks || []).slice(0, 8).map((t: any) => `- ${t.subject || ''} due ${t.dueDate || ''}`).join('\n') || 'None';

          const prompt = `Summarize CRM data for Pathway Intermediates USA, ${TEAM_LABELS[team]} team.\nActivities:\n${actText}\nOpportunities:\n${oppText}\nTasks:\n${taskText}\nReply ONLY JSON: {"thisWeek":"• pt1\\n• pt2","nextWeek":"• pt1\\n• pt2"} (3-5 bullets, under 15 words each)`;

          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey!, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
          });
          const cData = await res.json();
          const parsed = JSON.parse((cData.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim());
          aiSummaries[team] = { thisWeek: parsed.thisWeek || '• No data', nextWeek: parsed.nextWeek || '• No tasks' };
        } catch {
          aiSummaries[team] = { thisWeek: `• ${actCount} activities logged`, nextWeek: `• ${taskCount} tasks pending, ${oppCount} opportunities open` };
        }
      } else {
        aiSummaries[team] = { thisWeek: actCount > 0 ? `• ${actCount} activities logged` : '• No activities recorded', nextWeek: taskCount > 0 ? `• ${taskCount} tasks pending` : '• No tasks scheduled' };
      }
    }

    // Build Word document
    const colW = [1200, 900, 900, 900, 900, 900, 700, 1000, 1000, 800];
    const reportDate = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const doc = new Document({
      sections: [{ properties: { page: { size: { width: 15840, height: 12240 }, margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: 'Pathway Intermediates USA — Weekly Report', bold: true, size: 32, font: 'Arial', color: '1a4731' })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [new TextRun({ text: reportDate, size: 22, font: 'Arial', color: '666666' })] }),
          new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: 'Sales Performance', bold: true, size: 24, font: 'Arial', color: '1a4731' })] }),
          new Table({ width: { size: colW.reduce((a, b) => a + b, 0), type: WidthType.DXA }, rows: [
            new TableRow({ children: [
              c('(USD)', { bold: true, bg: '1a4731', color: 'FFFFFF', width: colW[0] }),
              c(MONTH_NAMES[months[0].m - 1], { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: colW[1] }),
              c(MONTH_NAMES[months[1].m - 1], { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: colW[2] }),
              c(MONTH_NAMES[months[2].m - 1], { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: colW[3] }),
              c('Budget', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: colW[4] }),
              c('Actual', { bold: true, bg: '2d6a4f', color: 'FFFFFF', center: true, width: colW[5] }),
              c('Ach%', { bold: true, bg: '2d6a4f', color: 'FFFFFF', center: true, width: colW[6] }),
              c('Ann.Budget', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: colW[7] }),
              c('Cumulative', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: colW[8] }),
              c('Cum%', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: colW[9] }),
            ] }),
            ...allRows.map((r) => { const isT = r.label === 'Total'; const bg = isT ? 'D6E4D0' : undefined; return new TableRow({ children: [
              c(r.label, { bold: isT, bg, width: colW[0] }), c(fmtUSD(r.m1), { center: true, bg, width: colW[1] }), c(fmtUSD(r.m2), { center: true, bg, width: colW[2] }),
              c(fmtUSD(r.m3), { center: true, bg, width: colW[3] }), c(fmtUSD(r.bgt), { center: true, bg, width: colW[4] }),
              c(fmtUSD(r.m3), { center: true, bg: isT ? 'D6E4D0' : 'E8F5E9', width: colW[5] }),
              c(r.ach > 0 ? r.ach + '%' : '—', { center: true, bg, width: colW[6], color: achCol(r.ach), bold: true }),
              c(fmtUSD(r.annBgt), { center: true, bg, width: colW[7] }), c(fmtUSD(r.cum), { center: true, bg, width: colW[8] }),
              c(r.cumAch > 0 ? r.cumAch + '%' : '—', { center: true, bg, width: colW[9], color: achCol(r.cumAch), bold: true }),
            ] }); }),
          ] }),
          new Paragraph({ spacing: { before: 400, after: 160 }, children: [new TextRun({ text: 'Team Weekly Activities (AI Summary)', bold: true, size: 24, font: 'Arial', color: '1a4731' })] }),
          new Table({ width: { size: 9600, type: WidthType.DXA }, rows: [
            new TableRow({ children: [c('Team', { bold: true, bg: '1a4731', color: 'FFFFFF', width: 2200 }), c('This Week', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: 3700 }), c('Next Week', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: 3700 })] }),
            ...['monogastrics', 'ruminants', 'latam', 'management'].map((t) => new TableRow({ children: [
              c(TEAM_LABELS[t], { bold: true, width: 2200, bg: 'F0F7EE' }),
              mc((aiSummaries[t]?.thisWeek || '').split('\n').filter(Boolean), { width: 3700 }),
              mc((aiSummaries[t]?.nextWeek || '').split('\n').filter(Boolean), { width: 3700 }),
            ] })),
          ] }),
        ] }],
    });

    const buffer = await Packer.toBuffer(doc);
    return new Response(buffer as unknown as BodyInit, {
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="PI_USA_Weekly_Report_${now.toISOString().split('T')[0]}.docx"` },
    });
  } catch (err) {
    console.error('[REPORT] Error:', err);
    return Response.json({ error: 'Failed to generate report' }, { status: 500 });
  }
}
