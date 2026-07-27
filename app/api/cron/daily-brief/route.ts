/**
 * GET /api/cron/daily-brief
 *
 * Weekday "morning brief" email. For every user who opted in
 * (users.daily_email = true, active, with an email), sends a
 * personalized email containing:
 *   1. My Focus       — overdue / due-today open tasks
 *   2. My Tasks       — upcoming open tasks
 *   3. My Open Deals  — pipeline snapshot (top 5 by amount)
 *
 * Mirrors the BioMatrix daily-brief route but wired to Resend (which
 * is already the outbound email provider for /api/send-email in this
 * project) instead of nodemailer/Gmail. Uses the same env conventions
 * as send-email so no extra secrets are required beyond RESEND_API_KEY
 * and RESEND_OUTBOUND_FROM_OVERRIDE (falls back to a sane default).
 *
 * Auth: Authorization: Bearer ${CRON_SECRET} (Vercel Cron sends it).
 * Schedule (vercel.json): `0 13 * * 1-5` = 13:00 UTC Mon–Fri (weekdays)
 *   = 8am US Central during CDT (summer) / 7am during CST (winter).
 *   Vercel cron is UTC and does not follow DST. Switch to `0 12 * * *`
 *   if you need 7am year-round.
 */
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { COMMODITIES, fmtPrice, pctDelta } from '@/lib/commodities';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://pathway-crm.vercel.app';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function fmtDue(d: string, today: string): string {
  if (!d) return '';
  if (d < today) return `⚠️ Overdue (${d})`;
  if (d === today) return 'Due today';
  return `Due ${d}`;
}
function fmtCurrency(n: number): string {
  if (!n && n !== 0) return '';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

interface EmailTask { subject?: string; due_date?: string; account?: string }
interface EmailOpp { name?: string; stage?: string; amount?: number; account?: string; close_date?: string }

function buildHtml(
  name: string,
  focus: EmailTask[],
  tasks: EmailTask[],
  opps: EmailOpp[],
  marketHtml: string,
  newsHtml: string,
  today: string,
): string {
  // Pathway's brand green from the login screen (#1a4731) so the
  // email looks like it came from the CRM the reps already use.
  const accent = '#1a4731';
  const taskItem = (t: EmailTask) =>
    `<tr><td style="padding:6px 0;border-bottom:1px solid #eee;">
        <div style="font-size:14px;color:#111;font-weight:600;">${esc(t.subject) || '(no subject)'}</div>
        <div style="font-size:12px;color:#6b7280;">${esc(t.account || '')}${t.account ? ' · ' : ''}${esc(fmtDue(t.due_date || '', today))}</div>
     </td></tr>`;
  const oppItem = (o: EmailOpp) =>
    `<tr><td style="padding:6px 0;border-bottom:1px solid #eee;">
        <div style="font-size:14px;color:#111;font-weight:600;">${esc(o.name) || '(no name)'} <span style="color:${accent};font-weight:700;">${esc(fmtCurrency(Number(o.amount) || 0))}</span></div>
        <div style="font-size:12px;color:#6b7280;">${esc(o.account || '')}${o.account && o.stage ? ' · ' : ''}${esc(o.stage || '')}${o.close_date ? ' · Close ' + esc(o.close_date) : ''}</div>
     </td></tr>`;

  const focusHtml = focus.length
    ? `<table width="100%" cellpadding="0" cellspacing="0">${focus.map(taskItem).join('')}</table>`
    : `<p style="font-size:14px;color:#0f6e56;margin:4px 0;">All caught up 🎉 Nothing overdue or due today.</p>`;
  const tasksHtml = tasks.length
    ? `<table width="100%" cellpadding="0" cellspacing="0">${tasks.map(taskItem).join('')}</table>`
    : `<p style="font-size:14px;color:#6b7280;margin:4px 0;">No upcoming tasks.</p>`;
  const oppsHtml = opps.length
    ? `<table width="100%" cellpadding="0" cellspacing="0">${opps.map(oppItem).join('')}</table>`
    : `<p style="font-size:14px;color:#6b7280;margin:4px 0;">No open opportunities right now.</p>`;

  const section = (title: string, body: string) =>
    `<div style="margin:0 0 22px 0;">
       <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:${accent};margin:0 0 8px 0;">${title}</div>
       ${body}
     </div>`;

  return `<!DOCTYPE html><html><body style="margin:0;background:#f5f5f7;font-family:Helvetica,Arial,sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:20px;">
      <div style="background:#ffffff;border-radius:14px;padding:24px;">
        <div style="border-bottom:2px solid ${accent};padding-bottom:12px;margin-bottom:20px;">
          <div style="font-size:20px;font-weight:800;color:${accent};">Pathway Intermediates USA</div>
          <div style="font-size:15px;color:#111;margin-top:2px;">Good morning, ${esc(name)}.</div>
          <div style="font-size:12px;color:#9ca3af;">${esc(today)} · your daily brief</div>
        </div>
        ${section('My Focus', focusHtml)}
        ${section('My Tasks', tasksHtml)}
        ${section('My Open Deals', oppsHtml)}
        ${section("Today's Feed Market", marketHtml)}
        ${section('Industry News', newsHtml)}
        <div style="text-align:center;margin-top:8px;">
          <a href="${APP_URL}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;">Open in CRM</a>
        </div>
      </div>
      <p style="font-size:11px;color:#9ca3af;text-align:center;margin:14px 0 0;">
        You're receiving this because the daily brief is enabled for your account.
        Turn it off any time in your Profile.
      </p>
    </div></body></html>`;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const isPlaceholder = !apiKey || apiKey.includes('placeholder');
  if (isPlaceholder) {
    return Response.json({ sent: 0, skipped: 'no RESEND_API_KEY configured' });
  }
  // Resend requires a verified sender. We prefer the outbound-from
  // override that /api/send-email already uses so operators only need
  // to set one env var; otherwise fall back to a project default that
  // must exist on Resend.
  const from = process.env.RESEND_OUTBOUND_FROM_OVERRIDE
    || process.env.EMAIL_FROM
    || 'Pathway CRM <notifications@pathway-intermediates.com>';

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || '';
  if (!url || !key) return Response.json({ error: 'No Supabase config' }, { status: 500 });
  const sb = createClient(url, key);

  const today = new Date().toISOString().split('T')[0];

  // ── Shared: commodity market ──
  // Latest close per commodity + day-over-day % delta. Shared across
  // all recipients (same market data).
  const since = new Date(Date.now() - 20 * 86400000).toISOString().split('T')[0];
  const { data: prices } = await sb.from('commodity_prices')
    .select('commodity_key, date, price, unit').gte('date', since).order('date', { ascending: false });
  const byKey = new Map<string, { date: string; price: number; unit: string }[]>();
  for (const r of prices || []) {
    const arr = byKey.get(r.commodity_key) || [];
    arr.push({ date: r.date, price: Number(r.price), unit: r.unit });
    byKey.set(r.commodity_key, arr);
  }
  const marketRows = COMMODITIES.map((cfg) => {
    const rows = byKey.get(cfg.key) || [];
    const latest = rows[0];
    if (!latest) return '';
    const prev = rows[1];
    const pct = prev ? pctDelta(latest.price, prev.price) : null;
    const unitShort = cfg.unit.replace('USD/', '').replace('cents/', '¢/');
    const chg = pct == null ? '' : `<span style="color:${pct > 0 ? '#dc2626' : pct < 0 ? '#0f6e56' : '#6b7280'};font-size:12px;">${pct > 0 ? '▲' : pct < 0 ? '▼' : ''} ${Math.abs(pct).toFixed(1)}%</span>`;
    return `<tr>
      <td style="padding:4px 0;font-size:13px;color:#111;">${esc(cfg.label)}</td>
      <td style="padding:4px 0;font-size:13px;color:#111;text-align:right;font-weight:600;">${fmtPrice(latest.price, cfg.unit)} <span style="color:#9ca3af;font-size:11px;">${esc(unitShort)}</span></td>
      <td style="padding:4px 0;text-align:right;">${chg}</td>
    </tr>`;
  }).filter(Boolean).join('');
  const marketHtml = marketRows
    ? `<table width="100%" cellpadding="0" cellspacing="0">${marketRows}</table>`
    : `<p style="font-size:13px;color:#6b7280;">No market data yet.</p>`;

  // ── Shared: industry news ──
  // Take today's top curated picks (whatever the latest surface_date
  // batch was). Same list for every recipient.
  const { data: news } = await sb.from('industry_news')
    .select('title, summary, source_url, source_name, category, surface_date')
    .order('surface_date', { ascending: false }).limit(10);
  const latestNewsDate = news?.[0]?.surface_date;
  const newsPicks = (news || []).filter((n) => n.surface_date === latestNewsDate).slice(0, 3);
  const newsHtml = newsPicks.length
    ? newsPicks.map((n) => `<div style="margin-bottom:12px;">
        <a href="${esc(n.source_url)}" style="font-size:14px;font-weight:600;color:#1a4731;text-decoration:none;">${esc(n.title)}</a>
        <div style="font-size:12px;color:#4b5563;margin-top:2px;">${esc(n.summary)}</div>
        <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${esc(n.source_name)}${n.category ? ' · ' + esc(n.category) : ''}</div>
      </div>`).join('')
    : `<p style="font-size:13px;color:#6b7280;">No news today.</p>`;

  // ── Recipients ──
  const { data: recipients } = await sb.from('users')
    .select('id, name, email, daily_email, status')
    .eq('daily_email', true).eq('status', 'active');
  const list = (recipients || []).filter((u) => u.email && String(u.email).includes('@'));
  if (list.length === 0) return Response.json({ sent: 0, note: 'no opted-in recipients' });

  // ── Tasks (all open, we filter per owner below) ──
  const { data: tasks } = await sb.from('tasks')
    .select('subject, due_date, status, owner_id, related_account_id').neq('status', 'Completed');
  const { data: accounts } = await sb.from('accounts').select('id, name');
  const acctName = new Map((accounts || []).map((a) => [a.id, a.name]));
  const openByOwner = new Map<string, EmailTask[]>();
  for (const t of tasks || []) {
    const arr = openByOwner.get(t.owner_id) || [];
    arr.push({
      subject: t.subject,
      due_date: t.due_date,
      account: t.related_account_id ? acctName.get(t.related_account_id) : '',
    });
    openByOwner.set(t.owner_id, arr);
  }

  // ── Opportunities (open by owner) ──
  // "Open" = anything not Closed Won / Closed Lost. Pipeline-only so
  // the brief celebrates what's in flight, not what's already done.
  const { data: opps } = await sb.from('opportunities')
    .select('name, stage, amount, close_date, owner_id, account_id')
    .not('stage', 'in', '("Closed Won","Closed Lost")');
  const oppsByOwner = new Map<string, EmailOpp[]>();
  for (const o of opps || []) {
    const arr = oppsByOwner.get(o.owner_id) || [];
    arr.push({
      name: o.name,
      stage: o.stage,
      amount: Number(o.amount) || 0,
      close_date: o.close_date,
      account: o.account_id ? acctName.get(o.account_id) : '',
    });
    oppsByOwner.set(o.owner_id, arr);
  }

  // ── Send ──
  let sent = 0;
  const errors: string[] = [];
  for (const u of list) {
    const mine = (openByOwner.get(u.id) || []).sort((a, b) =>
      (a.due_date || '9999').localeCompare(b.due_date || '9999'));
    const focus = mine.filter((t) => t.due_date && t.due_date <= today).slice(0, 6);
    const upcoming = mine.filter((t) => !t.due_date || t.due_date > today).slice(0, 8);
    const myOpps = (oppsByOwner.get(u.id) || [])
      .sort((a, b) => (b.amount || 0) - (a.amount || 0))
      .slice(0, 5);

    const html = buildHtml(u.name || 'there', focus, upcoming, myOpps, marketHtml, newsHtml, today);
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          from,
          to: [u.email],
          subject: `Your Pathway daily brief — ${today}`,
          html,
          tags: [
            { name: 'app', value: 'crm' },
            { name: 'kind', value: 'daily-brief' },
          ],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = (data as { message?: string }).message || `Resend ${res.status}`;
        errors.push(`${u.email}: ${msg}`);
      } else {
        sent++;
      }
    } catch (e) {
      errors.push(`${u.email}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return Response.json({ sent, recipients: list.length, errors: errors.slice(0, 10) });
}
