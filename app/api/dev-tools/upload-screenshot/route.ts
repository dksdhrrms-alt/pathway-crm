/**
 * POST /api/dev-tools/upload-screenshot
 *
 * TEMPORARY route — used once to embed User Guide screenshots.
 * Delete this file (and the _temp_screenshots table) once the
 * guide is finalized.
 *
 * NOTE: folder is "dev-tools" not "_dev" — Next.js App Router treats
 * underscore-prefixed folders as private and excludes them from routing.
 *
 * Body: { filename: string, dataUrl: string }
 *   dataUrl is the full "data:image/jpeg;base64,..." string from
 *   canvas.toDataURL — we store as-is so the workspace can decode
 *   exactly what the browser captured.
 *
 * Auth: requires a signed-in user (any role).
 */

import { auth } from '@/auth';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: { filename?: string; dataUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const filename = String(body.filename || '').trim();
  const dataUrl = String(body.dataUrl || '');
  if (!filename || !dataUrl.startsWith('data:image/')) {
    return NextResponse.json({ error: 'filename and dataUrl required' }, { status: 400 });
  }
  // Cap at 5 MB base64 (~3.75 MB actual) — anything bigger is a bug.
  if (dataUrl.length > 5_000_000) {
    return NextResponse.json({ error: 'dataUrl too large' }, { status: 413 });
  }
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const sb = createClient(url, key);
  const id = `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await sb.from('_temp_screenshots').insert({
    id, filename, data_url: dataUrl,
  });
  if (error) {
    console.error('[_dev/upload-screenshot]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id });
}
