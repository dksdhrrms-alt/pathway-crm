'use client';

/**
 * TrialMaterialsSection — the "📎 Materials" block that lives at
 * the bottom of the Trial edit modal. Shows up only when the
 * current user can see this trial's files (see
 * canAccessTrialFiles in lib/trialFiles.ts).
 *
 * The whole thing talks to Supabase directly through
 * lib/trialFiles.ts — same anon-key pattern as the rest of the
 * app. Access control is enforced two ways:
 *   1. this component refuses to render if the user doesn't pass
 *      canAccessTrialFiles(user, trial);
 *   2. the Admin page controls who gets the per-user bucket
 *      grants (users.trial_access_teams) in the first place.
 *
 * Upload UX notes:
 *   - Drag-and-drop OR click to open file picker.
 *   - Each file keeps its "label" (defaults to the filename stem).
 *     Re-uploading with the same label → new VERSION on the chain.
 *   - The row shows the head of the chain by default with a
 *     v2 / v3 badge; a chevron toggles previous versions.
 *   - 50 MB per file (TRIAL_FILE_MAX_BYTES).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useUsers } from '@/lib/UserContext';
import {
  canAccessTrialFiles, listFilesForTrial, listVersionChain,
  uploadTrialFile, deleteTrialFile, formatFileSize,
  TRIAL_FILE_MAX_BYTES, type TrialFile,
} from '@/lib/trialFiles';
import type { Trial } from '@/lib/trials';
import { Upload, FileText, Download, Trash2, ChevronDown, ChevronRight, History } from 'lucide-react';

export default function TrialMaterialsSection({ trial }: { trial: Trial }) {
  const { data: session } = useSession();
  const { users } = useUsers();
  const me = users.find((u) => u.id === session?.user?.id);

  const [files, setFiles] = useState<TrialFile[]>([]);
  const [chains, setChains] = useState<Record<string, TrialFile[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const canAccess = me ? canAccessTrialFiles(me, trial) : false;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const heads = await listFilesForTrial(trial.id);
      setFiles(heads);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [trial.id]);

  useEffect(() => { if (canAccess) refresh(); }, [canAccess, refresh]);

  async function toggleHistory(f: TrialFile) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(f.id)) next.delete(f.id); else next.add(f.id);
      return next;
    });
    if (f.parentFileId && !chains[f.id]) {
      const chain = await listVersionChain(f.id);
      setChains((c) => ({ ...c, [f.id]: chain }));
    }
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(fileList)) {
        if (file.size > TRIAL_FILE_MAX_BYTES) {
          setError(`"${file.name}" exceeds 50 MB.`);
          continue;
        }
        // Label = filename without extension — users can rename later
        // (future enhancement). Same label on this trial → new version.
        const label = file.name.replace(/\.[^.]+$/, '');
        await uploadTrialFile({
          trialId: trial.id,
          label,
          file,
          filename: file.name,
          mimeType: file.type || undefined,
          uploadedBy: me?.id ?? null,
        });
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleDelete(f: TrialFile) {
    if (!confirm(`Delete "${f.label}"${f.version > 1 ? ` v${f.version}` : ''} and all older versions? This cannot be undone.`)) return;
    try {
      await deleteTrialFile(f.id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!canAccess) {
    // Section is hidden entirely for users without the bucket grant.
    // Rendering nothing (as opposed to an "access denied" banner)
    // keeps the Trial edit modal clean for sales reps whose role
    // doesn't need these files.
    return null;
  }

  return (
    <div className="mt-4 border-t border-gray-200 dark:border-slate-700 pt-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
          <FileText className="w-4 h-4" /> Materials
          <span className="text-xs font-normal text-gray-500">({files.length})</span>
        </h3>
      </div>

      {/* Dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-4 text-center text-xs
          ${dragOver ? 'border-brand bg-brand-tint' : 'border-gray-300 dark:border-slate-600 hover:border-brand hover:bg-brand-tint/40'}
          ${uploading ? 'opacity-60 pointer-events-none' : ''}`}
      >
        <input
          ref={inputRef} type="file" multiple className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <Upload className="w-4 h-4 mx-auto mb-1 text-gray-500" />
        {uploading
          ? 'Uploading…'
          : <>Drop files here or <span className="text-brand font-medium">browse</span> &middot; up to 50 MB per file</>}
      </div>

      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}

      {/* File list */}
      <div className="mt-3 space-y-1.5">
        {loading && <div className="text-xs text-gray-400">Loading…</div>}
        {!loading && files.length === 0 && (
          <div className="text-xs text-gray-400">No files uploaded yet.</div>
        )}
        {files.map((f) => {
          const hasHistory = f.version > 1;
          const isOpen = expanded.has(f.id);
          const uploader = users.find((u) => u.id === f.uploadedBy)?.name ?? f.uploadedBy ?? '—';
          return (
            <div key={f.id} className="rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate font-medium text-gray-900 dark:text-gray-100">{f.label}</span>
                    {hasHistory && (
                      <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300 text-[10px] font-medium">
                        v{f.version}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">
                    {uploader} &middot; {new Date(f.uploadedAt).toLocaleDateString()}
                    {f.fileSize ? <> &middot; {formatFileSize(f.fileSize)}</> : null}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {hasHistory && (
                    <button
                      onClick={() => toggleHistory(f)}
                      className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500"
                      title="Previous versions"
                    >
                      {isOpen ? <ChevronDown className="w-4 h-4" /> : <History className="w-4 h-4" />}
                    </button>
                  )}
                  <a
                    href={f.url} target="_blank" rel="noreferrer" download
                    className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-600 dark:text-gray-300"
                    title="Download"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                  <button
                    onClick={() => handleDelete(f)}
                    className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-red-600"
                    title="Delete (incl. all versions)"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Version chain */}
              {hasHistory && isOpen && chains[f.id] && (
                <div className="mt-2 ml-6 border-l border-gray-200 dark:border-slate-700 pl-3 space-y-1">
                  {chains[f.id].filter((c) => c.id !== f.id).map((c) => (
                    <div key={c.id} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                      <ChevronRight className="w-3 h-3" />
                      <span>v{c.version}</span>
                      <span>&middot; {new Date(c.uploadedAt).toLocaleDateString()}</span>
                      <a href={c.url} target="_blank" rel="noreferrer" download className="text-brand hover:underline">Download</a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
