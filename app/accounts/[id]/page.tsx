'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Activity, generateId } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import { useSession } from 'next-auth/react';
import SendEmailModal from '@/app/components/SendEmailModal';
import { useUsers } from '@/lib/UserContext';
import StageBadge from '@/app/components/StageBadge';
import ActivityTimeline from '@/app/components/ActivityTimeline';
import LogActivityModal from '@/app/components/LogActivityModal';
import NewTaskModal from '@/app/components/NewTaskModal';
import TopBar from '@/app/components/TopBar';
import Toast from '@/app/components/Toast';
import EditAccountModal from '@/app/components/EditAccountModal';

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatRevenue(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  return formatCurrency(n);
}

export default function AccountDetailPage() {
  const params = useParams();
  const router = useRouter();
  const accountId = params.id as string;

  const { accounts, contacts, opportunities, getActivitiesForAccount, deleteAccount, deleteActivity, addActivity } = useCRM();
  const { data: session } = useSession();
  const { users } = useUsers();

  const account = accounts.find((a) => a.id === accountId);
  const accountContacts = contacts.filter((c) => c.accountId === accountId);
  const accountOpps = opportunities.filter(
    (o) => o.accountId === accountId && o.stage !== 'Closed Won' && o.stage !== 'Closed Lost'
  );

  const accountActivities = getActivitiesForAccount(accountId);

  const [showLogModal, setShowLogModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const contactNameMap: Record<string, string> = {};
  accountContacts.forEach((c) => {
    contactNameMap[c.id] = `${c.firstName} ${c.lastName}`;
  });

  function getOwnerName(ownerId: string): string {
    const ctxUser = users.find((u) => u.id === ownerId);
    return ctxUser?.name ?? ownerId;
  }

  if (!account) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 text-lg">Account not found.</p>
          <Link href="/accounts" className="mt-4 inline-block text-sm underline" style={{ color: '#1a4731' }}>
            Back to Accounts
          </Link>
        </div>
      </div>
    );
  }

  function handleDeleteAccount() {
    deleteAccount(accountId);
    router.push('/accounts');
  }

  const emailRecipients = accountContacts.filter(c => c.email).map(c => ({ email: c.email, name: `${c.firstName} ${c.lastName}`, contactId: c.id }));

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-7xl mx-auto">
          <div className="mt-6 mb-1">
            <Link href="/accounts" className="text-sm hover:underline" style={{ color: '#2d6a4f' }}>
              ← Accounts
            </Link>
          </div>

          {/* Header Card */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6 mt-3">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{account.name}</h1>
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                    {account.industry}
                  </span>
                  <span className="text-sm text-gray-500">{account.location}</span>
                  <span className="text-sm text-gray-500">Revenue: {formatRevenue(account.annualRevenue)}</span>
                  <span className="text-sm text-gray-500">Owner: {getOwnerName(account.ownerId)}</span>
                  <a
                    href={account.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm hover:underline"
                    style={{ color: '#2d6a4f' }}
                  >
                    {account.website.replace('https://', '')}
                  </a>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowEditModal(true)}
                  className="px-3 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  Edit
                </button>
                <button
                  onClick={() => setShowEmailModal(true)}
                  className="px-3 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Send Email
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
                  Delete Account
                </button>
              </div>
            </div>
          </div>

          {/* Middle Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Contacts */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Contacts</h2>
              {accountContacts.length === 0 ? (
                <p className="text-sm text-gray-400">No contacts linked.</p>
              ) : (
                <ul className="space-y-3">
                  {accountContacts.map((c) => (
                    <li key={c.id} className="flex items-start gap-3 pb-3 border-b border-gray-50 last:border-0">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                        style={{ backgroundColor: '#2d6a4f' }}
                      >
                        {c.firstName[0]}{c.lastName[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <Link
                          href={`/contacts/${c.id}`}
                          className="text-sm font-medium hover:underline"
                          style={{ color: '#1a4731' }}
                        >
                          {c.firstName} {c.lastName}
                        </Link>
                        <p className="text-xs text-gray-500">{c.title}</p>
                        <div className="flex gap-3 mt-0.5">
                          <span className="text-xs text-gray-400">{c.phone}</span>
                          <span className="text-xs text-gray-400">{c.email}</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Open Opportunities */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Open Opportunities</h2>
              {accountOpps.length === 0 ? (
                <p className="text-sm text-gray-400">No open opportunities.</p>
              ) : (
                <ul className="space-y-3">
                  {accountOpps.map((opp) => (
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
                onClick={() => setShowLogModal(true)}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#1a4731' }}
              >
                + Log Activity
              </button>
            </div>
            <ActivityTimeline
              activities={accountActivities}
              contactNameMap={contactNameMap}
              onDelete={deleteActivity}
            />
          </div>
        </div>
      </main>

      {showLogModal && (
        <LogActivityModal
          accountId={accountId}
          onClose={() => setShowLogModal(false)}
          onSave={(_a: Activity) => setToast('Activity logged successfully')}
        />
      )}

      {showTaskModal && (
        <NewTaskModal
          defaultAccountId={accountId}
          onClose={() => setShowTaskModal(false)}
          onSave={() => setToast('Task created successfully')}
        />
      )}

      {showEmailModal && emailRecipients.length > 0 && (
        <SendEmailModal
          recipients={emailRecipients}
          singleRecipient={emailRecipients.length === 1}
          onClose={() => setShowEmailModal(false)}
          onSent={(subject, body, recipients) => {
            recipients.forEach((r) => {
              const activity = {
                id: generateId(),
                type: 'Email' as const,
                subject,
                description: `Email sent: ${body.slice(0, 100)}`,
                date: new Date().toISOString().split('T')[0],
                ownerId: session?.user?.id ?? '',
                accountId: accountId,
                contactId: r.contactId,
              };
              addActivity(activity);
            });
            setToast(`Email sent to ${recipients.length} contact(s)`);
          }}
        />
      )}

      {showEditModal && account && (
        <EditAccountModal account={account} onClose={() => setShowEditModal(false)} onSaved={() => setToast('Account updated successfully')} />
      )}

      {/* Confirm delete modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Delete Account</h2>
            <p className="text-sm text-gray-600 mb-1">
              Are you sure you want to delete <strong>{account.name}</strong>?
            </p>
            <p className="text-xs text-red-600 mb-5">This will also delete all linked contacts, opportunities, activities, and tasks.</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
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
