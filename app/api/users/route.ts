import { NextResponse } from 'next/server';
import { getStoreUsers, addStoreUser } from '@/lib/userStore';
import { requireAuth, requireAdmin } from '@/lib/api-auth';
import { parseBody, CreateUserBodySchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Reading the user list is fine for any signed-in user (rendering team
  // pickers, owners, etc.) — but we still gate it behind authentication.
  const { error } = await requireAuth();
  if (error) return error;
  return NextResponse.json(getStoreUsers());
}

export async function POST(request: Request) {
  // Creating a new user is admin-only. Previously the route accepted whatever
  // shape the client posted (including `role: "admin"`), which let any
  // authenticated user escalate themselves through the file-store fallback.
  const { error: authErr } = await requireAdmin();
  if (authErr) return authErr;

  const { data, error: vErr } = await parseBody(request, CreateUserBodySchema);
  if (vErr) return vErr;

  const initials = data.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  const userId = `user-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const added = addStoreUser({
    id: userId,
    name: data.name,
    email: data.email,
    password: data.password,
    phone: data.phone || '',
    role: data.role,
    initials,
    status: data.status,
  });
  if (!added) {
    return NextResponse.json({ error: 'Email already registered.' }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
