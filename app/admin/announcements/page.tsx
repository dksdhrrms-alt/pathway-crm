'use client';

/**
 * Admin / CEO authoring screen for the Home announcement popup.
 *
 * Lives at its own route (/admin/announcements) rather than as another
 * tab inside the giant /admin page — keeps blast radius small and means
 * a future "Announcements" link can deep-link straight here.
 *
 * Features:
 *   - List existing announcements with active / inactive state, severity
 *     chip, expiry, and a row-level Edit / Delete / toggle.
 *   - "New announcement" form with title, body, severity, expires_at.
 *   - Role gate: anyone who isn't admin/ceo sees an Access denied stub.
 */
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import TopBar from '@/app/components/TopBar';

type Severity = 'info' | 'warning' | 'critical';

interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: Severity;
  active: boolean;
  expires_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const SEVERITY_LABELS: Record<Severity, { chip: string; label: string }> = {
  info:     { chip: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300', label: 'Info' },
  warning:  { chip: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300', label: 'Warning' },
  critical: { chip: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300', label: 'Critical' },
};

export default function AdminAnnouncementsPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role;
  const allowed = role === 'admin' || role === 'ceo';

  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<Severity>('info');
  const [expiresAt, setExpiresAt] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      // Hit the same GET used by the popup — but the GET filters to
      // "what this user should see right now". For the admin screen we
      // want EVERYTHING, including inactive/dismissed, so we read the
      // table directly via a dedicated header param? Simpler: just load
      // via the same endpoint, which is what reps see. For an admin
      // table view across all rows, use a small ad-hoc fetch with a
      // ?all=1 query param the server can honor; for now reuse the
      // popup feed so authoring still works. (Server-side improvement
      // for "show all rows incl inactive" is a TODO.)
      const r = await fetch('/api/announcements?all=1', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json() as { items?: Announcement[] };
        setItems(j.items || []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (allowed) load(); }, [allowed]);

  function openNew() {
    setEditing(null);
    setTitle(''); setBody(''); setSeverity('info'); setExpiresAt(''); setActive(true);
    setError(null);
    setShowForm(true);
  }

  function openEdit(a: Announcement) {
    setEditing(a);
    setTitle(a.title); setBody(a.body); setSeverity(a.severity);
    setExpiresAt(a.expires_at ? a.expires_at.slice(0, 16) : '');
    setActive(a.active);
    setError(null);
    setShowForm(true);
  }

  async function save() {
    if (!title.trim() || !body.trim()) {
      setError('Title and body are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: title.trim(),
        body: body.trim(),
        severity,
        active,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      };
      const url = editing ? `/api/announcements/${editing.id}` : '/api/announcements';
      const method = editing ? 'PATCH' : 'POST';
      const r = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error || `HTTP ${r.status}`);
      }
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this announcement? Dismissals will be removed too.')) return;
    const r = await fetch(`/api/announcements/${id}`, { method: 'DELETE' });
    if (r.ok) await load();
  }

  async function toggleActive(a: Announcement) {
    const r = await fetch(`/api/announcements/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active: !a.active }),
    });
    if (r.ok) await load();
  }

  if (!allowed) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
        <TopBar placeholder="Search CRM..." />
        <main className="pt-16 px-6 pb-10">
          <div className="max-w-3xl mx-auto mt-8 text-center text-gray-600 dark:text-gray-400">
            <h1 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">Access denied</h1>
            <p>Only Admin or CEO roles can manage announcements.</p>
            <Link href="/admin" className="inline-block mt-4 text-emerald-700 dark:text-emerald-400 hover:underline">← Back to Admin</Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <TopBar placeholder="Search CRM..." />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-end justify-between mt-6 mb-5">
            <div>
              <Link href="/admin" className="text-sm text-emerald-700 dark:text-emerald-400 hover:underline">← Admin</Link>
              <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mt-1">Announcements</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Posts a popup on Home for every user. They can snooze for 5 days.</p>
            </div>
            <button
              onClick={openNew}
              className="px-3 py-1.5 text-sm rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-medium"
            >
              + New announcement
            </button>
          </div>

          {showForm && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-5 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
                {editing ? 'Edit announcement' : 'New announcement'}
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Title *</label>
                  <input
                    type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. New CRM features released this week"
                    className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Message *</label>
                  <textarea
                    value={body} onChange={(e) => setBody(e.target.value)} rows={5}
                    placeholder="Body text. Line breaks preserved."
                    className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Severity</label>
                    <select
                      value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}
                      className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                      <option value="info">Info (blue)</option>
                      <option value="warning">Warning (amber)</option>
                      <option value="critical">Critical (red)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Expires (optional)</label>
                    <input
                      type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
                      className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="rounded" />
                  Active (visible to users)
                </label>
                {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setShowForm(false)} disabled={saving}
                    className="px-3 py-1.5 text-sm rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700"
                  >Cancel</button>
                  <button
                    onClick={save} disabled={saving}
                    className="px-3 py-1.5 text-sm rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-medium disabled:opacity-50"
                  >{saving ? 'Saving…' : editing ? 'Save changes' : 'Post announcement'}</button>
                </div>
              </div>
            </div>
          )}

          {/* List */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
            {loading ? (
              <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading…</div>
            ) : items.length === 0 ? (
              <div className="p-6 text-sm text-gray-500 dark:text-gray-400 italic">No announcements yet.</div>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-slate-800">
                {items.map((a) => {
                  const s = SEVERITY_LABELS[a.severity] || SEVERITY_LABELS.info;
                  return (
                    <li key={a.id} className="p-4 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs px-2 py-0.5 rounded uppercase tracking-wide font-semibold ${s.chip}`}>{s.label}</span>
                          {!a.active && <span className="text-xs px-2 py-0.5 rounded bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-gray-300">Inactive</span>}
                          {a.expires_at && <span className="text-xs text-gray-400 dark:text-gray-500">expires {new Date(a.expires_at).toLocaleString()}</span>}
                        </div>
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{a.title}</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap mt-1 line-clamp-3">{a.body}</p>
                      </div>
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        <button onClick={() => openEdit(a)} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800">Edit</button>
                        <button onClick={() => toggleActive(a)} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800">
                          {a.active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button onClick={() => remove(a.id)} className="text-xs px-2 py-1 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30">Delete</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
