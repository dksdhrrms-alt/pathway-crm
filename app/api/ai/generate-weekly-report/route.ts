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
const TEAM_KEYS = ['poultry', 'swine', 'ruminants', 'latam', 'marketing', 'management'];
const TEAM_DISPLAY: Record<string, string> = {
  poultry: 'Poultry', swine: 'Swine', ruminants: 'Ruminant', latam: 'LATAM',
  marketing: 'Marketing (Tech & R&D)', management: 'Management',
};

// ── Cell helpers ──
const brd = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: brd, bottom: brd, left: brd, right: brd };

function cell(text: string, o: { bold?: boolean; bg?: string; color?: string; center?: boolean; width?: number; size?: number; header?: boolean } = {}) {
  const lines = String(text || '--').split('\n').filter(Boolean);
  const fontSize = o.size || (o.header ? 14 : 13);
  return new TableCell({
    borders, width: { size: o.width || 1000, type: WidthType.DXA },
    shading: o.bg ? { fill: o.bg, type: ShadingType.CLEAR } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    children: lines.length === 0
      ? [new Paragraph({ children: [new TextRun({ text: '--', size: fontSize, font: 'Arial' })] })]
      : lines.map((line, i) => new Paragraph({
          alignment: o.center ? AlignmentType.CENTER : AlignmentType.LEFT,
          spacing: { before: 0, after: i < lines.length - 1 ? 40 : 0 },
          children: [new TextRun({ text: String(line || ''), bold: o.bold || false, size: fontSize, color: o.color || '000000', font: 'Arial' })],
        })),
  });
}

function activityCell(text: string, o: { width?: number; bg?: string } = {}) {
  const lines = String(text || '').split('\n').filter((l) => l.trim());
  if (lines.length === 0) lines.push('No activities recorded');
  return new TableCell({
    borders, width: { size: o.width || 6200, type: WidthType.DXA },
    shading: o.bg ? { fill: o.bg, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: lines.map((l, i) => new Paragraph({
      spacing: { before: 0, after: i < lines.length - 1 ? 60 : 0 },
      children: [new TextRun({ text: l.trim(), size: 15, font: 'Arial' })],
    })),
  });
}

function teamCell(text: string, o: { width?: number; bg?: string; color?: string } = {}) {
  const lines = text.split('\n');
  return new TableCell({
    borders, width: { size: o.width || 2000, type: WidthType.DXA },
    shading: o.bg ? { fill: o.bg, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    verticalAlign: VerticalAlign.CENTER,
    children: lines.map((line) => new Paragraph({
      children: [new TextRun({ text: line, bold: true, size: 16, font: 'Arial', color: o.color || '000000' })],
    })),
  });
}

function fmtCompact(n: number) {
  if (!n || n === 0) return '--';
  return '$' + Math.round(n).toLocaleString('en-US');
}
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateMonogastricReport(
  records: any[], budgets: any[], teamSummaries: any,
  now: Date, months: { m: number; y: number }[], curMonth: number, curYear: number,
) {
  const m1 = months[0], m2 = months[1], m3 = months[2];

  // Fetch account budgets from Supabase
  const sbUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const sbKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let acctBudgets: any[] = [];
  try {
    const abSb = createClient(sbUrl, sbKey);
    const { data } = await abSb.from('account_budgets').select('*').eq('year', curYear);
    acctBudgets = data || [];
  } catch { /* table might not exist */ }

  // Initialize accounts from budget table first (ensures all budget accounts appear)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const monoBudgetAccts = acctBudgets.filter((b: any) => b.category === 'monogastrics' || b.category === 'swine');
  const byAccount: Record<string, { name: string; prev: number; v1: number; v2: number; v3: number; cum: number; bgt: number; annBgt: number }> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [...new Set(monoBudgetAccts.map((b: any) => b.account_name || b.accountName).filter(Boolean))].forEach((acct: string) => {
    byAccount[acct] = { name: acct, prev: 0, v1: 0, v2: 0, v3: 0, cum: 0, bgt: 0, annBgt: 0 };
  });

  // Fill in sales data (monogastrics + swine)
  const monoRecords = records.filter((r: { category?: string }) => r.category === 'monogastrics' || r.category === 'swine');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  monoRecords.forEach((r: any) => {
    const acct = r.account_name || r.accountName || 'Unknown';
    if (!byAccount[acct]) byAccount[acct] = { name: acct, prev: 0, v1: 0, v2: 0, v3: 0, cum: 0, bgt: 0, annBgt: 0 };
    const d = String(r.date || ''); const yr = parseInt(d.split('-')[0]); const mo = parseInt(d.split('-')[1]);
    const amt = Number(r.amount) || 0;
    if (yr === curYear - 1) byAccount[acct].prev += amt;
    if (yr === m1.y && mo === m1.m) byAccount[acct].v1 += amt;
    if (yr === m2.y && mo === m2.m) byAccount[acct].v2 += amt;
    if (yr === m3.y && mo === m3.m) byAccount[acct].v3 += amt;
    if (yr === curYear && mo <= curMonth) byAccount[acct].cum += amt;
  });
  // Apply account-level budgets
  Object.values(byAccount).forEach((a) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const monthBgt = acctBudgets.find((b: any) => (b.account_name || b.accountName) === a.name && Number(b.month) === curMonth);
    a.bgt = Number(monthBgt?.budget_amount || monthBgt?.budgetAmount) || 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    a.annBgt = acctBudgets.filter((b: any) => (b.account_name || b.accountName) === a.name).reduce((s: number, b: { budget_amount?: number }) => s + (Number(b.budget_amount) || 0), 0);
  });
  // Include accounts with budget OR sales, sort by budget first then revenue
  const acctList = Object.values(byAccount)
    .filter((a) => a.prev + a.v1 + a.v2 + a.v3 + a.annBgt > 0)
    .sort((a, b) => { if (b.annBgt !== a.annBgt) return b.annBgt - a.annBgt; return (b.cum || b.prev) - (a.cum || a.prev); });
  const totBudget = acctList.reduce((s, a) => s + a.bgt, 0) || budgets.filter((b: { year?: number; month?: number; category?: string }) => Number(b.year) === curYear && Number(b.month) === curMonth && (b.category === 'monogastrics' || b.category === 'swine')).reduce((s: number, b: { budget_amount?: number }) => s + (Number(b.budget_amount) || 0), 0);
  const annBudget = acctList.reduce((s, a) => s + a.annBgt, 0) || budgets.filter((b: { year?: number; category?: string }) => Number(b.year) === curYear && (b.category === 'monogastrics' || b.category === 'swine')).reduce((s: number, b: { budget_amount?: number }) => s + (Number(b.budget_amount) || 0), 0);
  const teamTotal = { prev: acctList.reduce((s, a) => s + a.prev, 0), v1: acctList.reduce((s, a) => s + a.v1, 0), v2: acctList.reduce((s, a) => s + a.v2, 0), v3: acctList.reduce((s, a) => s + a.v3, 0), cum: acctList.reduce((s, a) => s + a.cum, 0) };

  // AI summaries for poultry + swine
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const hasAI = apiKey && !apiKey.includes('placeholder');
  const aiSummaries: Record<string, { thisWeek: string; nextWeek: string }> = {};

  for (const team of ['poultry', 'swine', 'b2bDistribution']) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (teamSummaries?.[team] || { activities: [], tasks: [], opportunities: [] }) as any;
    const actCount = data.activities?.length || 0;
    const taskCount = data.tasks?.length || 0;
    if (hasAI && (actCount > 0 || taskCount > 0)) {
      try {
        // Structured format: User | Account | Contact | Content | Type | Date
        // Empty fields are omitted entirely (no "—" filler).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const actText = (data.activities || []).map((a: any) => {
          const parts = [
            a.ownerName || a.ownerId,
            a.accountName,
            a.contactName,
            a.subject,
            a.type || 'Note',
            (a.date || '').slice(5).replace('-', '/'),
          ].filter((p) => p && String(p).trim()).map((p) => sanitize(String(p)));
          return `- ${parts.join(' | ')}`;
        }).join('\n') || 'None';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const taskText = (data.tasks || []).map((t: any) => {
          const parts = [
            t.ownerName || t.ownerId,
            t.accountName,
            t.subject,
            t.dueDate ? `Due ${(t.dueDate || '').slice(5).replace('-', '/')}` : '',
          ].filter((p) => p && String(p).trim()).map((p) => sanitize(String(p)));
          return `- ${parts.join(' | ')}`;
        }).join('\n') || 'None';
        const teamLabel = team === 'poultry' ? 'Poultry' : team === 'swine' ? 'Swine' : 'B2B Distribution (distributor accounts)';
        const prompt = sanitize(`Write ${teamLabel} team weekly summary for Pathway Intermediates USA.\nActivities:\n${actText}\nTasks:\n${taskText}\nRules:\n- thisWeek: copy EACH activity verbatim as its own bullet, preserving the pipe-separated format. Do NOT add "Logged by" — the user is already the first column. Do NOT consolidate. If a field is missing, simply skip it (do NOT insert "—" or placeholder).\n- nextWeek: copy EACH task verbatim as its own bullet, same rules.\nRespond ONLY JSON: {"thisWeek":"- bullet1\\n- bullet2\\n...","nextWeek":"- bullet1\\n- bullet2\\n..."}`);
        const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey!, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }) });
        if (res.ok) { const d = await res.json(); const p = JSON.parse((d.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim()); aiSummaries[team] = { thisWeek: p.thisWeek || '- No data', nextWeek: p.nextWeek || '- No tasks' }; }
        else { aiSummaries[team] = { thisWeek: `- ${actCount} activities logged`, nextWeek: `- ${taskCount} tasks pending` }; }
      } catch { aiSummaries[team] = { thisWeek: `- ${actCount} activities logged`, nextWeek: `- ${taskCount} tasks pending` }; }
    } else { aiSummaries[team] = { thisWeek: actCount > 0 ? `- ${actCount} activities logged` : '- No activities', nextWeek: taskCount > 0 ? `- ${taskCount} tasks pending` : '- No tasks' }; }
  }

  // Build Word document
  const reportDate = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const mn = MONTH_NAMES;
  const sColW = [1500, 1100, 900, 900, 1050, 1000, 650, 1150, 1150, 650, 810]; // sum ~10860
  const sTotal = sColW.reduce((a, b) => a + b, 0);
  const actColW = [1500, 5730, 5730]; // sum = 12960

  // Account rows
  const acctRows = acctList.map((a) => {
    const ach = a.bgt > 0 ? Math.round((a.v3 / a.bgt) * 100) : 0;
    const cumAch = a.annBgt > 0 ? Math.round((a.cum / a.annBgt) * 100) : 0;
    return new TableRow({
      height: { value: 340, rule: 'atLeast' as const },
      children: [
        cell(a.name, { width: sColW[0] }),
        cell(fmtCompact(a.prev), { center: true, width: sColW[1] }),
        cell(fmtCompact(a.v1), { center: true, width: sColW[2] }),
        cell(fmtCompact(a.v2), { center: true, width: sColW[3] }),
        cell(fmtCompact(a.bgt), { center: true, width: sColW[4] }),
        cell(fmtCompact(a.v3), { center: true, bg: 'E8F5E9', width: sColW[5] }),
        cell(ach > 0 ? ach + '%' : '--', { center: true, bold: true, color: achColor(ach), width: sColW[6] }),
        cell(fmtCompact(a.annBgt), { center: true, width: sColW[7] }),
        cell(fmtCompact(a.cum), { center: true, width: sColW[8] }),
        cell(cumAch > 0 ? cumAch + '%' : '--', { center: true, bold: true, color: achColor(cumAch), width: sColW[9] }),
        cell('', { width: sColW[10] }),
      ],
    });
  });

  const ttAch = totBudget > 0 ? Math.round((teamTotal.v3 / totBudget) * 100) : 0;
  const ttCumAch = annBudget > 0 ? Math.round((teamTotal.cum / annBudget) * 100) : 0;

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.LANDSCAPE, width: 12240, height: 15840 }, margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
      children: [
        // Title
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: 'Pathway Intermediates USA - Monogastric Weekly Report', bold: true, size: 32, font: 'Arial', color: '1a4731' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 280 }, children: [new TextRun({ text: reportDate, size: 20, font: 'Arial', color: '888888' })] }),

        // Focus Activities box (2 columns)
        new Table({ width: { size: 13680, type: WidthType.DXA }, rows: [
          new TableRow({ children: [new TableCell({ borders, columnSpan: 2, width: { size: 13680, type: WidthType.DXA }, shading: { fill: '1a4731', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 160, right: 160 }, children: [new Paragraph({ children: [new TextRun({ text: "This Month's Focus Activities, Goals and Sales Performance", bold: true, size: 20, font: 'Arial', color: 'FFFFFF' })] })] })] }),
          new TableRow({ children: [
            new TableCell({ borders, width: { size: 6840, type: WidthType.DXA }, shading: { fill: 'F0F7EE', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 140, right: 140 }, children: [
              new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Poultry: Key account development', size: 17, font: 'Arial', bold: true })] }),
              new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Swine: Market expansion activities', size: 17, font: 'Arial', bold: true })] }),
            ] }),
            new TableCell({ borders, width: { size: 6840, type: WidthType.DXA }, shading: { fill: 'F0F7EE', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 140, right: 140 }, children: [
              new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'B2B (Distribution): Channel updates', size: 17, font: 'Arial', bold: true })] }),
              new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Other: Team updates', size: 17, font: 'Arial', bold: true })] }),
            ] }),
          ] }),
        ] }),
        new Paragraph({ spacing: { before: 200, after: 100 }, children: [] }),

        // Sales by Account
        new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'Sales Performance - Monogastric Team', bold: true, size: 22, font: 'Arial', color: '1a4731' })] }),
        new Table({ width: { size: sTotal, type: WidthType.DXA }, rows: [
          new TableRow({ tableHeader: true, children: [
            cell('Account', { bold: true, bg: '1a4731', color: 'FFFFFF', width: sColW[0], header: true }),
            cell(`${curYear - 1}\nRevenue`, { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[1], header: true }),
            cell(mn[m1.m - 1], { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[2], header: true }),
            cell(mn[m2.m - 1], { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[3], header: true }),
            cell(`Budget\nin ${mn[m3.m - 1]}`, { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[4], header: true }),
            cell('Monthly\nActual', { bold: true, bg: '2d6a4f', color: 'FFFFFF', center: true, width: sColW[5], header: true }),
            cell('Ach%', { bold: true, bg: '2d6a4f', color: 'FFFFFF', center: true, width: sColW[6], header: true }),
            cell('Annual\nBudget', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[7], header: true }),
            cell('Cumulative', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[8], header: true }),
            cell('Cum%', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[9], header: true }),
            cell('Remark', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[10], header: true }),
          ] }),
          ...acctRows,
          // Team total row
          new TableRow({ children: [
            cell('Poultry Team:', { bold: true, bg: 'D6E4D0', width: sColW[0] }),
            cell(fmtCompact(teamTotal.prev), { center: true, bold: true, bg: 'D6E4D0', width: sColW[1] }),
            cell(fmtCompact(teamTotal.v1), { center: true, bold: true, bg: 'D6E4D0', width: sColW[2] }),
            cell(fmtCompact(teamTotal.v2), { center: true, bold: true, bg: 'D6E4D0', width: sColW[3] }),
            cell(fmtCompact(totBudget), { center: true, bold: true, bg: 'D6E4D0', width: sColW[4] }),
            cell(fmtCompact(teamTotal.v3), { center: true, bold: true, bg: 'D6E4D0', width: sColW[5] }),
            cell(ttAch > 0 ? ttAch + '%' : '--', { center: true, bold: true, bg: 'D6E4D0', color: achColor(ttAch), width: sColW[6] }),
            cell(fmtCompact(annBudget), { center: true, bold: true, bg: 'D6E4D0', width: sColW[7] }),
            cell(fmtCompact(teamTotal.cum), { center: true, bold: true, bg: 'D6E4D0', width: sColW[8] }),
            cell(ttCumAch > 0 ? ttCumAch + '%' : '--', { center: true, bold: true, bg: 'D6E4D0', color: achColor(ttCumAch), width: sColW[9] }),
            cell('', { bg: 'D6E4D0', width: sColW[10] }),
          ] }),
        ] }),
        new Paragraph({ spacing: { before: 240, after: 120 }, children: [] }),

        // Team Activities
        new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'Team Weekly Activities', bold: true, size: 22, font: 'Arial', color: '1a4731' })] }),
        new Table({ width: { size: actColW.reduce((a, b) => a + b, 0), type: WidthType.DXA }, rows: [
          new TableRow({ tableHeader: true, children: [
            cell('Activities', { bold: true, bg: '1a4731', color: 'FFFFFF', width: actColW[0], header: true }),
            cell('This week', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: actColW[1], header: true }),
            cell('Next week', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: actColW[2], header: true }),
          ] }),
          new TableRow({ height: { value: 600, rule: 'atLeast' as const }, children: [
            teamCell('Poultry', { bg: 'E6F1FB', width: actColW[0], color: '185FA5' }),
            activityCell(aiSummaries.poultry?.thisWeek || '', { width: actColW[1] }),
            activityCell(aiSummaries.poultry?.nextWeek || '', { width: actColW[2] }),
          ] }),
          new TableRow({ height: { value: 600, rule: 'atLeast' as const }, children: [
            teamCell('Swine', { bg: 'E6F1FB', width: actColW[0], color: '185FA5' }),
            activityCell(aiSummaries.swine?.thisWeek || '', { width: actColW[1] }),
            activityCell(aiSummaries.swine?.nextWeek || '', { width: actColW[2] }),
          ] }),
          new TableRow({ height: { value: 400, rule: 'atLeast' as const }, children: [
            teamCell('(B2B)\nDistribution', { bg: 'EEEDFE', width: actColW[0], color: '534AB7' }),
            activityCell(aiSummaries.b2bDistribution?.thisWeek || '', { width: actColW[1] }),
            activityCell(aiSummaries.b2bDistribution?.nextWeek || '', { width: actColW[2] }),
          ] }),
        ] }),
        new Paragraph({ spacing: { before: 200, after: 120 }, children: [] }),

        // Additional Activities
        new Table({ width: { size: actColW.reduce((a, b) => a + b, 0), type: WidthType.DXA }, rows: [
          new TableRow({ tableHeader: true, children: [
            cell('Activities', { bold: true, bg: '1a4731', color: 'FFFFFF', width: actColW[0], header: true }),
            cell('This week', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: actColW[1], header: true }),
            cell('Next week', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: actColW[2], header: true }),
          ] }),
          new TableRow({ children: [teamCell('Trials', { bg: 'FAEEDA', width: actColW[0], color: '854F0B' }), activityCell('', { width: actColW[1] }), activityCell('', { width: actColW[2] })] }),
          new TableRow({ children: [teamCell('Travel', { bg: 'F1EFE8', width: actColW[0], color: '5F5E5A' }), activityCell('', { width: actColW[1] }), activityCell('', { width: actColW[2] })] }),
          new TableRow({ children: [teamCell('Other', { bg: 'F1EFE8', width: actColW[0], color: '5F5E5A' }), activityCell('', { width: actColW[1] }), activityCell('', { width: actColW[2] })] }),
        ] }),
        new Paragraph({ spacing: { before: 120 }, children: [] }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Response(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="PI_Monogastric_Report_${now.toISOString().split('T')[0]}.docx"`,
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateRuminantReport(
  records: any[], budgets: any[], teamSummaries: any,
  now: Date, months: { m: number; y: number }[], curMonth: number, curYear: number,
) {
  const m1 = months[0], m2 = months[1], m3 = months[2];

  // Fetch account budgets
  const sbUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const sbKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let acctBudgets: any[] = [];
  try { const abSb = createClient(sbUrl, sbKey); const { data } = await abSb.from('account_budgets').select('*').eq('year', curYear); acctBudgets = data || []; } catch { /* */ }

  // Initialize from budget accounts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rumBudgetAccts = acctBudgets.filter((b: any) => b.category === 'ruminants');
  const byAccount: Record<string, { name: string; prev: number; v1: number; v2: number; v3: number; cum: number; bgt: number; annBgt: number }> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [...new Set(rumBudgetAccts.map((b: any) => b.account_name || b.accountName).filter(Boolean))].forEach((acct: string) => {
    byAccount[acct] = { name: acct, prev: 0, v1: 0, v2: 0, v3: 0, cum: 0, bgt: 0, annBgt: 0 };
  });

  // Fill in sales
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  records.filter((r: { category?: string }) => r.category === 'ruminants').forEach((r: any) => {
    const acct = r.account_name || r.accountName || 'Unknown';
    if (!byAccount[acct]) byAccount[acct] = { name: acct, prev: 0, v1: 0, v2: 0, v3: 0, cum: 0, bgt: 0, annBgt: 0 };
    const d = String(r.date || ''); const yr = parseInt(d.split('-')[0]); const mo = parseInt(d.split('-')[1]);
    const amt = Number(r.amount) || 0;
    if (yr === curYear - 1) byAccount[acct].prev += amt;
    if (yr === m1.y && mo === m1.m) byAccount[acct].v1 += amt;
    if (yr === m2.y && mo === m2.m) byAccount[acct].v2 += amt;
    if (yr === m3.y && mo === m3.m) byAccount[acct].v3 += amt;
    if (yr === curYear && mo <= curMonth) byAccount[acct].cum += amt;
  });

  // Apply budgets
  Object.values(byAccount).forEach((a) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mb = acctBudgets.find((b: any) => (b.account_name || b.accountName) === a.name && Number(b.month) === curMonth);
    a.bgt = Number(mb?.budget_amount || mb?.budgetAmount) || 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    a.annBgt = acctBudgets.filter((b: any) => (b.account_name || b.accountName) === a.name).reduce((s: number, b: { budget_amount?: number }) => s + (Number(b.budget_amount) || 0), 0);
  });

  const acctList = Object.values(byAccount).filter((a) => a.prev + a.v1 + a.v2 + a.v3 + a.annBgt > 0)
    .sort((a, b) => { if (b.annBgt !== a.annBgt) return b.annBgt - a.annBgt; return (b.cum || b.prev) - (a.cum || a.prev); });
  const totBudget = acctList.reduce((s, a) => s + a.bgt, 0) || budgets.filter((b: { year?: number; month?: number; category?: string }) => Number(b.year) === curYear && Number(b.month) === curMonth && b.category === 'ruminants').reduce((s: number, b: { budget_amount?: number }) => s + (Number(b.budget_amount) || 0), 0);
  const annBdg = acctList.reduce((s, a) => s + a.annBgt, 0) || budgets.filter((b: { year?: number; category?: string }) => Number(b.year) === curYear && b.category === 'ruminants').reduce((s: number, b: { budget_amount?: number }) => s + (Number(b.budget_amount) || 0), 0);
  const teamTotal = { prev: acctList.reduce((s, a) => s + a.prev, 0), v1: acctList.reduce((s, a) => s + a.v1, 0), v2: acctList.reduce((s, a) => s + a.v2, 0), v3: acctList.reduce((s, a) => s + a.v3, 0), cum: acctList.reduce((s, a) => s + a.cum, 0) };

  // AI summary
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const hasAI = apiKey && !apiKey.includes('placeholder');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rumData = (teamSummaries?.ruminants || { activities: [], tasks: [], opportunities: [] }) as any;
  const actCount = rumData.activities?.length || 0;
  const taskCount = rumData.tasks?.length || 0;
  let rumSummary = { thisWeek: '- No activities recorded', nextWeek: '- No tasks scheduled' };

  if (hasAI && (actCount > 0 || taskCount > 0)) {
    try {
      // Structured format: User | Account | Contact | Content | Type | Date — empty fields skipped
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const actText = (rumData.activities || []).map((a: any) => {
        const parts = [
          a.ownerName || a.ownerId,
          a.accountName,
          a.contactName,
          a.subject,
          a.type || 'Note',
          (a.date || '').slice(5).replace('-', '/'),
        ].filter((p) => p && String(p).trim()).map((p) => sanitize(String(p)));
        return `- ${parts.join(' | ')}`;
      }).join('\n') || 'None';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const taskText = (rumData.tasks || []).map((t: any) => {
        const parts = [
          t.ownerName || t.ownerId,
          t.accountName,
          t.subject,
          t.dueDate ? `Due ${(t.dueDate || '').slice(5).replace('-', '/')}` : '',
        ].filter((p) => p && String(p).trim()).map((p) => sanitize(String(p)));
        return `- ${parts.join(' | ')}`;
      }).join('\n') || 'None';
      const prompt = sanitize(`Write Ruminant team weekly summary for Pathway Intermediates USA (dairy/beef cattle nutrition).\nActivities:\n${actText}\nTasks:\n${taskText}\nRules:\n- thisWeek: copy EACH activity verbatim as its own bullet, preserving the pipe-separated format. Do NOT add "Logged by". Do NOT consolidate. Skip missing fields (no "—" placeholder).\n- nextWeek: copy EACH task verbatim as its own bullet, same rules.\nRespond ONLY JSON: {"thisWeek":"- bullet1\\n- bullet2\\n...","nextWeek":"- bullet1\\n- bullet2\\n..."}`);
      const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey!, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }) });
      if (res.ok) { const d = await res.json(); const p = JSON.parse((d.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim()); rumSummary = { thisWeek: p.thisWeek || '- No data', nextWeek: p.nextWeek || '- No tasks' }; }
      else { rumSummary = { thisWeek: `- ${actCount} activities logged`, nextWeek: `- ${taskCount} tasks pending` }; }
    } catch { rumSummary = { thisWeek: `- ${actCount} activities logged`, nextWeek: `- ${taskCount} tasks pending` }; }
  }

  // Build Word doc
  const reportDate = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const mn = MONTH_NAMES;
  const sColW = [1500, 1100, 900, 900, 1050, 1000, 650, 1150, 1150, 650, 810];
  const sTotal = sColW.reduce((a, b) => a + b, 0);
  const actColW = [1500, 5730, 5730];
  const RUM_GREEN = '0F6E56';

  // Account rows
  const acctRows = acctList.map((a) => {
    const ach = a.bgt > 0 ? Math.round((a.v3 / a.bgt) * 100) : 0;
    const cumAch = a.annBgt > 0 ? Math.round((a.cum / a.annBgt) * 100) : 0;
    return new TableRow({ height: { value: 340, rule: 'atLeast' as const }, children: [
      cell(a.name, { width: sColW[0] }),
      cell(fmtCompact(a.prev), { center: true, width: sColW[1] }),
      cell(fmtCompact(a.v1), { center: true, width: sColW[2] }),
      cell(fmtCompact(a.v2), { center: true, width: sColW[3] }),
      cell(fmtCompact(a.bgt), { center: true, width: sColW[4] }),
      cell(fmtCompact(a.v3), { center: true, bg: 'E8F5E9', width: sColW[5] }),
      cell(ach > 0 ? ach + '%' : '--', { center: true, bold: true, color: achColor(ach), width: sColW[6] }),
      cell(fmtCompact(a.annBgt), { center: true, width: sColW[7] }),
      cell(fmtCompact(a.cum), { center: true, width: sColW[8] }),
      cell(cumAch > 0 ? cumAch + '%' : '--', { center: true, bold: true, color: achColor(cumAch), width: sColW[9] }),
      cell('', { width: sColW[10] }),
    ] });
  });

  const ttAch = totBudget > 0 ? Math.round((teamTotal.v3 / totBudget) * 100) : 0;
  const ttCumAch = annBdg > 0 ? Math.round((teamTotal.cum / annBdg) * 100) : 0;

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.LANDSCAPE, width: 12240, height: 15840 }, margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: 'Pathway Intermediates USA - Ruminant Weekly Report', bold: true, size: 32, font: 'Arial', color: RUM_GREEN })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 280 }, children: [new TextRun({ text: reportDate, size: 20, font: 'Arial', color: '888888' })] }),

        // Focus box (single column)
        new Table({ width: { size: 13680, type: WidthType.DXA }, rows: [
          new TableRow({ children: [new TableCell({ borders, width: { size: 13680, type: WidthType.DXA }, shading: { fill: RUM_GREEN, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 160, right: 160 }, children: [new Paragraph({ children: [new TextRun({ text: "This Month's Focus Activities, Goals and Sales Performance", bold: true, size: 20, font: 'Arial', color: 'FFFFFF' })] })] })] }),
          new TableRow({ children: [new TableCell({ borders, width: { size: 13680, type: WidthType.DXA }, shading: { fill: 'E1F5EE', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 160, right: 160 }, children: [
            new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Ruminant: Dairy and beef cattle nutrition - Lipidol Protect trials and distribution expansion', size: 17, font: 'Arial', bold: true })] }),
          ] })] }),
        ] }),
        new Paragraph({ spacing: { before: 200, after: 100 }, children: [] }),

        // Sales by Account
        new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'Sales Performance - Ruminant Team', bold: true, size: 22, font: 'Arial', color: RUM_GREEN })] }),
        new Table({ width: { size: sTotal, type: WidthType.DXA }, rows: [
          new TableRow({ tableHeader: true, children: [
            cell('Account', { bold: true, bg: RUM_GREEN, color: 'FFFFFF', width: sColW[0], header: true }),
            cell(`${curYear - 1}\nRevenue`, { bold: true, bg: RUM_GREEN, color: 'FFFFFF', center: true, width: sColW[1], header: true }),
            cell(mn[m1.m - 1], { bold: true, bg: RUM_GREEN, color: 'FFFFFF', center: true, width: sColW[2], header: true }),
            cell(mn[m2.m - 1], { bold: true, bg: RUM_GREEN, color: 'FFFFFF', center: true, width: sColW[3], header: true }),
            cell(`Budget\nin ${mn[m3.m - 1]}`, { bold: true, bg: RUM_GREEN, color: 'FFFFFF', center: true, width: sColW[4], header: true }),
            cell('Monthly\nActual', { bold: true, bg: '085041', color: 'FFFFFF', center: true, width: sColW[5], header: true }),
            cell('Ach%', { bold: true, bg: '085041', color: 'FFFFFF', center: true, width: sColW[6], header: true }),
            cell('Annual\nBudget', { bold: true, bg: RUM_GREEN, color: 'FFFFFF', center: true, width: sColW[7], header: true }),
            cell('Cumulative', { bold: true, bg: RUM_GREEN, color: 'FFFFFF', center: true, width: sColW[8], header: true }),
            cell('Cum%', { bold: true, bg: RUM_GREEN, color: 'FFFFFF', center: true, width: sColW[9], header: true }),
            cell('Remark', { bold: true, bg: RUM_GREEN, color: 'FFFFFF', center: true, width: sColW[10], header: true }),
          ] }),
          ...acctRows,
          new TableRow({ children: [
            cell('Ruminant Team:', { bold: true, bg: 'E1F5EE', color: RUM_GREEN, width: sColW[0] }),
            cell(fmtCompact(teamTotal.prev), { center: true, bold: true, bg: 'E1F5EE', width: sColW[1] }),
            cell(fmtCompact(teamTotal.v1), { center: true, bold: true, bg: 'E1F5EE', width: sColW[2] }),
            cell(fmtCompact(teamTotal.v2), { center: true, bold: true, bg: 'E1F5EE', width: sColW[3] }),
            cell(fmtCompact(totBudget), { center: true, bold: true, bg: 'E1F5EE', width: sColW[4] }),
            cell(fmtCompact(teamTotal.v3), { center: true, bold: true, bg: 'E1F5EE', width: sColW[5] }),
            cell(ttAch > 0 ? ttAch + '%' : '--', { center: true, bold: true, bg: 'E1F5EE', color: achColor(ttAch), width: sColW[6] }),
            cell(fmtCompact(annBdg), { center: true, bold: true, bg: 'E1F5EE', width: sColW[7] }),
            cell(fmtCompact(teamTotal.cum), { center: true, bold: true, bg: 'E1F5EE', width: sColW[8] }),
            cell(ttCumAch > 0 ? ttCumAch + '%' : '--', { center: true, bold: true, bg: 'E1F5EE', color: achColor(ttCumAch), width: sColW[9] }),
            cell('', { bg: 'E1F5EE', width: sColW[10] }),
          ] }),
        ] }),
        new Paragraph({ spacing: { before: 240, after: 120 }, children: [] }),

        // Activities (Ruminant / Trial / Travel)
        new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'Team Weekly Activities', bold: true, size: 22, font: 'Arial', color: RUM_GREEN })] }),
        new Table({ width: { size: actColW.reduce((a, b) => a + b, 0), type: WidthType.DXA }, rows: [
          new TableRow({ tableHeader: true, children: [
            cell('Activities', { bold: true, bg: RUM_GREEN, color: 'FFFFFF', width: actColW[0], header: true }),
            cell('This week', { bold: true, bg: RUM_GREEN, color: 'FFFFFF', center: true, width: actColW[1], header: true }),
            cell('Next week', { bold: true, bg: RUM_GREEN, color: 'FFFFFF', center: true, width: actColW[2], header: true }),
          ] }),
          new TableRow({ height: { value: 600, rule: 'atLeast' as const }, children: [
            teamCell('Ruminant', { bg: 'E1F5EE', width: actColW[0], color: RUM_GREEN }),
            activityCell(rumSummary.thisWeek || '', { width: actColW[1] }),
            activityCell(rumSummary.nextWeek || '', { width: actColW[2] }),
          ] }),
          new TableRow({ height: { value: 400, rule: 'atLeast' as const }, children: [
            teamCell('Trial', { bg: 'FAEEDA', width: actColW[0], color: '854F0B' }),
            activityCell('', { width: actColW[1] }),
            activityCell('', { width: actColW[2] }),
          ] }),
          new TableRow({ height: { value: 400, rule: 'atLeast' as const }, children: [
            teamCell('Travel', { bg: 'F1EFE8', width: actColW[0], color: '5F5E5A' }),
            activityCell('', { width: actColW[1] }),
            activityCell('', { width: actColW[2] }),
          ] }),
        ] }),
        new Paragraph({ spacing: { before: 120 }, children: [] }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Response(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="PI_Ruminant_Report_${now.toISOString().split('T')[0]}.docx"`,
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateLATAMReport(
  records: any[], budgets: any[], teamSummaries: any,
  now: Date, months: { m: number; y: number }[], curMonth: number, curYear: number,
) {
  const m2 = months[1], m3 = months[2];
  const LATAM_COLOR = '854F0B';

  // Fetch account budgets
  const sbUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const sbKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let acctBudgets: any[] = [];
  try { const abSb = createClient(sbUrl, sbKey); const { data } = await abSb.from('account_budgets').select('*').eq('year', curYear); acctBudgets = data || []; } catch { /* */ }

  // Initialize from budget accounts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latBudgetAccts = acctBudgets.filter((b: any) => b.category === 'latam');
  const byAccount: Record<string, { name: string; ytd: number; v2: number; v3: number; cum: number; bgt: number; annBgt: number }> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [...new Set(latBudgetAccts.map((b: any) => b.account_name || b.accountName).filter(Boolean))].forEach((acct: string) => {
    byAccount[acct] = { name: acct, ytd: 0, v2: 0, v3: 0, cum: 0, bgt: 0, annBgt: 0 };
  });

  // Fill in sales
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  records.filter((r: { category?: string }) => r.category === 'latam').forEach((r: any) => {
    const acct = r.account_name || r.accountName || 'Unknown';
    if (!byAccount[acct]) byAccount[acct] = { name: acct, ytd: 0, v2: 0, v3: 0, cum: 0, bgt: 0, annBgt: 0 };
    const d = String(r.date || ''); const yr = parseInt(d.split('-')[0]); const mo = parseInt(d.split('-')[1]);
    const amt = Number(r.amount) || 0;
    if (yr === m2.y && mo === m2.m) byAccount[acct].v2 += amt;
    if (yr === m3.y && mo === m3.m) byAccount[acct].v3 += amt;
    if (yr === curYear && mo <= curMonth) { byAccount[acct].cum += amt; byAccount[acct].ytd += amt; }
  });

  // Apply budgets
  Object.values(byAccount).forEach((a) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mb = acctBudgets.find((b: any) => (b.account_name || b.accountName) === a.name && Number(b.month) === curMonth);
    a.bgt = Number(mb?.budget_amount || mb?.budgetAmount) || 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    a.annBgt = acctBudgets.filter((b: any) => (b.account_name || b.accountName) === a.name).reduce((s: number, b: { budget_amount?: number }) => s + (Number(b.budget_amount) || 0), 0);
  });

  const acctList = Object.values(byAccount).filter((a) => a.ytd + a.annBgt > 0)
    .sort((a, b) => { if (b.annBgt !== a.annBgt) return b.annBgt - a.annBgt; return b.cum - a.cum; });
  const totBgt = acctList.reduce((s, a) => s + a.bgt, 0) || budgets.filter((b: { year?: number; month?: number; category?: string }) => Number(b.year) === curYear && Number(b.month) === curMonth && b.category === 'latam').reduce((s: number, b: { budget_amount?: number }) => s + (Number(b.budget_amount) || 0), 0);
  const annBdg = acctList.reduce((s, a) => s + a.annBgt, 0) || budgets.filter((b: { year?: number; category?: string }) => Number(b.year) === curYear && b.category === 'latam').reduce((s: number, b: { budget_amount?: number }) => s + (Number(b.budget_amount) || 0), 0);
  const teamTot = { ytd: acctList.reduce((s, a) => s + a.ytd, 0), v2: acctList.reduce((s, a) => s + a.v2, 0), v3: acctList.reduce((s, a) => s + a.v3, 0), cum: acctList.reduce((s, a) => s + a.cum, 0) };

  // AI summary
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const hasAI = apiKey && !apiKey.includes('placeholder');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latData = (teamSummaries?.latam || { activities: [], tasks: [], opportunities: [] }) as any;
  const actCount = latData.activities?.length || 0;
  const taskCount = latData.tasks?.length || 0;
  let latSummary = { thisWeek: '- No activities recorded', nextWeek: '- No tasks scheduled' };

  if (hasAI && (actCount > 0 || taskCount > 0)) {
    try {
      // Structured format: User | Account | Contact | Content | Type | Date — empty fields skipped
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const actText = (latData.activities || []).map((a: any) => {
        const parts = [
          a.ownerName || a.ownerId,
          a.accountName,
          a.contactName,
          a.subject,
          a.type || 'Note',
          (a.date || '').slice(5).replace('-', '/'),
        ].filter((p) => p && String(p).trim()).map((p) => sanitize(String(p)));
        return `- ${parts.join(' | ')}`;
      }).join('\n') || 'None';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const taskText = (latData.tasks || []).map((t: any) => {
        const parts = [
          t.ownerName || t.ownerId,
          t.accountName,
          t.subject,
          t.dueDate ? `Due ${(t.dueDate || '').slice(5).replace('-', '/')}` : '',
        ].filter((p) => p && String(p).trim()).map((p) => sanitize(String(p)));
        return `- ${parts.join(' | ')}`;
      }).join('\n') || 'None';
      const prompt = sanitize(`Write LATAM team weekly summary for Pathway Intermediates USA (Latin America distributors: Mexico, Colombia, Peru, Chile, Venezuela, etc.).\nActivities:\n${actText}\nTasks:\n${taskText}\nRules:\n- thisWeek: copy EACH activity verbatim as its own bullet, preserving the pipe-separated format. Do NOT add "Logged by". Do NOT consolidate. Skip missing fields. Organize by country when possible.\n- nextWeek: copy EACH task verbatim as its own bullet, same rules.\nRespond ONLY JSON: {"thisWeek":"- bullet1\\n- bullet2\\n...","nextWeek":"- bullet1\\n- bullet2\\n..."}`);
      const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey!, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }) });
      if (res.ok) { const d = await res.json(); const p = JSON.parse((d.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim()); latSummary = { thisWeek: p.thisWeek || '- No data', nextWeek: p.nextWeek || '- No tasks' }; }
      else { latSummary = { thisWeek: `- ${actCount} activities logged`, nextWeek: `- ${taskCount} tasks pending` }; }
    } catch { latSummary = { thisWeek: `- ${actCount} activities logged`, nextWeek: `- ${taskCount} tasks pending` }; }
  }

  // Build Word doc
  const reportDate = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const mn = MONTH_NAMES;
  // 12 columns: Account | YTD | Bgt(m2) | Sales(m2) | Ach% | Bgt(m3) | Sales(m3) | Ach% | AnnBgt | Cum | Cum% | Remark
  const sColW = [1400, 900, 900, 900, 650, 900, 900, 650, 1050, 1050, 650, 810];
  const sTotal = sColW.reduce((a, b) => a + b, 0);
  const actColW = [1500, 5730, 5730];

  const acctRows = acctList.map((a) => {
    const m2Ach = a.bgt > 0 ? Math.round((a.v2 / a.bgt) * 100) : 0;
    const m3Ach = a.bgt > 0 ? Math.round((a.v3 / a.bgt) * 100) : 0;
    const cumAch = a.annBgt > 0 ? Math.round((a.cum / a.annBgt) * 100) : 0;
    return new TableRow({ height: { value: 340, rule: 'atLeast' as const }, children: [
      cell(a.name, { width: sColW[0] }),
      cell(fmtCompact(a.ytd), { center: true, width: sColW[1] }),
      cell(fmtCompact(a.bgt), { center: true, width: sColW[2] }),
      cell(fmtCompact(a.v2), { center: true, width: sColW[3] }),
      cell(m2Ach > 0 ? m2Ach + '%' : '--', { center: true, bold: true, color: achColor(m2Ach), width: sColW[4] }),
      cell(fmtCompact(a.bgt), { center: true, width: sColW[5] }),
      cell(fmtCompact(a.v3), { center: true, bg: 'E8F5E9', width: sColW[6] }),
      cell(m3Ach > 0 ? m3Ach + '%' : '--', { center: true, bold: true, color: achColor(m3Ach), width: sColW[7] }),
      cell(fmtCompact(a.annBgt), { center: true, width: sColW[8] }),
      cell(fmtCompact(a.cum), { center: true, width: sColW[9] }),
      cell(cumAch > 0 ? cumAch + '%' : '--', { center: true, bold: true, color: achColor(cumAch), width: sColW[10] }),
      cell('', { width: sColW[11] }),
    ] });
  });

  const ttM2Ach = totBgt > 0 ? Math.round((teamTot.v2 / totBgt) * 100) : 0;
  const ttM3Ach = totBgt > 0 ? Math.round((teamTot.v3 / totBgt) * 100) : 0;
  const ttCumAch = annBdg > 0 ? Math.round((teamTot.cum / annBdg) * 100) : 0;

  // Country rows for activities
  const countryLabels = ['Mexico', 'Colombia', 'Peru / Bolivia', 'Central America', 'Panama / Costa R.', 'Ecuador', 'Chile', 'Venezuela', 'Other Countries', 'MKT / Trials', 'Market News', 'Registration', 'Travel'];
  const countryRows = countryLabels.map((label, idx) => new TableRow({
    height: { value: idx === 0 ? 600 : 340, rule: 'atLeast' as const },
    children: [
      teamCell(label, { bg: idx === 0 ? 'FAEEDA' : idx % 2 === 0 ? 'FAFAFA' : 'FFFFFF', width: actColW[0], color: idx === 0 ? LATAM_COLOR : '444444' }),
      activityCell(idx === 0 ? (latSummary.thisWeek || '') : '', { width: actColW[1] }),
      activityCell(idx === 0 ? (latSummary.nextWeek || '') : '', { width: actColW[2] }),
    ],
  }));

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.LANDSCAPE, width: 12240, height: 15840 }, margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: 'Pathway Intermediates USA - LATAM Weekly Report', bold: true, size: 32, font: 'Arial', color: LATAM_COLOR })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 280 }, children: [new TextRun({ text: reportDate, size: 20, font: 'Arial', color: '888888' })] }),

        // Focus title only
        new Table({ width: { size: 13680, type: WidthType.DXA }, rows: [
          new TableRow({ children: [new TableCell({ borders, width: { size: 13680, type: WidthType.DXA }, shading: { fill: LATAM_COLOR, type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 160, right: 160 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "This Month's Focus Activities, Goals and Sales Performance", bold: true, size: 20, font: 'Arial', color: 'FFFFFF' })] })] })] }),
        ] }),
        new Paragraph({ spacing: { before: 200, after: 100 }, children: [] }),

        // Sales by Account
        new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'Sales Performance - LATAM Team', bold: true, size: 22, font: 'Arial', color: LATAM_COLOR })] }),
        new Table({ width: { size: sTotal, type: WidthType.DXA }, rows: [
          new TableRow({ tableHeader: true, children: [
            cell('(USD)', { bold: true, bg: LATAM_COLOR, color: 'FFFFFF', width: sColW[0], header: true }),
            cell(`${curYear}\nRevenue`, { bold: true, bg: LATAM_COLOR, color: 'FFFFFF', center: true, width: sColW[1], header: true }),
            cell(`Budget\n${mn[m2.m - 1]}`, { bold: true, bg: LATAM_COLOR, color: 'FFFFFF', center: true, width: sColW[2], header: true }),
            cell('Monthly\nSales', { bold: true, bg: '633806', color: 'FFFFFF', center: true, width: sColW[3], header: true }),
            cell('Ach%', { bold: true, bg: '633806', color: 'FFFFFF', center: true, width: sColW[4], header: true }),
            cell(`Budget\n${mn[m3.m - 1]}`, { bold: true, bg: LATAM_COLOR, color: 'FFFFFF', center: true, width: sColW[5], header: true }),
            cell('Monthly\nSales', { bold: true, bg: '633806', color: 'FFFFFF', center: true, width: sColW[6], header: true }),
            cell('Ach%', { bold: true, bg: '633806', color: 'FFFFFF', center: true, width: sColW[7], header: true }),
            cell('Annual\nBudget', { bold: true, bg: LATAM_COLOR, color: 'FFFFFF', center: true, width: sColW[8], header: true }),
            cell('Cumulative\nSales', { bold: true, bg: LATAM_COLOR, color: 'FFFFFF', center: true, width: sColW[9], header: true }),
            cell('Cum%', { bold: true, bg: LATAM_COLOR, color: 'FFFFFF', center: true, width: sColW[10], header: true }),
            cell('Remark', { bold: true, bg: LATAM_COLOR, color: 'FFFFFF', center: true, width: sColW[11], header: true }),
          ] }),
          ...acctRows,
          // Total row
          new TableRow({ children: [
            cell('LATAM Total:', { bold: true, bg: 'FAEEDA', color: '633806', width: sColW[0] }),
            cell(fmtCompact(teamTot.ytd), { center: true, bold: true, bg: 'FAEEDA', width: sColW[1] }),
            cell(fmtCompact(totBgt), { center: true, bold: true, bg: 'FAEEDA', width: sColW[2] }),
            cell(fmtCompact(teamTot.v2), { center: true, bold: true, bg: 'FAEEDA', width: sColW[3] }),
            cell(ttM2Ach > 0 ? ttM2Ach + '%' : '--', { center: true, bold: true, bg: 'FAEEDA', color: achColor(ttM2Ach), width: sColW[4] }),
            cell(fmtCompact(totBgt), { center: true, bold: true, bg: 'FAEEDA', width: sColW[5] }),
            cell(fmtCompact(teamTot.v3), { center: true, bold: true, bg: 'FAEEDA', width: sColW[6] }),
            cell(ttM3Ach > 0 ? ttM3Ach + '%' : '--', { center: true, bold: true, bg: 'FAEEDA', color: achColor(ttM3Ach), width: sColW[7] }),
            cell(fmtCompact(annBdg), { center: true, bold: true, bg: 'FAEEDA', width: sColW[8] }),
            cell(fmtCompact(teamTot.cum), { center: true, bold: true, bg: 'FAEEDA', width: sColW[9] }),
            cell(ttCumAch > 0 ? ttCumAch + '%' : '--', { center: true, bold: true, bg: 'FAEEDA', color: achColor(ttCumAch), width: sColW[10] }),
            cell('', { bg: 'FAEEDA', width: sColW[11] }),
          ] }),
        ] }),
        new Paragraph({ spacing: { before: 240, after: 120 }, children: [] }),

        // Activities by Country
        new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'Team Weekly Activities by Country', bold: true, size: 22, font: 'Arial', color: LATAM_COLOR })] }),
        new Table({ width: { size: actColW.reduce((a, b) => a + b, 0), type: WidthType.DXA }, rows: [
          new TableRow({ tableHeader: true, children: [
            cell('Activities', { bold: true, bg: LATAM_COLOR, color: 'FFFFFF', width: actColW[0], header: true }),
            cell('This week', { bold: true, bg: LATAM_COLOR, color: 'FFFFFF', center: true, width: actColW[1], header: true }),
            cell('Next Week', { bold: true, bg: LATAM_COLOR, color: 'FFFFFF', center: true, width: actColW[2], header: true }),
          ] }),
          ...countryRows,
        ] }),
        new Paragraph({ spacing: { before: 120 }, children: [] }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Response(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="PI_LATAM_Report_${now.toISOString().split('T')[0]}.docx"`,
    },
  });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { teamSummaries, reportType } = await request.json();

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

    // ── Team-specific reports ──
    if (reportType === 'monogastrics') {
      return generateMonogastricReport(records, budgets, teamSummaries, now, months, curMonth, curYear);
    }
    if (reportType === 'ruminants') {
      return generateRuminantReport(records, budgets, teamSummaries, now, months, curMonth, curYear);
    }
    if (reportType === 'latam') {
      return generateLATAMReport(records, budgets, teamSummaries, now, months, curMonth, curYear);
    }

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

    // Sales table — 10 columns, sum = 14400
    // (USD) | M1 | M2 | M3 Actual | Budget | Ach% | Ann.Budget | Cumulative | Cum% | Remark
    const sColW = [2500, 1300, 1300, 1300, 1400, 900, 2000, 2000, 900, 800];

    // Build sales table data rows
    const salesTableRows = allRows.map((r) => {
      const isTotal = r.label === 'Total';
      const isPoultry = r.label === 'Poultry';
      const isSwine = r.label === 'Swine';
      const bg = isTotal ? 'D6E4D0' : (isPoultry || isSwine) ? 'E6F1FB' : undefined;
      return new TableRow({
        height: { value: 380, rule: 'atLeast' as const },
        children: [
          cell(r.label, { bold: isTotal, bg, width: sColW[0], size: 13 }),
          cell(fmtCompact(r.m1), { center: true, bg, width: sColW[1], size: 13 }),
          cell(fmtCompact(r.m2), { center: true, bg, width: sColW[2], size: 13 }),
          cell(fmtCompact(r.m3), { center: true, bg: isTotal ? 'D6E4D0' : 'E8F5E9', width: sColW[3], size: 13 }),
          cell(fmtCompact(r.bgt), { center: true, bg, width: sColW[4], size: 13 }),
          cell(r.ach > 0 ? r.ach + '%' : '--', { center: true, bg, width: sColW[5], color: achColor(r.ach), bold: true, size: 13 }),
          cell(fmtCompact(r.annBgt), { center: true, bg, width: sColW[6], size: 13 }),
          cell(fmtCompact(r.cum), { center: true, bg, width: sColW[7], size: 13 }),
          cell(r.cumAch > 0 ? r.cumAch + '%' : '--', { center: true, bg, width: sColW[8], color: achColor(r.cumAch), bold: true, size: 13 }),
          cell('', { bg, width: sColW[9] }),
        ],
      });
    });

    // Activity table column widths — sum = 14400
    const actColW = [2000, 6200, 6200];

    // Activity table rows: Poultry, Swine, Ruminant, LATAM, Marketing, HR, Others, Travel
    const activityTeamRows = [
      { key: 'poultry', label: 'Poultry', bg: 'E6F1FB' },
      { key: 'swine', label: 'Swine', bg: 'E6F1FB' },
      { key: 'ruminants', label: 'Ruminant', bg: 'E1F5EE' },
      { key: 'latam', label: 'LATAM', bg: 'FAEEDA' },
      { key: 'marketing', label: 'Marketing\n(Tech & R&D)', bg: 'FBEAF0' },
      { key: 'hr', label: 'HR', bg: 'F1EFE8' },
      { key: 'others', label: 'Others', bg: 'F1EFE8' },
      { key: 'travel', label: 'Travel', bg: 'F1EFE8' },
    ];

    const activityTableRows = activityTeamRows.map((t) => {
      const summary = aiSummaries[t.key] || {};
      return new TableRow({
        height: { value: 600, rule: 'atLeast' as const },
        children: [
          teamCell(t.label, { bg: t.bg, width: actColW[0] }),
          activityCell(summary.thisWeek || '', { width: actColW[1] }),
          activityCell(summary.nextWeek || '', { width: actColW[2] }),
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
          spacing: { after: isHeader ? 30 : 50 },
          children: [new TextRun({ text: line, size: 17, font: 'Arial', bold: isHeader })],
        }));
      });
      focusParagraphs.push(new Paragraph({ spacing: { after: 60 }, children: [] }));
    }

    const doc = new Document({
      styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
      sections: [{
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE, width: 12240, height: 15840 },
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
            columnWidths: [14400],
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
                  margins: { top: 100, bottom: 100, left: 160, right: 160 },
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
            width: { size: 14400, type: WidthType.DXA },
            columnWidths: sColW,
            rows: [
              // Header
              new TableRow({
                tableHeader: true,
                children: [
                  cell('(USD)', { bold: true, bg: '1a4731', color: 'FFFFFF', width: sColW[0], header: true }),
                  cell(m1Name, { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[1], header: true }),
                  cell(m2Name, { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[2], header: true }),
                  cell(m3Name + '\nActual', { bold: true, bg: '2d6a4f', color: 'FFFFFF', center: true, width: sColW[3], header: true }),
                  cell('Budget\nin ' + m3Name, { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[4], header: true }),
                  cell('Ach%', { bold: true, bg: '2d6a4f', color: 'FFFFFF', center: true, width: sColW[5], header: true }),
                  cell('Annual\nBudget', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[6], header: true }),
                  cell('Cumulative', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[7], header: true }),
                  cell('Cum%', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[8], header: true }),
                  cell('Remark', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: sColW[9], header: true }),
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
            width: { size: 14400, type: WidthType.DXA },
            columnWidths: actColW,
            rows: [
              new TableRow({
                tableHeader: true,
                children: [
                  cell('Activities', { bold: true, bg: '1a4731', color: 'FFFFFF', width: actColW[0], header: true }),
                  cell('This week', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: actColW[1], header: true }),
                  cell('Next week', { bold: true, bg: '1a4731', color: 'FFFFFF', center: true, width: actColW[2], header: true }),
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
