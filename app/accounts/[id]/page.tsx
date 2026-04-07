'use client';

import { useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Activity, generateId } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import { useSession } from 'next-auth/react';
import SendEmailModal from '@/app/components/SendEmailModal';
import { useUsers } from '@/lib/UserContext';
import LogActivityModal from '@/app/components/LogActivityModal';
import NewTaskModal from '@/app/components/NewTaskModal';
import TopBar from '@/app/components/TopBar';
import Toast from '@/app/components/Toast';
import EditAccountModal from '@/app/components/EditAccountModal';

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const TYPE_ICON: Record<string, { emoji: string; bg: string }> = {
  Call: { emoji: '📞', bg: '#E6F1FB' },
  Meeting: { emoji: '🤝', bg: '#E1F5EE' },
  Email: { emoji: '📧', bg: '#FAEEDA' },
  Note: { emoji: '📝', bg: '#F1EFE8' },
};

const STAGE_COLORS: Record<string, { bg: string; text: string }> = {
  Prospecting: { bg: '#F1EFE8', text: '#5F5E5A' },
  Qualification: { bg: '#E6F1FB', text: '#185FA5' },
  Proposal: { bg: '#FAEEDA', text: '#854F0B' },
  Negotiation: { bg: '#EEEDFE', text: '#534AB7' },
  'Closed Won': { bg: '#E1F5EE', text: '#0F6E56' },
  'Closed Lost': { bg: '#FEE2E2', text: '#991B1B' },
};

export default function AccountDetailPage() {
  const params = useParams();
  const router = useRouter();
  const accountId = params.id as string;

  const {
    accounts, contacts, opportunities, tasks,
    activities, saleRecords,
    getActivitiesForAccount, deleteAccount, deleteActivity,
    addActivity, toggleTask,
  } = useCRM();
  const { data: session } = useSession();
  const { users } = useUsers();

  const account = accounts.find((a) => a.id === accountId);

  const [showLogModal, setShowLogModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // --- Related data ---
  const accountContacts = useMemo(
    () => contacts.filter((c) => c.accountId === accountId),
    [contacts, accountId],
  );
  const allAccountOpps = useMemo(
    () => opportunities.filter((o) => o.accountId === accountId),
    [opportunities, accountId],
  );
  const openDeals = useMemo(
    () => allAccountOpps.filter((o) => o.stage !== 'Closed Won' && o.stage !== 'Closed Lost'),
    [allAccountOpps],
  );
  const accountActivities = getActivitiesForAccount(accountId);
  const accountTasks = useMemo(
    () => tasks.filter((t) => t.relatedAccountId === accountId),
    [tasks, accountId],
  );
  const accountSales = useMemo(
    () => account ? saleRecords.filter((r) => r.accountName === account.name) : [],
    [saleRecords, account],
  );

  // --- KPIs ---
  const totalPurchases = useMemo(
    () => accountSales.reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
    [accountSales],
  );
  const sortedSales = useMemo(
    () => [...accountSales].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [accountSales],
  );
  const lastPurchaseDate = sortedSales[0]?.date ? formatDate(sortedSales[0].date) : null;
  const pipelineValue = useMemo(
    () => openDeals.reduce((sum, o) => sum + (Number(o.amount) || 0), 0),
    [openDeals],
  );
  const daysSinceLastContact = useMemo(() => {
    if (accountActivities.length === 0) return 999;
    const sorted = [...accountActivities].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    return Math.floor(
      (new Date().getTime() - new Date(sorted[0].date + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24),
    );
  }, [accountActivities]);

  // --- Product breakdown for purchase history ---
  const productBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    accountSales.forEach((r) => {
      const p = r.productName || 'Unknown';
      map[p] = (map[p] || 0) + (Number(r.amount) || 0);
    });
    return Object.entries(map).sort(([, a], [, b]) => b - a);
  }, [accountSales]);
  const maxProductAmount = productBreakdown.length > 0 ? productBreakdown[0][1] : 0;

  function getOwnerName(ownerId: string): string {
    return users.find((u) => u.id === ownerId)?.name ?? ownerId;
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

  const emailRecipients = accountContacts
    .filter((c) => c.email)
    .map((c) => ({ email: c.email, name: `${c.firstName} ${c.lastName}`, contactId: c.id }));

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-7xl mx-auto">
          <div className="mt-6 mb-3">
            <Link href="/accounts" className="text-sm hover:underline" style={{ color: '#2d6a4f' }}>
              ← Accounts
            </Link>
          </div>

          {/* ========== HEADER ========== */}
          <div
            style={{
              background: '#1a4731',
              color: 'white',
              padding: '24px 28px',
              borderRadius: '12px',
              marginBottom: '24px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
              {/* Left: Account info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '48px', height: '48px', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '18px', fontWeight: 500, flexShrink: 0,
                  }}
                >
                  {account.name.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 600 }}>{account.name}</h1>
                  <div style={{ fontSize: '13px', opacity: 0.8, marginTop: '2px' }}>
                    {account.industry}
                    {account.country ? ` · ${account.country}` : account.location ? ` · ${account.location}` : ''}
                    {' · Owner: '}{getOwnerName(account.ownerId)}
                  </div>
                </div>
              </div>

              {/* Right: Action buttons */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setShowLogModal(true)}
                  style={{
                    padding: '8px 16px', borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.4)',
                    background: 'transparent', color: 'white',
                    cursor: 'pointer', fontSize: '13px',
                  }}
                >
                  + Log Activity
                </button>
                <button
                  onClick={() => setShowEditModal(true)}
                  style={{
                    padding: '8px 16px', borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.4)',
                    background: 'transparent', color: 'white',
                    cursor: 'pointer', fontSize: '13px',
                  }}
                >
                  Edit
                </button>
                <button
                  onClick={() => setShowTaskModal(true)}
                  style={{
                    padding: '8px 16px', borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.4)',
                    background: 'transparent', color: 'white',
                    cursor: 'pointer', fontSize: '13px',
                  }}
                >
                  + Task
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  style={{
                    padding: '8px 16px', borderRadius: '8px',
                    border: '1px solid rgba(255,100,100,0.5)',
                    background: 'transparent', color: '#fca5a5',
                    cursor: 'pointer', fontSize: '13px',
                  }}
                >
                  Delete
                </button>
              </div>
            </div>

            {/* KPI Row */}
            <div
              className="account-kpi-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: '16px',
                marginTop: '20px',
                paddingTop: '20px',
                borderTop: '1px solid rgba(255,255,255,0.2)',
              }}
            >
              <div>
                <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}>TOTAL PURCHASES</div>
                <div style={{ fontSize: '20px', fontWeight: 500 }}>
                  {totalPurchases > 0 ? formatCurrency(totalPurchases) : '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}>LAST PURCHASE</div>
                <div style={{ fontSize: '20px', fontWeight: 500 }}>{lastPurchaseDate || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}>OPEN DEALS</div>
                <div style={{ fontSize: '20px', fontWeight: 500 }}>{openDeals.length}</div>
              </div>
              <div>
                <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}>PIPELINE VALUE</div>
                <div style={{ fontSize: '20px', fontWeight: 500 }}>
                  {pipelineValue > 0 ? formatCurrency(pipelineValue) : '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}>LAST CONTACT</div>
                <div style={{ fontSize: '20px', fontWeight: 500 }}>
                  {daysSinceLastContact === 999
                    ? '—'
                    : daysSinceLastContact === 0
                      ? 'Today'
                      : daysSinceLastContact === 1
                        ? 'Yesterday'
                        : `${daysSinceLastContact}d ago`}
                </div>
                {daysSinceLastContact > 30 && daysSinceLastContact < 999 && (
                  <div style={{ fontSize: '11px', color: '#fca5a5', marginTop: '2px' }}>
                    Follow up needed
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ========== 2-COLUMN LAYOUT ========== */}
          <div
            className="account-360-grid"
            style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '20px' }}
          >
            {/* ===== LEFT COLUMN ===== */}
            <div>
              {/* Activity Timeline */}
              <div
                style={{
                  background: 'white', border: '0.5px solid #e5e7eb',
                  borderRadius: '12px', padding: '20px', marginBottom: '20px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Activity Timeline</h3>
                  <button
                    onClick={() => setShowLogModal(true)}
                    style={{
                      fontSize: '12px', padding: '5px 12px', borderRadius: '6px',
                      border: '1px solid #1a4731', color: '#1a4731',
                      background: 'white', cursor: 'pointer',
                    }}
                  >
                    + Log
                  </button>
                </div>

                {accountActivities.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '32px', color: '#888', fontSize: '13px' }}>
                    No activities yet. Log the first one!
                  </div>
                ) : (
                  <div style={{ position: 'relative' }}>
                    {/* Vertical line */}
                    <div
                      style={{
                        position: 'absolute', left: '16px', top: '0', bottom: '0',
                        width: '1px', background: '#e5e7eb',
                      }}
                    />
                    {[...accountActivities]
                      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                      .map((act) => {
                        const ti = TYPE_ICON[act.type] || TYPE_ICON.Note;
                        const ownerName = getOwnerName(act.ownerId);
                        return (
                          <div key={act.id} style={{ display: 'flex', gap: '12px', paddingBottom: '16px', position: 'relative' }}>
                            <div
                              style={{
                                width: '32px', height: '32px', borderRadius: '50%',
                                background: ti.bg,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '14px', flexShrink: 0, zIndex: 1,
                                border: '2px solid white',
                              }}
                            >
                              {ti.emoji}
                            </div>
                            <div style={{ flex: 1, paddingTop: '4px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div style={{ fontSize: '13px', fontWeight: 500 }}>{act.subject}</div>
                                <div style={{ fontSize: '11px', color: '#888', whiteSpace: 'nowrap', marginLeft: '8px' }}>
                                  {formatDate(act.date)}
                                </div>
                              </div>
                              {act.description && (
                                <div
                                  style={{
                                    fontSize: '12px', color: '#666', marginTop: '4px',
                                    lineHeight: '1.6', background: '#fafafa',
                                    padding: '8px 10px', borderRadius: '6px',
                                    border: '0.5px solid #e5e7eb',
                                  }}
                                >
                                  {act.description}
                                </div>
                              )}
                              <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                                Logged by {ownerName}
                              </div>
                            </div>
                            <button
                              onClick={() => deleteActivity(act.id)}
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: '#ccc', fontSize: '14px', padding: '4px',
                                alignSelf: 'flex-start',
                              }}
                              title="Delete activity"
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* Purchase History */}
              <div
                style={{
                  background: 'white', border: '0.5px solid #e5e7eb',
                  borderRadius: '12px', padding: '20px',
                }}
              >
                <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 600 }}>Purchase History</h3>

                {accountSales.length === 0 ? (
                  <div style={{ color: '#888', fontSize: '13px', padding: '16px 0' }}>
                    No purchase records yet.
                  </div>
                ) : (
                  <>
                    {/* Product breakdown bars */}
                    {productBreakdown.map(([product, amount]) => {
                      const pct = maxProductAmount > 0 ? (amount / maxProductAmount) * 100 : 0;
                      return (
                        <div key={product} style={{ marginBottom: '10px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                            <span style={{ fontWeight: 500 }}>{product}</span>
                            <span style={{ color: '#666' }}>{formatCurrency(Math.round(amount))}</span>
                          </div>
                          <div style={{ height: '6px', background: '#e5e7eb', borderRadius: '3px', overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${pct}%`, height: '100%',
                                background: '#1a4731', borderRadius: '3px',
                                transition: 'width 0.5s ease',
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}

                    {/* Recent transactions */}
                    <div style={{ marginTop: '16px', borderTop: '0.5px solid #e5e7eb', paddingTop: '16px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 500, color: '#888', marginBottom: '8px' }}>
                        Recent Transactions
                      </div>
                      {sortedSales.slice(0, 5).map((sale, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'flex', justifyContent: 'space-between',
                            padding: '6px 0', borderBottom: '0.5px solid #f3f4f6',
                            fontSize: '12px',
                          }}
                        >
                          <div>
                            <span style={{ fontWeight: 500 }}>{sale.productName || 'Unknown'}</span>
                            <span style={{ color: '#888', marginLeft: '8px' }}>{formatDate(sale.date)}</span>
                          </div>
                          <span style={{ fontWeight: 500, color: '#1a4731' }}>
                            {formatCurrency(Math.round(Number(sale.amount)))}
                          </span>
                        </div>
                      ))}
                      {sortedSales.length > 5 && (
                        <div style={{ fontSize: '12px', color: '#888', marginTop: '8px', textAlign: 'center' }}>
                          + {sortedSales.length - 5} more transactions
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ===== RIGHT COLUMN ===== */}
            <div>
              {/* Key Contacts */}
              <div
                style={{
                  background: 'white', border: '0.5px solid #e5e7eb',
                  borderRadius: '12px', padding: '20px', marginBottom: '16px',
                }}
              >
                <h3 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 600 }}>Key Contacts</h3>
                {accountContacts.length === 0 ? (
                  <div style={{ color: '#888', fontSize: '13px' }}>No contacts yet.</div>
                ) : (
                  accountContacts
                    .sort((a, b) => (b.isKeyMan ? 1 : 0) - (a.isKeyMan ? 1 : 0))
                    .slice(0, 5)
                    .map((c) => (
                      <div
                        key={c.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '10px',
                          padding: '8px 0', borderBottom: '0.5px solid #f3f4f6',
                          cursor: 'pointer',
                        }}
                        onClick={() => router.push(`/contacts/${c.id}`)}
                      >
                        <div
                          style={{
                            width: '32px', height: '32px', borderRadius: '50%',
                            background: '#1a4731', color: 'white',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '11px', fontWeight: 500, flexShrink: 0,
                          }}
                        >
                          {c.firstName?.[0]}{c.lastName?.[0]}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                            {c.firstName} {c.lastName}
                            {c.isKeyMan && <span style={{ color: '#f59e0b', fontSize: '14px' }}>★</span>}
                          </div>
                          <div
                            style={{
                              fontSize: '11px', color: '#888',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}
                          >
                            {c.title || c.position || ''}
                          </div>
                        </div>
                        {c.phone && (
                          <a
                            href={`tel:${c.phone}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              fontSize: '11px', padding: '3px 8px',
                              border: '1px solid #e5e7eb', borderRadius: '4px',
                              color: '#1a4731', textDecoration: 'none',
                            }}
                          >
                            📞
                          </a>
                        )}
                      </div>
                    ))
                )}
                {accountContacts.length > 5 && (
                  <div style={{ fontSize: '12px', color: '#888', marginTop: '8px' }}>
                    + {accountContacts.length - 5} more contacts
                  </div>
                )}
              </div>

              {/* Open Deals */}
              <div
                style={{
                  background: 'white', border: '0.5px solid #e5e7eb',
                  borderRadius: '12px', padding: '20px', marginBottom: '16px',
                }}
              >
                <h3 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 600 }}>Open Deals</h3>
                {openDeals.length === 0 ? (
                  <div style={{ color: '#888', fontSize: '13px' }}>No open deals.</div>
                ) : (
                  openDeals.map((opp) => {
                    const sc = STAGE_COLORS[opp.stage] || STAGE_COLORS.Prospecting;
                    return (
                      <div
                        key={opp.id}
                        style={{
                          padding: '10px 0', borderBottom: '0.5px solid #f3f4f6',
                          cursor: 'pointer',
                        }}
                        onClick={() => router.push(`/opportunities/${opp.id}`)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                          <div style={{ fontSize: '13px', fontWeight: 500, flex: 1, marginRight: '8px' }}>{opp.name}</div>
                          <div style={{ fontSize: '13px', fontWeight: 500, color: '#1a4731', whiteSpace: 'nowrap' }}>
                            {formatCurrency(opp.amount)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              fontSize: '11px', padding: '2px 7px', borderRadius: '4px',
                              background: sc.bg, color: sc.text, fontWeight: 500,
                            }}
                          >
                            {opp.stage}
                          </span>
                          <span style={{ fontSize: '11px', color: '#888' }}>
                            Close: {formatDate(opp.closeDate)}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Open Tasks */}
              <div
                style={{
                  background: 'white', border: '0.5px solid #e5e7eb',
                  borderRadius: '12px', padding: '20px',
                }}
              >
                <h3 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 600 }}>Open Tasks</h3>
                {accountTasks.filter((t) => t.status !== 'Completed').length === 0 ? (
                  <div style={{ color: '#888', fontSize: '13px' }}>No open tasks.</div>
                ) : (
                  accountTasks
                    .filter((t) => t.status !== 'Completed')
                    .sort((a, b) => new Date(a.dueDate + 'T00:00:00').getTime() - new Date(b.dueDate + 'T00:00:00').getTime())
                    .map((task) => {
                      const due = new Date(task.dueDate + 'T00:00:00');
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      const isOverdue = due < today && task.status !== 'Completed';
                      const isDueToday = due.toDateString() === today.toDateString();
                      return (
                        <div
                          key={task.id}
                          style={{
                            display: 'flex', alignItems: 'flex-start', gap: '10px',
                            padding: '8px 0', borderBottom: '0.5px solid #f3f4f6',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={task.status === 'Completed'}
                            onChange={() => toggleTask(task.id)}
                            style={{ marginTop: '2px', cursor: 'pointer', width: '16px', height: '16px', flexShrink: 0 }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '13px', fontWeight: 500 }}>{task.subject}</div>
                            <div
                              style={{
                                fontSize: '11px', marginTop: '2px',
                                color: isOverdue ? '#E24B4A' : isDueToday ? '#854F0B' : '#888',
                              }}
                            >
                              {isOverdue ? 'Overdue · ' : isDueToday ? 'Due today · ' : ''}
                              {formatDate(task.dueDate)}
                            </div>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ========== MODALS ========== */}
      {showLogModal && (
        <LogActivityModal
          accountId={accountId}
          onClose={() => setShowLogModal(false)}
          onSave={() => setToast('Activity logged successfully')}
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
              addActivity({
                id: generateId(),
                type: 'Email',
                subject,
                description: `Email sent: ${body.slice(0, 100)}`,
                date: new Date().toISOString().split('T')[0],
                ownerId: session?.user?.id ?? '',
                accountId,
                contactId: r.contactId,
              });
            });
            setToast(`Email sent to ${recipients.length} contact(s)`);
          }}
        />
      )}

      {showEditModal && account && (
        <EditAccountModal
          account={account}
          onClose={() => setShowEditModal(false)}
          onSaved={() => setToast('Account updated successfully')}
        />
      )}

      {showDeleteConfirm && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.4)',
          }}
        >
          <div style={{ background: 'white', borderRadius: '12px', width: '100%', maxWidth: '380px', margin: '0 16px', padding: '24px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>Delete Account</h2>
            <p style={{ fontSize: '14px', color: '#666', marginBottom: '4px' }}>
              Are you sure you want to delete <strong>{account.name}</strong>?
            </p>
            <p style={{ fontSize: '12px', color: '#dc2626', marginBottom: '20px' }}>
              This will also delete all linked contacts, opportunities, activities, and tasks.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                style={{
                  padding: '8px 16px', fontSize: '14px', fontWeight: 500,
                  color: '#374151', background: '#f3f4f6', borderRadius: '8px',
                  border: 'none', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                style={{
                  padding: '8px 16px', fontSize: '14px', fontWeight: 500,
                  color: 'white', background: '#dc2626', borderRadius: '8px',
                  border: 'none', cursor: 'pointer',
                }}
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
