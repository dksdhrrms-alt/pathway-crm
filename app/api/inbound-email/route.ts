import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
// Inbound emails (especially with attachments) can be sizeable. Give Vercel
// some headroom; Resend retries on timeout so being conservative on the
// upper bound is fine.
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

/**
 * Inbound email webhook (Resend → CRM).
 *
 * Phase 3 (this version): full pipeline. After Svix verification we
 *   1. Parse the event metadata (sender, recipients, subject, email_id).
 *   2. Reject anything from outside the FROM-domain whitelist (default:
 *      pathway-intermediates.com) — keeps strangers from injecting
 *      activities by guessing the public BCC address.
 *   3. Look up the CRM user matching the FROM email (by lowercase match
 *      against `users.email`). No match → ignore the event silently
 *      (logged) since we can't attribute it.
 *   4. Look up a CRM contact whose email matches one of the TO/CC
 *      recipients. First match wins. If none match, the activity is
 *      still created but with empty contactId/accountId so the user
 *      sees an unattached entry they can manually link.
 *   5. Fetch the rendered body via Resend Inbound API (text preferred,
 *      HTML stripped on fallback). Failures here aren't fatal — we log
 *      what we have.
 *   6. Insert an Activity row whose id is deterministically derived
 *      from email_id, so Resend retries collapse into the same row
 *      (unique-key violation = already-recorded, return 200).
 *
 * Security:
 *   - In production we require RESEND_WEBHOOK_SECRET. Without it the
 *     route still 200s but skips verification (loud warning in logs)
 *     so the initial bootstrap on a fresh deploy doesn't get stuck.
 *   - Signature verified via the Resend SDK (Svix under the hood).
 *   - Insert uses the Supabase service role key so we don't have to
 *     ship per-user JWTs through the webhook.
 *
 * Required env (production):
 *   RESEND_WEBHOOK_SECRET                 — Svix signing secret from Resend
 *   RESEND_API_KEY                        — for fetching the rendered body
 *   NEXT_PUBLIC_SUPABASE_URL              — already set for the client
 *   SUPABASE_SERVICE_ROLE_KEY             — server-side insert, bypass RLS
 *
 * Optional:
 *   RESEND_FROM_WHITELIST_DOMAINS         — comma-separated, default
 *                                           "pathway-intermediates.com"
 */

interface InboundEmailEvent {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    bcc?: string[];
    cc?: string[];
    subject?: string;
    message_id?: string;
    // Resend's `email.received` webhook ships the rendered body inline
    // in the webhook payload itself — no separate Receiving API GET
    // needed. (We initially assumed otherwise and 404'd against
    // /emails/{id}, which is the *outbound* email retrieval endpoint.)
    text?: string;
    html?: string;
    attachments?: Array<{ id: string; filename: string; content_type: string }>;
  };
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: '/api/inbound-email',
    method: 'POST expected for Resend inbound webhooks',
    secret_configured: !!process.env.RESEND_WEBHOOK_SECRET,
    service_role_configured: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    api_key_configured: !!process.env.RESEND_API_KEY,
  });
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const rawBody = await req.text();

  const svixId = req.headers.get('svix-id') || '';
  const svixTimestamp = req.headers.get('svix-timestamp') || '';
  const svixSignature = req.headers.get('svix-signature') || '';

  // ── Phase 1 unchanged: signature verification ─────────────────────────
  if (!secret) {
    console.warn('[inbound-email] RESEND_WEBHOOK_SECRET not set — accepting without verification');
    logEventSummary(rawBody, { verified: false });
    return NextResponse.json({ ok: true, verified: false, processed: false });
  }
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { error: 'Missing Svix headers (id / timestamp / signature)' },
      { status: 400 }
    );
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY || 'unused-during-verify');
    resend.webhooks.verify({
      payload: rawBody,
      headers: { id: svixId, timestamp: svixTimestamp, signature: svixSignature },
      webhookSecret: secret,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[inbound-email] signature verification failed:', msg);
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
  }

  logEventSummary(rawBody, { verified: true });

  // ── Phase 3: parse + match + create activity ──────────────────────────
  // Wrapped so we always 200 back to Resend. If processing fails we log
  // and return ok:true,processed:false — never 4xx/5xx, otherwise Resend
  // keeps retrying for hours and floods the logs.
  let processed = false;
  let processingNote: string | undefined;
  try {
    const result = await processInboundEvent(rawBody);
    processed = result.processed;
    processingNote = result.note;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[inbound-email] processing error:', msg);
    processingNote = 'processing-error';
  }

  return NextResponse.json({ ok: true, verified: true, processed, note: processingNote });
}

// ──────────────────────────────────────────────────────────────────────────
//  Processing pipeline
// ──────────────────────────────────────────────────────────────────────────

interface ProcessResult {
  processed: boolean;
  note?: string;
}

async function processInboundEvent(rawBody: string): Promise<ProcessResult> {
  // Diagnostic: every silent-return path used to leave Vercel logs blank
  // after the initial "received" warning, making it impossible to tell
  // whether parsing/whitelist/lookup was at fault. Each step now tags
  // its own checkpoint so the bail point is obvious in production logs.
  console.warn('[inbound-email] processing start');
  let event: InboundEmailEvent | null = null;
  try { event = JSON.parse(rawBody) as InboundEmailEvent; }
  catch {
    console.warn('[inbound-email] bail: bad-json');
    return { processed: false, note: 'bad-json' };
  }
  if (event?.type !== 'email.received') {
    console.warn('[inbound-email] bail: wrong-type, got=', event?.type);
    return { processed: false, note: 'wrong-type' };
  }
  const d = event.data || {};

  const fromEmail = extractEmail(d.from || '');
  if (!fromEmail) {
    console.warn('[inbound-email] bail: no-from, raw d.from=', JSON.stringify(d.from));
    return { processed: false, note: 'no-from' };
  }
  console.warn('[inbound-email] step: extracted fromEmail=', fromEmail);

  // ── 1. Whitelist check ─────────────────────────────────────────────
  const whitelistRaw = process.env.RESEND_FROM_WHITELIST_DOMAINS || 'pathway-intermediates.com';
  const whitelist = whitelistRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const fromDomain = fromEmail.split('@')[1]?.toLowerCase() || '';
  if (!whitelist.includes(fromDomain)) {
    console.warn('[inbound-email] FROM domain not whitelisted, ignoring:', fromDomain);
    return { processed: false, note: 'from-domain-not-whitelisted' };
  }

  // ── Service-role Supabase client ───────────────────────────────────
  // Try multiple env var names — older Vercel envs in this project store
  // the URL as SUPABASE_URL (no NEXT_PUBLIC_ prefix), so falling back
  // covers either configuration.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  console.warn('[inbound-email] step: env check', {
    has_url: !!supabaseUrl,
    has_service_key: !!serviceKey,
    url_source: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'NEXT_PUBLIC' : (process.env.SUPABASE_URL ? 'SUPABASE_URL' : 'none'),
    service_key_prefix: serviceKey ? serviceKey.slice(0, 12) : null,
  });
  if (!supabaseUrl || !serviceKey) {
    console.error('[inbound-email] missing Supabase admin credentials');
    return { processed: false, note: 'missing-supabase-admin' };
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── 2. Match sender → CRM user ─────────────────────────────────────
  console.warn('[inbound-email] step: looking up user by email', fromEmail);
  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('id, email')
    .eq('email', fromEmail.toLowerCase())
    .maybeSingle();
  if (userErr) console.error('[inbound-email] user lookup error:', userErr.message);
  if (!userRow) {
    console.warn('[inbound-email] sender has no CRM user, ignoring:', fromEmail);
    return { processed: false, note: 'sender-not-in-crm' };
  }
  const ownerId = userRow.id as string;
  console.warn('[inbound-email] step: matched user', { ownerId });

  // ── 3. Match recipients → contact ──────────────────────────────────
  // Real recipients live in TO and CC. The inbound BCC address (e.g.
  // crm@log.pathway-intermediates.com) is *us* — never a contact, so we
  // exclude the BCC list to avoid accidentally matching ourselves.
  //
  // Resend's webhook payload sometimes ships `to` / `cc` as plain
  // strings, sometimes as `"Display Name <email@domain>"`. extractEmail
  // handles both. We also log the raw shape in case the format ever
  // shifts again — past silent contact-match failures cost us a debug
  // round-trip.
  console.warn('[inbound-email] step: raw recipients', {
    to_raw: JSON.stringify(d.to ?? []),
    cc_raw: JSON.stringify(d.cc ?? []),
  });
  const recipientCandidates = uniqueLower([
    ...(d.to || []).map(extractEmail),
    ...(d.cc || []).map(extractEmail),
  ].filter(Boolean) as string[]);
  console.warn('[inbound-email] step: extracted recipients', recipientCandidates);

  let matchedContactId: string | null = null;
  let matchedAccountId: string | null = null;
  if (recipientCandidates.length > 0) {
    // Case-insensitive lookup via PostgREST `or(ilike...)` — covers any
    // contact whose email column happens to be stored with a different
    // casing than what arrived in the webhook (e.g. "Dksdhrrms@..."
    // saved by hand vs "dksdhrrms@..." from the email envelope).
    const orFilter = recipientCandidates.map((e) => `email.ilike.${e}`).join(',');
    const { data: contactRows, error: cErr } = await supabase
      .from('contacts')
      .select('id, email, account_id')
      .or(orFilter);
    if (cErr) console.error('[inbound-email] contact lookup error:', cErr.message);
    console.warn('[inbound-email] step: contact lookup result', {
      candidates: recipientCandidates,
      row_count: contactRows?.length ?? 0,
      first_row: contactRows && contactRows[0]
        ? { id: contactRows[0].id, email: contactRows[0].email, account_id: contactRows[0].account_id }
        : null,
    });
    const first = contactRows && contactRows[0];
    if (first) {
      matchedContactId = first.id as string;
      matchedAccountId = (first.account_id as string) || null;
    }
  }

  // ── 4. Get body — straight from webhook payload ────────────────────
  // Resend includes `text` and `html` directly in the email.received
  // payload, so there's no separate fetch. Prefer plain text; fall
  // back to a stripped-HTML approximation if only html is present.
  const emailId = d.email_id || '';
  const bodyText = (d.text || htmlToPlain(d.html || '') || '').trim();
  console.warn('[inbound-email] step: body length=', bodyText.length);

  // Cap to keep activities table sensible. Full text isn't free.
  const MAX_DESC = 8000;
  const truncated = bodyText.length > MAX_DESC ? bodyText.slice(0, MAX_DESC) + '\n\n[...truncated]' : bodyText;
  const description = truncated || `(Body unavailable)\nFrom: ${fromEmail}\nSubject: ${d.subject || ''}`;

  // ── 5. Insert activity (deterministic id for retry-dedup) ─────────
  // Activity id derived from email_id collapses Resend's "at-least-once"
  // retries into a single row via the PK constraint. The id is short to
  // match the rest of the table's ~7-char ids.
  const activityId = emailId ? `email-${emailId.slice(0, 8)}` : `email-${Date.now().toString(36).slice(-8)}`;

  const subject = `📨 ${(d.subject || '(no subject)').slice(0, 240)}`;
  const todayIso = new Date().toISOString().split('T')[0];

  const { error: insertErr } = await supabase.from('activities').insert({
    id: activityId,
    type: 'Email',
    subject,
    description,
    date: todayIso,
    owner_id: ownerId,
    account_id: matchedAccountId || '',
    contact_id: matchedContactId || null,
  });

  if (insertErr) {
    // Unique-key violation = retry of an already-logged email. That's a
    // success, not a failure — Resend should consider this delivered.
    if (insertErr.code === '23505' || /duplicate/i.test(insertErr.message)) {
      console.warn('[inbound-email] retry collapsed to existing row:', activityId);
      return { processed: true, note: 'duplicate' };
    }
    console.error('[inbound-email] insert error:', insertErr.message);
    return { processed: false, note: 'insert-error' };
  }

  console.warn('[inbound-email] activity created', {
    id: activityId,
    owner: ownerId,
    contact: matchedContactId,
    account: matchedAccountId,
    subject_preview: subject.slice(0, 60),
  });
  return { processed: true };
}

// ──────────────────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Pull the bare email out of a "Display Name <local@domain>" header.
 * Returns lowercase. Empty string on failure.
 */
function extractEmail(raw: string): string {
  if (!raw) return '';
  const m = raw.match(/<([^>]+)>/);
  const candidate = (m ? m[1] : raw).trim().toLowerCase();
  return /\S+@\S+\.\S+/.test(candidate) ? candidate : '';
}

function uniqueLower(arr: string[]): string[] {
  const set = new Set<string>();
  for (const v of arr) {
    const s = (v || '').trim().toLowerCase();
    if (s) set.add(s);
  }
  return [...set];
}

/**
 * Cheap HTML→plain conversion for body fallback. Not perfect — strips
 * tags and decodes the most common entities. Anything fancier should
 * happen client-side in the activity timeline if needed.
 */
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

function logEventSummary(rawBody: string, opts: { verified: boolean }): void {
  let event: InboundEmailEvent | null = null;
  try {
    event = JSON.parse(rawBody) as InboundEmailEvent;
  } catch {
    console.warn('[inbound-email] body is not valid JSON');
    return;
  }
  const d = event?.data;
  console.warn('[inbound-email] received', {
    verified: opts.verified,
    type: event?.type,
    email_id: d?.email_id,
    from: d?.from?.replace(/<.+>/, '').trim(),
    to_count: d?.to?.length ?? 0,
    bcc_count: d?.bcc?.length ?? 0,
    subject: d?.subject?.slice(0, 80),
    attachments: d?.attachments?.length ?? 0,
  });
}
