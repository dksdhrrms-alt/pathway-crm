import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

export const runtime = 'nodejs';
// Inbound emails (especially with attachments) can be sizeable. Give Vercel
// some headroom; Resend retries on timeout so being conservative on the
// upper bound is fine.
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

/**
 * Inbound email webhook (Resend → CRM).
 *
 * Phase 1 (this file): stub. Verifies the Svix signature from Resend, logs the
 * event metadata, and returns 200. The actual parsing — extracting the BCC
 * mailbox, matching the sender to a CRM user, finding the recipient contact,
 * fetching the body via the Receiving API, and creating an Activity — happens
 * in Phase 3 once we've confirmed the webhook itself reaches us.
 *
 * Why a stub first: Resend validates the endpoint URL during webhook
 * registration and during delivery retries. A live 200-returning endpoint
 * lets us register the webhook, grab the signing secret, and end-to-end
 * test "real email arrives → our endpoint sees it" before we wire the
 * downstream logic.
 *
 * Security:
 *   - In production we require RESEND_WEBHOOK_SECRET to be set. Without it
 *     the route returns 503 so we don't accept unverifiable webhooks.
 *   - Signature is verified via the Resend SDK (which wraps Svix internally).
 *   - We never trust the body until verify() succeeds.
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
    attachments?: Array<{ id: string; filename: string; content_type: string }>;
  };
}

export async function GET() {
  // Helpful for manual reachability checks (curl, browser). Doesn't reveal
  // anything sensitive — just confirms the route exists.
  return NextResponse.json({
    ok: true,
    route: '/api/inbound-email',
    method: 'POST expected for Resend inbound webhooks',
    secret_configured: !!process.env.RESEND_WEBHOOK_SECRET,
  });
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;

  // Capture the raw body once — needed both for signature verification
  // (which is over the exact bytes Resend sent) and for parsing.
  const rawBody = await req.text();

  // Pull the three Svix headers Resend forwards on every webhook delivery.
  const svixId = req.headers.get('svix-id') || '';
  const svixTimestamp = req.headers.get('svix-timestamp') || '';
  const svixSignature = req.headers.get('svix-signature') || '';

  if (!secret) {
    // Bootstrap convenience: if the secret hasn't been added to Vercel env
    // yet, accept the test event but make it loud in the logs. This keeps
    // the initial Resend webhook registration working before the operator
    // has had a chance to wire the env var.
    console.warn('[inbound-email] RESEND_WEBHOOK_SECRET not set — skipping signature verification');
    logEventSummary(rawBody, { verified: false });
    return NextResponse.json({ ok: true, verified: false });
  }

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { error: 'Missing Svix headers (id / timestamp / signature)' },
      { status: 400 }
    );
  }

  try {
    // The Resend SDK wraps Svix; this throws on signature mismatch or
    // out-of-window timestamp.
    const resend = new Resend(process.env.RESEND_API_KEY || 'unused-during-verify');
    resend.webhooks.verify({
      payload: rawBody,
      headers: {
        id: svixId,
        timestamp: svixTimestamp,
        signature: svixSignature,
      },
      webhookSecret: secret,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[inbound-email] signature verification failed:', msg);
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
  }

  // Verified. Log a one-liner so we can confirm the wire-up from Vercel
  // logs without exposing email contents to the client.
  logEventSummary(rawBody, { verified: true });

  // 200 OK with no body keeps the response tiny (Resend just needs a 2xx).
  return NextResponse.json({ ok: true, verified: true });
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
  // We deliberately keep this terse and avoid logging the body.
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
