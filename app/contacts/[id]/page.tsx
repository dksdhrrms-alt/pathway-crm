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
import { formatPhone } from '@/lib/phone';

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
      <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 dark:text-gray-400 text-lg">Contact not found.</p>
          <Link href="/contacts" className="mt-4 inline-block text-sm underline text-[#1a4731] dark:text-white">
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
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <TopBar />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-7xl mx-auto">
          <div className="mt-6 mb-1">
            <Link href="/contacts" className="text-sm hover:underline text-[#2d6a4f] dark:text-emerald-300">
              ← Contacts
            </Link>
          </div>

          {/* Header */}
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-6 mb-6 mt-3">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center text-white text-lg font-semibold flex-shrink-0"
                  style={{ backgroundColor: '#1a4731' }}
                >
                  {contact.firstName[0]}{contact.lastName[0]}
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    {contact.firstName} {contact.lastName}
                  </h1>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    {contact.position && (
                      <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ backgroundColor: '#E1F5EE', color: '#0F6E56' }}>
                        {contact.position}
                      </span>
                    )}
                    {contact.species && (
                      <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ backgroundColor: '#EEEDFE', color: '#534AB7' }}>
                        {contact.species}
                      </span>
                    )}
                    {contact.title && contact.title !== contact.position && contact.title !== contact.species && (
                      <span className="text-sm text-gray-500">{contact.title}</span>
                    )}
                  </div>
                  {/* Account link sits on its own row so the company name
                      reads cleanly. */}
                  {account && (
                    <div className="mt-2">
                      <Link href={`/accounts/${account.id}`} className="text-sm font-medium hover:underline text-[#2d6a4f] dark:text-emerald-300">
                        {account.name}
                      </Link>
                    </div>
                  )}
                  {/* Contact channels — phone (tel:), email (mailto:),
                      LinkedIn. Pills with icons so each channel is
                      visually distinct and one-click-actionable. mailto:
                      hands off to the OS default mail client which is
                      Outlook on the reps' Windows machines.
                      Phone number is reformatted with dashes on display
                      (formatPhone) so legacy "8144663366" rows look
                      consistent with new "814-466-3366" entries. */}
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    {contact.phone && (
                      <a
                        href={`tel:${contact.phone.replace(/\D/g, '')}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-slate-700 transition"
                        title="Call this number"
                      >
                        <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h2.28a2 2 0 011.94 1.515l.7 2.8a2 2 0 01-.45 1.9L8 10.5a11 11 0 005.5 5.5l1.285-1.47a2 2 0 011.9-.45l2.8.7A2 2 0 0121 16.72V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                        {formatPhone(contact.phone)}
                      </a>
                    )}
                    {contact.email && (
                      <a
                        href={`mailto:${contact.email}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition"
                        title="Send email via your default mail client"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        {contact.email}
                      </a>
                    )}
                    {contact.linkedIn && (
                      <a
                        href={contact.linkedIn}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/50 transition"
                        title="Open LinkedIn profile"
                      >
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M20.5 2h-17A1.5 1.5 0 002 3.5v17A1.5 1.5 0 003.5 22h17a1.5 1.5 0 001.5-1.5v-17A1.5 1.5 0 0020.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 118.3 6.5a1.78 1.78 0 01-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0013 14.19a.66.66 0 000 .14V19h-3v-9h2.9v1.3a3.11 3.11 0 012.7-1.4c1.55 0 3.36.86 3.36 3.66z" />
                        </svg>
                        LinkedIn
                      </a>
                    )}
                  </div>
                  {/* Physical address — shown right under the contact
                      channels so a rep glancing at the header can see
                      where this contact actually is. Each piece is
                      optional; we only render the address row at all
                      if at least one field is present, and we join the
                      pieces with the conventional US format:
                        Street
                        City, ST  ZIP
                      Clicking opens Google Maps in a new tab so reps
                      can quickly look it up before a visit. */}
                  {(contact.street || contact.city || contact.state || contact.zip) && (() => {
                    const cityStateZip = [contact.city, contact.state].filter(Boolean).join(', ') + (contact.zip ? `  ${contact.zip}` : '');
                    const fullAddr = [contact.street, cityStateZip].filter((s) => s && s.trim()).join(', ');
                    return (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddr)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-start gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition"
                        title="Open in Google Maps"
                      >
                        <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span className="leading-tight">
                          {contact.street && <>{contact.street}<br /></>}
                          {cityStateZip}
                        </span>
                      </a>
                    );
                  })()}
                </div>
              </div>

              {/* Quick actions */}
              <div className="flex gap-2">
                {/* Reps prefer composing in Outlook (their normal
                    workflow) rather than the CRM's in-app SendEmailModal,
                    so the top-bar Email button is now a plain mailto:
                    link. Browser hands it to the OS default mail client
                    — Outlook on the team's Windows machines. */}
                <a
                  href={contact.email ? `mailto:${contact.email}` : undefined}
                  aria-disabled={!contact.email}
                  onClick={(e) => { if (!contact.email) e.preventDefault(); }}
                  title={!contact.email ? 'This contact has no email address on file' : 'Open Outlook (or your default mail client) with this contact'}
                  className={`px-3 py-2 text-sm font-medium border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5 ${!contact.email ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  Email
                </a>
                <button
                  onClick={() => setShowEditModal(true)}
                  className="px-3 py-2 text-sm font-medium border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  Edit
                </button>
                <button
                  onClick={() => setShowTaskModal(true)}
                  className="px-3 py-2 text-sm font-medium border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5"
                >
                  + New Task
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-3 py-2 text-sm font-medium border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>

          {/* Middle Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Open Tasks */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-6">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Open Tasks</h2>
              {openTasks.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">No open tasks.</p>
              ) : (
                <ul className="space-y-2">
                  {openTasks.map((task) => {
                    const isOverdue = task.dueDate < TODAY;
                    return (
                      <li key={task.id} className="pb-2 border-b border-gray-50 dark:border-slate-800 last:border-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{task.subject}</p>
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
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-6">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Related Opportunities</h2>
              {relatedOpps.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">No open opportunities.</p>
              ) : (
                <ul className="space-y-3">
                  {relatedOpps.map((opp) => (
                    <li key={opp.id} className="pb-3 border-b border-gray-50 dark:border-slate-800 last:border-0">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/opportunities/${opp.id}`}
                          className="text-sm font-medium hover:underline"
                          style={{ color: '#1a4731' }}
                        >
                          {opp.name}
                        </Link>
                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex-shrink-0">
                          {formatCurrency(opp.amount)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <StageBadge stage={opp.stage} />
                        <span className="text-xs text-gray-400 dark:text-gray-500">Close: {formatDate(opp.closeDate)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Activity Timeline */}
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Activity Timeline</h2>
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

      {showLogModal && (
        <LogActivityModal
          accountId={contact.accountId || ''}
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
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Delete Contact</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
              Are you sure you want to delete <strong>{contact.firstName} {contact.lastName}</strong>?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-slate-800 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors"
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
