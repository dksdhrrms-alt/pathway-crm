import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

/**
 * Inbound email webhook (Postmark → CRM).
 *
 * We migrated off Resend Inbound because Resend's webhook payload
 * ships metadata only — no `text`/`html` body, and BCC delivery
 * strips the original `To:` header so contact matching had no
 * signal to work with. Postmark's `Inbound Stream` webhook ships
 * everything we need in one JSON:
 *   TextBody / HtmlBody     — the actual message body
 *   Headers[]               — full RFC-2822 header list (incl. original To on BCC)
 *   OriginalRecipient       — the address Postmark WAS delivered to
 *   FromFull / ToFull / CcFull / BccFull — structured recipients
 *
 * Pipeline
 *   1. Auth: URL token OR Postmark-Webhook-Token header must match
 *      POSTMARK_WEBHOOK_TOKEN. Postmark doesn't sign like Resend
 *      does — its recommended flow is HTTP basic auth OR a random
 *      token in the webhook URL.
 *   2. Reject anything whose FROM domain isn't whitelisted
 *      (default: pathway-intermediates.com).
 *   3. Look up the sender in `users` (email match).
 *   4. Find the real recipient. Priority:
 *        (a) header `To:` — usually preserved on BCC deliveries
 *        (b) ToFull / CcFull (envelope) minus our inbound address
 *        (c) OriginalRecipient minus our inbound address
 *        (d) email regex scan of the body — signature blocks, quoted
 *            replies, etc.
 *   5. Match the first recipient email that belongs to a contact.
 *   6. Insert an Activity row keyed off MessageID (idempotent).
 *
 * Required env
 *   POSTMARK_WEBHOOK_TOKEN   — random string, appears in the webhook URL
 *                              e.g. https://…/api/postmark/inbound?token=XXX
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional
 *   RESEND_FROM_WHITELIST_DOMAINS   — reused (comma-separated)
 *   POSTMARK_INBOUND_ADDRESS        — our own inbound mailbox address,
 *                                     filtered out of recipient candidates.
 *                                     Default: crm@log.pathway-intermediates.com
 */

// ── Types ────────────────────────────────────────────────────────

interface PostmarkAddress { Email?: string; Name?: string; MailboxHash?: string }
interface PostmarkHeader  { Name: string; Value: string }

interface PostmarkInboundBody {
  FromName?: string;
  From?: string;
  FromFull?: PostmarkAddress;
  To?: string;
  ToFull?: PostmarkAddress[];
  Cc?: string;
  CcFull?: PostmarkAddress[];
  Bcc?: string;
  BccFull?: PostmarkAddress[];
  OriginalRecipient?: string;
  Subject?: string;
  MessageID?: string;
  Date?: string;
  TextBody?: string;
  HtmlBody?: string;
  StrippedTextReply?: string;
  Headers?: PostmarkHeader[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Attachments?: any[];
}

// ── Route handlers ───────────────────────────────────────────────

export async function GET(req: NextRequest) {
  return NextResponse.json({
    ok: true,
    route: '/api/postmark/inbound',
    method: 'POST expected for Postmark inbound webhooks',
    token_configured: !!process.env.POSTMARK_WEBHOOK_TOKEN,
    service_role_configured: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    token_query_present: !!req.nextUrl.searchParams.get('token'),
  });
}

export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────
  const expected = process.env.POSTMARK_WEBHOOK_TOKEN;
  if (!expected) {
    console.warn('[postmark-inbound] POSTMARK_WEBHOOK_TOKEN not set — refusing');
    return NextResponse.json({ error: 'not-configured' }, { status: 503 });
  }
  const supplied =
    req.nextUrl.searchParams.get('token') ||
    req.headers.get('postmark-webhook-token') ||
    '';
  if (supplied !== expected) {
    console.warn('[postmark-inbound] token mismatch');
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // ── Parse body ──────────────────────────────────────────────────
  let payload: PostmarkInboundBody;
  try { payload = await req.json() as PostmarkInboundBody; }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  // Wrap so we always 200 back — Postmark retries on non-2xx and
  // hammer-mode retries flood the logs. Real errors go to console.
  let processed = false;
  let note: string | undefined;
  try {
    const result = await processInbound(payload);
    processed = result.processed;
    note = result.note;
  } catch (err) {
    console.error('[postmark-inbound] processing error:', err instanceof Error ? err.message : String(err));
    note = 'processing-error';
  }
  return NextResponse.json({ ok: true, processed, note });
}

// ── Processing pipeline ──────────────────────────────────────────

interface ProcessResult { processed: boolean; note?: string }

async function processInbound(p: PostmarkInboundBody): Promise<ProcessResult> {
  console.warn('[postmark-inbound] start', {
    from: p.From,
    subject: p.Subject,
    messageId: p.MessageID,
    text_len: (p.TextBody || '').length,
    html_len: (p.HtmlBody || '').length,
    to_count: p.ToFull?.length ?? 0,
    cc_count: p.CcFull?.length ?? 0,
    original_recipient: p.OriginalRecipient,
    header_count: p.Headers?.length ?? 0,
  });

  const fromEmail = extractEmail(p.FromFull?.Email || p.From || '');
  if (!fromEmail) return { processed: false, note: 'no-from' };

  // ── Whitelist ───────────────────────────────────────────────────
  const wl = (process.env.RESEND_FROM_WHITELIST_DOMAINS || 'pathway-intermediates.com')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const fromDomain = fromEmail.split('@')[1]?.toLowerCase() || '';
  if (!wl.includes(fromDomain)) {
    console.warn('[postmark-inbound] not whitelisted:', fromDomain);
    return { processed: false, note: 'from-domain-not-whitelisted' };
  }

  // ── Supabase (service role) ─────────────────────────────────────
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { processed: false, note: 'missing-supabase-admin' };
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // ── Match sender → CRM user ─────────────────────────────────────
  const { data: userRow } = await sb.from('users').select('id, email')
    .eq('email', fromEmail.toLowerCase()).maybeSingle();
  if (!userRow) {
    console.warn('[postmark-inbound] sender not in CRM:', fromEmail);
    return { processed: false, note: 'sender-not-in-crm' };
  }
  const ownerId = userRow.id as string;

  // ── Recipient candidates ────────────────────────────────────────
  const ourAddress = (process.env.POSTMARK_INBOUND_ADDRESS
    || 'crm@log.pathway-intermediates.com').toLowerCase();
  const isOurs = (e: string) => {
    const lc = e.toLowerCase();
    return lc === ourAddress
      || lc.endsWith('@log.pathway-intermediates.com')
      || lc.startsWith('crm@log.');
  };

  const fromHeaderTo = extractHeader(p.Headers, 'To');
  const fromHeaderCc = extractHeader(p.Headers, 'Cc');
  const headerCandidates = uniqueLower([
    ...extractEmails(fromHeaderTo || ''),
    ...extractEmails(fromHeaderCc || ''),
  ]);
  const envelopeCandidates = uniqueLower([
    ...(p.ToFull || []).map((a) => extractEmail(a.Email || '')),
    ...(p.CcFull || []).map((a) => extractEmail(a.Email || '')),
    extractEmail(p.OriginalRecipient || ''),
  ].filter(Boolean));

  const bodyText = (p.TextBody || htmlToPlain(p.HtmlBody || '') || '').trim();
  const forwardedCandidates = extractForwardedRecipients(bodyText);

  const allCandidates = uniqueLower([
    ...forwardedCandidates,
    ...headerCandidates,
    ...envelopeCandidates,
  ]).filter((e) => !isOurs(e));

  console.warn('[postmark-inbound] recipient sources', {
    header_count: headerCandidates.length,
    envelope_count: envelopeCandidates.length,
    forwarded_count: forwardedCandidates.length,
    combined: allCandidates.slice(0, 5),
  });

  let matchedContactId: string | null = null;
  let matchedAccountId: string | null = null;

  if (allCandidates.length > 0) {
    const orFilter = allCandidates.map((e) => `email.ilike.${e}`).join(',');
    const { data: contactRows } = await sb.from('contacts')
      .select('id, email, account_id')
      .is('archived_at', null)
      .or(orFilter);
    const first = contactRows?.[0];
    if (first) {
      matchedContactId = first.id as string;
      matchedAccountId = (first.account_id as string) || null;
    }
  }

  // Body-scan fallback — any email-shape substring anywhere in the
  // message. Skips our own domain to avoid self-match on signatures.
  if (!matchedContactId && bodyText) {
    const emailRegex = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
    const found = uniqueLower(bodyText.match(emailRegex) || [])
      .filter((e) => !isOurs(e) && !e.endsWith('@pathway-intermediates.com'));
    if (found.length > 0) {
      const orFilter = found.slice(0, 20).map((e) => `email.ilike.${e}`).join(',');
      const { data: contactRows } = await sb.from('contacts')
        .select('id, email, account_id')
        .is('archived_at', null)
        .or(orFilter);
      const first = contactRows?.[0];
      if (first) {
        matchedContactId = first.id as string;
        matchedAccountId = (first.account_id as string) || null;
        console.warn('[postmark-inbound] body-scan matched:', first.email);
      }
    }
  }

  // Last-resort: sender's most recent contact interaction. Only fires
  // when we have zero recipient signal — same fallback the Resend
  // route uses.
  if (!matchedContactId) {
    const { data: recent } = await sb.from('activities')
      .select('contact_id, account_id, date').eq('owner_id', ownerId)
      .not('contact_id', 'is', null)
      .order('date', { ascending: false }).limit(1);
    if (recent && recent[0]) {
      matchedContactId = (recent[0].contact_id as string) || null;
      matchedAccountId = (recent[0].account_id as string) || null;
      console.warn('[postmark-inbound] fallback to recent contact:', matchedContactId);
    }
  }

  // ── Insert Activity ─────────────────────────────────────────────
  const MAX_DESC = 8000;
  const truncated = bodyText.length > MAX_DESC ? bodyText.slice(0, MAX_DESC) + '\n\n[...truncated]' : bodyText;
  const description = truncated || `(Body unavailable)\nFrom: ${fromEmail}\nSubject: ${p.Subject || ''}`;

  const activityId = `act-pm-${(p.MessageID || '').replace(/[^a-z0-9]/gi, '').slice(0, 40) || Date.now().toString(36)}`;
  const dateOnly = (p.Date ? new Date(p.Date) : new Date()).toISOString().split('T')[0];

  const { error: insErr } = await sb.from('activities').insert({
    id: activityId,
    type: 'Email',
    subject: p.Subject || '(no subject)',
    description,
    date: dateOnly,
    owner_id: ownerId,
    account_id: matchedAccountId,
    contact_id: matchedContactId,
  });
  if (insErr) {
    // Unique-key violation = we've already recorded this MessageID.
    // Treat as success so Postmark stops retrying.
    if ((insErr as { code?: string }).code === '23505') {
      console.warn('[postmark-inbound] duplicate MessageID, already recorded');
      return { processed: true, note: 'duplicate' };
    }
    console.error('[postmark-inbound] insert error:', insErr.message);
    return { processed: false, note: 'insert-failed' };
  }
  console.warn('[postmark-inbound] inserted activity', activityId);
  return { processed: true };
}

// ── Helpers ──────────────────────────────────────────────────────

function extractEmail(raw: string): string {
  if (!raw) return '';
  const m = raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? m[0].toLowerCase() : '';
}

function extractEmails(raw: string): string[] {
  if (!raw) return [];
  const matches = raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  return matches.map((s) => s.toLowerCase());
}

function extractHeader(headers: PostmarkHeader[] | undefined, name: string): string | null {
  if (!headers) return null;
  const wanted = name.toLowerCase();
  const h = headers.find((x) => (x.Name || '').toLowerCase() === wanted);
  return h?.Value || null;
}

function uniqueLower(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    if (!s) continue;
    const lc = s.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);
    out.push(lc);
  }
  return out;
}

function htmlToPlain(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Pull recipient emails out of forwarded-message markers commonly
 * placed inside the body when a user forwards or replies.
 */
function extractForwardedRecipients(body: string): string[] {
  if (!body) return [];
  const out: string[] = [];
  const markers = [
    /-{2,}\s*Forwarded message\s*-{2,}/i,
    /-{2,}\s*Original Message\s*-{2,}/i,
    // `s` (dotAll) flag was added in ES2018 and tsconfig here targets
    // an older lib. `[\s\S]` is the same thing without the flag.
    /From:[\s\S]+?\nSent:[\s\S]+?\nTo:.+/i,
  ];
  for (const rx of markers) {
    const idx = body.search(rx);
    if (idx >= 0) {
      const chunk = body.slice(idx, idx + 2000);
      const toLine = chunk.match(/^\s*To:\s*(.+)$/im);
      if (toLine) out.push(...extractEmails(toLine[1]));
      const ccLine = chunk.match(/^\s*Cc:\s*(.+)$/im);
      if (ccLine) out.push(...extractEmails(ccLine[1]));
    }
  }
  return uniqueLower(out);
}
