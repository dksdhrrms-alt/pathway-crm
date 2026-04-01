import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { error: authErr } = await requireAuth();
  if (authErr) return authErr;
  const { to, subject, body, fromName, contactName } = await request.json();

  const apiKey = process.env.RESEND_API_KEY;
  const isPlaceholder = !apiKey || apiKey.includes('placeholder');

  if (isPlaceholder) {
    // Demo mode — mock success without sending
    return NextResponse.json({
      ok: true,
      mock: true,
      message: `Demo mode: email to ${contactName || to} logged (no real email sent).`,
    });
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: `${fromName || 'CRM'} <onboarding@resend.dev>`,
        to: Array.isArray(to) ? to : [to],
        subject,
        text: body,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      return NextResponse.json({ ok: false, message: err.message || 'Failed to send email.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: `Email sent to ${contactName || to}` });
  } catch {
    return NextResponse.json({ ok: false, message: 'Failed to send email.' }, { status: 500 });
  }
}
