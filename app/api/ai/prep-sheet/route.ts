/**
 * Prep Sheet — assembles a 1-page pre-meeting briefing for an Account,
 * Contact, or Opportunity, and (optionally) asks Claude to generate 5
 * tailored discussion questions on top.
 *
 * POST /api/ai/prep-sheet
 *   body: { kind: 'account'|'contact'|'opportunity', id: string }
 *   returns: {
 *     subject: { kind, id, name },
 *     accountId, accountName, team, companyType,
 *     recentActivities: [{ date, type, subject, description, star }],
 *     openOpps: [{ name, stage, amount, closeDate }],
 *     openTrials: [{ name, phase, health, stage, next_step, due_date }],
 *     news: [{ title, url, publishedAt, source }],
 *     commodities: [{ key, label, latest, unit, deltaWeekPct }],
 *     ytdSales: number,
 *     questions: [string]   // AI-generated when ANTHROPIC_API_KEY present
 *   }
 *
 * The data assembly is standalone — if the Claude call fails (no key,
 * rate limit, timeout) the client still gets everything else and the
 * `questions` array is empty.
 */

import { auth } from '@/auth';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Kind = 'account' | 'contact' | 'opportunity';

interface Req { kind: Kind; id: string }

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Req | null;
  if (!body || !body.kind || !body.id) {
    return Response.json({ error: 'kind + id required' }, { status: 400 });
  }

  const sbUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!sbUrl || !sbKey) return Response.json({ error: 'Supabase not configured' }, { status: 500 });
  const sb = createClient(sbUrl, sbKey);

  // ── 1. Resolve the subject → account_id ─────────────────────
  let accountId = '';
  let subjectName = '';
  if (body.kind === 'account') {
    const { data } = await sb.from('accounts').select('id,name').eq('id', body.id).maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = data as any;
    if (!a) return Response.json({ error: 'account not found' }, { status: 404 });
    accountId = a.id;
    subjectName = a.name;
  } else if (body.kind === 'contact') {
    const { data } = await sb.from('contacts').select('id,first_name,last_name,account_id').eq('id', body.id).maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = data as any;
    if (!c) return Response.json({ error: 'contact not found' }, { status: 404 });
    accountId = c.account_id;
    subjectName = `${c.first_name} ${c.last_name}`.trim();
  } else if (body.kind === 'opportunity') {
    const { data } = await sb.from('opportunities').select('id,name,account_id').eq('id', body.id).maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o = data as any;
    if (!o) return Response.json({ error: 'opportunity not found' }, { status: 404 });
    accountId = o.account_id;
    subjectName = o.name;
  }
  if (!accountId) return Response.json({ error: 'cannot resolve account' }, { status: 400 });

  // ── 2. Pull everything else in parallel ─────────────────────
  const sixWeeksAgoISO = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 42);
    return d.toISOString().slice(0, 10);
  })();

  const [acctRes, actsRes, oppsRes, trialsRes, newsRes, commRes, salesRes] = await Promise.all([
    sb.from('accounts').select('id,name,team,company_type,industry,location,state').eq('id', accountId).maybeSingle(),
    sb.from('activities')
      .select('id,date,type,subject,description,is_important,owner_id,contact_id')
      .eq('account_id', accountId).gte('date', sixWeeksAgoISO)
      .order('date', { ascending: false }).limit(20),
    sb.from('opportunities')
      .select('id,name,stage,amount,close_date,next_step')
      .eq('account_id', accountId).not('stage', 'in', '("Won","Stalled or Lost")'),
    // trials — try to match by name containing account name (loose). The
    // Trial Tracker doesn't FK to accounts, so this is best-effort.
    sb.from('trials').select('id,name,animal_group,phase,finished_at').is('finished_at', null),
    sb.from('industry_news').select('id,title,url,published_at,source,summary').order('published_at', { ascending: false }).limit(5),
    sb.from('commodity_prices').select('commodity_key,date,price,unit').order('date', { ascending: false }).limit(200),
    sb.from('sale_records').select('amount,date,account_name').ilike('account_name', '').limit(0), // placeholder — see below
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const account = acctRes.data as any;
  const activities = (actsRes.data || []).map((a) => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    date: (a as any).date, type: (a as any).type, subject: (a as any).subject,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    description: (a as any).description, star: !!(a as any).is_important,
  }));
  const openOpps = (oppsRes.data || []).map((o) => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    name: (o as any).name, stage: (o as any).stage, amount: (o as any).amount,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    closeDate: (o as any).close_date, nextStep: (o as any).next_step,
  }));

  // Trials — filter by name heuristic (name contains any token from account name)
  const acctTokens = String(account?.name || '').toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const openTrialsAll = (trialsRes.data || []).filter((t) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tn = String((t as any).name || '').toLowerCase();
    return acctTokens.some((tok) => tn.includes(tok));
  });
  // Pull latest update per matched trial
  const trialIds = openTrialsAll.map((t) => (t as { id: string }).id);
  let openTrials: unknown[] = [];
  if (trialIds.length > 0) {
    const { data: us } = await sb.from('trial_updates').select('trial_id,week_ending,stage,health,next_step,due_date').in('trial_id', trialIds).order('week_ending', { ascending: false });
    const byTrial = new Map<string, unknown>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const u of (us || []) as any[]) {
      if (!byTrial.has(u.trial_id)) byTrial.set(u.trial_id, u);
    }
    openTrials = openTrialsAll.map((t) => {
      const tid = (t as { id: string }).id;
      const u = byTrial.get(tid) as Record<string, unknown> | undefined;
      return {
        name: (t as { name: string }).name,
        phase: (t as { phase: string }).phase,
        animalGroup: (t as { animal_group: string }).animal_group,
        health: u?.health ?? null,
        stage: u?.stage ?? null,
        nextStep: u?.next_step ?? null,
        dueDate: u?.due_date ?? null,
      };
    });
  }

  // News — simple keyword match. Full-text match would be better but
  // this is cheap and good enough for a prep card.
  const newsAll = (newsRes.data || []) as unknown as { id: string; title: string; url: string; published_at: string; source: string }[];
  const news = newsAll.filter((n) =>
    acctTokens.some((tok) => n.title.toLowerCase().includes(tok)),
  ).slice(0, 3);

  // Commodities — pick the 2-3 most relevant for this account's team
  const relevantKeys = (() => {
    const team = String(account?.team || '').toLowerCase();
    if (team.includes('mono') || team.includes('swine') || team.includes('poultry')) {
      return ['corn', 'soybean_meal', 'soybean_oil', 'bs_breast'];
    }
    if (team.includes('rumin') || team.includes('dair')) {
      return ['class_iii_milk', 'class_iv_milk', 'live_cattle'];
    }
    return ['corn', 'soybean_meal'];
  })();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commByKey = new Map<string, any[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (commRes.data || []) as any[]) {
    const arr = commByKey.get(row.commodity_key) || [];
    arr.push(row);
    commByKey.set(row.commodity_key, arr);
  }
  const commodities = relevantKeys.map((k) => {
    const arr = commByKey.get(k) || [];
    if (arr.length === 0) return null;
    const latest = arr[0];
    const weekAgo = arr.find((r) => {
      const ad = new Date(latest.date);
      const rd = new Date(r.date);
      return (ad.getTime() - rd.getTime()) >= 6 * 86400000;
    });
    const deltaWeekPct = weekAgo && weekAgo.price > 0
      ? Math.round(((latest.price - weekAgo.price) / weekAgo.price) * 1000) / 10
      : null;
    return { key: k, latest: Number(latest.price), unit: latest.unit, deltaWeekPct };
  }).filter(Boolean);

  // YTD sales roll-up — simple sum by name (same pattern Weekly Report uses)
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const { data: yrSales } = await sb.from('sale_records').select('amount,account_name').gte('date', yearStart);
  const ytdSales = ((yrSales || []) as unknown as { amount: number; account_name: string }[])
    .filter((r) => (r.account_name || '').toLowerCase() === String(account?.name || '').toLowerCase())
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
  void salesRes;

  // ── 3. Ask Claude for 5 meeting questions (optional) ────────
  let questions: string[] = [];
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const prompt = buildPrompt({
      subjectName, subjectKind: body.kind,
      account, activities, openOpps, openTrials, news, commodities, ytdSales,
    });
    try {
      const anth = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (anth.ok) {
        const j = await anth.json() as { content?: { text?: string }[] };
        const text = j.content?.[0]?.text || '';
        // Extract bullet-style lines
        questions = text.split('\n')
          .map((l) => l.replace(/^\s*[-*•\d.)]+\s*/, '').trim())
          .filter((l) => l.length > 10 && l.length < 240)
          .slice(0, 5);
      }
    } catch (e) {
      console.error('[prep-sheet] claude call failed:', e);
    }
  }

  return Response.json({
    subject: { kind: body.kind, id: body.id, name: subjectName },
    accountId, accountName: account?.name || '',
    team: account?.team || '', companyType: account?.company_type || '',
    industry: account?.industry || '', location: account?.location || '', state: account?.state || '',
    recentActivities: activities,
    openOpps,
    openTrials,
    news,
    commodities,
    ytdSales,
    questions,
  });
}

interface PromptCtx {
  subjectName: string;
  subjectKind: Kind;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  account: any;
  activities: { date: string; type: string; subject: string; description: string; star: boolean }[];
  openOpps: { name: string; stage: string; amount: number; closeDate: string; nextStep: string }[];
  openTrials: unknown[];
  news: { title: string; source: string }[];
  commodities: ({ key: string; latest: number; unit: string; deltaWeekPct: number | null } | null)[];
  ytdSales: number;
}

function buildPrompt(ctx: PromptCtx): string {
  const linesAct = ctx.activities.slice(0, 10).map((a) =>
    `- ${a.date} · ${a.type} · ${a.subject}${a.description ? ` — ${a.description.slice(0, 160)}` : ''}`
  ).join('\n');
  const linesOpp = ctx.openOpps.map((o) => `- ${o.name} · ${o.stage} · $${Math.round(o.amount).toLocaleString()} · closes ${o.closeDate}${o.nextStep ? ` · next: ${o.nextStep.slice(0, 120)}` : ''}`).join('\n');
  const linesTrial = (ctx.openTrials as Record<string, unknown>[]).map((t) =>
    `- ${t.name} · ${t.animalGroup}/${t.phase}${t.health ? ` · ${t.health}` : ''}${t.stage ? ` · ${t.stage}` : ''}${t.nextStep ? ` · next: ${String(t.nextStep).slice(0, 120)}` : ''}`
  ).join('\n');
  const linesNews = ctx.news.map((n) => `- ${n.title}`).join('\n');
  const linesComm = ctx.commodities.filter(Boolean).map((c) => {
    const cc = c as { key: string; latest: number; unit: string; deltaWeekPct: number | null };
    return `- ${cc.key}: ${cc.latest} ${cc.unit}${cc.deltaWeekPct !== null ? ` (${cc.deltaWeekPct > 0 ? '+' : ''}${cc.deltaWeekPct}% WoW)` : ''}`;
  }).join('\n');

  return `You are helping a Pathway Intermediates sales rep prepare for a meeting.
Pathway sells feed-additive specialty ingredients (Lipidol, Enncinate, Barrier, etc.) to animal nutrition / feed companies.

MEETING SUBJECT: ${ctx.subjectName} (${ctx.subjectKind})
ACCOUNT: ${ctx.account?.name || '—'}
TEAM: ${ctx.account?.team || '—'}
COMPANY TYPE: ${ctx.account?.company_type || '—'}
INDUSTRY: ${ctx.account?.industry || '—'}
LOCATION: ${[ctx.account?.location, ctx.account?.state].filter(Boolean).join(', ') || '—'}
YTD SALES: $${Math.round(ctx.ytdSales).toLocaleString()}

RECENT ACTIVITIES (last 6 weeks):
${linesAct || '(none)'}

OPEN OPPORTUNITIES:
${linesOpp || '(none)'}

OPEN TRIALS (likely matched by name):
${linesTrial || '(none)'}

RELEVANT NEWS:
${linesNews || '(none)'}

COMMODITY PRICES THAT MATTER TO THIS ACCOUNT:
${linesComm || '(none)'}

TASK: Generate exactly 5 specific, open-ended discussion questions the rep should ask in this meeting.
- Each question should reference something concrete from the context above (not generic "how are things going").
- Prefer questions that advance an open opportunity, surface a problem Pathway could solve, or build rapport by referencing a recent event.
- Keep each question under 25 words.
- Output as a plain numbered list, nothing else. No preamble, no "Here are 5 questions", no explanation.`;
}
