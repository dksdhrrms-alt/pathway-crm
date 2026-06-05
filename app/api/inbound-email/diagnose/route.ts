import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DiagnoseBody {
  from?: string;
  subject?: string;
  text?: string;
  html?: string;
  to?: string[] | string;
  cc?: string[] | string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  headers?: any;
}

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization') || '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: DiagnoseBody;
  try { body = (await request.json()) as DiagnoseBody; }
  catch { return NextResponse.json({ error: 'Bad JSON body' }, { status: 400 }); }

  const fromEmail = extractEmail(body.from || '');
  if (!fromEmail) {
    return NextResponse.json({ ok: false, step: 'no-from', reason: 'Could not parse from address' });
  }

  const whitelistRaw = process.env.RESEND_FROM_WHITELIST_DOMAINS || 'pathway-intermediates.com';
  const whitelist = whitelistRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const fromDomain = fromEmail.split('@')[1]?.toLowerCase() || '';
  const whitelistOk = whitelist.includes(fromDomain);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Supabase admin credentials missing' }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRow } = await supabase
    .from('users')
    .select('id, email, name')
    .eq('email', fromEmail.toLowerCase())
    .maybeSingle();

  const headerCandidates = extractHeaderRecipients(body.headers);
  const toList = Array.isArray(body.to) ? body.to : body.to ? [body.to] : [];
  const ccList = Array.isArray(body.cc) ? body.cc : body.cc ? [body.cc] : [];
  const envelopeCandidates = uniqueLower([
    ...toList.map(extractEmail),
    ...ccList.map(extractEmail),
  ].filter(Boolean));

  const bodyForParse = (body.text || htmlToPlain(body.html || '') || '').trim();
  const forwardedCandidates = extractForwardedRecipients(bodyForParse);
  const allCandidates = uniqueLower([
    ...forwardedCandidates,
    ...headerCandidates,
    ...envelopeCandidates,
  ]);
  const realCandidates = allCandidates.filter(
    (e) => !e.endsWith('@log.pathway-intermediates.com') && !e.startsWith('crm@log.'),
  );

  let matchedContactId: string | null = null;
  let matchedAccountId: string | null = null;
  let matchedVia: string | null = null;
  let matchedEmail: string | null = null;

  if (realCandidates.length > 0) {
    const orFilter = realCandidates.map((e) => `email.ilike.${e}`).join(',');
    const { data: contactRows } = await supabase
      .from('contacts')
      .select('id, email, account_id')
      .is('archived_at', null)
      .or(orFilter);
    const first = contactRows && contactRows[0];
    if (first) {
      matchedContactId = first.id as string;
      matchedAccountId = (first.account_id as string) || null;
      matchedEmail = first.email as string;
      const ce = (first.email as string || '').toLowerCase();
      matchedVia = forwardedCandidates.includes(ce)
        ? 'forwarded'
        : headerCandidates.includes(ce)
          ? 'header'
          : 'envelope';
    }
  }

  const bodyScanHits: string[] = [];
  if (!matchedContactId && !matchedAccountId) {
    const bodyForScan = (body.text || htmlToPlain(body.html || '') || '').toLowerCase();
    const emailRegex = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g;
    const hits = [...new Set((bodyForScan.match(emailRegex) || []))]
      .filter((e) => !e.endsWith('@log.pathway-intermediates.com'))
      .filter((e) => !e.endsWith('@pathway-intermediates.com'))
      .slice(0, 30);
    bodyScanHits.push(...hits);
    if (hits.length > 0) {
      const orFilter = hits.map((e) => `email.ilike.${e}`).join(',');
      const { data: rows } = await supabase
        .from('contacts')
        .select('id, email, account_id')
        .is('archived_at', null)
        .or(orFilter);
      const hit = rows && rows[0];
      if (hit) {
        matchedContactId = hit.id as string;
        matchedAccountId = (hit.account_id as string) || null;
        matchedEmail = hit.email as string;
        matchedVia = 'body-scan';
      }
    }
  }

  const subjectLower = (body.subject || '').toLowerCase();
  let subjectAccountHit: { id: string; name: string } | null = null;
  if (!matchedContactId && !matchedAccountId && subjectLower) {
    const { data: accts } = await supabase.from('accounts').select('id, name').range(0, 4999);
    let best: { id: string; name: string; len: number } | null = null;
    for (const a of accts || []) {
      const n = String(a.name || '').trim();
      if (n.length < 4) continue;
      if (subjectLower.includes(n.toLowerCase()) && (!best || n.length > best.len)) {
        best = { id: a.id as string, name: n, len: n.length };
      }
    }
    if (best) {
      subjectAccountHit = { id: best.id, name: best.name };
      matchedAccountId = best.id;
      matchedVia = 'subject-account';
    }
  }

  const replyPrefixRegex = /^\s*(re|fwd|fw|antw|wg|sv|tr|rv|ant|aw|enc)\s*:\s*/i;
  const rawSubject = body.subject || '';
  const isReply = replyPrefixRegex.test(rawSubject);
  let cleanSubject = rawSubject;
  for (let i = 0; i < 3 && replyPrefixRegex.test(cleanSubject); i++) {
    cleanSubject = cleanSubject.replace(replyPrefixRegex, '');
  }
  cleanSubject = cleanSubject.trim();

  let replyParent: { id: string; subject: string; contact_id: string | null; account_id: string | null } | null = null;
  if (!matchedContactId && !matchedAccountId && userRow && isReply && cleanSubject.length >= 3) {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { data: parents } = await supabase
      .from('activities')
      .select('id, subject, contact_id, account_id, date')
      .eq('type', 'Email')
      .eq('owner_id', userRow.id)
      .ilike('subject', `%${cleanSubject}%`)
      .is('archived_at', null)
      .gte('date', since)
      .order('date', { ascending: true })
      .limit(20);
    const normalize = (s: string) => {
      let v = (s || '').replace(/^📨\s*/, '');
      for (let i = 0; i < 3 && replyPrefixRegex.test(v); i++) v = v.replace(replyPrefixRegex, '');
      return v.trim().toLowerCase();
    };
    const target = (parents || []).find((c) => normalize(c.subject) === cleanSubject.toLowerCase());
    if (target && (target.contact_id || target.account_id)) {
      replyParent = {
        id: target.id as string,
        subject: target.subject as string,
        contact_id: (target.contact_id as string) || null,
        account_id: (target.account_id as string) || null,
      };
      matchedContactId = replyParent.contact_id;
      matchedAccountId = replyParent.account_id;
      matchedVia = 'reply-parent';
    }
  }

  if (!matchedVia) matchedVia = 'none';

  let contactDetail: { id: string; name: string | null; email: string | null; account_id: string | null } | null = null;
  let accountDetail: { id: string; name: string } | null = null;
  if (matchedContactId) {
    const { data } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, email, account_id')
      .eq('id', matchedContactId)
      .maybeSingle();
    if (data) {
      const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null;
      contactDetail = {
        id: data.id as string,
        name,
        email: (data.email as string) || null,
        account_id: (data.account_id as string) || null,
      };
    }
  }
  if (matchedAccountId) {
    const { data } = await supabase
      .from('accounts')
      .select('id, name')
      .eq('id', matchedAccountId)
      .maybeSingle();
    if (data) accountDetail = { id: data.id as string, name: (data.name as string) || '' };
  }

  return NextResponse.json({
    ok: true,
    note: 'dry-run; no DB writes',
    input: {
      from: fromEmail,
      subject: body.subject || '',
      is_reply: isReply,
      clean_subject: cleanSubject,
    },
    whitelist: { from_domain: fromDomain, ok: whitelistOk, allowed: whitelist },
    sender: userRow
      ? { id: userRow.id, email: userRow.email, name: userRow.name }
      : null,
    candidates: {
      forwarded: forwardedCandidates,
      header: headerCandidates,
      envelope: envelopeCandidates,
      after_self_filter: realCandidates,
      body_scan_hits: bodyScanHits,
      subject_account_hit: subjectAccountHit,
    },
    reply_parent: replyParent,
    matched: {
      via: matchedVia,
      contact_id: matchedContactId,
      account_id: matchedAccountId,
      matched_email: matchedEmail,
      contact: contactDetail,
      account: accountDetail,
    },
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: '/api/inbound-email/diagnose',
    method: 'POST',
    body_shape: '{ from, subject?, text?, html?, to?, cc?, headers? }',
    auth: 'Authorization: Bearer $CRON_SECRET',
    note: 'Mirrors the BCC matching pipeline (forwarded → header → envelope → body-scan → subject-account → reply-parent). Read-only.',
  });
}

function extractEmail(raw: string): string {
  if (!raw) return '';
  const m = raw.match(/<([^>]+)>/);
  const candidate = (m ? m[1] : raw).trim().toLowerCase();
  return /\S+@\S+\.\S+/.test(candidate) ? candidate : '';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractHeaderRecipients(headers: any): string[] {
  if (!headers) return [];
  const collected: string[] = [];
  function pickFrom(value: unknown) {
    if (!value) return;
    if (typeof value === 'string') {
      for (const part of value.split(',')) {
        const e = extractEmail(part);
        if (e) collected.push(e);
      }
      return;
    }
    if (Array.isArray(value)) { for (const v of value) pickFrom(v); return; }
  }
  try {
    if (typeof headers === 'string') {
      for (const line of headers.split(/\r?\n/)) {
        const m = line.match(/^(to|cc):\s*(.*)$/i);
        if (m) pickFrom(m[2]);
      }
    } else if (Array.isArray(headers)) {
      for (const h of headers) {
        if (h && typeof h === 'object' && /^(to|cc)$/i.test(String(h.name || h.key || ''))) {
          pickFrom(h.value ?? h.values);
        }
      }
    } else if (typeof headers === 'object') {
      for (const key of Object.keys(headers)) {
        if (/^(to|cc)$/i.test(key)) pickFrom(headers[key]);
      }
    }
  } catch { /* ignore */ }
  return uniqueLower(collected);
}

function extractForwardedRecipients(body: string): string[] {
  if (!body) return [];
  const collected: string[] = [];
  const markerRegex = /(?:-+\s*(?:Original Message|Forwarded message|Original)\s*-+|^Begin forwarded message:|_{10,})/gim;
  const markers: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = markerRegex.exec(body)) !== null) markers.push(m.index);
  const bareHeaderRegex = /^From:\s+.+\n(?:^Sent:\s+.+\n|^Date:\s+.+\n)/gim;
  while ((m = bareHeaderRegex.exec(body)) !== null) markers.push(m.index);
  if (markers.length === 0) return [];
  for (const start of markers) {
    const window = body.slice(start, start + 2000);
    const fromMatch = window.match(/^\s*From:\s*(.+)$/im);
    const toMatch = window.match(/^\s*To:\s*(.+)$/im);
    const ccMatch = window.match(/^\s*Cc:\s*(.+)$/im);
    for (const line of [fromMatch?.[1], toMatch?.[1], ccMatch?.[1]]) {
      if (!line) continue;
      for (const part of line.split(/[,;]/)) {
        const e = extractEmail(part);
        if (e) collected.push(e);
      }
    }
  }
  return uniqueLower(collected);
}

function uniqueLower(arr: string[]): string[] {
  const set = new Set<string>();
  for (const v of arr) {
    const s = (v || '').trim().toLowerCase();
    if (s) set.add(s);
  }
  return [...set];
}

function htmlToPlain(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
