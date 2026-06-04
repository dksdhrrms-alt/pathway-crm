/**
 * POST /api/send-email
 *
 * Sends an outbound email through Resend, then writes a matching
 * Activity row to Supabase so the conversation lands in the CRM
 * timeline without any BCC routing step.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { createClient } from '@supabase/supabase-js';
import { auth } from '@/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SendBody {
  to: string[] | string;
  cc?: string[];
  subject: string;
  body: string;
  html?: boolean;
  contactId?: string;
  accountId?: string;
  fromName?: string;
  contactName?: string;
}

function asArray(v: string[] | string | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v].filter(Boolean);
}

export async function POST(request: Request) {
  const { error: authErr } = await requireAuth();
  if (authErr) return authErr;

  const session = await auth();
  const userEmail = session?.user?.email ?? '';
  const userName = session?.user?.name ?? 'Pathway CRM';
  const userId = (session?.user as { id?: string })?.id ?? '';
  if (!userEmail) {
    return NextResponse.json({ ok: false, message: 'Signed-in user has no email on file.' }, { status: 400 });
  }

  let body: SendBody;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, message: 'Bad JSON body.' }, { status: 400 }); }

  const toList = asArray(body.to);
  const ccList = asArray(body.cc);
  if (toList.length === 0) return NextResponse.json({ ok: false, message: '"to" must not be empty.' }, { status: 400 });
  if (!body.subject?.trim()) return NextResponse.json({ ok: false, message: 'Subject is required.' }, { status: 400 });
  if (!body.body?.trim()) return NextResponse.json({ ok: false, message: 'Email body is required.' }, { status: 400 });

  const apiKey = process.env.RESEND_API_KEY;
  const fromOverride = process.env.RESEND_OUTBOUND_FROM_OVERRIDE;
  const isPlaceholder = !apiKey || apiKey.includes('placeholder');
  const fromAddress = fromOverride || userEmail;
  const fromHeader = `${body.fromName || userName} <${fromAddress}>`;

  if (isPlaceholder) {
    return NextResponse.json({
      ok: true, mock: true,
      message: `Demo mode: email to ${body.contactName || toList.join(', ')} logged (no real email sent).`,
    });
  }

  let resendId: string | null = null;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: fromHeader,
        reply_to: userEmail,
        to: toList,
        cc: ccList.length > 0 ? ccList : undefined,
        subject: body.subject.trim(),
        ...(body.html ? { html: body.body } : { text: body.body }),
        tags: [
          { name: 'app', value: 'crm' },
          { name: 'owner', value: userId || 'unknown' },
        ],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data as { message?: string }).message || `Resend rejected the request (${res.status})`;
      return NextResponse.json({ ok: false, message: msg }, { status: 502 });
    }
    resendId = (data as { id?: string }).id ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, message: `Failed to reach Resend: ${msg}` }, { status: 502 });
  }

  // Best-effort Activity insert.
  let activityNote = '';
  try {
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (sbUrl && sbKey) {
      const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false } });
      const id = `act-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const header = [
        `To: ${toList.join(', ')}`,
        ccList.length ? `CC: ${ccList.join(', ')}` : '',
        '',
      ].filter(Boolean).join('\n');
      await sb.from('activities').insert({
        id,
        type: 'Email',
        subject: body.subject.trim().slice(0, 240),
        description: (header + body.body).slice(0, 8000),
        date: new Date().toISOString().split('T')[0],
        owner_id: userId,
        account_id: body.accountId || null,
        contact_id: body.contactId || null,
      });
    } else {
      activityNote = 'activity not logged (Supabase env not configured)';
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    activityNote = `activity log failed: ${msg}`;
    console.error('[send-email] activity insert failed:', msg);
  }

  return NextResponse.json({
    ok: true,
    id: resendId,
    message: `Email sent to ${body.contactName || toList.join(', ')}`,
    ...(activityNote ? { warning: activityNote } : {}),
  });
}
