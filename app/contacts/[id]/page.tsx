'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Activity, generateId } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import SendEmailModal from '@/app/components/SendEmailModal';
import ActivityTimeline from '@/app/components/ActivityTimeline';
import LogActivityModal from '@/app/components/LogActivityModal';
import NewTaskModal from '@/app/components/NewTaskModal';
import StageBadge from '@/app/components/StageBadge';
import TopBar from '@/app/components/TopBar';
import Toast from '@/app/components/Toast';
import EditContactModal from '@/app/components/EditContactModal';

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

export default function ContactDetailPage() {
  const params = useParams();
  const router = useRouter();
  const contactId = params.id as string;

  const { data: session } = useSession();
  const { contacts, accounts, opportunities, tasks, getActivitiesForContact, deleteContact, deleteActivity, addActivity } = useCRM();

  const contact = contacts.find((c) => c.id === contactId);
  const account = contact ? accounts.find((a) => a.id === contact.accountId) : undefined;

  const relatedOpps = opportunities.filter(
    (o) => o.contactIds.includes(contactId) && o.stage !== 'Closed Won' && o.stage !== 'Closed Lost'
  );

  const openTasks = tasks.filter(
    (t) => t.relatedContactId === contactId && t.status === 'Open'
  );

  const contactActivities = getActivitiesForContact(contactId);

  const [showLogModal, setShowLogModal] = useState(false);
  const [logModalType, setLogModalType] = useState<'Call' | 'Meeting' | 'Email' | 'Note'>('Call');
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const accountNameMap: Record<string, string> = {};
  if (account) accountNameMap[account.id] = account.name;

  function openLogCall() {
    setLogModalType('Call');
    setShowLogModal(true);
  }

  if (!contact) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 text-lg">Contact not found.</p>
          <Link href="/contacts" className="mt-4 inline-block text-sm underline" style={{ color: '#1a4731' }}>
            Back to Contacts
          </Link>
        </div>
      </div>
    );
  }

  function handleDeleteContact() {
    deleteContact(contactId);
    router.push('/contacts');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-7xl mx-auto">
          <div className="mt-6 mb-1">
            <Link href="/contacts" className="text-sm hover:underline" style={{ color: '#2d6a4f' }}>
              ← Contacts
            </Link>
          </div>

          {/* Header */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6 mt-3">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center text-white text-lg font-semibold flex-shrink-0"
                  style={{ backgroundColor: '#1a4731' }}
                >
                  {contact.firstName[0]}{contact.lastName[0]}
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">
                    {contact.firstName} {contact.lastName}
                  </h1>
                  <p className="text-gray-500 mt-0.5">{contact.title}</p>
                  <div className="flex flex-wrap items-center gap-3 mt-2">
                    {account && (
                      <Link href={`/accounts/${account.id}`} className="text-sm font-medium hover:underline" style={{ color: '#2d6a4f' }}>
                        {account.name}
                      </Link>
                    )}
                    <span className="text-sm text-gray-500">{contact.phone}</span>
                    <span className="text-sm text-gray-500">{contact.email}</span>
                    {contact.linkedIn && (
                      <a
                        href={contact.linkedIn}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm hover:underline"
                        style={{ color: '#2d6a4f' }}
                      >
                        LinkedIn
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* Quick actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => setShowEditModal(true)}
                  className="px-3 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  Edit
                </button>
                <button
                  onClick={openLogCall}
                  className="px-3 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity flex items-center gap-1.5"
                  style={{ backgroundColor: '#1a4731' }}
                >
                  📞 Log a Call
                </button>
                <button
                  onClick={() => setShowEmailModal(true)}
                  className="px-3 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Send Email
                </button>
                <button
                  onClick={() => setShowTaskModal(true)}
                  className="px-3 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-1.5"
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
          </div>

          {/* Middle Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Open Tasks */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Open Tasks</h2>
              {openTasks.length === 0 ? (
                <p className="text-sm text-gray-400">No open tasks.</p>
              ) : (
                <ul className="space-y-2">
                  {openTasks.map((task) => {
                    const isOverdue = task.dueDate < TODAY;
                    return (
                      <li key={task.id} className="pb-2 border-b border-gray-50 last:border-0">
                        <p className="text-sm font-medium text-gray-800">{task.subject}</p>
                        <span className={`text-xs ${isOverdue ? 'text-red-600' : 'text-gray-400'}`}>
                          {isOverdue ? 'Overdue · ' : ''}
                          Due {formatDate(task.dueDate)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Related Opportunities */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Related Opportunities</h2>
              {relatedOpps.length === 0 ? (
                <p className="text-sm text-gray-400">No open opportunities.</p>
              ) : (
                <ul className="space-y-3">
                  {relatedOpps.map((opp) => (
                    <li key={opp.id} className="pb-3 border-b border-gray-50 last:border-0">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/opportunities/${opp.id}`}
                          className="text-sm font-medium hover:underline"
                          style={{ color: '#1a4731' }}
                        >
                          {opp.name}
                        </Link>
                        <span className="text-sm font-semibold text-gray-700 flex-shrink-0">
                          {formatCurrency(opp.amount)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <StageBadge stage={opp.stage} />
                        <span className="text-xs text-gray-400">Close: {formatDate(opp.closeDate)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Activity Timeline */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-base font-semibold text-gray-900">Activity Timeline</h2>
              <button
                onClick={() => { setLogModalType('Call'); setShowLogModal(true); }}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#1a4731' }}
              >
                + Log Activity
              </button>
            </div>
            <ActivityTimeline
              activities={contactActivities}
              accountNameMap={accountNameMap}
              onDelete={deleteActivity}
            />
          </div>
        </div>
      </main>

      {showLogModal && contact.accountId && (
        <LogActivityModal
          accountId={contact.accountId}
          contactId={contactId}
          defaultType={logModalType}
          onClose={() => setShowLogModal(false)}
          onSave={(_a: Activity) => setToast('Activity logged successfully')}
        />
      )}

      {showTaskModal && (
        <NewTaskModal
          defaultAccountId={contact.accountId}
          defaultContactId={contactId}
          onClose={() => setShowTaskModal(false)}
          onSave={() => setToast('Task created successfully')}
        />
      )}

      {showEditModal && contact && (
        <EditContactModal contact={contact} onClose={() => setShowEditModal(false)} onSaved={() => setToast('Contact updated')} />
      )}

      {/* Confirm delete modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Delete Contact</h2>
            <p className="text-sm text-gray-600 mb-5">
              Are you sure you want to delete <strong>{contact.firstName} {contact.lastName}</strong>?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteContact}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {showEmailModal && contact && (
        <SendEmailModal
          recipients={[{ email: contact.email, name: `${contact.firstName} ${contact.lastName}`, contactId: contact.id }]}
          onClose={() => setShowEmailModal(false)}
          onSent={(subject, body) => {
            const activity = {
              id: generateId(),
              type: 'Email' as const,
              subject,
              description: `Email sent: ${body.slice(0, 100)}`,
              date: new Date().toISOString().split('T')[0],
              ownerId: session?.user?.id ?? '',
              accountId: contact.accountId,
              contactId: contact.id,
            };
            addActivity(activity);
            setToast(`Email sent to ${contact.firstName} ${contact.lastName}`);
          }}
        />
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
