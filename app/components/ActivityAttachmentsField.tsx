'use client';

/**
 * Pluggable "Attachments" field used by every Activity-logging path
 * (LogActivityModal, EditActivityModal, Quick-log variants). Handles:
 *
 *   • pre-save mode   — holds File objects locally, defers upload
 *     until the parent assigns the activity id. New-activity modals
 *     use this; they call `uploadPending(activityId)` after insert.
 *   • post-save mode  — immediately uploads each selected file and
 *     adds the resulting row to Supabase. Edit modals use this.
 *
 * Pattern mirrors ThumbnailUploader in app/admin/page.tsx but handles
 * multiple files, deletions, and the two-mode (deferred vs immediate)
 * lifecycle.
 */

import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import {
  listActivityAttachments, uploadActivityAttachment, deleteActivityAttachment,
  fmtBytes, type ActivityAttachment,
} from '@/lib/activityAttachments';

// 20 MB per file — generous for PDFs / photos but keeps bucket cost
// sane. Users get a plain-English error if they go over.
const MAX_SIZE = 20 * 1024 * 1024;

export interface ActivityAttachmentsFieldHandle {
  /** Upload any locally-held Files to the given activity id. Called
   *  by `new-activity` modals once the Activity row has been inserted. */
  uploadPending: (activityId: string, uploadedBy?: string) => Promise<void>;
  /** True when there's something queued or being uploaded. */
  hasPending: () => boolean;
}

interface Props {
  // When set, we're editing an existing activity — upload goes
  // straight to that id. When undefined, pending files are buffered
  // locally until the parent calls uploadPending().
  activityId?: string;
  uploadedBy?: string;
  onError?: (msg: string) => void;
}

const ActivityAttachmentsField = forwardRef<ActivityAttachmentsFieldHandle, Props>(
  function ActivityAttachmentsField({ activityId, uploadedBy, onError }, ref) {
    const [existing, setExisting] = useState<ActivityAttachment[]>([]);
    const [pending, setPending] = useState<File[]>([]);
    const [uploading, setUploading] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);

    // Load the existing attachments only when editing (activityId
    // present). New-activity modals start empty.
    useEffect(() => {
      if (!activityId) return;
      let cancelled = false;
      listActivityAttachments(activityId)
        .then((rows) => { if (!cancelled) setExisting(rows); })
        .catch((e) => onError?.(e instanceof Error ? e.message : String(e)));
      return () => { cancelled = true; };
    }, [activityId, onError]);

    useImperativeHandle(ref, () => ({
      async uploadPending(id: string, who?: string) {
        if (pending.length === 0) return;
        setUploading(true);
        try {
          for (const f of pending) {
            await uploadActivityAttachment(f, id, { uploadedBy: who || uploadedBy });
          }
          setPending([]);
        } finally {
          setUploading(false);
        }
      },
      hasPending() { return pending.length > 0 || uploading; },
    }), [pending, uploading, uploadedBy]);

    async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
      const files = Array.from(e.target.files || []);
      if (inputRef.current) inputRef.current.value = '';
      if (files.length === 0) return;
      const tooBig = files.find((f) => f.size > MAX_SIZE);
      if (tooBig) {
        onError?.(`"${tooBig.name}" is larger than 20 MB.`);
        return;
      }

      if (activityId) {
        // Immediate upload — edit mode.
        setUploading(true);
        try {
          for (const f of files) {
            const row = await uploadActivityAttachment(f, activityId, { uploadedBy });
            setExisting((prev) => [...prev, row]);
          }
        } catch (err) {
          onError?.(err instanceof Error ? err.message : String(err));
        } finally {
          setUploading(false);
        }
      } else {
        // Deferred — hold the File objects until the parent inserts
        // the activity row.
        setPending((prev) => [...prev, ...files]);
      }
    }

    async function removeExisting(a: ActivityAttachment) {
      if (!confirm(`Delete "${a.filename}"?`)) return;
      try {
        await deleteActivityAttachment(a);
        setExisting((prev) => prev.filter((x) => x.id !== a.id));
      } catch (err) {
        onError?.(err instanceof Error ? err.message : String(err));
      }
    }

    function removePending(idx: number) {
      setPending((prev) => prev.filter((_, i) => i !== idx));
    }

    const totalCount = existing.length + pending.length;

    return (
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
            Attachments {totalCount > 0 && <span className="text-xs text-gray-400 dark:text-gray-500">({totalCount})</span>}
          </label>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="text-xs px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 disabled:opacity-50"
            title="Attach files (PDF, image, Word, Excel, up to 20 MB each)"
          >
            {uploading ? 'Uploading…' : '+ Attach file'}
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            onChange={handlePick}
            className="hidden"
          />
        </div>

        {totalCount === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 italic mt-1">No attachments yet. Click &quot;+ Attach file&quot; to add one.</p>
        ) : (
          <ul className="space-y-1 mt-1">
            {existing.map((a) => (
              <li key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded border border-gray-200 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-800/40">
                <span className="text-base" aria-hidden>📎</span>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 min-w-0 text-sm text-blue-700 dark:text-blue-400 hover:underline truncate"
                  title={`Open ${a.filename}`}
                >
                  {a.filename}
                </a>
                <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">{fmtBytes(a.sizeBytes)}</span>
                <button
                  type="button"
                  onClick={() => removeExisting(a)}
                  className="text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded px-1.5 py-0.5"
                  title="Delete"
                >×</button>
              </li>
            ))}
            {pending.map((f, i) => (
              <li key={`pending-${i}`} className="flex items-center gap-2 px-2 py-1.5 rounded border border-amber-200 dark:border-amber-700/40 bg-amber-50/60 dark:bg-amber-900/20">
                <span className="text-base" aria-hidden>📎</span>
                <span className="flex-1 min-w-0 text-sm text-gray-800 dark:text-gray-200 truncate" title={f.name}>{f.name}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">{fmtBytes(f.size)}</span>
                <span className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400 font-semibold">queued</span>
                <button
                  type="button"
                  onClick={() => removePending(i)}
                  className="text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded px-1.5 py-0.5"
                  title="Remove"
                >×</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
);

export default ActivityAttachmentsField;
