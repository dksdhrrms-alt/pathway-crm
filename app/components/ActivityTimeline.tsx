'use client';

import { useState, useEffect } from 'react';
import { Activity, ActivityType } from '@/lib/data';
import { useUsers } from '@/lib/UserContext';
import CommentThread from './CommentThread';
import { getCommentCounts } from '@/lib/comments';
import ActivityDescription from './ActivityDescription';

interface ActivityTimelineProps {
  activities: Activity[];
  contactNameMap?: Record<string, string>;
  accountNameMap?: Record<string, string>;
  onDelete?: (id: string) => void;
}

const typeIcon: Record<ActivityType, string> = {
  Call: '📞',
  Meeting: '🤝',
  Email: '📧',
  Note: '📝',
};

const typeColor: Record<ActivityType, string> = {
  Call: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  Meeting: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  Email: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  Note: 'bg-gray-100 text-gray-700 dark:bg-gray-900/40 dark:text-gray-300',
};

const typeLabel: Record<ActivityType, string> = {
  Call: 'Call / Text Message',
  Meeting: 'Meeting',
  Email: 'Email',
  Note: 'Note',
};

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ActivityTimeline({
  activities,
  contactNameMap = {},
  accountNameMap = {},
  onDelete,
}: ActivityTimelineProps) {
  const { users } = useUsers();
  const [showComments, setShowComments] = useState<string | null>(null);
  // Comment count per activity id, refetched when the inline thread
  // toggles so add/delete inside CommentThread reflect immediately.
  const [commentCountById, setCommentCountById] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    const ids = activities.map((a) => a.id);
    if (ids.length === 0) { setCommentCountById({}); return; }
    getCommentCounts('activity', ids).then((counts) => {
      if (!cancelled) setCommentCountById(counts);
    });
    return () => { cancelled = true; };
  }, [activities, showComments]);

  function getOwnerName(ownerId: string): string {
    const ctxUser = users.find((u) => u.id === ownerId);
    return ctxUser?.name ?? ownerId;
  }

  if (activities.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm dark:text-gray-500">No activities recorded yet.</div>
    );
  }

  return (
    <div className="flow-root">
      <ul className="-mb-8">
        {activities.map((activity, idx) => (
          <li key={activity.id}>
            <div className="relative pb-8">
              {idx < activities.length - 1 && (
                <span
                  className="absolute left-5 top-5 -ml-px h-full w-0.5 bg-gray-200 dark:bg-slate-700"
                  aria-hidden="true"
                />
              )}
              <div className="relative flex items-start space-x-3 group">
                <div className="relative">
                  <div
                    className={`h-10 w-10 rounded-full flex items-center justify-center ring-8 ring-white dark:ring-slate-900 ${typeColor[activity.type]}`}
                  >
                    <span className="text-lg">{typeIcon[activity.type]}</span>
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{activity.subject}</span>
                      <span
                        className={`ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${typeColor[activity.type]}`}
                      >
                        {typeLabel[activity.type]}
                      </span>
                      {activity.purpose && (
                        <span className="ml-1.5 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700 border border-purple-100 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-800">
                          {activity.purpose}
                        </span>
                      )}
                      {activity.internalParticipants && activity.internalParticipants.length > 0 && (
                        <span className="ml-1.5 inline-flex items-center gap-1 align-middle" title={`Internal participants: ${activity.internalParticipants.map((id) => users.find((u) => u.id === id)?.name || id).join(', ')}`}>
                          {activity.internalParticipants.slice(0, 3).map((id, i) => {
                            const u = users.find((x) => x.id === id);
                            const initials = u ? u.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) : '?';
                            return (
                              <span key={id} className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[8px] font-semibold text-white border-2 border-white" style={{ backgroundColor: '#1e40af', marginLeft: i > 0 ? '-8px' : 0, zIndex: 3 - i }}>
                                {initials}
                              </span>
                            );
                          })}
                          {activity.internalParticipants.length > 3 && (
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-semibold text-blue-700 bg-blue-100 border-2 border-white dark:text-blue-300 dark:bg-blue-900/40 dark:border-slate-900" style={{ marginLeft: '-8px' }}>
                              +{activity.internalParticipants.length - 3}
                            </span>
                          )}
                          <span className="ml-1 text-[10px] text-blue-700 font-medium dark:text-blue-400">joint</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <time className="text-xs text-gray-500 whitespace-nowrap dark:text-gray-400">
                        {formatDate(activity.date)}
                      </time>
                      {onDelete && (
                        <button
                          onClick={() => onDelete(activity.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 dark:text-gray-600 dark:hover:text-red-400 dark:hover:bg-red-900/30"
                          aria-label="Delete activity"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                  {(activity.contactId && contactNameMap[activity.contactId]) ||
                  (activity.accountId && accountNameMap[activity.accountId]) ? (
                    <p className="text-xs text-gray-500 mt-0.5 dark:text-gray-400">
                      {activity.contactId && contactNameMap[activity.contactId] && (
                        <span>{contactNameMap[activity.contactId]}</span>
                      )}
                      {activity.accountId && accountNameMap[activity.accountId] && (
                        <span className="text-gray-400 dark:text-gray-500">
                          {activity.contactId && contactNameMap[activity.contactId] ? ' · ' : ''}
                          {accountNameMap[activity.accountId]}
                        </span>
                      )}
                    </p>
                  ) : null}
                  <ActivityDescription description={activity.description} />
                  <div className="mt-1 flex items-center gap-3 flex-wrap">
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      Logged by <span className="font-medium text-gray-600 dark:text-gray-300">{getOwnerName(activity.ownerId)}</span>
                      {activity.internalParticipants && activity.internalParticipants.length > 0 && (
                        <>
                          <span className="mx-1">with</span>
                          <span className="font-medium text-blue-700 dark:text-blue-400">{activity.internalParticipants.map((id) => getOwnerName(id)).join(', ')}</span>
                        </>
                      )}
                    </p>
                    {/* Reply button is hidden when comments already exist — the
                        thread auto-expands below and its own input handles new replies. */}
                    {(commentCountById[activity.id] ?? 0) === 0 && (
                      <button onClick={() => setShowComments(showComments === activity.id ? null : activity.id)}
                        className="text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                        {showComments === activity.id ? 'Hide replies' : 'Reply'}
                      </button>
                    )}
                  </div>
                  {((commentCountById[activity.id] ?? 0) > 0 || showComments === activity.id) && (
                    <div className="mt-2 ml-1 pl-3 dark:border-slate-700" style={{ borderLeft: '2px solid #e5e7eb' }}>
                      <CommentThread parentType="activity" parentId={activity.id} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Render an activity's description text + parse out the "📎 Attachments:"
 * block that the inbound-email route appends. Each attachment shows as
 * a small clickable chip with filename + size; clicking opens the
 * signed Supabase Storage URL in a new tab.
 *
 * The description format (set in /api/inbound-email/route.ts) looks like:
 *
 *   <body text>
 *
 *   📎 Attachments:
 *   • Report.pdf (245 KB) — https://....supabase.co/.../Report.pdf
 *   • Quote.xlsx (32 KB) — https://....supabase.co/.../Quote.xlsx
 */
function ActivityBody({ description }: { description?: string | null }) {
  const text = String(description || '');
  if (!text) return null;

  // Detect the start of the attachment block.  We match every reasonable
  // variant the description might use:
  //   "📎 Attachments:"  (current writer)
  //   "Attachments:"     (no emoji — emoji can disappear on certain
  //                       editors / clipboards / DB tooling)
  //   "📎Attachments:"   (missing space)
  // The match is case-insensitive too because admins sometimes hand-edit.
  const markerMatch = text.match(/(?:📎\s*)?attachments\s*:/i);
  const idx = markerMatch ? markerMatch.index ?? -1 : -1;
  const bodyPart = idx >= 0 ? text.slice(0, idx).trim() : text;
  const attPart  = idx >= 0 ? text.slice(idx + (markerMatch?.[0]?.length ?? 0)) : '';

  const attachments: { name: string; size: string; url: string }[] = [];
  if (attPart) {
    // Normalize: collapse any line-wrapping inside URLs the textarea
    // / Word / Slack may have injected.  We rebuild the block from the
    // raw character stream and split on bullets.
    const compact = attPart.replace(/\s*\n\s*/g, ' ').trim();
    // Each item starts with a bullet (• - *) and runs until the next
    // bullet or end of string.
    const items = compact.split(/\s+(?=[•\-*]\s)/).map((s) => s.trim()).filter(Boolean);
    for (const raw of items) {
      const m = raw.match(/^[•\-*]\s*(.+?)\s*\(([^)]+)\)\s*[—–\-]\s*(https?:\/\/\S+)/);
      if (m) {
        // URL may have trailing punctuation from the rebuilt string.
        const cleanUrl = m[3].replace(/[)\]>.,;]+$/, '');
        attachments.push({ name: m[1], size: m[2], url: cleanUrl });
      }
    }
  }

  return (
    <>
      {bodyPart && (
        <p className="mt-1 text-sm text-gray-600 leading-relaxed dark:text-gray-300 whitespace-pre-wrap">
          {bodyPart}
        </p>
      )}
      {attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {attachments.map((a, i) => (
            <a
              key={`${a.name}-${i}`}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${a.name}`}
              className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 transition-colors"
            >
              <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 10-5.656-5.656L4.93 12.343a6 6 0 108.486 8.486L20.5 13.5" />
              </svg>
              <span className="font-medium truncate max-w-[14rem]">{a.name}</span>
              <span className="text-gray-400 dark:text-gray-500">{a.size}</span>
            </a>
          ))}
        </div>
      )}
    </>
  );
}
