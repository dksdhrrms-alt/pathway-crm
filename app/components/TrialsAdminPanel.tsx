'use client';

/**
 * TrialsAdminPanel — the Admin → Trials tab.
 *
 * Two sections stacked:
 *
 *   1. Trial Materials Access
 *      -- One row per user. Three checkboxes per row (Monogastrics /
 *         Ruminants / LATAM) → writes users.trial_access_teams.
 *         Admin / CEO / COO / administrative_manager rows are shown
 *         with the checkboxes locked ON and a "role-based" badge,
 *         to make it obvious why they always have access.
 *         Directors show their team's bucket as locked-on too.
 *
 *   2. Weekly Trial Report Recipients
 *      -- The list the Thursday 12 PM cron sends the .docx to.
 *         Add a row with { email, label, teams[] }. The teams
 *         checkboxes let us send a Monogastric-only report to one
 *         person and a full report to another.
 *
 * Both sections write through the lib/trialFiles.ts +
 * /api/users/trial-access routes (we don't let the browser's anon
 * key update users.trial_access_teams directly — the users table
 * is the only one on the DB that we gate server-side).
 */

import { useCallback, useEffect, useState } from 'react';
import { useUsers } from '@/lib/UserContext';
import {
  listReportRecipients, upsertReportRecipient, deleteReportRecipient,
  type TrialReportRecipient,
} from '@/lib/trialFiles';
import {
  TRIAL_ACCESS_TEAMS, trialAccessTeamLabel,
  type TrialAccessTeam, type AppUser,
} from '@/lib/users';
import { Trash2, Mail, Users as UsersIcon, Save, Plus } from 'lucide-react';

const ADMIN_TIER = new Set(['admin', 'ceo', 'coo', 'administrative_manager']);

/** For a Director, which bucket their users.team maps to. */
function directorBucket(u: AppUser): TrialAccessTeam | null {
  if (u.role !== 'sales_director') return null;
  if (u.team === 'monogastrics' || u.team === 'swine') return 'monogastrics';
  if (u.team === 'ruminants') return 'ruminants';
  if (u.team === 'latam') return 'latam';
  return null;
}

export default function TrialsAdminPanel() {
  const { users } = useUsers();
  const [grants, setGrants] = useState<Record<string, TrialAccessTeam[]>>({});
  const [savingUser, setSavingUser] = useState<string | null>(null);
  const [savedUser, setSavedUser] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [recipients, setRecipients] = useState<TrialReportRecipient[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newTeams, setNewTeams] = useState<TrialAccessTeam[]>([...TRIAL_ACCESS_TEAMS]);
  const [recipLoading, setRecipLoading] = useState(true);

  // Seed grants state from the UserContext
  useEffect(() => {
    const seed: Record<string, TrialAccessTeam[]> = {};
    for (const u of users) seed[u.id] = (u.trialAccessTeams ?? []) as TrialAccessTeam[];
    setGrants(seed);
  }, [users]);

  const refreshRecipients = useCallback(async () => {
    setRecipLoading(true);
    try {
      setRecipients(await listReportRecipients());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRecipLoading(false);
    }
  }, []);

  useEffect(() => { refreshRecipients(); }, [refreshRecipients]);

  async function saveGrantsFor(userId: string) {
    setSavingUser(userId);
    setError(null);
    try {
      const res = await fetch(`/api/users/${userId}/trial-access`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teams: grants[userId] ?? [] }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSavedUser(userId);
      setTimeout(() => setSavedUser((s) => (s === userId ? null : s)), 1500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingUser(null);
    }
  }

  function toggleGrant(userId: string, team: TrialAccessTeam) {
    setGrants((prev) => {
      const current = new Set(prev[userId] ?? []);
      if (current.has(team)) current.delete(team); else current.add(team);
      return { ...prev, [userId]: Array.from(current) };
    });
  }

  async function addRecipient(e: React.FormEvent) {
    e.preventDefault();
    const email = newEmail.trim();
    if (!email) return;
    try {
      await upsertReportRecipient({ email, label: newLabel.trim() || null, teams: newTeams });
      setNewEmail(''); setNewLabel(''); setNewTeams([...TRIAL_ACCESS_TEAMS]);
      await refreshRecipients();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removeRecipient(email: string) {
    if (!confirm(`Remove ${email} from the Trial Report distribution?`)) return;
    try {
      await deleteReportRecipient(email);
      await refreshRecipients();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggleRecipientTeam(r: TrialReportRecipient, team: TrialAccessTeam) {
    const next = new Set(r.teams);
    if (next.has(team)) next.delete(team); else next.add(team);
    try {
      await upsertReportRecipient({ email: r.email, label: r.label, teams: Array.from(next) as TrialAccessTeam[] });
      await refreshRecipients();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {/* ── Section 1: Access matrix ──────────────────────────── */}
      <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-4">
        <header className="flex items-center gap-2 mb-1">
          <UsersIcon className="w-4 h-4 text-brand" />
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Trial Materials Access</h2>
        </header>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Grant users access to trial files by team. Admin / CEO / COO / Admin Manager and Directors
          of the matching team always have access (locked rows below).
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 dark:text-gray-400">
              <tr className="border-b border-gray-200 dark:border-slate-700">
                <th className="text-left py-2 pr-3">User</th>
                <th className="text-left py-2 pr-3">Role</th>
                {TRIAL_ACCESS_TEAMS.map((t) => (
                  <th key={t} className="text-center py-2 px-2">{trialAccessTeamLabel(t)}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {users
                .filter((u) => u.status !== 'inactive')
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((u) => {
                  const isAdminTier = ADMIN_TIER.has(u.role);
                  const dirBucket = directorBucket(u);
                  const current = grants[u.id] ?? [];
                  const isSaving = savingUser === u.id;
                  const isSaved = savedUser === u.id;
                  return (
                    <tr key={u.id} className="border-b border-gray-100 dark:border-slate-800">
                      <td className="py-2 pr-3 font-medium text-gray-900 dark:text-gray-100">{u.name}</td>
                      <td className="py-2 pr-3 text-xs text-gray-500">{u.role}{u.team ? ` · ${u.team}` : ''}</td>
                      {TRIAL_ACCESS_TEAMS.map((t) => {
                        const locked = isAdminTier || dirBucket === t;
                        const checked = locked || current.includes(t);
                        return (
                          <td key={t} className="py-2 px-2 text-center">
                            <input
                              type="checkbox"
                              disabled={locked}
                              checked={checked}
                              onChange={() => toggleGrant(u.id, t)}
                              title={locked ? 'Role-based access (always on)' : undefined}
                              className="accent-brand"
                            />
                          </td>
                        );
                      })}
                      <td className="py-2 pl-2 text-right">
                        {isAdminTier ? (
                          <span className="text-[10px] text-gray-400 italic">role-based</span>
                        ) : (
                          <button
                            onClick={() => saveGrantsFor(u.id)}
                            disabled={isSaving}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                              ${isSaved
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-brand text-white hover:opacity-90'
                              } ${isSaving ? 'opacity-50' : ''}`}
                          >
                            <Save className="w-3 h-3" />
                            {isSaved ? 'Saved' : isSaving ? 'Saving…' : 'Save'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Section 2: Weekly report recipients ───────────────── */}
      <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-4">
        <header className="flex items-center gap-2 mb-1">
          <Mail className="w-4 h-4 text-brand" />
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Weekly Trial Report Recipients</h2>
        </header>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Every <strong>Thursday at 12:00 PM</strong> a .docx with the current week's trial updates
          is auto-sent to the addresses below. Each recipient can be scoped to only the team sections
          they care about.
        </p>

        {/* Add row */}
        <form onSubmit={addRecipient} className="flex flex-wrap items-center gap-2 mb-3 p-3 rounded-lg border border-dashed border-gray-300 dark:border-slate-600">
          <input
            type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
            placeholder="email@example.com"
            className="flex-1 min-w-[200px] border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm"
          />
          <input
            value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label (optional, e.g. Edwin Lee)"
            className="flex-1 min-w-[160px] border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-2">
            {TRIAL_ACCESS_TEAMS.map((t) => (
              <label key={t} className="text-xs flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={newTeams.includes(t)}
                  onChange={() => setNewTeams((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t])}
                  className="accent-brand"
                />
                {trialAccessTeamLabel(t)}
              </label>
            ))}
          </div>
          <button type="submit" className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:opacity-90">
            <Plus className="w-4 h-4" /> Add
          </button>
        </form>

        <div className="space-y-1.5">
          {recipLoading && <div className="text-xs text-gray-400">Loading…</div>}
          {!recipLoading && recipients.length === 0 && (
            <div className="text-xs text-gray-400">No recipients yet — the weekly cron will skip.</div>
          )}
          {recipients.map((r) => (
            <div key={r.email} className="flex flex-wrap items-center gap-2 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2">
              <div className="flex-1 min-w-[220px]">
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100">{r.label || r.email}</div>
                {r.label && <div className="text-[11px] text-gray-500">{r.email}</div>}
              </div>
              <div className="flex items-center gap-2">
                {TRIAL_ACCESS_TEAMS.map((t) => (
                  <label key={t} className="text-xs flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={r.teams.includes(t)}
                      onChange={() => toggleRecipientTeam(r, t)}
                      className="accent-brand"
                    />
                    {trialAccessTeamLabel(t)}
                  </label>
                ))}
              </div>
              <button
                onClick={() => removeRecipient(r.email)}
                className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-red-600"
                title="Remove"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
