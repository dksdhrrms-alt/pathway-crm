/**
 * POST /api/ai/generate-trial-report
 *
 * Standalone Trial Tracker report — the same Trial section that
 * gets embedded in Jason's Weekly Report, but on its own .docx so
 * the team can save a weekly copy to their desktop without the
 * sales-performance tables around it.
 *
 * Body: { weekEnding?: 'YYYY-MM-DD', teams?: TrialAccessTeam[] }
 *   - weekEnding defaults to the current week's Wednesday
 *   - teams     defaults to ['monogastrics','ruminants','latam']
 *
 * Response: .docx (application/vnd.openxmlformats...).
 *
 * The cron (/api/cron/trial-weekly-report, Thu 12:00 PM) also
 * calls into this file through buildTrialReportDocx() so the
 * email attachment is byte-identical to what the manual
 * download produces.
 */

import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, WidthType, BorderStyle, ShadingType, VerticalAlign,
} from 'docx';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Access-team → animal_group values. Must stay in sync with
// lib/trialFiles.ts accessTeamToAnimalGroups() — we duplicate here
// so this route doesn't drag the client-only lib file in.
const BUCKET_GROUPS: Record<string, string[]> = {
  monogastrics: ['Poultry', 'Swine', 'Poultry/Swine'],
  ruminants:    ['Ruminants'],
  latam:        ['LATAM'],
  common:       ['Common'],
};
const BUCKET_LABEL: Record<string, string> = {
  monogastrics: 'Monogastrics', ruminants: 'Ruminants', latam: 'LATAM', common: 'Common',
};

/** Normalize incoming scope — drop unknown teams and de-dupe. */
function normalizeTeams(teams: string[] | undefined): string[] {
  const defaulted = teams && teams.length ? teams : ['monogastrics', 'ruminants', 'latam', 'common'];
  return Array.from(new Set(defaulted.filter((t) => BUCKET_GROUPS[t])));
}

// ── Date + sanitize helpers ──────────────────────────────────
function wednesdayISO(d: Date): string {
  const day = d.getDay();
  const offset = 3 - day;
  const w = new Date(d);
  w.setDate(w.getDate() + offset);
  const y = w.getFullYear();
  const m = String(w.getMonth() + 1).padStart(2, '0');
  const dd = String(w.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function sanitize(text: string): string {
  if (!text) return '';
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/•/g, '-').replace(/·/g, '-')
    .replace(/…/g, '...').replace(/–/g, '-').replace(/—/g, '--')
    .replace(/→/g, '->').replace(/←/g, '<-')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-\x7F]/g, ' ').trim();
}

// ── Cell helpers ─────────────────────────────────────────────
const brd = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: brd, bottom: brd, left: brd, right: brd };

function activityCell(lines: Paragraph[], width: number, bg?: string) {
  if (lines.length === 0) {
    lines = [new Paragraph({ children: [new TextRun({ text: 'No updates for this week', size: 15, font: 'Arial', color: '888888', italics: true })] })];
  }
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA },
    shading: bg ? { fill: bg, type: ShadingType.CLEAR } : undefined,
    margins: { top: 100, bottom: 100, left: 140, right: 140 },
    children: lines,
  });
}
function headerCell(text: string, width: number) {
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA },
    shading: { fill: '1a4731', type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 140, right: 140 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 18, font: 'Arial', color: 'FFFFFF' })] })],
  });
}
function sectionLabelCell(text: string, width: number, bg: string, color: string) {
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA },
    shading: { fill: bg, type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 16, font: 'Arial', color })] })],
  });
}

const HEALTH_HEX: Record<string, string> = {
  Green: '0F6E56', Amber: '854F0B', Red: 'A32D2D',
};

/** One trial entry rendered as 1-3 paragraphs: title line (health
 *  tag + name + phase + stage + owner), optional body paragraph,
 *  spacer. */
function trialThisWeekParagraphs(trial: { name: string; phase: string }, u: { health?: string; stage?: string; owner?: string | null; what_happened?: string | null }): Paragraph[] {
  const out: Paragraph[] = [];
  const healthColor = HEALTH_HEX[String(u.health || '')] || '555555';
  const headRuns: TextRun[] = [];
  if (u.health) {
    headRuns.push(new TextRun({ text: `[${u.health}] `, bold: true, size: 15, font: 'Arial', color: healthColor }));
  }
  headRuns.push(new TextRun({ text: trial.name, bold: true, size: 15, font: 'Arial' }));
  const meta = [trial.phase, u.stage, u.owner].filter(Boolean).join(' · ');
  if (meta) headRuns.push(new TextRun({ text: ` — ${meta}`, size: 14, font: 'Arial', color: '555555' }));
  out.push(new Paragraph({ spacing: { after: 40 }, children: headRuns }));

  const what = sanitize(u.what_happened || '').replace(/\s*\n+\s*/g, ' ');
  if (what) {
    out.push(new Paragraph({
      spacing: { after: 120 },
      indent: { left: 160 },
      children: [new TextRun({ text: what, size: 15, font: 'Arial' })],
    }));
  } else {
    out.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
  }
  return out;
}
function trialNextWeekParagraphs(trial: { name: string }, u: { due_date?: string | null; next_step?: string | null }): Paragraph[] {
  const out: Paragraph[] = [];
  const headRuns: TextRun[] = [new TextRun({ text: trial.name, bold: true, size: 15, font: 'Arial' })];
  if (u.due_date) {
    const d = String(u.due_date).slice(5).replace('-', '/');
    headRuns.push(new TextRun({ text: `  (Due ${d})`, size: 14, font: 'Arial', color: '854F0B' }));
  }
  out.push(new Paragraph({ spacing: { after: 40 }, children: headRuns }));
  const nxt = sanitize(u.next_step || '').replace(/\s*\n+\s*/g, ' ');
  if (nxt) {
    out.push(new Paragraph({
      spacing: { after: 120 },
      indent: { left: 160 },
      children: [new TextRun({ text: nxt, size: 15, font: 'Arial' })],
    }));
  } else {
    out.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
  }
  return out;
}

// ── Core doc builder (exported for cron reuse) ───────────────

export async function buildTrialReportDocx(opts: {
  weekEnding?: string;
  teams?: string[];
}): Promise<{ bytes: Buffer; filename: string; stats: { green: number; amber: number; red: number; total: number } }> {
  const now = new Date();
  const weekEnding = opts.weekEnding || wednesdayISO(now);
  const teams = normalizeTeams(opts.teams);

  const sbUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const sb = createClient(sbUrl, sbKey);

  const groups = teams.flatMap((t) => BUCKET_GROUPS[t] || []);
  const [uRes, tRes] = await Promise.all([
    sb.from('trial_updates').select('*').eq('week_ending', weekEnding),
    sb.from('trials').select('*').in('animal_group', groups).is('finished_at', null),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trials = (tRes.data as any[]) || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates = (uRes.data as any[]) || [];
  const trialById = new Map(trials.map((t) => [t.id, t]));
  const pairs = updates
    .filter((u) => trialById.has(u.trial_id))
    .map((u) => ({ trial: trialById.get(u.trial_id)!, update: u }));

  // Count health badges for the header summary.
  const stats = { green: 0, amber: 0, red: 0, total: pairs.length };
  for (const { update } of pairs) {
    if (update.health === 'Green') stats.green++;
    else if (update.health === 'Amber') stats.amber++;
    else if (update.health === 'Red') stats.red++;
  }

  // Group by access bucket, then within each bucket group by
  // animal_group → phase, matching the Weekly Report layout.
  const bucketOrder = teams; // user's selection order
  const colW = [1500, 5730, 5730];

  const children: (Paragraph | Table)[] = [];

  // Title
  const weekLabel = (() => {
    const [y, m, d] = weekEnding.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1)
      .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  })();
  const scopeLabel = teams.map((t) => BUCKET_LABEL[t]).join(' · ');
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 100 },
    children: [new TextRun({ text: 'Pathway Intermediates USA — Trial Tracker Report', bold: true, size: 32, font: 'Arial', color: '1a4731' })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 80 },
    children: [new TextRun({ text: `Week ending ${weekLabel}`, size: 20, font: 'Arial', color: '555555' })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 280 },
    children: [new TextRun({ text: `${scopeLabel}  ·  ${stats.total} trial update${stats.total === 1 ? '' : 's'}  ·  `, size: 18, font: 'Arial', color: '888888' }),
      new TextRun({ text: `${stats.green} Green`, size: 18, font: 'Arial', color: HEALTH_HEX.Green, bold: true }),
      new TextRun({ text: `  ·  ${stats.amber} Amber`, size: 18, font: 'Arial', color: HEALTH_HEX.Amber, bold: true }),
      new TextRun({ text: `  ·  ${stats.red} Red`, size: 18, font: 'Arial', color: HEALTH_HEX.Red, bold: true }),
    ],
  }));

  // One Trial table per selected access bucket.
  for (const bucket of bucketOrder) {
    const bucketGroups = BUCKET_GROUPS[bucket];
    const bucketPairs = pairs.filter((p) => bucketGroups.includes(p.trial.animal_group));

    children.push(new Paragraph({
      spacing: { before: 200, after: 100 },
      children: [new TextRun({ text: BUCKET_LABEL[bucket], bold: true, size: 24, font: 'Arial', color: '1a4731' })],
    }));

    const thisWeekParas: Paragraph[] = [];
    const nextWeekParas: Paragraph[] = [];
    bucketPairs
      .sort((a, b) =>
        String(a.trial.phase || '').localeCompare(String(b.trial.phase || ''))
        || String(a.trial.name || '').localeCompare(String(b.trial.name || '')),
      )
      .forEach(({ trial, update }) => {
        thisWeekParas.push(...trialThisWeekParagraphs(trial, update));
        nextWeekParas.push(...trialNextWeekParagraphs(trial, update));
      });

    const rows: TableRow[] = [
      new TableRow({ tableHeader: true, children: [
        headerCell('Activities', colW[0]),
        headerCell('This week', colW[1]),
        headerCell('Next week', colW[2]),
      ] }),
      new TableRow({ children: [
        sectionLabelCell('Trials', colW[0], 'FAEEDA', '854F0B'),
        activityCell(thisWeekParas, colW[1]),
        activityCell(nextWeekParas, colW[2]),
      ] }),
    ];

    children.push(new Table({ width: { size: colW.reduce((a, b) => a + b, 0), type: WidthType.DXA }, rows }));
  }

  if (stats.total === 0) {
    children.push(new Paragraph({
      spacing: { before: 300 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'No trial updates recorded for this reporting week.', italics: true, size: 18, font: 'Arial', color: '888888' })],
    }));
  }

  // Footer
  children.push(new Paragraph({
    spacing: { before: 400 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `Generated ${now.toLocaleString('en-US')} · pathway-usa.com`, size: 14, font: 'Arial', color: 'AAAAAA' })],
  }));

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [{ properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } }, children }],
  });

  const buffer = await Packer.toBuffer(doc);
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const scopeTag = teams.length === 3 ? 'All' : teams.map((t) => BUCKET_LABEL[t]).join('-');
  const filename = `Trial_Tracker_${weekEnding}_${scopeTag}.docx`;
  return { bytes, filename, stats };
}

// ── HTTP handler ─────────────────────────────────────────────

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { weekEnding?: string; teams?: string[] } = {};
  try { body = await request.json(); } catch { /* allow empty */ }

  // Server-side team guard: Admin tier (admin / ceo / coo /
  // administrative_manager) may request any buckets; everyone else
  // is limited to the buckets they actually have access to (role
  // Director + explicit per-user grants in users.trial_access_teams).
  // Otherwise a user could craft the POST and pull data for a
  // bucket they weren't granted. See lib/trialFiles.ts for the
  // canonical access model.
  const role = session.user.role as string;
  const ADMIN_TIER = new Set(['admin', 'ceo', 'coo', 'administrative_manager']);
  if (!ADMIN_TIER.has(role)) {
    const allowed = new Set<string>();
    // Director role → their species bucket
    const team = (session.user as { team?: string }).team;
    if (role === 'sales_director') {
      if (team === 'monogastrics' || team === 'swine') allowed.add('monogastrics');
      else if (team === 'ruminants') allowed.add('ruminants');
      else if (team === 'latam')     allowed.add('latam');
    }
    // Pull the user's explicit grants from Supabase (session doesn't
    // carry them — avoids a stale-token issue when Admin updates them).
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    if (url && key) {
      const { createClient } = await import('@supabase/supabase-js');
      const sb = createClient(url, key, { auth: { persistSession: false } });
      const { data: u } = await sb.from('users')
        .select('trial_access_teams').eq('id', session.user.id).maybeSingle();
      for (const t of (u?.trial_access_teams ?? []) as string[]) allowed.add(t);
    }
    if (allowed.size === 0) {
      return NextResponse.json({ error: 'No trial team access configured for this account.' }, { status: 403 });
    }
    body.teams = (body.teams ?? Array.from(allowed)).filter((t) => allowed.has(t));
    if (body.teams.length === 0) {
      return NextResponse.json({ error: 'You do not have access to any of the requested teams.' }, { status: 403 });
    }
  }

  const { bytes, filename } = await buildTrialReportDocx({
    weekEnding: body.weekEnding,
    teams: body.teams,
  });

  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
