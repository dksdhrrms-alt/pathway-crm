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
  // BCC delivery problem: when a user BCCs our inbound mailbox, the
  // envelope `to` that Resend hands us is just our own address — the
  // real recipient (the customer the user actually wrote to) isn't
  // visible there. We try three strategies in order:
  //   (a) parse the message's `To:` header from data.headers, which
  //       most sender mail servers preserve verbatim on BCC delivery
  //   (b) check data.to / data.cc the normal way (works for the
  //       Cc-pattern, or non-BCC tests)
  //   (c) fall back to whichever contact this sender most recently
  //       interacted with — covers the case where the user truly
  //       BCC'd a customer Outlook scrubbed from the envelope, but
  //       was actively logging activities against that contact
  //
  // Whichever strategy hits first wins.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dExt = d as any;
  const headerCandidates = extractHeaderRecipients(dExt.headers);
  const envelopeCandidates = uniqueLower([
    ...(d.to || []).map(extractEmail),
    ...(d.cc || []).map(extractEmail),
  ].filter(Boolean) as string[]);

  // Outlook-forward-rule pattern: when the user has set up their
  // Outlook to auto-forward every sent message to our inbound mailbox,
  // the original `To:` line lands inside the body of the forwarded
  // message (after a "----- Forwarded message -----" or
  // "-----Original Message-----" marker). Parse those out — this is
  // what makes contact matching robust without sender-side plugins.
  const bodyForParse = (d.text || htmlToPlain(d.html || '') || '').trim();
  const forwardedCandidates = extractForwardedRecipients(bodyForParse);

  // Combine and dedupe. Forwarded-body addresses come first because
  // they're the highest-fidelity source we have for the BCC pattern;
  // then header, then envelope.
  const allCandidates = uniqueLower([
    ...forwardedCandidates,
    ...headerCandidates,
    ...envelopeCandidates,
  ]);

  console.warn('[inbound-email] step: recipient sources', {
    forwarded_count: forwardedCandidates.length,
    header_count: headerCandidates.length,
    envelope_count: envelopeCandidates.length,
    combined: allCandidates,
    has_headers: !!dExt.headers,
    data_keys: Object.keys(d),
  });

  let matchedContactId: string | null = null;
  let matchedAccountId: string | null = null;

  // Step (a) + (b): match against contacts.email
  if (allCandidates.length > 0) {
    // Drop any candidates that hit the inbound BCC mailbox itself —
    // we'd never want to match ourselves to a contact.
    const realCandidates = allCandidates.filter(
      (e) => !e.endsWith('@log.pathway-intermediates.com') && !e.startsWith('crm@log.'),
    );
    if (realCandidates.length > 0) {
      const orFilter = realCandidates.map((e) => `email.ilike.${e}`).join(',');
      const { data: contactRows, error: cErr } = await supabase
        .from('contacts')
        .select('id, email, account_id')
        .is('archived_at', null)
        .or(orFilter);
      if (cErr) console.error('[inbound-email] contact lookup error:', cErr.message);
      console.warn('[inbound-email] step: contact lookup', {
        candidates: realCandidates,
        row_count: contactRows?.length ?? 0,
      });
      const first = contactRows && contactRows[0];
      if (first) {
        matchedContactId = first.id as string;
        matchedAccountId = (first.account_id as string) || null;
      }
    }
  }

  // ── Step (a2): full-body email scan as secondary safety net ──────
  // If steps (a)+(b) found no candidate that matched a contact, scan
  // the ENTIRE body for any email-shaped substring (not just inside
  // forwarded-header blocks), then check if any of them belongs to a
  // CRM contact we know about. This catches Outlook BCC patterns where
  // the marker regex didn't fire but the contact's address is still
  // sitting somewhere in the message (signatures, scattered quoted
  // text, mailto: links, etc.). Pathway domain addresses are filtered
  // out so we never match ourselves to ourselves.
  if (!matchedContactId && !matchedAccountId) {
    const bodyForScan = (d.text || htmlToPlain(d.html || '') || '').toLowerCase();
    const emailRegex = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g;
    const scanHits = [...new Set((bodyForScan.match(emailRegex) || []))]
      .filter((e) => !e.endsWith('@log.pathway-intermediates.com'))
      .filter((e) => !e.endsWith('@pathway-intermediates.com')) // never the rep
      .slice(0, 30);
    console.warn('[inbound-email] step: body email scan', { hit_count: scanHits.length, sample: scanHits.slice(0, 5) });
    if (scanHits.length > 0) {
      const orFilter = scanHits.map((e) => `email.ilike.${e}`).join(',');
      const { data: rows, error: scErr } = await supabase
        .from('contacts')
        .select('id, email, account_id')
        .is('archived_at', null)
        .or(orFilter);
      if (scErr) console.error('[inbound-email] body-scan contact lookup error:', scErr.message);
      const hit = rows && rows[0];
      if (hit) {
        matchedContactId = hit.id as string;
        matchedAccountId = (hit.account_id as string) || null;
        console.warn('[inbound-email] step: matched by body-scan', {
          contact_id: matchedContactId, account_id: matchedAccountId, matched_email: hit.email,
        });
      }
    }
  }

  // ── Step (a3): Domain-based ACCOUNT fallback ──────────────────────
  // If we couldn't find a specific contact, but we can extract a
  // candidate's email domain (e.g. `mcarabeau@poulingrain.com`), look
  // for any existing contact in CRM whose email shares that domain. If
  // multiple, pick the most common account_id among them. This catches
  // "new contact at known company" — the email lands on the correct
  // account even though the specific person isn't in CRM yet. The rep
  // then only needs to attach a contact, not also pick the account.
  if (!matchedContactId && !matchedAccountId) {
    const bodyForDomainScan = (d.text || htmlToPlain(d.html || '') || '').toLowerCase();
    const emailRegexDom = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g;
    const allEmailsForDomain = [
      ...allCandidates,
      ...((bodyForDomainScan.match(emailRegexDom) || [])),
    ];
    const externalDomains = [...new Set(
      allEmailsForDomain
        .map((e) => (e.split('@')[1] || '').toLowerCase().trim())
        .filter((dom) => dom && dom !== 'pathway-intermediates.com' && !dom.endsWith('log.pathway-intermediates.com'))
    )];
    if (externalDomains.length > 0) {
      const orFilter = externalDomains.map((dom) => `email.ilike.%@${dom}`).join(',');
      const { data: domainContacts, error: dErr } = await supabase
        .from('contacts')
        .select('account_id, email')
        .is('archived_at', null)
        .or(orFilter);
      if (dErr) console.error('[inbound-email] domain-fallback contact fetch error:', dErr.message);
      const acctCount = new Map<string, number>();
      for (const c of domainContacts || []) {
        if (c.account_id) acctCount.set(c.account_id as string, (acctCount.get(c.account_id as string) || 0) + 1);
      }
      if (acctCount.size > 0) {
        const topAcct = [...acctCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
        matchedAccountId = topAcct;
        console.warn('[inbound-email] step: matched ACCOUNT only by domain fallback', {
          domains: externalDomains,
          account_id: topAcct,
          domain_contacts_count: domainContacts?.length || 0,
        });
      } else {
        console.warn('[inbound-email] step: no domain-fallback hit', { domains: externalDomains });
      }
    }
  }

  // ── Step (c): subject-based account-name match ────────────────────
  // BCC strips recipient info from envelope on most clients (Outlook +
  // Gmail), so contact_email matching often fails for the exact
  // pattern this feature is meant to solve. Salespeople almost always
  // include the customer's name in the subject line ("RE: Tyson trial
  // Q3", "FW: Cargill sample request"), so we scan the subject for any
  // known account name as a high-precision fallback.
  //
  // Two-pass strategy:
  //   1. Exact substring of full account name (highest precision)
  //   2. Token-overlap score against the account's significant words
  //      ("Poulin Grain" vs subject "fw: poulin annual sales meeting"
  //      gets a 0.5 score on the "poulin" token — accepted because the
  //      single matched token is significant after stop-word removal).
  //
  // Safeguards against false positives:
  //   - account name must be ≥ 4 chars total for substring path
  //   - token comparison drops stop words (USA, LLC, Inc, Foods, Farms,
  //     and, of, group, …) so generic suffixes can't win
  //   - tokens must be ≥ 3 chars
  //   - prefer LONGER name on ties (more specific account)
  const SUBJECT_MIN_NAME_LEN = 4;
  const TOKEN_STOPWORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for',
    'by', 'with', 'usa', 'inc', 'llc', 'corp', 'corporation', 'co', 'ltd',
    'group', 'company', 'companies', 'foods', 'farms', 'farm', 'enterprises',
  ]);
  const tokenize = (s: string): string[] =>
    s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !TOKEN_STOPWORDS.has(t));
  const subjectLower = (d.subject || '').toLowerCase();
  if (!matchedContactId && !matchedAccountId && subjectLower) {
    const { data: accts, error: aErr } = await supabase
      .from('accounts').select('id, name').range(0, 4999);
    if (aErr) console.error('[inbound-email] subject-match account fetch error:', aErr.message);
    const subjTokens = new Set(tokenize(d.subject || ''));
    let bestSubstr: { id: string; name: string; len: number } | null = null;
    // (id, name, score, matchedCount, nameLen) — used to break ties
    let bestToken: { id: string; name: string; score: number; matchedCount: number; nameLen: number } | null = null;
    for (const a of accts || []) {
      const n = String(a.name || '').trim();
      if (n.length < SUBJECT_MIN_NAME_LEN) continue;
      // Pass 1: substring of full account name
      if (subjectLower.includes(n.toLowerCase()) && (!bestSubstr || n.length > bestSubstr.len)) {
        bestSubstr = { id: a.id as string, name: n, len: n.length };
        continue;
      }
      // Pass 2: token-overlap scoring
      const acctTokens = tokenize(n);
      if (acctTokens.length === 0) continue;
      const matchedCount = acctTokens.filter((t) => subjTokens.has(t)).length;
      if (matchedCount === 0) continue;
      const score = matchedCount / acctTokens.length;
      if (score < 0.5) continue;
      // Tie-break: higher score → higher matchedCount → longer name
      if (
        !bestToken ||
        score > bestToken.score ||
        (score === bestToken.score && matchedCount > bestToken.matchedCount) ||
        (score === bestToken.score && matchedCount === bestToken.matchedCount && n.length > bestToken.nameLen)
      ) {
        bestToken = { id: a.id as string, name: n, score, matchedCount, nameLen: n.length };
      }
    }
    const finalSubjectHit = bestSubstr
      ? { id: bestSubstr.id, name: bestSubstr.name, source: 'substring' as const }
      : bestToken
        ? { id: bestToken.id, name: bestToken.name, source: `tokens(${bestToken.matchedCount}/${Math.round(bestToken.score * 10) / 10})` }
        : null;
    if (finalSubjectHit) {
      matchedAccountId = finalSubjectHit.id;
      console.warn('[inbound-email] step: matched by subject-account-name', {
        account_id: finalSubjectHit.id, account_name: finalSubjectHit.name,
        match_source: finalSubjectHit.source, subject: d.subject,
      });
    }
  }

  // ── Step (c'): Re:/Fwd: subject → original activity's account/contact ──
  // The single most reliable signal that a reply is "for" a particular
  // account is finding the original outbound Email we already logged
  // under that account. When the subject starts with Re:/Fwd: and we
  // haven't matched a contact yet, look for any Email activity from
  // this sender with the same cleaned subject in the last 90 days, and
  // adopt its account_id + contact_id. This MUST run before step (d)'s
  // 30-day fallback — otherwise the fallback picks the rep's most-
  // recent activity (e.g. Land O Lakes) and mis-routes every reply.
  const replyPrefixRegexEarly = /^\s*(re|fwd|fw|antw|wg|sv|tr|rv|ant|aw|enc)\s*:\s*/i;
  const rawSubjectEarly = d.subject || '';
  const isReplyEarly = replyPrefixRegexEarly.test(rawSubjectEarly);
  let cleanSubjectEarly = rawSubjectEarly;
  for (let i = 0; i < 3 && replyPrefixRegexEarly.test(cleanSubjectEarly); i++) {
    cleanSubjectEarly = cleanSubjectEarly.replace(replyPrefixRegexEarly, '');
  }
  cleanSubjectEarly = cleanSubjectEarly.trim();

  if (!matchedContactId && !matchedAccountId && isReplyEarly && cleanSubjectEarly.length >= 3) {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { data: parentByOwner, error: pErr } = await supabase
      .from('activities')
      .select('id, subject, contact_id, account_id, date')
      .eq('type', 'Email')
      .eq('owner_id', ownerId)
      .ilike('subject', `%${cleanSubjectEarly}%`)
      .is('archived_at', null)
      .gte('date', since)
      .order('date', { ascending: true })
      .limit(20);
    if (pErr) console.error('[inbound-email] re-subject parent lookup error:', pErr.message);

    const normalizeEarly = (s: string) => {
      let v = (s || '').replace(/^📨\s*/, '');
      for (let i = 0; i < 3 && replyPrefixRegexEarly.test(v); i++) v = v.replace(replyPrefixRegexEarly, '');
      return v.trim().toLowerCase();
    };
    const targetParent = (parentByOwner || []).find((c) => normalizeEarly(c.subject) === cleanSubjectEarly.toLowerCase());
    if (targetParent && (targetParent.contact_id || targetParent.account_id)) {
      matchedContactId = (targetParent.contact_id as string) || null;
      matchedAccountId = (targetParent.account_id as string) || null;
      console.warn('[inbound-email] step: matched by Re:/Fwd: parent subject lookup', {
        parent_activity_id: targetParent.id,
        clean_subject: cleanSubjectEarly.slice(0, 80),
        adopted_contact: matchedContactId,
        adopted_account: matchedAccountId,
      });
    }
  }

  // ── Step (d) REMOVED — silent "recent activity" fallback was the root
  //   cause of every mis-routing incident (Poulin Grain → Land O Lakes,
  //   Nathan/Cornerstone → Land O Lakes, Melissa/Poulin → Jamie/LOL).
  //   When parser cannot identify a contact we deliberately leave
  //   contact_id NULL + account_id empty. The activity still lands so
  //   nothing is lost, but it surfaces in the Unassigned queue (TopBar
  //   bell badge → Archive filter) for one-click assignment by the rep.
  //   Better an empty assignment than a confidently wrong one.
  if (!matchedContactId && !matchedAccountId) {
    // Diagnostic dump for unmatched emails. Every field that could
    // have contained a recipient hint is logged so we can see what
    // Outlook/Resend actually delivers when BCC strips the envelope.
    // This drives the next round of parser improvements without
    // guessing.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dExtForLog = d as any;
    console.warn('[inbound-email] step: no match — saving as unassigned for manual review', {
      subject: d.subject?.slice(0, 120),
      from: fromEmail,
      envelope_to: d.to,
      envelope_cc: d.cc,
      headers_keys: dExtForLog.headers ? Object.keys(dExtForLog.headers).slice(0, 20) : null,
      headers_to: dExtForLog.headers?.to ?? dExtForLog.headers?.To ?? null,
      headers_cc: dExtForLog.headers?.cc ?? dExtForLog.headers?.Cc ?? null,
      headers_from: dExtForLog.headers?.from ?? dExtForLog.headers?.From ?? null,
      headers_references: dExtForLog.headers?.references ?? dExtForLog.headers?.References ?? null,
      headers_in_reply_to: dExtForLog.headers?.['in-reply-to'] ?? dExtForLog.headers?.['In-Reply-To'] ?? null,
      forwarded_extracted: forwardedCandidates,
      all_candidates: allCandidates,
    });
  }

  // ── 4. Get body — payload first, Resend API fallback ──────────────
  // Resend's `email.received` payload SHOULD carry text/html inline,
  // but in practice some forwarded / BCC'd messages arrive with both
  // fields empty (or under different keys depending on the customer's
  // webhook config). Try every reasonable field name before giving up.
  const emailId = d.email_id || '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dAny = d as any;
  // One-time payload-shape dump so we can see what Resend actually sent
  // in production when something goes missing. Truncated to keep logs
  // readable; full payload is in Vercel's `Functions` tab anyway.
  console.warn('[inbound-email] payload shape:', {
    data_keys: Object.keys(d),
    has_text: !!dAny.text,         text_len: (dAny.text || '').length,
    has_html: !!dAny.html,         html_len: (dAny.html || '').length,
    has_body: !!dAny.body,         body_len: (dAny.body || '').length,
    has_body_text: !!dAny.body_text, body_text_len: (dAny.body_text || '').length,
    has_body_html: !!dAny.body_html, body_html_len: (dAny.body_html || '').length,
    has_content: !!dAny.content,   content_len: (dAny.content || '').length,
    has_message: !!dAny.message,   message_len: (typeof dAny.message === 'string' ? dAny.message : '').length,
    attachment_count: (dAny.attachments || []).length,
    attachment_keys: dAny.attachments?.[0] ? Object.keys(dAny.attachments[0]) : [],
  });

  let bodyText = bodyForParse;
  // Try alternative field names Resend may use for body content.
  if (!bodyText) {
    const alt =
      (dAny.body_text || '').trim() ||
      htmlToPlain(dAny.body_html || '').trim() ||
      (typeof dAny.body === 'string' ? dAny.body : '').trim() ||
      (typeof dAny.content === 'string' ? dAny.content : '').trim() ||
      (typeof dAny.message === 'string' ? dAny.message : '').trim();
    if (alt) {
      bodyText = alt;
      console.warn('[inbound-email] step: body found under alternate key, length=', bodyText.length);
    }
  }
  // Last-resort API fallback (only if RESEND_API_KEY is set).
  if (!bodyText && emailId && process.env.RESEND_API_KEY) {
    const fetched = await fetchInboundBodyFromResend(emailId);
    if (fetched) {
      bodyText = fetched;
      console.warn('[inbound-email] step: body fetched via Resend API, length=', bodyText.length);
    }
  } else if (bodyText) {
    console.warn('[inbound-email] step: body inline, length=', bodyText.length);
  } else {
    console.warn('[inbound-email] step: body NOT FOUND anywhere — check Resend webhook config (Include message body?)');
  }

  // ── 4b. Pull attachments down + upload to Supabase Storage ─────────
  // We fetch each attachment from Resend's Inbound API as binary, push
  // it into the `email-attachments` bucket, and remember the public URL
  // so we can stitch links into the description (rendered by the
  // Activity Timeline). The whole step is non-fatal — if anything
  // breaks (bucket missing, network blip), the activity still gets
  // created without the attachments. They're auditable in Resend.
  const attachmentLinks: { filename: string; url: string; sizeKb: number; sizeLabel: string }[] = [];
  const attachments = (d as { attachments?: Array<{ id: string; filename: string; content_type: string }> }).attachments || [];
  if (attachments.length && emailId && process.env.RESEND_API_KEY) {
    console.warn(`[inbound-email] step: fetching ${attachments.length} attachment(s)`);
    for (const att of attachments) {
      try {
        const link = await fetchAndStoreAttachment(supabase, emailId, att);
        if (link) attachmentLinks.push(link);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[inbound-email] attachment "${att.filename}" failed:`, msg);
      }
    }
  }

  // Cap to keep activities table sensible. Full text isn't free.
  const MAX_DESC = 8000;
  const truncated = bodyText.length > MAX_DESC ? bodyText.slice(0, MAX_DESC) + '\n\n[...truncated]' : bodyText;
  let description = truncated || `(Body unavailable)\nFrom: ${fromEmail}\nSubject: ${d.subject || ''}`;
  if (attachmentLinks.length) {
    description += '\n\n📎 Attachments:\n' + attachmentLinks
      .map((a) => `• ${a.filename} (${a.sizeLabel}) — ${a.url}`)
      .join('\n');
  }

  // ── 4b. Reply-threading: append to parent activity if "Re:"/"Fwd:" ──
  // When the inbound subject starts with a reply prefix, look for the
  // original Email activity (same scope, same cleaned subject) inside a
  // 90-day window. If found, append the reply body to that row's
  // description instead of creating a new sibling activity — keeps the
  // conversation in one timeline entry. Falls through to a normal
  // insert when no parent is found, so unattached replies still land.
  const replyPrefixRegex = /^\s*(re|fwd|fw|antw|wg|sv|tr|rv|ant|aw|enc)\s*:\s*/i;
  const rawSubject = d.subject || '';
  const isReply = replyPrefixRegex.test(rawSubject);
  // Strip up to 3 nested prefixes ("Re: Fwd: Re: Hello" → "Hello").
  let cleanSubject = rawSubject;
  for (let i = 0; i < 3 && replyPrefixRegex.test(cleanSubject); i++) {
    cleanSubject = cleanSubject.replace(replyPrefixRegex, '');
  }
  cleanSubject = cleanSubject.trim();

  if (isReply && cleanSubject.length >= 3) {
    const lookupSince = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
    let q = supabase
      .from('activities')
      .select('id, description, subject, date')
      .eq('type', 'Email')
      .ilike('subject', `%${cleanSubject}%`)
      .is('archived_at', null)
      .gte('date', lookupSince)
      .order('date', { ascending: true })
      .limit(20);
    // Prefer the tightest scope we know: contact > account > owner.
    if (matchedContactId) q = q.eq('contact_id', matchedContactId);
    else if (matchedAccountId) q = q.eq('account_id', matchedAccountId);
    else q = q.eq('owner_id', ownerId);

    const { data: candidates, error: thErr } = await q;
    if (thErr) console.error('[inbound-email] thread lookup error:', thErr.message);

    // Normalize each candidate's stored subject (strip the 📨 prefix our
    // own inserts prepend, plus any leading reply prefixes) so we match
    // against the cleaned reply subject.
    const normalize = (s: string) => {
      let v = (s || '').replace(/^📨\s*/, '');
      for (let i = 0; i < 3 && replyPrefixRegex.test(v); i++) v = v.replace(replyPrefixRegex, '');
      return v.trim().toLowerCase();
    };
    const parent = (candidates || []).find((c) => normalize(c.subject) === cleanSubject.toLowerCase());

    if (parent) {
      const sender = (d.from || fromEmail || '').trim();
      const nowLabel = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
      const separator = '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
      const replyHeader = `↳ Reply from ${sender} · ${nowLabel}\n\n`;
      const attachmentSuffix = attachmentLinks.length
        ? '\n\n📎 Attachments:\n' + attachmentLinks.map((a) => `• ${a.filename} (${a.sizeLabel}) — ${a.url}`).join('\n')
        : '';
      const THREAD_MAX = 32000;
      const combined = ((parent.description || '') + separator + replyHeader + bodyText + attachmentSuffix).slice(0, THREAD_MAX);

      const { error: updErr } = await supabase
        .from('activities')
        .update({ description: combined })
        .eq('id', parent.id);
      if (updErr) {
        console.error('[inbound-email] thread append error, falling through to insert:', updErr.message);
      } else {
        console.warn('[inbound-email] threaded reply into', parent.id, { subject_preview: cleanSubject.slice(0, 60) });
        return { processed: true, note: `threaded:${parent.id}` };
      }
    } else {
      console.warn('[inbound-email] reply prefix detected but no parent matched — inserting standalone', {
        clean_subject: cleanSubject.slice(0, 60),
        candidates_seen: candidates?.length ?? 0,
      });
    }
  }

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

/**
 * Pull recipient emails out of an RFC822-style `headers` blob.
 * Resend may surface headers in any of these shapes — handle them all:
 *   - object map:  { "to": "Foo <foo@x.com>", "cc": "..." }
 *   - object map with arrays: { "to": ["a@x.com", "b@x.com"] }
 *   - array of {name, value}: [{ name: "To", value: "foo@x.com" }, ...]
 *   - raw string: "To: foo@x.com\r\nCc: bar@x.com\r\n..."
 * Anything else returns []. Lowercased + deduped.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractHeaderRecipients(headers: any): string[] {
  if (!headers) return [];
  const collected: string[] = [];

  function pickFrom(value: unknown) {
    if (!value) return;
    if (typeof value === 'string') {
      // Comma-separated address list e.g. "Alice <a@x.com>, b@y.com"
      for (const part of value.split(',')) {
        const e = extractEmail(part);
        if (e) collected.push(e);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) pickFrom(v);
      return;
    }
  }

  try {
    if (typeof headers === 'string') {
      // Raw RFC822 block — pull the To/Cc lines.
      const lines = headers.split(/\r?\n/);
      for (const line of lines) {
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
  } catch {
    // If header shape is wildly off, we just give up — the recent-
    // activity fallback below still has a shot at finding a contact.
  }

  return uniqueLower(collected);
}

/**
 * Pull recipient emails out of the body of a forwarded email.
 *
 * When a user has Outlook (or Gmail) auto-forwarding sent items to our
 * inbound mailbox, the original message gets quoted inside the forward
 * with a recognizable header block, e.g.:
 *
 *   ---------- Forwarded message ---------
 *   From: Jeff Harding <jeff@example.com>
 *   Date: Wed, May 7, 2026 at 2:30 PM
 *   Subject: Quote follow-up
 *   To: Ron Marriott <rmarriott@pdscows.com>
 *   Cc: someone@example.com
 *
 *   [original body]
 *
 * We scan for that header block and extract every email address from
 * the To: and Cc: lines. This is the *highest-fidelity* recipient
 * source we have — the addresses come straight from the user's own
 * mail client, so they survive whatever SMTP did to the envelope.
 *
 * Outlook ("-----Original Message-----"), Gmail ("---------- Forwarded
 * message ----------"), and Apple Mail ("Begin forwarded message:") all
 * use slightly different markers — the regex tolerates each variant.
 */
function extractForwardedRecipients(body: string): string[] {
  if (!body) return [];

  const collected: string[] = [];
  // Find every place the body looks like a forwarded-message header
  // block. Multiple forwards can be nested (forward of a forward), so
  // we accept all matches and union their recipients.
  //
  // Marker variants we recognize:
  //   - Outlook desktop / old Outlook: "----- Original Message -----"
  //   - Gmail web:                    "----- Forwarded message -----"
  //   - Apple Mail:                   "Begin forwarded message:"
  //   - Outlook web / new Outlook:    a line of 10+ underscores (this
  //     was the missing case that mis-routed Jeff/Poulin Grain into
  //     Land-O-Lakes via the 30-day fallback)
  const markerRegex = /(?:-+\s*(?:Original Message|Forwarded message|Original)\s*-+|^Begin forwarded message:|_{10,})/gim;
  const markers: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = markerRegex.exec(body)) !== null) {
    markers.push(m.index);
  }

  // Defense in depth: some clients (Outlook autoforward rules in
  // particular) drop every separator and just dump the quoted header
  // block raw. If we see a "From: …\n[Sent|Date]: …" pair anywhere in
  // the body, treat that position as an implicit marker. The "From +
  // Sent|Date" combo is specific enough that false positives from
  // ordinary prose are vanishingly rare.
  const bareHeaderRegex = /^From:\s+.+\n(?:^Sent:\s+.+\n|^Date:\s+.+\n)/gim;
  while ((m = bareHeaderRegex.exec(body)) !== null) {
    markers.push(m.index);
  }

  if (markers.length === 0) return [];

  for (const start of markers) {
    // Look at the next ~2000 chars after the marker — the header block
    // is right there. Limit so we don't accidentally match a quoted
    // To: in body prose far below.
    const window = body.slice(start, start + 2000);
    // Multiline match `^From:`, `^To:` and `^Cc:` lines. From is included
    // because in REPLY emails the quoted block has `From: <contact>`
    // and `To: <us>` — the contact we want to match is the From, not
    // the To (which is just our own address). Including From: catches
    // the Jeff→Nathan reply pattern that was mis-routing to Land O
    // Lakes via the 30-day fallback.
    const fromMatch = window.match(/^\s*From:\s*(.+)$/im);
    const toMatch = window.match(/^\s*To:\s*(.+)$/im);
    const ccMatch = window.match(/^\s*Cc:\s*(.+)$/im);
    for (const line of [fromMatch?.[1], toMatch?.[1], ccMatch?.[1]]) {
      if (!line) continue;
      // A To/Cc/From line can list multiple recipients separated by
      // commas or semicolons, each as bare email or "Name <email>".
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

/**
 * Resend's `email.received` payload SHOULD ship the body inline, but
 * we occasionally see empty `text` and `html`. As a last resort try the
 * outbound retrieval endpoint — sometimes works for messages our own
 * users sent + Bcc'd back to us via Outlook's autoforward rule.
 */
/**
 * Logs a 1-line summary of the incoming webhook event so the Vercel
 * Functions tab shows what arrived, even when we 200 silently. Doesn't
 * throw — diagnostic-only.
 */
function logEventSummary(rawBody: string, ctx: { verified: boolean }): void {
  try {
    const evt = JSON.parse(rawBody) as InboundEmailEvent;
    console.warn('[inbound-email] received', {
      verified: ctx.verified,
      type: evt.type,
      from: evt.data?.from,
      subject: evt.data?.subject,
      email_id: evt.data?.email_id,
    });
  } catch {
    console.warn('[inbound-email] received: (un-parseable body)', { verified: ctx.verified });
  }
}

async function fetchInboundBodyFromResend(emailId: string): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !emailId) return '';
  try {
    const res = await fetch(`https://api.resend.com/emails/${emailId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      console.warn(`[inbound-email] body fetch non-OK ${res.status}`);
      return '';
    }
    const data = await res.json().catch(() => ({} as { text?: string; html?: string }));
    const txt = (data as { text?: string }).text || htmlToPlain((data as { html?: string }).html || '');
    return (txt || '').trim();
  } catch (err) {
    console.warn('[inbound-email] body fetch error:', err instanceof Error ? err.message : String(err));
    return '';
  }
}

/**
 * Pull one attachment's bytes from Resend, push to Supabase Storage,
 * return a record for stitching into the activity description.
 */
async function fetchAndStoreAttachment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  emailId: string,
  att: { id: string; filename: string; content_type: string },
): Promise<{ filename: string; url: string; sizeKb: number; sizeLabel: string } | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  const metaRes = await fetch(
    `https://api.resend.com/emails/inbound/${emailId}/attachments/${att.id}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!metaRes.ok) {
    console.warn(`[inbound-email] attachment metadata fetch non-OK ${metaRes.status} for`, att.filename);
    return null;
  }
  let meta: { download_url?: string; size?: number; content_type?: string } = {};
  try { meta = await metaRes.json(); }
  catch { console.error('[inbound-email] could not parse attachment metadata JSON'); return null; }
  if (!meta.download_url) {
    console.error('[inbound-email] attachment metadata missing download_url:', Object.keys(meta));
    return null;
  }
  const dlRes = await fetch(meta.download_url);
  if (!dlRes.ok) {
    console.warn(`[inbound-email] attachment download non-OK ${dlRes.status} for`, att.filename);
    return null;
  }
  const buf = Buffer.from(await dlRes.arrayBuffer());
  const contentType = dlRes.headers.get('content-type') || meta.content_type || '';
  console.warn(`[inbound-email] attachment "${att.filename}" — ${buf.length} bytes, content-type=${contentType}`);
  if (buf.length === 0) {
    console.error('[inbound-email] attachment download returned zero bytes — skipping');
    return null;
  }
  const safeName = (att.filename || `attachment-${att.id}`)
    .replace(/[^\p{L}\p{N}.\-_ ]+/gu, '_').replace(/_+/g, '_').slice(0, 120);
  const objectPath = `${emailId}/${safeName}`;
  const { error: upErr } = await supabase
    .storage.from('email-attachments')
    .upload(objectPath, buf, {
      contentType: contentType || 'application/octet-stream',
      upsert: true,
    });
  if (upErr) {
    console.error('[inbound-email] storage upload error:', upErr.message);
    return null;
  }
  const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
  const { data: signed, error: signErr } = await supabase
    .storage
    .from('email-attachments')
    .createSignedUrl(safeName, ONE_YEAR_SECONDS);
  if (signErr) console.error('[inbound-email] signed-url error:', signErr.message);
  if (!signed?.signedUrl) {
    const { data: pub } = supabase.storage.from('email-attachments').getPublicUrl(safeName);
    return {
      filename: att.filename || safeName,
      url: pub?.publicUrl || '',
      sizeKb: Math.max(1, Math.round(buf.length / 1024)),
      sizeLabel: formatBytes(buf.length),
    };
  }
  return {
    filename: att.filename || safeName,
    url: signed?.signedUrl || '',
    sizeKb: Math.max(1, Math.round(buf.length / 1024)),
    sizeLabel: formatBytes(buf.length),
  };
}

/** Human-friendly byte size: 916 B / 245 KB / 1.2 MB. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
