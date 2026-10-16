/**
 * Ask CRM — natural-language queries against the user's CRM data.
 *
 * V2 (2026-10-16, Opus 4.7 upgrade): turned the one-shot filter
 * executor into a small reasoning loop. The previous version just
 * answered "No matching rows." whenever the plan came back empty —
 * which is useless when the user is actually asking something that
 * requires judgment ("when will Simplot order?", "which account
 * needs follow-up?"). The new flow:
 *
 *   1. ENTITY SNIFF
 *      Haiku extracts any Account / Contact / Trial names from the
 *      question (fuzzy — "simplot", "Kalmbach", "UGA broiler" all
 *      survive). Plus the usual filter plan.
 *
 *   2. PRIMARY QUERY
 *      Execute the plan against Supabase, same whitelist as V1.
 *
 *   3. CONTEXT EXPANSION
 *      If any entities were sniffed OR the primary query returned
 *      zero rows, pull a small context packet: the account(s)
 *      themselves, their recent activities (last 90d), open
 *      opportunities, open tasks, and recent trial updates. This is
 *      what turns "No matching rows" into "Last activity was a call
 *      on 9/12; the deal has been in Trial Started for 47 days, so
 *      you'd typically expect an order 60–90 days out — around early
 *      November."
 *
 *   4. REASONING ANSWER
 *      Second Claude call (Haiku again — fast + cheap). Prompt
 *      includes the question, the plan result, the context packet,
 *      and today's date. Claude must produce a substantive
 *      paragraph plus bullet-form Suggested next steps. If the data
 *      really can't support a prediction, Claude still says what IS
 *      known and asks a specific clarifying question instead of
 *      shrugging.
 *
 * The whitelist model is unchanged: Claude never writes SQL, only
 * emits structured plan + narration. All reads go through the
 * ALLOWED_TABLES / column regex guard.
 *
 * POST body: { question: string }
 * Response:  { answer, rows, headers, suggestions, source, context }
 */

import { auth } from '@/auth';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

// ── Schema cheat-sheet given to Claude ────────────────────────
const SCHEMA_HINT = `Tables available to query:

accounts(id, name, team, company_type, industry, location, state,
         owner_id, parent_account_id, created_at)
contacts(id, first_name, last_name, title, account_id, owner_id,
         role_in_deal, influence_score, is_key_man)
opportunities(id, name, stage, amount, close_date, probability,
              account_id, owner_id, next_step, expected_start_date,
              created_at)
tasks(id, subject, status, due_date, priority, owner_id,
      related_account_id, related_contact_id)
activities(id, type, subject, note, date, owner_id, account_id,
           contact_id, is_important)
trials(id, name, animal_group, phase, finished_at)
trial_updates(id, trial_id, week_ending, stage, health, owner,
              what_happened, next_step)
users(id, name, email, team, role)

Stages (opportunities.stage):
  'Prospect' | 'Qualified' | 'Trial Started' | 'Trial Ended' |
  'Results Successful' | 'Won' | 'Stalled or Lost'

Teams (users.team / accounts.team):
  'monogastrics' | 'swine' | 'ruminants' | 'latam' | 'familyb2b'
  | 'marketing' | 'management'

Important: You can ONLY filter and sort. You cannot create, update,
or delete anything.`;

interface Plan {
  table: 'accounts' | 'contacts' | 'opportunities' | 'tasks' | 'activities' | 'trials' | 'trial_updates' | 'users' | 'unknown';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filters: Array<{ col: string; op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'ilike' | 'is' | 'in'; value: any }>;
  orderBy?: { col: string; ascending: boolean };
  limit?: number;
  select?: string[];
  explanation: string;
  /** Named entities we should pull context for even if the main
   *  query returns rows (people often ask about a specific account
   *  and want more than just a row list back). */
  entities?: {
    accounts?: string[];     // free text — we fuzzy match on accounts.name
    contacts?: string[];     // free text — fuzzy on first+last name
    trials?: string[];       // free text — fuzzy on trials.name
  };
}

const ALLOWED_TABLES = new Set([
  'accounts', 'contacts', 'opportunities', 'tasks', 'activities',
  'trials', 'trial_updates', 'users',
]);
const USERS_SAFE_COLS = ['id', 'name', 'email', 'team', 'role'];

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const myId = session.user.id || '';
  const myName = (session.user as { name?: string }).name || '';
  const myRole = ((session.user as { role?: string }).role || '').toLowerCase();

  const { question } = await request.json().catch(() => ({ question: '' })) as { question?: string };
  if (!question || question.trim().length < 3) {
    return Response.json({ error: 'question required' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'AI not configured (ANTHROPIC_API_KEY missing)' }, { status: 500 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const since90 = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);

  // ── 1. Ask Claude for a structured plan + entity sniff ────
  const planPrompt = `You translate CRM questions into structured filter plans AND spot named entities.

${SCHEMA_HINT}

User question: ${question.replace(/\n+/g, ' ').slice(0, 500)}
Current user context: user_id="${myId}", user_name="${myName}", role="${myRole}", today=${today}

Return ONLY a JSON object with this exact shape (no prose, no backticks):
{
  "table": "accounts|contacts|opportunities|tasks|activities|trials|trial_updates|users|unknown",
  "filters": [{"col":"...","op":"eq|neq|gt|gte|lt|lte|ilike|is|in","value":...}],
  "orderBy": {"col":"...","ascending":false},
  "limit": 25,
  "select": ["col1","col2"],
  "explanation": "One short sentence describing what you filtered.",
  "entities": { "accounts": ["Simplot"], "contacts": [], "trials": [] }
}

Rules:
- Date comparisons: ISO (YYYY-MM-DD).
- "my ..." / "I ..." → add filter {"col":"owner_id","op":"eq","value":"${myId}"}.
- "ilike" needs % wildcards, e.g. "%dairy%".
- limit ≤ 100.
- "select" lists columns the UI should show.
- "entities" lists any specific company / person / trial names mentioned
  in the question. These are used to pull extra context later even
  when the main query returns 0 rows. ALWAYS fill this when a specific
  name is mentioned — "when will Simplot order?" → entities.accounts=["Simplot"].
- Prefer the opportunities table for "when will X order", "will X buy", etc.
- Pick the MOST LIKELY table rather than refusing — "unknown" is a last resort.`;

  let plan: Plan | null = null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
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
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in planner response');
    plan = JSON.parse(match[0]) as Plan;
  } catch (e) {
    return Response.json({ error: `AI planning failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }

  // ── 2. Supabase client ────────────────────────────────────
  const sbUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!sbUrl || !sbKey) return Response.json({ error: 'Supabase not configured' }, { status: 500 });
  const sb = createClient(sbUrl, sbKey);

  // ── 3. Execute the primary plan (if valid) ────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows: any[] = [];
  let headers: string[] = [];
  let primaryTable: string | null = null;
  const colAllowed = (c: string, table: string) => {
    if (!/^[a-z_]+$/.test(c)) return false;
    if (table === 'users') return USERS_SAFE_COLS.includes(c);
    return true;
  };
  if (plan && plan.table !== 'unknown' && ALLOWED_TABLES.has(plan.table)) {
    primaryTable = plan.table;
    const safeCols = plan.table === 'users' ? USERS_SAFE_COLS : null;
    const requested = Array.isArray(plan.select) ? plan.select.filter((c) => colAllowed(c, plan!.table)) : [];
    const selectCols = requested.length > 0 ? requested.join(',') : safeCols ? safeCols.join(',') : '*';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = sb.from(plan.table).select(selectCols);
    for (const f of (plan.filters || []).slice(0, 8)) {
      if (!colAllowed(f.col, plan.table)) continue;
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
    if (plan.orderBy && colAllowed(plan.orderBy.col, plan.table)) {
      q = q.order(plan.orderBy.col, { ascending: !!plan.orderBy.ascending });
    }
    const limit = Math.min(Math.max(1, Number(plan.limit) || 25), 100);
    q = q.limit(limit);
    const { data } = await q;
    rows = (data || []) as unknown[];
    headers = (rows[0] ? Object.keys(rows[0] as object) : (plan.select || [])) as string[];
  }

  // ── 4. Context expansion ──────────────────────────────────
  // Named entities OR empty primary → go pull the account's recent
  // activity, open opps, open tasks, trial updates. Keep each list
  // short so the follow-up Claude call stays snappy.
  const context: Record<string, unknown> = {};
  const entityAccounts = plan?.entities?.accounts ?? [];
  const entityContacts = plan?.entities?.contacts ?? [];
  const entityTrials = plan?.entities?.trials ?? [];
  const needsContext = entityAccounts.length > 0
    || entityContacts.length > 0
    || entityTrials.length > 0
    || (primaryTable && rows.length === 0);

  if (needsContext) {
    try {
      // Pull matching accounts (fuzzy)
      const acctIds: string[] = [];
      const accountSummaries: Array<{ id: string; name: string; team?: string; owner_id?: string }> = [];
      for (const term of entityAccounts.slice(0, 3)) {
        const { data } = await sb.from('accounts')
          .select('id, name, team, owner_id, industry, state')
          .ilike('name', `%${term}%`).limit(3);
        for (const a of (data ?? []) as Array<{ id: string; name: string; team?: string; owner_id?: string }>) {
          if (!acctIds.includes(a.id)) {
            acctIds.push(a.id);
            accountSummaries.push(a);
          }
        }
      }
      // If no entity accounts but primary query was accounts and returned 0,
      // try the ilike pattern we already had.
      if (acctIds.length === 0 && primaryTable === 'opportunities') {
        // Fall through — just skip
      }
      if (accountSummaries.length > 0) context.accounts = accountSummaries;

      if (acctIds.length > 0) {
        const [actsRes, oppsRes, tasksRes] = await Promise.all([
          sb.from('activities')
            .select('id, type, subject, note, date, is_important, account_id, owner_id')
            .in('account_id', acctIds).gte('date', since90).order('date', { ascending: false }).limit(15),
          sb.from('opportunities')
            .select('id, name, stage, amount, close_date, probability, next_step, account_id, owner_id, expected_start_date, created_at')
            .in('account_id', acctIds).order('close_date', { ascending: true }).limit(10),
          sb.from('tasks')
            .select('id, subject, status, due_date, priority, related_account_id, owner_id')
            .in('related_account_id', acctIds).eq('status', 'Open').order('due_date', { ascending: true }).limit(10),
        ]);
        context.recentActivities = actsRes.data ?? [];
        context.opportunities = oppsRes.data ?? [];
        context.openTasks = tasksRes.data ?? [];
      }

      // Trial context
      if (entityTrials.length > 0) {
        const trialSummaries: Array<Record<string, unknown>> = [];
        for (const term of entityTrials.slice(0, 3)) {
          const { data } = await sb.from('trials')
            .select('id, name, animal_group, phase, finished_at')
            .ilike('name', `%${term}%`).limit(3);
          for (const t of (data ?? []) as Array<Record<string, unknown>>) trialSummaries.push(t);
        }
        if (trialSummaries.length > 0) {
          context.trials = trialSummaries;
          const trialIds = trialSummaries.map((t) => t.id as string);
          const { data: upd } = await sb.from('trial_updates')
            .select('trial_id, week_ending, stage, health, what_happened, next_step, owner')
            .in('trial_id', trialIds).order('week_ending', { ascending: false }).limit(8);
          context.recentTrialUpdates = upd ?? [];
        }
      }
    } catch (e) {
      // Context expansion is best-effort — never fail the whole
      // response just because one of the enrichment queries 500'd.
      context.contextError = e instanceof Error ? e.message : String(e);
    }
  }

  // ── 5. Reasoning answer (second LLM call) ────────────────
  const answerPrompt = `You are the Pathway Intermediates CRM assistant. The user is a salesperson and your job is to give them an actionable, substantive answer — not just a row count.

User question: ${question}

Today's date: ${today}
Current user: ${myName} (role: ${myRole})

Primary query results (table: ${primaryTable || 'none'}): ${JSON.stringify(rows.slice(0, 20))}

Context packet (recent activity on referenced accounts / contacts / trials):
${JSON.stringify(context, null, 2).slice(0, 6000)}

Instructions:
1. Give a direct answer in 1–3 sentences. If the data is thin, say what IS known rather than refusing.
2. For prediction questions ("when will X order?", "will this deal close?"), reason from the stage, close_date, last activity, and historical cadence. Give a dated estimate (e.g. "likely early November") with a plain-English rationale.
3. For "which should I prioritise" questions, pick a short-list and justify.
4. End with "Suggested next steps:" followed by 1–3 concrete bullet actions the user can take today (log an activity, send an email, create a task). Each bullet starts with a verb.
5. If the data really cannot support an answer, say exactly what's missing and ask ONE clarifying question — don't just say "no data".
6. Keep the whole response under 180 words. Plain text, no markdown headers.`;

  let answer = plan?.explanation || '';
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: answerPrompt }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (r.ok) {
      const j = await r.json() as { content?: { text?: string }[] };
      const text = j.content?.[0]?.text?.trim();
      if (text) answer = text;
    }
  } catch { /* keep the plan explanation as fallback */ }

  return Response.json({
    answer,
    rows,
    headers,
    source: plan && plan.table !== 'unknown' ? {
      table: plan.table, filters: plan.filters, orderBy: plan.orderBy, limit: plan.limit,
    } : null,
    context: Object.keys(context).length > 0 ? context : null,
  });
}
