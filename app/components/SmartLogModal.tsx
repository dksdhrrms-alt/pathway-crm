'use client';

/**
 * SmartLogModal — the "scribble it, we'll parse it" entry point.
 *
 * One textarea + voice button. User dictates "Just had a meeting
 * with Tanner at Kalmbach, discussed the trial protocol, need to
 * send samples next week." → hits ✨ Parse → Claude returns a
 * structured preview → user reviews the fields → Confirm → row
 * writes to the DB.
 *
 * No field-by-field form on step 1. That's the whole point —
 * reps hate CRMs because every log takes 90 seconds of clicking.
 * This takes 10 seconds of talking.
 *
 * Flow:
 *   step=input  → textarea + mic + "Parse" button
 *   step=review → editable preview card + Confirm/Discard
 *   step=saving → spinner
 */

import { useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import { generateId, ActivityType, ACTIVITY_PURPOSES, type Task } from '@/lib/data';
import VoiceInputButton from './VoiceInputButton';
import SubmitButton from './SubmitButton';
import { Modal } from './ui/Modal';
import { Sparkles, Loader2, AlertTriangle, Check, Pencil } from 'lucide-react';

interface Preview {
  type: ActivityType;
  purpose: string | null;
  subject: string;
  note: string;
  date: string;
  account: { id: string | null; name: string | null; confidence: 'high' | 'medium' | 'low' | null };
  contact: { id: string | null; name: string | null } | null;
  task: { subject: string; dueDate: string | null; priority: 'High' | 'Medium' | 'Low' } | null;
  needsAccountPick: boolean;
}

interface Props {
  onClose: () => void;
  onSaved?: () => void;
}

export default function SmartLogModal({ onClose, onSaved }: Props) {
  const { data: session } = useSession();
  const { accounts, contacts, addActivity, addTask } = useCRM();
  const { users } = useUsers();
  const userId = session?.user?.id ?? '';
  const myName = users.find((u) => u.id === userId)?.name;

  const [step, setStep] = useState<'input' | 'review'>('input');
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Set<string>>(new Set());

  const accountOptions = useMemo(() =>
    accounts.map((a) => ({ id: a.id, name: a.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [accounts],
  );
  const contactOptionsForAccount = useMemo(() => {
    if (!preview?.account.id) return [];
    return contacts
      .filter((c) => c.accountId === preview.account.id)
      .map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}` }));
  }, [contacts, preview?.account.id]);

  /** Rough question detector so users who meant to open Ask CRM
   *  (bottom-left) don't waste a round-trip here. We flag anything
   *  that ends with "?" or starts with a question word in English
   *  or Korean — same words Ask CRM already handles well. The user
   *  can override and parse anyway if they really meant to log it. */
  function looksLikeQuestion(s: string): boolean {
    const t = s.trim();
    if (!t) return false;
    if (t.endsWith('?') || t.endsWith('?')) return true;
    // \b only works on ASCII word chars, so Korean prefixes match without it.
    return /^(?:(?:when|where|who|what|which|why|how)\b|(?:is|are|does|do|can|should|will)\s|언제|어디|누가|무엇|뭐|왜|어떻|어떤|얼마|몇)/i.test(t);
  }
  const questionLike = looksLikeQuestion(text);

  async function parse() {
    const trimmed = text.trim();
    if (trimmed.length < 5) { setError('Add a sentence or two first.'); return; }
    setParsing(true); setError(null);
    try {
      const r = await fetch('/api/ai/smart-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmed,
          accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
          contacts: contacts.map((c) => ({ id: c.id, firstName: c.firstName, lastName: c.lastName, accountId: c.accountId })),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      setPreview(j.preview);
      setWarnings(j.warnings || []);
      setStep('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setParsing(false); }
  }

  function toggleEdit(field: string) {
    setEditing((p) => { const n = new Set(p); if (n.has(field)) n.delete(field); else n.add(field); return n; });
  }

  async function save() {
    if (!preview) return;
    if (!preview.account.id) { setError('Pick an account before saving.'); return; }
    setSaving(true); setError(null);
    try {
      const activityId = generateId();
      addActivity({
        id: activityId,
        type: preview.type,
        subject: preview.subject,
        // Activity's long-text field is called `description` in the
        // schema (lib/data.ts). The Smart Log preview surfaces the
        // same thing as "note" to the user because that reads better.
        description: preview.note,
        date: preview.date,
        purpose: preview.purpose || undefined,
        accountId: preview.account.id,
        contactId: preview.contact?.id || undefined,
        ownerId: userId,
        isImportant: false,
      });
      if (preview.task) {
        const task: Task = {
          id: generateId(),
          subject: preview.task.subject,
          description: '',
          status: 'Open',
          priority: preview.task.priority,
          dueDate: preview.task.dueDate || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
          ownerId: userId,
          relatedAccountId: preview.account.id,
          relatedContactId: preview.contact?.id ?? undefined,
          sourceActivityId: activityId,
        };
        addTask(task);
      }
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} size="lg" blockBackdropClose={parsing || saving}>
      <Modal.Header
        title={step === 'input' ? '✨ Smart Log' : 'Review log'}
        subtitle={step === 'input'
          ? "Dictate or type what just happened — we'll fill in the fields."
          : (myName ? `Logging as ${myName}` : 'Logging activity')}
        onClose={onClose}
      />
      <Modal.Body>
        {step === 'input' && (
          <div className="space-y-3">
            {/* Purpose banner — makes it unmistakable that this
                is for RECORDING what happened, not for asking
                questions. */}
            <div className="rounded-lg border border-brand/30 bg-brand-tint px-3 py-2 text-xs text-foreground">
              <strong>Use this to record what just happened.</strong><br />
              Need to <em>ask</em> something about the CRM instead? Use <strong>Ask CRM</strong> on the bottom-left (⌘⇧K).
            </div>
            <div className="relative">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
                rows={6}
                placeholder={`e.g. "Just had a call with Tanner at Kalmbach — talked about the Enncinate trial, he wants a sample bag by Friday. Follow up next week."`}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2.5 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-brand"
                disabled={parsing}
              />
              <div className="absolute right-2 bottom-2">
                <VoiceInputButton
                  onTranscript={(t) => setText((prev) => prev ? `${prev} ${t}` : t)}
                  title="Dictate (press & hold)"
                />
              </div>
            </div>
            {/* Question detection — soft redirect to Ask CRM. The
                parser will happily try to log a question as a Note,
                but that's rarely what the user actually wants. */}
            {questionLike && (
              <div className="rounded-lg border border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 px-3 py-2 text-xs text-indigo-900 dark:text-indigo-200">
                <div className="font-semibold mb-0.5">This looks like a question.</div>
                Smart Log <em>records</em> activities — it doesn't answer questions.
                Try <button
                  type="button"
                  onClick={() => {
                    onClose();
                    // Open Ask CRM via its global hotkey. AICopilotPanel
                    // listens for Cmd/Ctrl+Shift+K.
                    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', ctrlKey: true, shiftKey: true, metaKey: true }));
                  }}
                  className="underline font-medium hover:no-underline"
                >Ask CRM (⌘⇧K)</button> for things like
                "when will Simplot order?" or "which deal is at risk?".
              </div>
            )}
            <ul className="text-[11px] text-muted-fg space-y-0.5 pl-2">
              <li>↳ We'll detect the Account and Contact from the names you mention.</li>
              <li>↳ Phrases like "need to send samples next week" become a follow-up Task.</li>
              <li>↳ Nothing saves until you confirm the preview on the next step.</li>
            </ul>
            {error && (
              <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded px-3 py-2">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} disabled={parsing}
                className="px-4 py-2 text-sm border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button type="button" onClick={parse} disabled={parsing || text.trim().length < 5}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-brand text-white rounded-lg hover:opacity-90 disabled:opacity-50">
                {parsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {parsing ? 'Parsing…' : 'Parse ✨'}
              </button>
            </div>
          </div>
        )}

        {step === 'review' && preview && (
          <div className="space-y-3">
            {/* Warnings */}
            {warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <ul className="text-xs text-amber-800 dark:text-amber-200 space-y-0.5">
                    {warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              </div>
            )}

            {/* Account pick (always shown — most important) */}
            <PreviewField label="Account" required onEdit={() => toggleEdit('account')} editing={editing.has('account') || preview.needsAccountPick}>
              {(editing.has('account') || preview.needsAccountPick) ? (
                <select
                  value={preview.account.id ?? ''}
                  onChange={(e) => setPreview({ ...preview, account: { ...preview.account, id: e.target.value || null, name: accounts.find((a) => a.id === e.target.value)?.name ?? null, confidence: 'high' }, needsAccountPick: !e.target.value })}
                  className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded px-2 py-1 text-sm">
                  <option value="">— pick an account —</option>
                  {accountOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              ) : (
                <div className="text-sm text-foreground flex items-center gap-2">
                  <span>{preview.account.name}</span>
                  {preview.account.confidence && (
                    <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${
                      preview.account.confidence === 'high' ? 'bg-emerald-100 text-emerald-700' :
                      preview.account.confidence === 'medium' ? 'bg-amber-100 text-amber-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>{preview.account.confidence} confidence</span>
                  )}
                </div>
              )}
            </PreviewField>

            {/* Type + Date */}
            <div className="grid grid-cols-2 gap-3">
              <PreviewField label="Type" onEdit={() => toggleEdit('type')} editing={editing.has('type')}>
                {editing.has('type') ? (
                  <select value={preview.type} onChange={(e) => setPreview({ ...preview, type: e.target.value as ActivityType })}
                    className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded px-2 py-1 text-sm">
                    {(['Call', 'Meeting', 'Email', 'Note'] as ActivityType[]).map((t) => <option key={t}>{t}</option>)}
                  </select>
                ) : (
                  <div className="text-sm text-foreground">{preview.type}</div>
                )}
              </PreviewField>
              <PreviewField label="Date" onEdit={() => toggleEdit('date')} editing={editing.has('date')}>
                {editing.has('date') ? (
                  <input type="date" value={preview.date} onChange={(e) => setPreview({ ...preview, date: e.target.value })}
                    className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded px-2 py-1 text-sm" />
                ) : (
                  <div className="text-sm text-foreground">{preview.date}</div>
                )}
              </PreviewField>
            </div>

            {/* Contact (optional) */}
            {(preview.contact?.name || preview.account.id) && (
              <PreviewField label="Contact" onEdit={() => toggleEdit('contact')} editing={editing.has('contact')}>
                {editing.has('contact') ? (
                  <select
                    value={preview.contact?.id ?? ''}
                    onChange={(e) => setPreview({ ...preview, contact: e.target.value ? { id: e.target.value, name: contactOptionsForAccount.find((c) => c.id === e.target.value)?.name ?? null } : null })}
                    className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded px-2 py-1 text-sm">
                    <option value="">— none —</option>
                    {contactOptionsForAccount.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                ) : (
                  <div className="text-sm text-foreground">
                    {preview.contact?.id ? preview.contact.name : (
                      <span className="text-amber-600 italic">
                        {preview.contact?.name ? `"${preview.contact.name}" — not in CRM yet` : '—'}
                      </span>
                    )}
                  </div>
                )}
              </PreviewField>
            )}

            {/* Subject */}
            <PreviewField label="Subject" onEdit={() => toggleEdit('subject')} editing={editing.has('subject')}>
              {editing.has('subject') ? (
                <input value={preview.subject} onChange={(e) => setPreview({ ...preview, subject: e.target.value })}
                  className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded px-2 py-1 text-sm" />
              ) : (
                <div className="text-sm text-foreground">{preview.subject}</div>
              )}
            </PreviewField>

            {/* Note */}
            <PreviewField label="Note" onEdit={() => toggleEdit('note')} editing={editing.has('note')}>
              {editing.has('note') ? (
                <textarea value={preview.note} onChange={(e) => setPreview({ ...preview, note: e.target.value })} rows={3}
                  className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded px-2 py-1 text-sm resize-y" />
              ) : (
                <div className="text-sm text-foreground whitespace-pre-wrap">{preview.note}</div>
              )}
            </PreviewField>

            {/* Purpose */}
            <PreviewField label="Purpose" onEdit={() => toggleEdit('purpose')} editing={editing.has('purpose')}>
              {editing.has('purpose') ? (
                <select value={preview.purpose ?? ''} onChange={(e) => setPreview({ ...preview, purpose: e.target.value || null })}
                  className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded px-2 py-1 text-sm">
                  <option value="">— none —</option>
                  {ACTIVITY_PURPOSES.map((p) => <option key={p}>{p}</option>)}
                </select>
              ) : (
                <div className="text-sm text-foreground">{preview.purpose || <span className="text-muted-fg">—</span>}</div>
              )}
            </PreviewField>

            {/* Task card */}
            {preview.task && (
              <div className="rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-sky-800 dark:text-sky-200">
                  <Check className="w-3.5 h-3.5" /> Follow-up Task will be created
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_100px] gap-2">
                  <input
                    value={preview.task.subject}
                    onChange={(e) => setPreview({ ...preview, task: { ...preview.task!, subject: e.target.value } })}
                    className="w-full border border-sky-200 dark:border-sky-800 bg-white dark:bg-slate-900 rounded px-2 py-1 text-sm"
                  />
                  <input
                    type="date"
                    value={preview.task.dueDate ?? ''}
                    onChange={(e) => setPreview({ ...preview, task: { ...preview.task!, dueDate: e.target.value || null } })}
                    className="w-full border border-sky-200 dark:border-sky-800 bg-white dark:bg-slate-900 rounded px-2 py-1 text-sm"
                  />
                  <select
                    value={preview.task.priority}
                    onChange={(e) => setPreview({ ...preview, task: { ...preview.task!, priority: e.target.value as 'High' | 'Medium' | 'Low' } })}
                    className="w-full border border-sky-200 dark:border-sky-800 bg-white dark:bg-slate-900 rounded px-2 py-1 text-sm">
                    <option>High</option><option>Medium</option><option>Low</option>
                  </select>
                </div>
                <button onClick={() => setPreview({ ...preview, task: null })}
                  className="text-[11px] text-sky-700 dark:text-sky-300 hover:underline">
                  Skip creating a task
                </button>
              </div>
            )}

            {error && (
              <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded px-3 py-2">
                {error}
              </div>
            )}

            <div className="flex justify-between items-center pt-2">
              <button type="button" onClick={() => { setStep('input'); setPreview(null); }}
                className="text-sm text-muted-fg hover:text-foreground">
                ← Edit raw text
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={onClose} disabled={saving}
                  className="px-4 py-2 text-sm border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800">
                  Cancel
                </button>
                <SubmitButton type="button" onClick={save} pending={saving} pendingText="Saving…" disabled={!preview.account.id}>
                  Confirm & Save
                </SubmitButton>
              </div>
            </div>
          </div>
        )}
      </Modal.Body>
    </Modal>
  );
}

function PreviewField({ label, required, children, onEdit, editing }: {
  label: string; required?: boolean; children: React.ReactNode;
  onEdit: () => void; editing: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-2.5">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-fg">
          {label}{required && <span className="text-red-500 ml-1">*</span>}
        </div>
        <button type="button" onClick={onEdit}
          className="text-[10px] text-muted-fg hover:text-brand inline-flex items-center gap-0.5">
          <Pencil className="w-3 h-3" />
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      {children}
    </div>
  );
}
