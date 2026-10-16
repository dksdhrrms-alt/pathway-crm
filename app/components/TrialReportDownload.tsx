'use client';

/**
 * TrialReportDownload — the "📄 Download .docx" dropdown next to
 * the Print button on /trials → Weekly report tab.
 *
 * UX: a single compact button that opens a popover with three team
 * checkboxes (Monogastrics / Ruminants / LATAM) and a Download
 * button. Downloads call POST /api/ai/generate-trial-report with
 * { weekEnding, teams } and save the returned .docx via a hidden
 * anchor.
 *
 * This gives Edwin's "save a copy to desktop each week" flow a
 * single click once the checkboxes are set — browsers remember
 * the last-chosen state within the session via useState.
 */

import { useState } from 'react';
import { Download, FileDown } from 'lucide-react';
import { TRIAL_ACCESS_TEAMS, trialAccessTeamLabel, type TrialAccessTeam } from '@/lib/users';

export default function TrialReportDownload({ weekEnding }: { weekEnding: string }) {
  const [open, setOpen] = useState(false);
  const [teams, setTeams] = useState<TrialAccessTeam[]>([...TRIAL_ACCESS_TEAMS]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (teams.length === 0) { setError('Pick at least one team.'); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/ai/generate-trial-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekEnding, teams }),
      });
      if (!res.ok) throw new Error(await res.text() || 'Report generation failed.');
      const blob = await res.blob();
      // Pull filename from Content-Disposition if present.
      const cd = res.headers.get('Content-Disposition') || '';
      const match = /filename="([^"]+)"/.exec(cd);
      const name = match?.[1] || `Trial_Tracker_${weekEnding}.docx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-sm px-3 py-2 rounded-lg bg-brand text-white font-medium hover:opacity-90 inline-flex items-center gap-1.5"
        title="Download Trial Tracker .docx"
      >
        <FileDown className="w-4 h-4" />
        Download .docx
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-72 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg p-3">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              Pick which teams to include. The file follows the format at the
              bottom of Jason&apos;s weekly report.
            </div>
            <div className="space-y-1.5 mb-3">
              {TRIAL_ACCESS_TEAMS.map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={teams.includes(t)}
                    onChange={() => setTeams((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t])}
                    className="accent-brand"
                  />
                  {trialAccessTeamLabel(t)}
                </label>
              ))}
            </div>
            {error && <div className="text-xs text-red-600 mb-2">{error}</div>}
            <button
              onClick={download}
              disabled={busy || teams.length === 0}
              className="w-full text-sm px-3 py-2 rounded-lg bg-brand text-white font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
            >
              <Download className="w-4 h-4" />
              {busy ? 'Generating…' : 'Download'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
