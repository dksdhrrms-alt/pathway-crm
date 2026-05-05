import { NextResponse } from 'next/server';
import { updateStoreUser, getStoreUserById } from '@/lib/userStore';
import { requireAdmin } from '@/lib/api-auth';
import { parseBody, UpdateUserBodySchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Editing another user (especially their role/status) is admin-only.
  // Without this guard, any signed-in user could PATCH `{role:"admin"}` on
  // their own id and escalate themselves through the file-store fallback.
  const { error: authErr } = await requireAdmin();
  if (authErr) return authErr;

  const { id } = await params;
  const found = getStoreUserById(id);
  if (!found) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const { data, error: vErr } = await parseBody(request, UpdateUserBodySchema);
  if (vErr) return vErr;

  updateStoreUser(id, data);
  return NextResponse.json({ ok: true });
}
