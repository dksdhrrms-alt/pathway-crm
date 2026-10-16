/**
 * Weekly Trial Report cron — Thursdays at 12:00 PM (US Central).
 *
 * Pulls the recipient list from `trial_report_recipients` and sends
 * each person a .docx of this week's Trial Tracker report, scoped
 * to the `teams` column on their recipient row.
 *
 * The .docx is produced by buildTrialReportDocx() in
 * app/api/ai/generate-trial-report/route.ts so the attachment is
 * byte-identical to what manual downloads produce.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}, same pattern as the
 * daily-brief cron. Vercel Cron sends this header automatically
 * for the schedule registered in vercel.json.
 *
 * HARD-CODED hex colors in this file: this route only inlines
 * colors into Resend HTML, which does not support CSS variables.
 * The sed-based token sweep must skip this file.
 */

import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildTrialReportDocx } from '@/app/api/ai/generate-trial-report/route';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BUCKET_LABEL: Record<string, string> = {
  monogastrics: 'Monogastrics', ruminants: 'Ruminants', latam: 'LATAM',
};

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en-US',
    { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

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

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes('placeholder')) {
    return Response.json({ sent: 0, skipped: 'no RESEND_API_KEY configured' });
  }
  const from = process.env.RESEND_OUTBOUND_FROM_OVERRIDE
    || process.env.EMAIL_FROM
    || 'Pathway CRM <notifications@pathway-intermediates.com>';

  const sbUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!sbUrl || !sbKey) return Response.json({ error: 'No Supabase config' }, { status: 500 });
  const sb = createClient(sbUrl, sbKey);

  const { data: recipients, error } = await sb
    .from('trial_report_recipients').select('*');
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!recipients || recipients.length === 0) {
    return Response.json({ sent: 0, skipped: 'no recipients configured' });
  }

  const weekEnding = wednesdayISO(new Date());
  const weekLabel = fmtDate(weekEnding);

  // Cache docs by team-combo so recipients that share a scope don't
  // re-generate the file.
  const docCache = new Map<string, { bytes: Buffer; filename: string; stats: { green: number; amber: number; red: number; total: number } }>();

  const results: { email: string; ok: boolean; error?: string }[] = [];

  for (const r of recipients as Array<{ email: string; label: string | null; teams: string[] }>) {
    const teams = (Array.isArray(r.teams) ? r.teams : []).filter((t) => BUCKET_LABEL[t]);
    if (teams.length === 0) {
      results.push({ email: r.email, ok: false, error: 'no teams configured' });
      continue;
    }
    const key = teams.slice().sort().join('|');
    let built = docCache.get(key);
    if (!built) {
      try {
        built = await buildTrialReportDocx({ weekEnding, teams });
      } catch (e) {
        results.push({ email: r.email, ok: false, error: (e as Error).message });
        continue;
      }
      docCache.set(key, built);
    }

    const b64 = built.bytes.toString('base64');
    const scopeLabel = teams.map((t) => BUCKET_LABEL[t]).join(', ');
    const html = buildEmailHtml({ label: r.label, weekLabel, scopeLabel, stats: built.stats });

    try {
      await sendWithRetry({
        apiKey, from, to: r.email,
        subject: `Trial Tracker Report — ${weekLabel}`,
        html,
        attachment: { filename: built.filename, b64 },
      });
      results.push({ email: r.email, ok: true });
    } catch (e) {
      results.push({ email: r.email, ok: false, error: (e as Error).message });
    }
  }

  return Response.json({
    weekEnding,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}

function buildEmailHtml(opts: {
  label: string | null; weekLabel: string; scopeLabel: string;
  stats: { green: number; amber: number; red: number; total: number };
}): string {
  // Email HTML: inline hex only (no CSS variables — Gmail/Outlook strip them).
  const brand = '#1a4731';
  const greenHex = '#0F6E56';
  const amberHex = '#854F0B';
  const redHex = '#A32D2D';
  const greeting = opts.label ? `Hi ${esc(opts.label.split(' ')[0])},` : 'Hi,';
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f5f7;margin:0;padding:24px 0;">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px 28px 20px;box-shadow:0 1px 2px rgba(0,0,0,0.06);">
  <h1 style="font-size:20px;color:${brand};margin:0 0 4px;">Trial Tracker Report</h1>
  <p style="font-size:13px;color:#6b7280;margin:0 0 20px;">Week ending ${esc(opts.weekLabel)}</p>

  <p style="font-size:14px;color:#111;margin:0 0 12px;">${esc(greeting)}</p>
  <p style="font-size:14px;color:#111;margin:0 0 16px;line-height:1.5;">
    Attached is this week's Trial Tracker report covering
    <strong>${esc(opts.scopeLabel)}</strong>.
  </p>

  <table style="border-collapse:collapse;margin:8px 0 20px;">
    <tr>
      <td style="padding:6px 12px;background:#f9fafb;border-radius:8px;">
        <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">Updates</div>
        <div style="font-size:20px;color:#111;font-weight:700;">${opts.stats.total}</div>
      </td>
      <td style="width:12px;"></td>
      <td style="padding:6px 12px;background:#f0fdf4;border-radius:8px;">
        <div style="font-size:11px;color:${greenHex};text-transform:uppercase;letter-spacing:0.04em;">Green</div>
        <div style="font-size:20px;color:${greenHex};font-weight:700;">${opts.stats.green}</div>
      </td>
      <td style="width:12px;"></td>
      <td style="padding:6px 12px;background:#fef3c7;border-radius:8px;">
        <div style="font-size:11px;color:${amberHex};text-transform:uppercase;letter-spacing:0.04em;">Amber</div>
        <div style="font-size:20px;color:${amberHex};font-weight:700;">${opts.stats.amber}</div>
      </td>
      <td style="width:12px;"></td>
      <td style="padding:6px 12px;background:#fee2e2;border-radius:8px;">
        <div style="font-size:11px;color:${redHex};text-transform:uppercase;letter-spacing:0.04em;">Red</div>
        <div style="font-size:20px;color:${redHex};font-weight:700;">${opts.stats.red}</div>
      </td>
    </tr>
  </table>

  <p style="font-size:13px;color:#6b7280;margin:0 0 4px;line-height:1.5;">
    The .docx uses the same format as the Trials section at the bottom of
    Jason's weekly report, so you can save a copy or forward it as-is.
  </p>

  <p style="font-size:11px;color:#9ca3af;text-align:center;margin:28px 0 0;">
    Scheduled every Thursday at 12 PM. Admin manages recipients in the CRM Admin page.
  </p>
</div></body></html>`;
}

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

async function sendWithRetry(opts: {
  apiKey: string; from: string; to: string; subject: string; html: string;
  attachment: { filename: string; b64: string };
}): Promise<void> {
  const body = JSON.stringify({
    from: opts.from,
    to: [opts.to],
    subject: opts.subject,
    html: opts.html,
    attachments: [{ filename: opts.attachment.filename, content: opts.attachment.b64 }],
    tags: [{ name: 'app', value: 'crm' }, { name: 'kind', value: 'trial-weekly' }],
  });
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` };

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers, body });
    if (res.ok) return;
    if (res.status === 429 && attempt === 0) {
      const retryAfter = Number(res.headers.get('retry-after')) || 0;
      await new Promise((r) => setTimeout(r, Math.max(1500, retryAfter * 1000)));
      continue;
    }
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { message?: string }).message || `Resend ${res.status}`);
  }
  throw new Error('Resend 429 after retry');
}
