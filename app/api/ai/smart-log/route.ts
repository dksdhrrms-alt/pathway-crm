/**
 * Smart Log — turn free text (typed or voice-transcribed) into a
 * structured Activity + optional follow-up Task.
 *
 * This is the "I just had a meeting, let me scribble a sentence
 * instead of filling out a form" fix. Reddit r/sales #1 complaint
 * about every CRM is manual data entry; this cuts the ceremony to:
 *
 *   type/dictate → preview the parsed result → confirm.
 *
 * The server does the parse here (never persists), returns a
 * JSON preview. The client renders the preview in a modal with
 * editable fields and only writes on confirm. Keeps us honest
 * about AI mistakes — the user always sees what will land.
 *
 * POST body: { text: string, accounts?: {id,name,team}[],
 *              contacts?: {id,firstName,lastName,accountId}[] }
 * Response:  { preview: {...}, confidence: number, warnings: [] }
 */

import { auth } from '@/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const ACTIVITY_TYPES = ['Call', 'Meeting', 'Email', 'Note'] as const;
const ACTIVITY_PURPOSES = [
  'Prospecting - new opportunity',
  'Prospecting - growing existing business',
  'Follow up - new opportunity',
  'Follow up - existing business',
  'maintenance - existing customer',
  'Industry call - informational',
  'Internal meeting',
  'Nutritionist call',
  'Nutritionist Education Event',
];

interface SmartLogPreview {
  type: typeof ACTIVITY_TYPES[number];
  purpose: string | null;
  subject: string;
  note: string;
  /** YYYY-MM-DD (today if the user didn't mention). */
  date: string;
  /** Fuzzy match — may be null if nothing in the catalog looked close. */
  account: { id: string | null; name: string | null; confidence: 'high' | 'medium' | 'low' | null };
  contact: { id: string | null; name: string | null } | null;
  /** Follow-up Task extracted from "need to send samples next week". */
  task: { subject: string; dueDate: string | null; priority: 'High' | 'Medium' | 'Low' } | null;
  /** True when Claude couldn't nail down the account — the client
   *  should show the account picker open with a search prefill. */
  needsAccountPick: boolean;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null) as {
    text?: string;
    accounts?: Array<{ id: string; name: string; team?: string }>;
    contacts?: Array<{ id: string; firstName: string; lastName: string; accountId?: string }>;
  } | null;
  const text = (body?.text || '').trim();
  if (text.length < 5) return Response.json({ error: 'text too short' }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: 'AI not configured' }, { status: 500 });

  // Build a compact account catalog so Claude can match names it sees
  // in the free text. We trim to 300 to keep the prompt small — bigger
  // orgs can switch to a server-side fuzzy pre-filter later. Each entry
  // is just "id|name" so the response can reference them by id directly.
  const accountCatalog = (body?.accounts ?? []).slice(0, 300)
    .map((a) => `${a.id}|${a.name}`).join('\n');
  const contactCatalog = (body?.contacts ?? []).slice(0, 500)
    .map((c) => `${c.id}|${c.firstName} ${c.lastName}|${c.accountId ?? ''}`).join('\n');

  const today = new Date().toISOString().slice(0, 10);

  const prompt = `You are a CRM data-entry assistant. The salesperson typed or dictated the raw text below. Convert it into one structured Activity log + an optional follow-up Task.

Raw text:
"""
${text.slice(0, 1500)}
"""

Today's date: ${today}
Activity types (pick ONE): ${ACTIVITY_TYPES.join(', ')}
Activity purposes (pick the closest ONE, or null): ${ACTIVITY_PURPOSES.join(' | ')}

Account catalog (format: id|name):
${accountCatalog || '(none provided)'}

Contact catalog (format: id|first last|accountId):
${contactCatalog || '(none provided)'}

Return ONLY this JSON (no code fence, no commentary):
{
  "type": "Call|Meeting|Email|Note",
  "purpose": "one of the listed purposes, or null",
  "subject": "short title, under 80 chars, imperative or past-tense (e.g. 'Discussed trial protocol with Tanner')",
  "note": "the salesperson's full detail, cleaned up and in third-person-sales style, up to ~400 chars",
  "date": "YYYY-MM-DD (default to today if no explicit date in the text)",
  "accountId": "the matching catalog id, or null if nothing in the catalog is clearly the account",
  "accountName": "the catalog name if matched, else the raw name the user typed, else null",
  "accountConfidence": "high|medium|low|null — how sure you are the id above is correct",
  "contactId": "catalog id of the person mentioned, or null",
  "contactName": "raw name of the person mentioned, or null",
  "task": {
    "subject": "the follow-up action (verb + object), under 80 chars",
    "dueDate": "YYYY-MM-DD or null if unspecified",
    "priority": "High|Medium|Low"
  }
}

Rules:
- type: default to "Call" if the text says "spoke" or "called". "Meeting" if "met with", "lunch", "visit". "Email" if explicit. "Note" otherwise.
- date: resolve relative phrases — "yesterday" → yesterday's ISO date; "last Friday" → that Friday. Never leave as a relative phrase.
- task: ONLY create one if the text clearly implies a follow-up action by the salesperson ("need to send", "will call them", "follow up next week"). If no follow-up, return "task": null.
- task.dueDate: resolve "next week" to the following Monday, "tomorrow" to tomorrow, "end of month" to the month's last day. Null only when there's no time cue at all.
- accountId: only populate when you are confident the raw text clearly refers to a single row in the catalog. Partial matches that could be two accounts → leave null, let the user pick.
- Do NOT fabricate — if the text has no useful content, return accountId=null, task=null, subject reflecting what little the text says.`;

  let parsed: Record<string, unknown> | null = null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return Response.json({ error: `Claude error: ${(err as { message?: string }).message || r.status}` }, { status: 500 });
    }
    const j = await r.json() as { content?: { text?: string }[] };
    const raw = j.content?.[0]?.text || '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON');
    parsed = JSON.parse(match[0]);
  } catch (e) {
    return Response.json({ error: `Parse failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }

  const type = (ACTIVITY_TYPES as readonly string[]).includes(String(parsed?.type))
    ? String(parsed?.type) : 'Note';
  const purposeRaw = parsed?.purpose ? String(parsed.purpose) : null;
  const purpose = purposeRaw && ACTIVITY_PURPOSES.includes(purposeRaw) ? purposeRaw : null;
  const subject = String(parsed?.subject || '').slice(0, 120) || text.slice(0, 80);
  const note = String(parsed?.note || '').slice(0, 2000) || text.slice(0, 2000);
  const dateStr = typeof parsed?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : today;

  const accountId = typeof parsed?.accountId === 'string' ? parsed.accountId : null;
  const accountName = typeof parsed?.accountName === 'string' ? parsed.accountName : null;
  const accountConfidence = (['high', 'medium', 'low'] as const).includes(parsed?.accountConfidence as 'high' | 'medium' | 'low')
    ? (parsed?.accountConfidence as 'high' | 'medium' | 'low') : null;

  const contactId = typeof parsed?.contactId === 'string' ? parsed.contactId : null;
  const contactName = typeof parsed?.contactName === 'string' ? parsed.contactName : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const taskRaw = parsed?.task as any;
  let task: SmartLogPreview['task'] = null;
  if (taskRaw && typeof taskRaw === 'object' && taskRaw.subject) {
    task = {
      subject: String(taskRaw.subject).slice(0, 160),
      dueDate: typeof taskRaw.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(taskRaw.dueDate)
        ? taskRaw.dueDate : null,
      priority: (['High', 'Medium', 'Low'] as const).includes(taskRaw.priority)
        ? taskRaw.priority : 'Medium',
    };
  }

  const preview: SmartLogPreview = {
    type: type as SmartLogPreview['type'],
    purpose,
    subject,
    note,
    date: dateStr,
    account: { id: accountId, name: accountName, confidence: accountConfidence },
    contact: contactId || contactName ? { id: contactId, name: contactName } : null,
    task,
    needsAccountPick: !accountId,
  };

  const warnings: string[] = [];
  if (preview.needsAccountPick) warnings.push('Account could not be matched — pick from the dropdown.');
  if (preview.task && !preview.task.dueDate) warnings.push("Follow-up task has no due date — defaulting to blank; set one if needed.");

  return Response.json({ preview, warnings });
}
