'use client';

import { useState } from 'react';
import { Activity, ActivityType } from '@/lib/data';
import { useUsers } from '@/lib/UserContext';
import CommentThread from './CommentThread';

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
  Call: 'bg-blue-100 text-blue-700',
  Meeting: 'bg-green-100 text-green-700',
  Email: 'bg-amber-100 text-amber-700',
  Note: 'bg-gray-100 text-gray-700',
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

  function getOwnerName(ownerId: string): string {
    const ctxUser = users.find((u) => u.id === ownerId);
    return ctxUser?.name ?? ownerId;
  }

  if (activities.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">No activities recorded yet.</div>
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
                  className="absolute left-5 top-5 -ml-px h-full w-0.5 bg-gray-200"
                  aria-hidden="true"
                />
              )}
              <div className="relative flex items-start space-x-3 group">
                <div className="relative">
                  <div
                    className={`h-10 w-10 rounded-full flex items-center justify-center ring-8 ring-white ${typeColor[activity.type]}`}
                  >
                    <span className="text-lg">{typeIcon[activity.type]}</span>
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-medium text-gray-900">{activity.subject}</span>
                      <span
                        className={`ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${typeColor[activity.type]}`}
                      >
                        {typeLabel[activity.type]}
                      </span>
                      {activity.purpose && (
                        <span className="ml-1.5 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700 border border-purple-100">
                          {activity.purpose}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <time className="text-xs text-gray-500 whitespace-nowrap">
                        {formatDate(activity.date)}
                      </time>
                      {onDelete && (
                        <button
                          onClick={() => onDelete(activity.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50"
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
                    <p className="text-xs text-gray-500 mt-0.5">
                      {activity.contactId && contactNameMap[activity.contactId] && (
                        <span>{contactNameMap[activity.contactId]}</span>
                      )}
                      {activity.accountId && accountNameMap[activity.accountId] && (
                        <span className="text-gray-400">
                          {activity.contactId && contactNameMap[activity.contactId] ? ' · ' : ''}
                          {accountNameMap[activity.accountId]}
                        </span>
                      )}
                    </p>
                  ) : null}
                  <p className="mt-1 text-sm text-gray-600 leading-relaxed">
                    {activity.description}
                  </p>
                  <div className="mt-1 flex items-center gap-3">
                    <p className="text-xs text-gray-400">Logged by {getOwnerName(activity.ownerId)}</p>
                    <button onClick={() => setShowComments(showComments === activity.id ? null : activity.id)}
                      className="text-xs text-gray-400 hover:text-gray-600" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      {showComments === activity.id ? 'Hide replies' : 'Reply'}
                    </button>
                  </div>
                  {showComments === activity.id && (
                    <div className="mt-2 ml-1 pl-3" style={{ borderLeft: '2px solid #e5e7eb' }}>
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
