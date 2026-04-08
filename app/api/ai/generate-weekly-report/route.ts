import { auth } from '@/auth';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, WidthType, BorderStyle, ShadingType, VerticalAlign,
  PageOrientation,
} from 'docx';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const SALES_CATS = ['familyb2b', 'ruminants', 'monogastrics', 'swine', 'latam'];
const CAT_LABELS: Record<string, string> = {
  familyb2b: 'Family/B2B', ruminants: 'Ruminant', monogastrics: 'Poultry', swine: 'Swine', latam: 'LATAM',
};
const TEAM_KEYS = ['poultry', 'swine', 'ruminants', 'latam', 'management'];
const TEAM_DISPLAY: Record<string, string> = {
  poultry: 'Poultry', swine: 'Swine', ruminants: 'Ruminant', latam: 'LATAM', management: 'Management',
};

// ── Cell helpers ──
const brd = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: brd, bottom: brd, left: brd, right: brd };

function cell(text: string, o: { bold?: boolean; bg?: string; color?: string; center?: boolean; width?: number; size?: number } = {}) {
  const lines = String(text || '').split('\n');
  return new TableCell({
    borders, width: { size: o.width || 1000, type: WidthType.DXA },
    shading: o.bg ? { fill: o.bg, type: ShadingType.CLEAR } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: lines.map((line, i) => new Paragraph({
      alignment: o.center ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: i < lines.length - 1 ? { after: 60 } : {},
      children: [new TextRun({ text: line, bold: o.bold || false, size: o.size || 18, color: o.color || '000000', font: 'Arial' })],
    })),
  });
}

function multiCell(lines: string[], o: { width?: number; bg?: string } = {}) {
  return new TableCell({
    borders, width: { size: o.width || 4000, type: WidthType.DXA },
    shading: o.bg ? { fill: o.bg, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: (lines.length > 0 ? lines : ['']).map((l) => new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: l, size: 18, font: 'Arial' })],
    })),
  });
}

function fmtUSD(n: number) { return n > 0 ? '$' + Math.round(n).toLocaleString('en-US') : '--'; }
function achColor(p: number) { return p >= 100 ? '0F6E56' : p >= 50 ? '854F0B' : 'A32D2D'; }

// Sanitize text for Claude API — strip non-ASCII that causes ByteString errors
function sanitize(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2022/g, '-')
    .replace(/\u00B7/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '--')
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-\x7F]/g, ' ')
    .trim();
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { teamSummaries } = await request.json();

    // ── Fetch sales + budgets from Supabase ──
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    const sb = createClient(url, key);
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

    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const curYear = now.getFullYear();

    // Last 3 months
    const months: { m: number; y: number }[] = [];
    for (let i = 2; i >= 0; i--) { let m = curMonth - i, y = curYear; if (m <= 0) { m += 12; y--; } months.push({ m, y }); }

    // ── Sales helpers ──
    const getMonthSales = (cat: string, y: number, m: number) => {
      const pfx = `${y}-${String(m).padStart(2, '0')}`;
      return records.filter((r) => r.date?.startsWith(pfx) && (cat === 'all' || r.category === cat))
        .reduce((s: number, r: { amount?: number }) => s + (Number(r.amount) || 0), 0);
    };
    const getCumSales = (cat: string, y: number) =>
      records.filter((r) => { const p = (r.date || '').split('-'); return parseInt(p[0]) === y && parseInt(p[1]) <= curMonth && (cat === 'all' || r.category === cat); })
        .reduce((s: number, r: { amount?: number }) => s + (Number(r.amount) || 0), 0);
    const getBgt = (cat: string, y: number, m: number) => {
      const f = budgets.find((b) => Number(b.year) === y && Number(b.month) === m && b.category === cat);
      return Number(f?.budget_amount) || Number(f?.budgetAmount) || 0;
    };
    const getAnnBgt = (cat: string, y: number) =>
      budgets.filter((b) => Number(b.year) === y && b.category === cat)
        .reduce((s: number, b: { budget_amount?: number }) => s + (Number(b.budget_amount) || 0), 0);

    // ── Build sales rows (Family/B2B, Ruminant, Poultry, Swine, LATAM) ──
    const salesRows = SALES_CATS.map((cat) => {
      const m1 = getMonthSales(cat, months[0].y, months[0].m);
      const m2 = getMonthSales(cat, months[1].y, months[1].m);
      const m3 = getMonthSales(cat, months[2].y, months[2].m);
      const bgt = getBgt(cat, curYear, curMonth);
      const annBgt = getAnnBgt(cat, curYear);
      const cum = getCumSales(cat, curYear);
      const ach = bgt > 0 ? Math.round((m3 / bgt) * 100) : 0;
      const cumAch = annBgt > 0 ? Math.round((cum / annBgt) * 100) : 0;
      return { label: CAT_LABELS[cat], m1, m2, m3, bgt, ach, annBgt, cum, cumAch };
    });
    const total = {
      label: 'Total',
      m1: salesRows.reduce((s, r) => s + r.m1, 0),
      m2: salesRows.reduce((s, r) => s + r.m2, 0),
      m3: salesRows.reduce((s, r) => s + r.m3, 0),
      bgt: salesRows.reduce((s, r) => s + r.bgt, 0),
      ach: 0, annBgt: salesRows.reduce((s, r) => s + r.annBgt, 0),
      cum: salesRows.reduce((s, r) => s + r.cum, 0), cumAch: 0,
    };
    total.ach = total.bgt > 0 ? Math.round((total.m3 / total.bgt) * 100) : 0;
    total.cumAch = total.annBgt > 0 ? Math.round((total.cum / total.annBgt) * 100) : 0;
    const allRows = [...salesRows, total];

    // ── AI: Focus Activities ──
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const hasAI = apiKey && !apiKey.includes('placeholder');

    let focusSummary: Record<string, string> = {
      poultry: 'Poultry:\n- Key account development and product trials\n- Lipidol Prime and EndoPower focus',
      swine: 'Swine:\n- Developing swine market opportunities',
      ruminants: 'Ruminants:\n- Dairy distribution and LP trials',
      latam: 'LATAM:\n- Mexico, Colombia, Peru distributor development',
    };

    if (hasAI) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const oppsSample = Object.values(teamSummaries || {}).flatMap((t: any) =>
          (t.opportunities || []).slice(0, 5).map((o: { name?: string; stage?: string; amount?: number }) => ({
            name: sanitize(String(o.name || '')), stage: sanitize(String(o.stage || '')), amount: o.amount,
          })),
        ).slice(0, 20);

        const focusPrompt = sanitize(`Write monthly focus points for Pathway Intermediates USA (livestock feed additives company) weekly report.\n\nOpen opportunities:\n${JSON.stringify(oppsSample)}\n\nWrite 2-3 bullet points for each team section.\nRespond ONLY with JSON (no markdown):\n{"poultry":"Poultry:\\n- bullet1\\n- bullet2","swine":"Swine:\\n- bullet1","ruminants":"Ruminants:\\n- bullet1\\n- bullet2","latam":"LATAM:\\n- bullet1\\n- bullet2"}`);

        const focusRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey!, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514', max_tokens: 600,
            messages: [{ role: 'user', content: focusPrompt }],
          }),
        });
        console.log('[REPORT] Focus AI status:', focusRes.status);
        if (!focusRes.ok) { console.error('[REPORT] Focus AI error:', await focusRes.text()); throw new Error('Focus AI failed'); }
        const focusData = await focusRes.json();
        const focusText = (focusData.content?.[0]?.text || '{}').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        focusSummary = { ...focusSummary, ...JSON.parse(focusText) };
      } catch (e) {
        console.error('[REPORT] Focus AI error:', e);
      }
    }

    // ── AI: Team Summaries ──
    const aiSummaries: Record<string, { thisWeek: string; nextWeek: string }> = {};

    for (const team of TEAM_KEYS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (teamSummaries?.[team] || { activities: [], tasks: [], opportunities: [] }) as any;
      const actCount = data.activities?.length || 0;
      const taskCount = data.tasks?.length || 0;
      const oppCount = data.opportunities?.length || 0;

      if (hasAI && (actCount > 0 || taskCount > 0)) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const actText = actCount > 0 ? (data.activities || []).slice(0, 15).map((a: any) => {
            const type = sanitize(a.type || 'Activity');
            const subject = sanitize(a.subject || '');
            const desc = sanitize(String(a.description || '')).substring(0, 200);
            const account = sanitize(a.accountName || a.account_name || a.relatedAccountName || a.related_account_name || '');
            const contact = sanitize(a.contactName || a.contact_name || a.relatedContactName || a.related_contact_name || '');
            const date = a.date ? new Date(a.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
            let line = `[${type}]`;
            if (date) line += ` ${date}`;
            line += ` - "${subject}"`;
            if (account) line += ` | Account: ${account}`;
            if (contact) line += ` | Contact: ${contact}`;
            if (desc) line += ` | Notes: ${desc}`;
            return line;
          }).join('\n') : 'No activities this period';

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const oppText = oppCount > 0 ? (data.opportunities || []).slice(0, 8).map((o: any) => {
            const name = sanitize(o.name || '');
            const account = sanitize(o.accountName || o.account_name || '');
            const stage = sanitize(o.stage || '');
            const amount = Number(o.amount || 0);
            const closeDate = sanitize(o.closeDate || o.close_date || '');
            const nextStep = sanitize(String(o.nextStep || o.next_step || '')).substring(0, 100);
            let line = `"${name}"`;
            if (account) line += ` | Account: ${account}`;
            line += ` | Stage: ${stage}`;
            if (amount > 0) line += ` | $${amount.toLocaleString()}`;
            if (closeDate) line += ` | Close: ${closeDate}`;
            if (nextStep) line += ` | Next: ${nextStep}`;
            return line;
          }).join('\n') : 'No open opportunities';

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const taskText = taskCount > 0 ? (data.tasks || []).slice(0, 8).map((t: any) => {
            const subject = sanitize(t.subject || '');
            const due = sanitize(t.dueDate || t.due_date || '');
            const account = sanitize(t.relatedAccountName || t.related_account_name || '');
            const priority = sanitize(t.priority || 'Medium');
            let line = `[${priority.toUpperCase()}] "${subject}"`;
            if (due) line += ` | Due: ${due}`;
            if (account) line += ` | Account: ${account}`;
            return line;
          }).join('\n') : 'No pending tasks';

          const teamName = TEAM_DISPLAY[team];
          const prompt = sanitize(`You are a sales manager at Pathway Intermediates USA writing the weekly report for the ${teamName} team.

Below is the ACTUAL data from our CRM. Use these specific details in your summary - mention account names, contact names, deal values, and what was discussed.

=== ACTIVITIES THIS PERIOD ===
${actText}

=== OPEN OPPORTUNITIES ===
${oppText}

=== PENDING TASKS ===
${taskText}

Write a professional weekly summary:

"thisWeek": Summarize what happened this week.
- Mention specific accounts and contacts by name
- Note what type of interaction (call/meeting/email)
- Include key outcomes or next steps discussed
- 3-5 bullet points starting with -

"nextWeek": What should the team do next week?
- Based on pending tasks and open opportunities
- Mention specific accounts and deals to follow up
- Include deal stages and amounts where relevant
- 3-5 bullet points starting with -

IMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation:
{"thisWeek":"- point1\\n- point2\\n- point3","nextWeek":"- point1\\n- point2\\n- point3"}`);

          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey!, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
          });
          console.log(`[REPORT] ${team} AI status:`, res.status);
          if (!res.ok) { console.error(`[REPORT] ${team} AI error:`, await res.text()); throw new Error(`${team} AI failed`); }
          const cData = await res.json();
          const aiParsed = JSON.parse((cData.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim());
          aiSummaries[team] = { thisWeek: aiParsed.thisWeek || '- No data', nextWeek: aiParsed.nextWeek || '- No tasks' };
        } catch (e) {
          console.error(`[REPORT] ${team} AI error:`, e);
          aiSummaries[team] = {
            thisWeek: `- ${actCount} activities logged`,
            nextWeek: `- ${taskCount} tasks pending, ${oppCount} opportunities open`,
          };
        }
      } else {
        aiSummaries[team] = {
          thisWeek: actCount > 0 ? `- ${actCount} activities logged` : '- No activities recorded',
          nextWeek: taskCount > 0 ? `- ${taskCount} tasks pending` : '- No tasks scheduled',
        };
      }
    }

    // ── Build Word Document ──
    const reportDate = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const m1Name = MONTH_NAMES[months[0].m - 1];
    const m2Name = MONTH_NAMES[months[1].m - 1];
    const m3Name = MONTH_NAMES[months[2].m - 1];

    // Sales table column widths (landscape)
    const sColW = [1200, 900, 900, 900, 1000, 900, 700, 1100, 1100, 700, 760];
    const sTotal = sColW.reduce((a, b) => a + b, 0);

    // Build sales table data rows
    const salesTableRows = allRows.map((r) => {
      const isTotal = r.label === 'Total';
      const isPoultry = r.label === 'Poultry';
      const isSwine = r.label === 'Swine';
      const bg = isTotal ? 'D6E4D0' : (isPoultry || isSwine) ? 'E6F1FB' : undefined;
      return new TableRow({
        children: [
          cell(r.label, { bold: isTotal, bg, width: sColW[0] }),
          cell(fmtUSD(r.m1), { center: true, bg, width: sColW[1] }),
          cell(fmtUSD(r.m2), { center: true, bg, width: sColW[2] }),
          cell(fmtUSD(r.m3), { center: true, bg, width: sColW[3] }),
          cell(fmtUSD(r.bgt), { center: true, bg, width: sColW[4] }),
          cell(fmtUSD(r.m3), { center: true, bg: isTotal ? 'D6E4D0' : 'E8F5E9', width: sColW[5] }),
          cell(r.ach > 0 ? r.ach + '%' : '--', { center: true, bg, width: sColW[6], color: achColor(r.ach), bold: true }),
          cell(fmtUSD(r.annBgt), { center: true, bg, width: sColW[7] }),
          cell(fmtUSD(r.cum), { center: true, bg, width: sColW[8] }),
          cell(r.cumAch > 0 ? r.cumAch + '%' : '--', { center: true, bg, width: sColW[9], color: achColor(r.cumAch), bold: true }),
          cell('', { bg, width: sColW[10] }),
        ],
      });
    });

    // Activity table column widths (landscape)
    const actColW = [1800, 5500, 5500];
    const actTotal = actColW.reduce((a, b) => a + b, 0);

    // Activity table rows: Poultry, Swine, Ruminant, LATAM, Marketing, HR, Others, Travel
    const activityTeamRows = [
      { key: 'poultry', label: 'Poultry', bg: 'E6F1FB' },
      { key: 'swine', label: 'Swine', bg: 'E6F1FB' },
      { key: 'ruminants', label: 'Ruminant', bg: 'E1F5EE' },
      { key: 'latam', label: 'LATAM', bg: 'FAEEDA' },
      { key: 'marketing', label: 'Marketing\n(Tech & R&D)', bg: 'F1EFE8' },
      { key: 'hr', label: 'HR', bg: 'F1EFE8' },
      { key: 'others', label: 'Others', bg: 'F1EFE8' },
      { key: 'travel', label: 'Travel', bg: 'F1EFE8' },
    ];

    const activityTableRows = activityTeamRows.map((t) => {
      const summary = aiSummaries[t.key] || {};
      return new TableRow({
        children: [
          cell(t.label, { bold: true, bg: t.bg, width: actColW[0] }),
          multiCell((summary.thisWeek || '').split('\n').filter(Boolean), { width: actColW[1] }),
          multiCell((summary.nextWeek || '').split('\n').filter(Boolean), { width: actColW[2] }),
        ],
      });
    });

    // Focus content paragraphs
    const focusParagraphs: Paragraph[] = [];
    for (const key of ['poultry', 'swine', 'ruminants', 'latam']) {
      const text = focusSummary[key] || '';
      text.split('\n').filter(Boolean).forEach((line) => {
        const isHeader = /^(Poultry|Swine|Ruminants|LATAM):/.test(line);
        focusParagraphs.push(new Paragraph({
          spacing: { after: isHeader ? 40 : 60 },
          children: [new TextRun({ text: line, size: 18, font: 'Arial', bold: isHeader })],
        }));
      });
      // Add spacing between sections
      focusParagraphs.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
    }

    const doc = new Document({
      styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
      sections: [{
        properties: {
          page: {
            size: { width: 15840, height: 12240, orientation: PageOrientation.LANDSCAPE },
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        children: [
          // ── Title ──
          new Paragraph({
            alignment: AlignmentType.CENTER, spacing: { after: 160 },
            children: [new TextRun({ text: 'Pathway Intermediates USA - Weekly Report', bold: true, size: 36, font: 'Arial', color: '1a4731' })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER, spacing: { after: 320 },
            children: [new TextRun({ text: reportDate, size: 20, font: 'Arial', color: '888888' })],
          }),

          // ── Section 1: Focus Activities ──
          new Table({
            width: { size: 14400, type: WidthType.DXA },
            rows: [
              new TableRow({
                children: [new TableCell({
                  borders, width: { size: 14400, type: WidthType.DXA },
                  shading: { fill: '1a4731', type: ShadingType.CLEAR },
                  margins: { top: 100, bottom: 100, left: 160, right: 160 },
                  children: [new Paragraph({
                    children: [new TextRun({ text: "This Month's Focus Activities, Goals and Sales Performance", bold: true, size: 22, font: 'Arial', color: 'FFFFFF' })],
                  })],
                })],
              }),
              new TableRow({
                children: [new TableCell({
                  borders, width: { size: 14400, type: WidthType.DXA },
                  shading: { fill: 'F0F7EE', type: ShadingType.CLEAR },
                  margins: { top: 120, bottom: 120, left: 200, right: 200 },
                  children: focusParagraphs,
                })],
              }),
            ],
          }),

          new Paragraph({ spacing: { before: 200, after: 100 }, children: [] }),

          // ── Section 2: Sales Performance ──
          new Paragraph({
            spacing: { before: 100, after: 120 },
            children: [new TextRun({ text: 'Sales Performance', bold: true, size: 24, font: 'Arial', color: '1a4731' })],
          }),
          new Table({
            width: { size: sTotal, type: WidthType.DXA },
            rows: [
              // Header
              new TableRow({
                tableHeader: true,
                children: [
                  cell('(USD)', { bold: true, bg: '1a4731', color: 'FFFFFF', width: sColW[0] }),
                  cell(m1Name, { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[1] }),
                  cell(m2Name, { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[2] }),
                  cell(m3Name, { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[3] }),
                  cell('Budget\nin ' + m3Name, { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[4] }),
                  cell('Monthly\nActual', { bold: true, bg: '2d6a4f', color: 'FFFFFF', center: true, width: sColW[5] }),
                  cell('Ach%', { bold: true, bg: '2d6a4f', color: 'FFFFFF', center: true, width: sColW[6] }),
                  cell('Annual\nBudget', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[7] }),
                  cell('Cumulative', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[8] }),
                  cell('Cum%', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[9] }),
                  cell('Remark', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[10] }),
                ],
              }),
              ...salesTableRows,
            ],
          }),

          new Paragraph({ spacing: { before: 200, after: 100 }, children: [] }),

          // ── Section 3: Team Activities ──
          new Paragraph({
            spacing: { before: 100, after: 120 },
            children: [new TextRun({ text: 'Team Weekly Activities Summary', bold: true, size: 24, font: 'Arial', color: '1a4731' })],
          }),
          new Table({
            width: { size: actTotal, type: WidthType.DXA },
            rows: [
              new TableRow({
                tableHeader: true,
                children: [
                  cell('Activities', { bold: true, bg: '1a4731', color: 'FFFFFF', width: actColW[0] }),
                  cell('This week', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: actColW[1] }),
                  cell('Next week', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: actColW[2] }),
                ],
              }),
              ...activityTableRows,
            ],
          }),

          new Paragraph({ spacing: { before: 120 }, children: [] }),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    return new Response(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="PI_USA_Weekly_Report_${now.toISOString().split('T')[0]}.docx"`,
      },
    });
  } catch (err) {
    console.error('[REPORT] Error:', err);
    return Response.json({ error: 'Failed to generate report' }, { status: 500 });
  }
}
