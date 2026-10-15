/**
 * Ask CRM — natural-language queries against the user's CRM data.
 *
 * How it works:
 *   1. User types "Which accounts in Monogastric haven't been
 *      contacted in 60 days?" into the AICopilotPanel.
 *   2. We pass the question + a lightweight schema cheat-sheet to
 *      Claude. Claude returns a short "plan" describing which
 *      tables to pull and what to filter.
 *   3. We execute the plan against Supabase via a small set of
 *      ALLOWED operations (no raw SQL — Claude never writes code
 *      that touches the DB directly). This blocks SQL-injection and
 *      prompt-injection vectors.
 *   4. The resulting rows + a short natural-language summary go
 *      back to the client, which renders a table in the sidebar.
 *
 * POST body: { question: string }
 * Response:  { answer, rows, headers, source }
 */

import { auth } from '@/auth';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ── Schema cheat-sheet given to Claude ────────────────────────
// Minimal, concrete, and limited to fields it's safe to filter on.
// Resist adding freeform notes/descriptions here — they bloat the
// context and tempt the model to assume richer filters than we can
// execute safely.
const SCHEMA_HINT = `Tables available to query:

accounts(id, name, team, company_type, industry, location, state,
         owner_id, parent_account_id, created_at)
contacts(id, first_name, last_name, title, account_id, owner_id,
         role_in_deal, influence_score, is_key_man)
opportunities(id, name, stage, amount, close_date, account_id,
              owner_id, next_step)
tasks(id, subject, status, due_date, priority, owner_id,
      related_account_id)
activities(id, type, subject, date, owner_id, account_id, is_important)
trials(id, name, animal_group, phase, finished_at)
trial_updates(id, trial_id, week_ending, stage, health, owner, next_step)
users(id, name, email, team, role)

Stages (opportunities.stage):
  'Prospect' | 'Qualified' | 'Trial Started' | 'Trial Ended' |
  'Results Successful' | 'Won' | 'Stalled or Lost'

Teams (users.team / accounts.team):
  'monogastrics' | 'swine' | 'ruminants' | 'latam' | 'familyb2b'
  | 'marketing' | 'management'

Important: You can ONLY filter and sort. You cannot create, update,
or delete anything. Return "unknown" if the question needs data not
in the schema.`;

interface Plan {
  table: 'accounts' | 'contacts' | 'opportunities' | 'tasks' | 'activities' | 'trials' | 'trial_updates' | 'users' | 'unknown';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filters: Array<{ col: string; op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'ilike' | 'is' | 'in'; value: any }>;
  orderBy?: { col: string; ascending: boolean };
  limit?: number;
  select?: string[];
  // The summary we'll show above the result table.
  explanation: string;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const myId = session.user.id || '';
  const myRole = ((session.user as { role?: string }).role || '').toLowerCase();

  const { question } = await request.json().catch(() => ({ question: '' })) as { question?: string };
  if (!question || question.trim().length < 3) {
    return Response.json({ error: 'question required' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'AI not configured (ANTHROPIC_API_KEY missing)' }, { status: 500 });
  }

  // ── 1. Ask Claude for a structured plan ────────────────────
  const planPrompt = `You translate CRM questions into structured filter plans.

${SCHEMA_HINT}

User question: ${question.replace(/\n+/g, ' ').slice(0, 500)}

Current user context: user_id="${myId}", role="${myRole}", today=${new Date().toISOString().slice(0, 10)}

Return ONLY a JSON object with this exact shape (no prose, no backticks):
{
  "table": "...",
  "filters": [{"col":"...","op":"eq|neq|gt|gte|lt|lte|ilike|is|in","value":...}],
  "orderBy": {"col":"...","ascending":false},
  "limit": 50,
  "select": ["col1","col2","col3"],
  "explanation": "One short sentence describing what you filtered."
}

Rules:
- Date comparisons: use ISO strings (YYYY-MM-DD).
- "my ..." / "I ..." → add filter {"col":"owner_id","op":"eq","value":"${myId}"}.
- "ilike" needs % wildcards in the value, e.g. "%dairy%".
- Keep limit ≤ 100.
- "select" must list columns the UI should show.
- If the question is ambiguous or can't be answered from the schema, return:
  {"table":"unknown","filters":[],"explanation":"Can't answer that from the CRM data."}`;

  let plan: Plan | null = null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: planPrompt }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return Response.json({ error: `Claude error: ${(err as { message?: string }).message || r.status}` }, { status: 500 });
    }
    const j = await r.json() as { content?: { text?: string }[] };
    const text = j.content?.[0]?.text || '';
    // Extract the first JSON object in the response (defensive — model
    // sometimes wraps JSON in a code fence despite instructions).
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    plan = JSON.parse(match[0]) as Plan;
  } catch (e) {
    return Response.json({ error: `AI planning failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }

  if (!plan || plan.table === 'unknown' || !ALLOWED_TABLES.has(plan.table)) {
    return Response.json({
      answer: plan?.explanation || "I couldn't translate that into a CRM query.",
      rows: [], headers: [], source: null,
    });
  }

  // ── 2. Execute against Supabase (whitelisted) ──────────────
  const sbUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!sbUrl || !sbKey) {
    return Response.json({ error: 'Supabase not configured' }, { status: 500 });
  }
  const sb = createClient(sbUrl, sbKey);

  // Build a safe select clause — if the plan listed columns, use them;
  // otherwise fall back to '*' (Supabase caps row size on its own).
  // `users` holds the password column and we're on the service role,
  // so that table is locked to a fixed column set for select, filter
  // and order — never '*'.
  const safeCols = plan.table === 'users' ? USERS_SAFE_COLS : null;
  const colAllowed = (c: string) => /^[a-z_]+$/.test(c) && (!safeCols || safeCols.includes(c));
  const requested = Array.isArray(plan.select) ? plan.select.filter(colAllowed) : [];
  const selectCols = requested.length > 0
    ? requested.join(',')
    : safeCols ? safeCols.join(',') : '*';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = sb.from(plan.table).select(selectCols);

  // Apply up to 8 filters (hard cap to prevent runaway chaining)
  for (const f of (plan.filters || []).slice(0, 8)) {
    if (!colAllowed(f.col)) continue;
    switch (f.op) {
      case 'eq':   q = q.eq(f.col, f.value); break;
      case 'neq':  q = q.neq(f.col, f.value); break;
      case 'gt':   q = q.gt(f.col, f.value); break;
      case 'gte':  q = q.gte(f.col, f.value); break;
      case 'lt':   q = q.lt(f.col, f.value); break;
      case 'lte':  q = q.lte(f.col, f.value); break;
      case 'ilike':q = q.ilike(f.col, String(f.value)); break;
      case 'is':   q = q.is(f.col, f.value); break;
      case 'in':   if (Array.isArray(f.value)) q = q.in(f.col, f.value); break;
    }
  }
  if (plan.orderBy && colAllowed(plan.orderBy.col)) {
    q = q.order(plan.orderBy.col, { ascending: !!plan.orderBy.ascending });
  }
  const limit = Math.min(Math.max(1, Number(plan.limit) || 25), 100);
  q = q.limit(limit);

  const { data, error } = await q;
  if (error) {
    return Response.json({ error: `Supabase error: ${error.message}`, plan }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data || []) as any[];
  const headers = rows[0] ? Object.keys(rows[0]) : (plan.select || []);

  return Response.json({
    answer: plan.explanation || `Found ${rows.length} row${rows.length === 1 ? '' : 's'}.`,
    rows,
    headers,
    source: { table: plan.table, filters: plan.filters, orderBy: plan.orderBy, limit },
  });
}

const ALLOWED_TABLES = new Set([
  'accounts', 'contacts', 'opportunities', 'tasks', 'activities',
  'trials', 'trial_updates', 'users',
]);

const USERS_SAFE_COLS = ['id', 'name', 'email', 'team', 'role'];
