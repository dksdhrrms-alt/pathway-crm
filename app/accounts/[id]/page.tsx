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
    addActivity, toggleTask, updateAccount,
  } = useCRM();
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const { data: session } = useSession();
  const { users } = useUsers();

  const account = accounts.find((a) => a.id === accountId);

  const [showLogModal, setShowLogModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showAllTx, setShowAllTx] = useState(false);
  const [showAllContacts, setShowAllContacts] = useState(false);
  const [purchasePeriod, setPurchasePeriod] = useState<'all' | 'q1' | 'q2' | 'q3' | 'q4' | 'ytd' | '6m' | '1y' | '2y' | 'custom'>('all');
  const [purchaseProduct, setPurchaseProduct] = useState<string>('all');
  const [purchaseFrom, setPurchaseFrom] = useState('');
  const [purchaseTo, setPurchaseTo] = useState('');
  const [purchaseView, setPurchaseView] = useState<'list' | 'quarterly'>('list');

  // --- Related data ---
  const accountContacts = useMemo(
    () => contacts.filter((c) => c.accountId === accountId),
    [contacts, accountId],
  );
  // Child accounts (for Integration roll-up)
  const childAccounts = useMemo(
    () => accounts.filter((a) => a.parentAccountId === accountId),
    [accounts, accountId],
  );
  const aggregateAccountIds = useMemo(
    () => [accountId, ...childAccounts.map((c) => c.id)],
    [accountId, childAccounts],
  );
  const aggregateAccountNames = useMemo(
    () => account ? [account.name, ...childAccounts.map((c) => c.name)] : [],
    [account, childAccounts],
  );

  const allAccountOpps = useMemo(
    () => opportunities.filter((o) => aggregateAccountIds.includes(o.accountId)),
    [opportunities, aggregateAccountIds],
  );
  const openDeals = useMemo(
    () => allAccountOpps.filter((o) => o.stage !== 'Closed Won' && o.stage !== 'Closed Lost'),
    [allAccountOpps],
  );
  const accountActivities = useMemo(
    () => activities.filter((a) => aggregateAccountIds.includes(a.accountId)),
    [activities, aggregateAccountIds],
  );
  void getActivitiesForAccount;
  const accountTasks = useMemo(
    () => tasks.filter((t) => t.relatedAccountId && aggregateAccountIds.includes(t.relatedAccountId)),
    [tasks, aggregateAccountIds],
  );
  const accountSales = useMemo(
    () => aggregateAccountNames.length > 0 ? saleRecords.filter((r) => aggregateAccountNames.includes(r.accountName)) : [],
    [saleRecords, aggregateAccountNames],
  );

  const hasChildren = childAccounts.length > 0;

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
                  {(() => {
                    const parent = account.parentAccountId ? accounts.find((a) => a.id === account.parentAccountId) : null;
                    return parent ? (
                      <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '2px' }}>
                        ↳ Child of <Link href={`/accounts/${parent.id}`} style={{ color: 'white', textDecoration: 'underline' }}>{parent.name}</Link>
                      </div>
                    ) : null;
                  })()}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 600 }}>{account.name}</h1>
                    {hasChildren && (
                      <span style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '999px', background: 'rgba(59,130,246,0.25)', color: '#dbeafe', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }} title={`Integration parent of ${childAccounts.length} complex${childAccounts.length > 1 ? 'es' : ''}`}>
                        ◆ Integration · {childAccounts.length} {childAccounts.length === 1 ? 'complex' : 'complexes'}
                      </span>
                    )}
                  </div>
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
                {hasChildren && <div style={{ fontSize: '10px', opacity: 0.6, marginTop: '2px' }}>incl. {childAccounts.length} complex{childAccounts.length > 1 ? 'es' : ''}</div>}
              </div>
              <div>
                <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}>LAST PURCHASE</div>
                <div style={{ fontSize: '20px', fontWeight: 500 }}>{lastPurchaseDate || '—'}</div>
                {hasChildren && <div style={{ fontSize: '10px', opacity: 0.6, marginTop: '2px' }}>across all complexes</div>}
              </div>
              <div>
                <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}>OPEN DEALS</div>
                <div style={{ fontSize: '20px', fontWeight: 500 }}>{openDeals.length}</div>
                {hasChildren && <div style={{ fontSize: '10px', opacity: 0.6, marginTop: '2px' }}>incl. {childAccounts.length} complex{childAccounts.length > 1 ? 'es' : ''}</div>}
              </div>
              <div>
                <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}>PIPELINE VALUE</div>
                <div style={{ fontSize: '20px', fontWeight: 500 }}>
                  {pipelineValue > 0 ? formatCurrency(pipelineValue) : '—'}
                </div>
                {hasChildren && <div style={{ fontSize: '10px', opacity: 0.6, marginTop: '2px' }}>incl. {childAccounts.length} complex{childAccounts.length > 1 ? 'es' : ''}</div>}
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

          {/* ========== SUMMARY ========== */}
          <div style={{ background: 'white', border: '0.5px solid #e5e7eb', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Summary</h3>
              {!editingNotes ? (
                <button
                  onClick={() => { setNotesDraft(account.notes || ''); setEditingNotes(true); }}
                  style={{ fontSize: '12px', padding: '5px 12px', borderRadius: '6px', border: '1px solid #1a4731', color: '#1a4731', background: 'white', cursor: 'pointer' }}
                >
                  {account.notes ? 'Edit' : '+ Add Summary'}
                </button>
              ) : (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => setEditingNotes(false)}
                    style={{ fontSize: '12px', padding: '5px 12px', borderRadius: '6px', border: '1px solid #d1d5db', color: '#6b7280', background: 'white', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => { updateAccount(accountId, { notes: notesDraft.trim() }); setEditingNotes(false); setToast('Summary updated'); }}
                    style={{ fontSize: '12px', padding: '5px 12px', borderRadius: '6px', border: 'none', color: 'white', background: '#1a4731', cursor: 'pointer' }}
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
            {editingNotes ? (
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder="Background, key relationships, recent updates, strategic context..."
                rows={5}
                autoFocus
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px', lineHeight: '1.5', fontFamily: 'inherit', resize: 'vertical', outline: 'none' }}
              />
            ) : account.notes ? (
              <p style={{ margin: 0, fontSize: '13px', lineHeight: '1.6', color: '#374151', whiteSpace: 'pre-wrap' }}>{account.notes}</p>
            ) : (
              <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af', fontStyle: 'italic' }}>No summary yet. Click &quot;+ Add Summary&quot; to capture key context about this account.</p>
            )}
          </div>

          {/* ========== COMPLEXES (CHILD ACCOUNTS) ========== */}
          {(() => {
            const children = accounts.filter((a) => a.parentAccountId === accountId);
            if (children.length === 0) return null;
            const todayMs = Date.now();
            const THIRTY_DAYS_AGO = todayMs - 30 * 24 * 60 * 60 * 1000;
            const rows = children
              .map((c) => {
                const acts = activities.filter((a) => a.accountId === c.id);
                const lastDateStr = acts.length > 0 ? acts.map((a) => a.date).sort().reverse()[0] : '';
                const lastMs = lastDateStr ? new Date(lastDateStr + 'T00:00:00').getTime() : 0;
                const daysSince = lastMs > 0 ? Math.floor((todayMs - lastMs) / (1000 * 60 * 60 * 24)) : -1;
                const recentActivityCount = acts.filter((a) => new Date(a.date + 'T00:00:00').getTime() >= THIRTY_DAYS_AGO).length;
                const openDeals = opportunities.filter((o) => o.accountId === c.id && o.stage !== 'Closed Won' && o.stage !== 'Closed Lost');
                const pipeline = openDeals.reduce((s, o) => s + (Number(o.amount) || 0), 0);
                const sales = saleRecords.filter((r) => r.accountName === c.name).reduce((s, r) => s + (Number(r.amount) || 0), 0);
                return { c, lastDateStr, daysSince, recentActivityCount, openDealsCount: openDeals.length, pipeline, sales };
              })
              .sort((a, b) => b.pipeline - a.pipeline || a.c.name.localeCompare(b.c.name));

            // Aggregates
            const totalChildren = rows.length;
            const totalOpenDeals = rows.reduce((s, r) => s + r.openDealsCount, 0);
            const totalPipeline = rows.reduce((s, r) => s + r.pipeline, 0);
            const totalSales = rows.reduce((s, r) => s + r.sales, 0);
            const activeComplexes = rows.filter((r) => r.daysSince >= 0 && r.daysSince <= 30).length;
            const staleCount = rows.filter((r) => r.daysSince > 90 || r.daysSince === -1).length;
            const coveragePct = totalChildren > 0 ? Math.round((activeComplexes / totalChildren) * 100) : 0;
            const topContributor = rows.length > 0 && rows[0].pipeline > 0 ? rows[0] : null;

            function statusBadge(daysSince: number) {
              if (daysSince === -1) return { label: 'No contact', bg: '#fee2e2', color: '#991b1b' };
              if (daysSince <= 30) return { label: 'Active', bg: '#d1fae5', color: '#065f46' };
              if (daysSince <= 90) return { label: 'Stale', bg: '#fef3c7', color: '#92400e' };
              return { label: 'Cold', bg: '#fee2e2', color: '#991b1b' };
            }
            function relativeDate(daysSince: number, dateStr: string) {
              if (daysSince === -1) return '—';
              if (daysSince === 0) return 'Today';
              if (daysSince === 1) return 'Yesterday';
              if (daysSince < 30) return `${daysSince}d ago`;
              return formatDate(dateStr);
            }

            return (
              <div style={{ background: 'white', border: '0.5px solid #e5e7eb', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px', flexWrap: 'wrap', gap: '12px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Complexes ({totalChildren})</h3>
                    <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#888' }}>Sorted by pipeline contribution · highest first</p>
                  </div>
                </div>

                {/* Roll-up summary strip */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '14px' }}>
                  <div style={{ background: '#f0f7ee', border: '1px solid #d1fae5', borderRadius: '8px', padding: '10px 12px' }}>
                    <div style={{ fontSize: '10px', color: '#047857', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Coverage</div>
                    <div style={{ fontSize: '17px', fontWeight: 600, color: '#0F6E56', marginTop: '2px' }}>{coveragePct}%</div>
                    <div style={{ fontSize: '10px', color: '#888', marginTop: '1px' }}>{activeComplexes}/{totalChildren} active in 30d</div>
                  </div>
                  <div style={{ background: '#f9fafb', border: '0.5px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px' }}>
                    <div style={{ fontSize: '10px', color: '#666', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total Pipeline</div>
                    <div style={{ fontSize: '17px', fontWeight: 600, color: '#1a4731', marginTop: '2px' }}>{totalPipeline > 0 ? formatCurrency(totalPipeline) : '—'}</div>
                    <div style={{ fontSize: '10px', color: '#888', marginTop: '1px' }}>{totalOpenDeals} open deal{totalOpenDeals !== 1 ? 's' : ''}</div>
                  </div>
                  <div style={{ background: '#f9fafb', border: '0.5px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px' }}>
                    <div style={{ fontSize: '10px', color: '#666', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total Sales</div>
                    <div style={{ fontSize: '17px', fontWeight: 600, color: '#1a4731', marginTop: '2px' }}>{totalSales > 0 ? formatCurrency(totalSales) : '—'}</div>
                    <div style={{ fontSize: '10px', color: '#888', marginTop: '1px' }}>lifetime · all complexes</div>
                  </div>
                  {topContributor && (
                    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px 12px' }}>
                      <div style={{ fontSize: '10px', color: '#92400e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Top Contributor</div>
                      <Link href={`/accounts/${topContributor.c.id}`} style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#854f0b', marginTop: '2px', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{topContributor.c.name}</Link>
                      <div style={{ fontSize: '10px', color: '#92400e', marginTop: '1px' }}>{formatCurrency(topContributor.pipeline)} · {totalPipeline > 0 ? Math.round((topContributor.pipeline / totalPipeline) * 100) : 0}% of pipeline</div>
                    </div>
                  )}
                  {staleCount > 0 && (
                    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 12px' }}>
                      <div style={{ fontSize: '10px', color: '#991b1b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Need Attention</div>
                      <div style={{ fontSize: '17px', fontWeight: 600, color: '#dc2626', marginTop: '2px' }}>{staleCount}</div>
                      <div style={{ fontSize: '10px', color: '#888', marginTop: '1px' }}>no contact 90d+</div>
                    </div>
                  )}
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
                        <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: '11px', color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Complex</th>
                        <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: '11px', color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Owner</th>
                        <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: '11px', color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Last Contact</th>
                        <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: '11px', color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Status</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: '11px', color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em' }}>30d Acts</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: '11px', color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Open Deals</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: '11px', color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Pipeline</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: '11px', color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em' }}>% of Pipe</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: '11px', color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Total Sales</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ c, lastDateStr, daysSince, recentActivityCount, openDealsCount, pipeline, sales }) => {
                        const sb = statusBadge(daysSince);
                        const sharePct = totalPipeline > 0 ? Math.round((pipeline / totalPipeline) * 100) : 0;
                        return (
                          <tr key={c.id} style={{ borderBottom: '0.5px solid #f3f4f6' }}>
                            <td style={{ padding: '10px' }}>
                              <Link href={`/accounts/${c.id}`} style={{ color: '#1a4731', fontWeight: 500, textDecoration: 'none' }}>{c.name}</Link>
                              <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
                                {c.industry || '—'}
                                {c.country ? ` · ${c.country}` : ''}
                              </div>
                            </td>
                            <td style={{ padding: '10px', fontSize: '12px', color: '#444' }}>{c.ownerName || getOwnerName(c.ownerId) || '—'}</td>
                            <td style={{ padding: '10px', fontSize: '12px', color: daysSince > 30 ? '#dc2626' : '#444' }}>{relativeDate(daysSince, lastDateStr)}</td>
                            <td style={{ padding: '10px' }}>
                              <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '999px', fontWeight: 500, background: sb.bg, color: sb.color }}>{sb.label}</span>
                            </td>
                            <td style={{ padding: '10px', textAlign: 'right', fontSize: '12px', color: recentActivityCount > 0 ? '#0F6E56' : '#888', fontWeight: recentActivityCount > 0 ? 600 : 400 }}>{recentActivityCount || '—'}</td>
                            <td style={{ padding: '10px', textAlign: 'right', fontSize: '12px', color: openDealsCount > 0 ? '#1a4731' : '#888', fontWeight: openDealsCount > 0 ? 600 : 400 }}>{openDealsCount || '—'}</td>
                            <td style={{ padding: '10px', textAlign: 'right', fontSize: '12px', color: pipeline > 0 ? '#1a4731' : '#888', fontWeight: pipeline > 0 ? 600 : 400 }}>{pipeline > 0 ? formatCurrency(pipeline) : '—'}</td>
                            <td style={{ padding: '10px', textAlign: 'right', fontSize: '11px', color: sharePct > 30 ? '#854f0b' : '#888', fontWeight: sharePct > 30 ? 600 : 400 }}>{sharePct > 0 ? `${sharePct}%` : '—'}</td>
                            <td style={{ padding: '10px', textAlign: 'right', fontSize: '12px', color: sales > 0 ? '#444' : '#888' }}>{sales > 0 ? formatCurrency(sales) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid #e5e7eb', background: '#f9fafb' }}>
                        <td style={{ padding: '10px', fontSize: '12px', fontWeight: 600, color: '#374151' }} colSpan={4}>TOTAL</td>
                        <td style={{ padding: '10px', textAlign: 'right', fontSize: '12px', fontWeight: 600, color: '#0F6E56' }}>{rows.reduce((s, r) => s + r.recentActivityCount, 0) || '—'}</td>
                        <td style={{ padding: '10px', textAlign: 'right', fontSize: '12px', fontWeight: 600, color: '#1a4731' }}>{totalOpenDeals || '—'}</td>
                        <td style={{ padding: '10px', textAlign: 'right', fontSize: '12px', fontWeight: 600, color: '#1a4731' }}>{totalPipeline > 0 ? formatCurrency(totalPipeline) : '—'}</td>
                        <td style={{ padding: '10px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: '#888' }}>100%</td>
                        <td style={{ padding: '10px', textAlign: 'right', fontSize: '12px', fontWeight: 600, color: '#374151' }}>{totalSales > 0 ? formatCurrency(totalSales) : '—'}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            );
          })()}

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
                                <div style={{ fontSize: '13px', fontWeight: 500 }}>
                                  {act.subject}
                                  {hasChildren && act.accountId !== accountId && (() => {
                                    const fromChild = childAccounts.find((c) => c.id === act.accountId);
                                    return fromChild ? (
                                      <Link href={`/accounts/${fromChild.id}`} style={{ marginLeft: '6px', fontSize: '10px', padding: '1px 7px', borderRadius: '999px', background: '#dbeafe', color: '#1e40af', fontWeight: 500, textDecoration: 'none', verticalAlign: 'middle' }}>
                                        ↳ {fromChild.name}
                                      </Link>
                                    ) : null;
                                  })()}
                                </div>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Purchase History</h3>
                  <div style={{ display: 'flex', gap: '2px', background: '#f3f4f6', borderRadius: '6px', padding: '2px' }}>
                    {([['list', 'List'], ['quarterly', 'Q Compare']] as const).map(([v, l]) => (
                      <button key={v} onClick={() => setPurchaseView(v)}
                        style={{ padding: '3px 10px', borderRadius: '4px', border: 'none', fontSize: '11px', fontWeight: purchaseView === v ? 600 : 400, background: purchaseView === v ? '#1a4731' : 'transparent', color: purchaseView === v ? 'white' : '#666', cursor: 'pointer' }}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quarterly Comparison View */}
                {purchaseView === 'quarterly' && accountSales.length > 0 && (() => {
                  const curYear = new Date().getFullYear();
                  const years = [curYear, curYear - 1];
                  const quarters = [
                    { label: 'Q1', months: [1, 2, 3] },
                    { label: 'Q2', months: [4, 5, 6] },
                    { label: 'Q3', months: [7, 8, 9] },
                    { label: 'Q4', months: [10, 11, 12] },
                  ];
                  const getData = (yr: number, ms: number[]) => accountSales.filter((s) => {
                    const d = String(s.date || '').split('-');
                    return parseInt(d[0]) === yr && ms.includes(parseInt(d[1]));
                  });
                  const sum = (arr: typeof accountSales) => arr.reduce((s, r) => s + (Number(r.amount) || 0), 0);
                  const sumKg = (arr: typeof accountSales) => arr.reduce((s, r) => s + (Number(r.volumeKg) || 0), 0);
                  const ytdMonth = new Date().getMonth() + 1;
                  const ytdMonths = Array.from({ length: ytdMonth }, (_, i) => i + 1);

                  return (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '500px' }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#888', fontWeight: 500 }}>Period</th>
                            {years.map((y) => (
                              <th key={y} colSpan={2} style={{ textAlign: 'center', padding: '6px 8px', color: '#1a4731', fontWeight: 600, borderLeft: '1px solid #e5e7eb' }}>{y}</th>
                            ))}
                            <th style={{ textAlign: 'center', padding: '6px 8px', color: '#888', fontWeight: 500, borderLeft: '1px solid #e5e7eb' }}>YoY</th>
                          </tr>
                          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                            <th />
                            {years.map((y) => (
                              <span key={y} style={{ display: 'contents' }}>
                                <th style={{ textAlign: 'right', padding: '4px 8px', color: '#aaa', fontWeight: 400, fontSize: '10px' }}>Amount</th>
                                <th style={{ textAlign: 'right', padding: '4px 8px', color: '#aaa', fontWeight: 400, fontSize: '10px' }}>KG</th>
                              </span>
                            ))}
                            <th style={{ textAlign: 'center', padding: '4px 8px', color: '#aaa', fontWeight: 400, fontSize: '10px' }}>%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {quarters.map((q) => {
                            const curAmt = sum(getData(curYear, q.months));
                            const prevAmt = sum(getData(curYear - 1, q.months));
                            const yoy = prevAmt > 0 ? Math.round(((curAmt - prevAmt) / prevAmt) * 100) : null;
                            return (
                              <tr key={q.label} style={{ borderBottom: '0.5px solid #f3f4f6' }}>
                                <td style={{ padding: '8px 8px', fontWeight: 500 }}>{q.label}</td>
                                <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 500, color: '#1a4731' }}>{curAmt > 0 ? formatCurrency(Math.round(curAmt)) : '--'}</td>
                                <td style={{ padding: '8px 8px', textAlign: 'right', color: '#888', fontSize: '11px' }}>{sumKg(getData(curYear, q.months)) > 0 ? Math.round(sumKg(getData(curYear, q.months))).toLocaleString() : '--'}</td>
                                <td style={{ padding: '8px 8px', textAlign: 'right', color: '#666', borderLeft: '1px solid #e5e7eb' }}>{prevAmt > 0 ? formatCurrency(Math.round(prevAmt)) : '--'}</td>
                                <td style={{ padding: '8px 8px', textAlign: 'right', color: '#888', fontSize: '11px' }}>{sumKg(getData(curYear - 1, q.months)) > 0 ? Math.round(sumKg(getData(curYear - 1, q.months))).toLocaleString() : '--'}</td>
                                <td style={{ padding: '8px 8px', textAlign: 'center', fontWeight: 600, color: yoy === null ? '#ccc' : yoy >= 0 ? '#0F6E56' : '#E24B4A', borderLeft: '1px solid #e5e7eb' }}>
                                  {yoy === null ? '--' : `${yoy >= 0 ? '+' : ''}${yoy}%`}
                                </td>
                              </tr>
                            );
                          })}
                          {/* YTD row */}
                          {(() => {
                            const curYTD = sum(getData(curYear, ytdMonths));
                            const prevYTD = sum(getData(curYear - 1, ytdMonths));
                            const yoy = prevYTD > 0 ? Math.round(((curYTD - prevYTD) / prevYTD) * 100) : null;
                            return (
                              <tr style={{ borderTop: '2px solid #1a4731', background: '#f0f7ee', fontWeight: 600 }}>
                                <td style={{ padding: '8px 8px', color: '#1a4731' }}>YTD</td>
                                <td style={{ padding: '8px 8px', textAlign: 'right', color: '#1a4731' }}>{curYTD > 0 ? formatCurrency(Math.round(curYTD)) : '--'}</td>
                                <td style={{ padding: '8px 8px', textAlign: 'right', color: '#888', fontSize: '11px' }}>{sumKg(getData(curYear, ytdMonths)) > 0 ? Math.round(sumKg(getData(curYear, ytdMonths))).toLocaleString() : '--'}</td>
                                <td style={{ padding: '8px 8px', textAlign: 'right', color: '#666', borderLeft: '1px solid #e5e7eb' }}>{prevYTD > 0 ? formatCurrency(Math.round(prevYTD)) : '--'}</td>
                                <td style={{ padding: '8px 8px', textAlign: 'right', color: '#888', fontSize: '11px' }}>{sumKg(getData(curYear - 1, ytdMonths)) > 0 ? Math.round(sumKg(getData(curYear - 1, ytdMonths))).toLocaleString() : '--'}</td>
                                <td style={{ padding: '8px 8px', textAlign: 'center', color: yoy === null ? '#ccc' : yoy >= 0 ? '#0F6E56' : '#E24B4A', borderLeft: '1px solid #e5e7eb' }}>
                                  {yoy === null ? '--' : `${yoy >= 0 ? '+' : ''}${yoy}%`}
                                </td>
                              </tr>
                            );
                          })()}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}

                {purchaseView === 'list' && accountSales.length === 0 ? (
                  <div style={{ color: '#888', fontSize: '13px', padding: '16px 0' }}>
                    No purchase records yet.
                  </div>
                ) : purchaseView === 'list' ? (
                  (() => {
                    // Apply period filter
                    const now = Date.now();
                    const cY = new Date().getFullYear();
                    const qMonths: Record<string, number[]> = { q1: [1,2,3], q2: [4,5,6], q3: [7,8,9], q4: [10,11,12] };
                    const periodFiltered = purchasePeriod === 'all' ? sortedSales
                      : purchasePeriod === 'custom' ? sortedSales.filter((s) => (!purchaseFrom || s.date >= purchaseFrom) && (!purchaseTo || s.date <= purchaseTo))
                      : purchasePeriod === 'ytd' ? sortedSales.filter((s) => { const d = String(s.date||'').split('-'); return parseInt(d[0]) === cY; })
                      : qMonths[purchasePeriod] ? sortedSales.filter((s) => { const d = String(s.date||'').split('-'); return parseInt(d[0]) === cY && qMonths[purchasePeriod].includes(parseInt(d[1])); })
                      : sortedSales.filter((s) => (now - new Date(s.date + 'T00:00:00').getTime()) / 86400000 <= (({ '6m': 180, '1y': 365, '2y': 730 } as Record<string, number>)[purchasePeriod] || 9999));
                    // Previous year same period for comparison
                    const prevPeriodSales = purchasePeriod === 'ytd' ? sortedSales.filter((s) => { const d = String(s.date||'').split('-'); return parseInt(d[0]) === cY - 1; })
                      : qMonths[purchasePeriod] ? sortedSales.filter((s) => { const d = String(s.date||'').split('-'); return parseInt(d[0]) === cY - 1 && qMonths[purchasePeriod].includes(parseInt(d[1])); })
                      : [];
                    const prevTotal = prevPeriodSales.reduce((s, r) => s + (Number(r.amount) || 0), 0);
                    const prevKg = prevPeriodSales.reduce((s, r) => s + (Number(r.volumeKg) || 0), 0);
                    // Apply product filter
                    const filtered = purchaseProduct === 'all' ? periodFiltered
                      : periodFiltered.filter((s) => (s.productName || 'Unknown') === purchaseProduct);
                    // Unique products for filter
                    const products = [...new Set(sortedSales.map((s) => s.productName || 'Unknown'))];
                    // Product breakdown from filtered
                    const pBrkFiltered: Record<string, { amount: number; kg: number }> = {};
                    filtered.forEach((s) => {
                      const p = s.productName || 'Unknown';
                      if (!pBrkFiltered[p]) pBrkFiltered[p] = { amount: 0, kg: 0 };
                      pBrkFiltered[p].amount += Number(s.amount) || 0;
                      pBrkFiltered[p].kg += Number(s.volumeKg) || 0;
                    });
                    const pBrkArr = Object.entries(pBrkFiltered).sort(([, a], [, b]) => b.amount - a.amount);
                    const maxAmt = pBrkArr.length > 0 ? pBrkArr[0][1].amount : 0;
                    const totalKg = filtered.reduce((s, r) => s + (Number(r.volumeKg) || 0), 0);
                    const totalAmt = filtered.reduce((s, r) => s + (Number(r.amount) || 0), 0);

                    return (
                      <>
                        {/* Filters */}
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', gap: '2px', background: '#f3f4f6', borderRadius: '6px', padding: '2px', flexWrap: 'wrap' }}>
                            {([['all', 'All'], ['q1', 'Q1'], ['q2', 'Q2'], ['q3', 'Q3'], ['q4', 'Q4'], ['ytd', 'YTD'], ['custom', 'Custom']] as const).map(([v, l]) => (
                              <button key={v} onClick={() => setPurchasePeriod(v)}
                                style={{ padding: '3px 8px', borderRadius: '4px', border: 'none', fontSize: '10px', fontWeight: purchasePeriod === v ? 600 : 400, background: purchasePeriod === v ? '#1a4731' : 'transparent', color: purchasePeriod === v ? 'white' : '#666', cursor: 'pointer' }}>
                                {l}
                              </button>
                            ))}
                          </div>
                          {purchasePeriod === 'custom' && (
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                              <input type="date" value={purchaseFrom} onChange={(e) => setPurchaseFrom(e.target.value)}
                                style={{ fontSize: '11px', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '2px 6px' }} />
                              <span style={{ fontSize: '10px', color: '#aaa' }}>~</span>
                              <input type="date" value={purchaseTo} onChange={(e) => setPurchaseTo(e.target.value)}
                                style={{ fontSize: '11px', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '2px 6px' }} />
                            </div>
                          )}
                          {products.length > 1 && (
                            <select value={purchaseProduct} onChange={(e) => setPurchaseProduct(e.target.value)}
                              style={{ fontSize: '11px', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '3px 8px', background: 'white' }}>
                              <option value="all">All Products</option>
                              {products.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                          )}
                          <div style={{ marginLeft: 'auto', fontSize: '11px', color: '#888', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            <span>{Math.round(totalKg).toLocaleString()} kg</span>
                            <span style={{ fontWeight: 600, color: '#1a4731' }}>{formatCurrency(Math.round(totalAmt))}</span>
                            {prevTotal > 0 && (() => {
                              const yoy = Math.round(((totalAmt - prevTotal) / prevTotal) * 100);
                              return <span style={{ fontWeight: 600, color: yoy >= 0 ? '#0F6E56' : '#E24B4A' }}>vs LY: {yoy >= 0 ? '+' : ''}{yoy}%</span>;
                            })()}
                          </div>
                        </div>
                        {/* Previous year comparison bar */}
                        {prevTotal > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#888', marginBottom: '12px', padding: '6px 8px', background: '#f9fafb', borderRadius: '6px' }}>
                            <span>vs {cY - 1} same period:</span>
                            <span>{Math.round(prevKg).toLocaleString()} kg &middot; {formatCurrency(Math.round(prevTotal))}</span>
                          </div>
                        )}

                        {/* Product breakdown bars */}
                        {pBrkArr.map(([product, data]) => {
                          const pct = maxAmt > 0 ? (data.amount / maxAmt) * 100 : 0;
                          return (
                            <div key={product} style={{ marginBottom: '10px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                                <span style={{ fontWeight: 500 }}>{product}</span>
                                <span style={{ color: '#666' }}>
                                  {data.kg > 0 && <span style={{ color: '#888', marginRight: '8px' }}>{Math.round(data.kg).toLocaleString()} kg</span>}
                                  {formatCurrency(Math.round(data.amount))}
                                </span>
                              </div>
                              <div style={{ height: '6px', background: '#e5e7eb', borderRadius: '3px', overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: '#1a4731', borderRadius: '3px', transition: 'width 0.5s ease' }} />
                              </div>
                            </div>
                          );
                        })}

                        {/* Transactions */}
                        <div style={{ marginTop: '16px', borderTop: '0.5px solid #e5e7eb', paddingTop: '16px' }}>
                          <div style={{ fontSize: '12px', fontWeight: 500, color: '#888', marginBottom: '8px' }}>
                            Transactions ({filtered.length})
                          </div>
                          {filtered.length === 0 ? (
                            <div style={{ color: '#aaa', fontSize: '12px', padding: '8px 0' }}>No transactions match filters.</div>
                          ) : (
                            <>
                              {(showAllTx ? filtered : filtered.slice(0, 5)).map((sale, idx) => (
                                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '0.5px solid #f3f4f6', fontSize: '12px' }}>
                                  <div>
                                    <span style={{ fontWeight: 500 }}>{sale.productName || 'Unknown'}</span>
                                    <span style={{ color: '#888', marginLeft: '8px' }}>{formatDate(sale.date)}</span>
                                    {(sale.volumeKg || 0) > 0 && <span style={{ color: '#aaa', marginLeft: '6px' }}>{Math.round(sale.volumeKg).toLocaleString()} kg</span>}
                                  </div>
                                  <span style={{ fontWeight: 500, color: '#1a4731' }}>{formatCurrency(Math.round(Number(sale.amount)))}</span>
                                </div>
                              ))}
                              {filtered.length > 5 && (
                                <button onClick={() => setShowAllTx(!showAllTx)}
                                  style={{ marginTop: '10px', width: '100%', padding: '8px', background: 'none', border: '1px solid #e5e7eb', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', color: '#1a4731', fontWeight: 500 }}>
                                  {showAllTx ? 'Show less' : `+ ${filtered.length - 5} more transactions`}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </>
                    );
                  })()
                ) : null}
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
                    .slice(0, showAllContacts ? undefined : 5)
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
                  <button
                    onClick={() => setShowAllContacts(!showAllContacts)}
                    style={{
                      marginTop: '10px', width: '100%', padding: '8px',
                      background: 'none', border: '1px solid #e5e7eb', borderRadius: '8px',
                      cursor: 'pointer', fontSize: '12px', color: '#1a4731', fontWeight: 500,
                    }}
                  >
                    {showAllContacts ? 'Show less' : `+ ${accountContacts.length - 5} more contacts`}
                  </button>
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
