'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Activity } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import StageBadge from '@/app/components/StageBadge';
import ActivityTimeline from '@/app/components/ActivityTimeline';
import CommentThread from '@/app/components/CommentThread';
import LogActivityModal from '@/app/components/LogActivityModal';
import NewTaskModal from '@/app/components/NewTaskModal';
import TopBar from '@/app/components/TopBar';
import Toast from '@/app/components/Toast';
import EditOpportunityModal from '@/app/components/EditOpportunityModal';

const TODAY = new Date().toISOString().split('T')[0];

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

export default function OpportunityDetailPage() {
  const params = useParams();
  const router = useRouter();
  const oppId = params.id as string;
  const { data: session } = useSession();
  const isAdmin = ['administrative_manager','admin','ceo','sales_director','coo'].includes(session?.user?.role ?? '');

  const { opportunities, accounts, contacts, tasks, getActivitiesForAccount, updateOpportunityOwner, deleteOpportunity, deleteActivity } = useCRM();
  const { users } = useUsers();

  const opp = opportunities.find((o) => o.id === oppId);
  const account = opp ? accounts.find((a) => a.id === opp.accountId) : undefined;
  const oppContacts = opp ? contacts.filter((c) => opp.contactIds.includes(c.id)) : [];
  const relatedTasks = tasks.filter((t) => t.relatedOpportunityId === oppId);
  const allUsers = users;

  const oppActivities = opp ? getActivitiesForAccount(opp.accountId) : [];

  const [currentOwnerId, setCurrentOwnerId] = useState(opp?.ownerId ?? '');
  const [showLogModal, setShowLogModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function handleOwnerChange(newOwnerId: string) {
    if (!opp) return;
    updateOpportunityOwner(opp.id, newOwnerId);
    setCurrentOwnerId(newOwnerId);
  }

  function getOwnerName(ownerId: string): string {
    const ctxUser = users.find((u) => u.id === ownerId);
    return ctxUser?.name ?? ownerId;
  }

  function handleDeleteOpportunity() {
    deleteOpportunity(oppId);
    router.push('/opportunities');
  }

  const contactNameMap: Record<string, string> = {};
  oppContacts.forEach((c) => {
    contactNameMap[c.id] = `${c.firstName} ${c.lastName}`;
  });
  const accountNameMap: Record<string, string> = {};
  if (account) accountNameMap[account.id] = account.name;

  if (!opp) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 text-lg">Opportunity not found.</p>
          <Link href="/opportunities" className="mt-4 inline-block text-sm underline" style={{ color: '#1a4731' }}>
            Back to Opportunities
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <TopBar />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-7xl mx-auto">
          <div className="mt-6 mb-1">
            <Link href="/opportunities" className="text-sm hover:underline" style={{ color: '#2d6a4f' }}>
              ← Opportunities
            </Link>
          </div>

          {/* Header Card */}
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 p-6 mb-6 mt-3">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{opp.name}</h1>
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  {account && (
                    <Link href={`/accounts/${account.id}`} className="text-sm font-medium hover:underline" style={{ color: '#2d6a4f' }}>
                      {account.name}
                    </Link>
                  )}
                  <StageBadge stage={opp.stage} />
                  <span className="text-sm font-bold text-gray-800">{formatCurrency(opp.amount)}</span>
                  <span className="text-sm text-gray-500">Close: {formatDate(opp.closeDate)}</span>
                  <span className="text-sm text-gray-500">{opp.probability}% probability</span>
                  {isAdmin ? (
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm text-gray-500">Owner:</span>
                      <select
                        value={currentOwnerId}
                        onChange={(e) => handleOwnerChange(e.target.value)}
                        className="text-sm font-medium border border-gray-200 rounded-md px-2 py-0.5 focus:outline-none focus:ring-1 bg-white"
                        style={{ color: '#1a4731' }}
                      >
                        {allUsers.map((u) => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                    </span>
                  ) : (
                    <span className="text-sm text-gray-500">Owner: {getOwnerName(currentOwnerId)}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowEditModal(true)}
                  className="px-3 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  Edit
                </button>
                <button
                  onClick={() => setShowTaskModal(true)}
                  className="px-3 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  + New Task
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-3 py-2 text-sm font-medium border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>

            {/* Key fields */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5 pt-5 border-t border-gray-100">
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Next Step</p>
                <p className="text-sm text-gray-700 mt-1">{opp.nextStep || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Lead Source</p>
                <p className="text-sm text-gray-700 mt-1">{opp.leadSource || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Created Date</p>
                <p className="text-sm text-gray-700 mt-1">{formatDate(opp.createdDate)}</p>
              </div>
            </div>
          </div>

          {/* Middle Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Contact Roles */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Contact Roles</h2>
              {oppContacts.length === 0 ? (
                <p className="text-sm text-gray-400">No contacts linked.</p>
              ) : (
                <ul className="space-y-3">
                  {oppContacts.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 pb-3 border-b border-gray-50 last:border-0">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                        style={{ backgroundColor: '#2d6a4f' }}
                      >
                        {c.firstName[0]}{c.lastName[0]}
                      </div>
                      <div>
                        <Link
                          href={`/contacts/${c.id}`}
                          className="text-sm font-medium hover:underline"
                          style={{ color: '#1a4731' }}
                        >
                          {c.firstName} {c.lastName}
                        </Link>
                        <p className="text-xs text-gray-500">{c.title}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Related Tasks */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Related Tasks</h2>
              {relatedTasks.length === 0 ? (
                <p className="text-sm text-gray-400">No tasks linked.</p>
              ) : (
                <ul className="space-y-2">
                  {relatedTasks.map((task) => {
                    const isOverdue = task.dueDate < TODAY && task.status === 'Open';
                    return (
                      <li key={task.id} className="pb-2 border-b border-gray-50 last:border-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-gray-800">{task.subject}</p>
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
                              task.status === 'Completed'
                                ? 'bg-green-50 text-green-600'
                                : task.priority === 'High'
                                ? 'bg-red-50 text-red-600'
                                : task.priority === 'Medium'
                                ? 'bg-amber-50 text-amber-600'
                                : 'bg-gray-50 text-gray-500'
                            }`}
                          >
                            {task.status === 'Completed' ? 'Done' : task.priority}
                          </span>
                        </div>
                        <span className={`text-xs ${isOverdue ? 'text-red-600' : 'text-gray-400'}`}>
                          {task.status === 'Completed' ? 'Completed' : `Due ${formatDate(task.dueDate)}`}
                          {isOverdue ? ' (overdue)' : ''}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Activity Timeline */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-base font-semibold text-gray-900">Activity Timeline</h2>
              <button
                onClick={() => setShowLogModal(true)}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#1a4731' }}
              >
                + Log Activity
              </button>
            </div>
            <ActivityTimeline
              activities={oppActivities}
              contactNameMap={contactNameMap}
              accountNameMap={accountNameMap}
              onDelete={deleteActivity}
            />

            {/* Deal Comments */}
            <div className="mt-6 pt-4 border-t border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Deal Comments</h3>
              <CommentThread parentType="opportunity" parentId={oppId} />
            </div>
          </div>
        </div>
      </main>

      {showLogModal && opp.accountId && (
        <LogActivityModal
          accountId={opp.accountId}
          onClose={() => setShowLogModal(false)}
          onSave={(_a: Activity) => setToast('Activity logged successfully')}
        />
      )}

      {showTaskModal && (
        <NewTaskModal
          defaultAccountId={opp.accountId}
          defaultOpportunityId={oppId}
          onClose={() => setShowTaskModal(false)}
          onSave={() => setToast('Task created successfully')}
        />
      )}

      {/* Confirm delete modal */}
      {showEditModal && opp && (
        <EditOpportunityModal opportunity={opp} onClose={() => setShowEditModal(false)} onSaved={() => { setToast('Opportunity updated'); setShowEditModal(false); window.location.reload(); }} />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Delete Opportunity</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
              Are you sure you want to delete <strong>{opp.name}</strong>?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteOpportunity}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
