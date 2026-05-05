import { z } from 'zod';
import { NextResponse } from 'next/server';

/**
 * Shared input-validation schemas for API routes.
 *
 * Why schemas: without them, anyone can POST `{role: "admin"}` to user-creation
 * endpoints and escalate themselves. zod gives us defense-in-depth even when
 * the route already does session checks — the body must match the contract.
 *
 * Use `parseBody(req, Schema)` in route handlers; on failure it returns a
 * `NextResponse` with a 400 + the field that failed (no full Zod tree —
 * we don't want to confuse end users).
 */

// ── Primitive building blocks ───────────────────────────────────────────────

export const ROLES = [
  'administrative_manager',
  'admin',
  'ceo',
  'sales_director',
  'coo',
  'sales',
  'marketing',
] as const;

export const STATUSES = ['pending', 'active', 'inactive'] as const;

const TRIM_MIN_1 = z.string().trim().min(1);
const TRIM_MAX_200 = z.string().trim().max(200);

const EmailSchema = z.string().trim().toLowerCase().email().max(254);
const PasswordSchema = z.string().min(6).max(200);
const NameSchema = TRIM_MIN_1.max(120);
const PhoneSchema = z.string().trim().max(40).optional();
const RoleSchema = z.enum(ROLES);
const StatusSchema = z.enum(STATUSES);

// ── Route schemas ───────────────────────────────────────────────────────────

/** POST /api/auth/register — public signup */
export const RegisterBodySchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  name: NameSchema,
  phone: PhoneSchema,
});

/** POST /api/users — admin creates a new user (legacy / file-store path) */
export const CreateUserBodySchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  name: NameSchema,
  phone: PhoneSchema,
  role: RoleSchema.default('sales'),
  status: StatusSchema.default('active'),
});

/** POST /api/admin/create-user — admin creates a Supabase user row */
export const AdminCreateUserBodySchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  name: NameSchema,
  phone: PhoneSchema,
  role: RoleSchema,
  status: StatusSchema.optional(),
});

/** PATCH /api/users/:id — admin updates a user. All fields optional but
 *  at least one must be provided. */
export const UpdateUserBodySchema = z
  .object({
    name: NameSchema.optional(),
    phone: PhoneSchema,
    role: RoleSchema.optional(),
    status: StatusSchema.optional(),
    profilePhoto: z.string().max(2_000_000).optional(), // base64 cap (~2MB)
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field is required',
  });

// ── Helper: parse a request body with a schema, return error response on fail

export async function parseBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T
): Promise<{ data: z.infer<T>; error: null } | { data: null; error: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      data: null,
      error: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    // Pull out the first issue. We deliberately don't return the whole zod
    // error tree — most callers are user-facing forms that just need one
    // helpful message.
    const first = result.error.issues[0];
    const path = first.path.length > 0 ? first.path.join('.') : 'body';
    return {
      data: null,
      error: NextResponse.json(
        { error: `Invalid ${path}: ${first.message}` },
        { status: 400 }
      ),
    };
  }

  return { data: result.data, error: null };
}

// Re-export TRIM_MAX_200 for callers that want a simple sanitized string.
export { TRIM_MAX_200 };
