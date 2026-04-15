'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useCRM } from '@/lib/CRMContext';

interface Notification {
  id: string;
  type: 'overdue_task' | 'closing_soon' | 'no_contact' | 'follow_up' | 'birthday';
  priority: 'high' | 'medium' | 'low';
  title: string;
  body: string;
  link: string;
}

const PRIORITY_COLOR: Record<string, string> = { high: '#E24B4A', medium: '#EF9F27', low: '#378ADD' };
const PRIORITY_BG: Record<string, string> = { high: '#FCEBEB', medium: '#FAEEDA', low: '#E6F1FB' };
const TYPE_ICON: Record<string, string> = { overdue_task: '\u26A0\uFE0F', closing_soon: '\uD83C\uDFAF', no_contact: '\uD83D\uDCED', follow_up: '\uD83D\uDD14', birthday: '\uD83C\uDF82' };

export default function NotificationBell() {
  const { data: session } = useSession();
  const router = useRouter();
  const { tasks, opportunities, activities, accounts, contacts } = useCRM();

  const [isOpen, setIsOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('dismissed_notifications') || '[]'));
    } catch { return new Set(); }
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const userId = session?.user?.id ?? '';
  const role = (session?.user as { role?: string })?.role ?? '';
  const isAdmin = ['admin', 'administrative_manager', 'ceo', 'coo', 'sales_director'].includes(role);

  const notifications = useMemo(() => {
    const result: Notification[] = [];
    const now = new Date();
    const todayMs = now.getTime();

    // 1. Overdue tasks (own tasks only)
    tasks
      .filter((t) => t.ownerId === userId && t.status !== 'Completed')
      .filter((t) => t.dueDate && new Date(t.dueDate + 'T00:00:00').getTime() < todayMs)
      .slice(0, 5)
      .forEach((t) => {
        const id = `overdue_task_${t.id}`;
        if (dismissed.has(id)) return;
        const days = Math.floor((todayMs - new Date(t.dueDate + 'T00:00:00').getTime()) / 86400000);
        result.push({
          id, type: 'overdue_task', priority: 'high',
          title: 'Overdue Task',
          body: `"${t.subject}" is ${days}d overdue`,
          link: '/tasks',
        });
      });

    // 2. Deals closing within 7 days
    const opps = isAdmin ? opportunities : opportunities.filter((o) => o.ownerId === userId);
    opps
      .filter((o) => o.closeDate && o.stage !== 'Closed Won' && o.stage !== 'Closed Lost')
      .filter((o) => {
        const days = Math.floor((new Date(o.closeDate + 'T00:00:00').getTime() - todayMs) / 86400000);
        return days >= 0 && days <= 7;
      })
      .slice(0, 5)
      .forEach((o) => {
        const id = `closing_soon_${o.id}`;
        if (dismissed.has(id)) return;
        const days = Math.floor((new Date(o.closeDate + 'T00:00:00').getTime() - todayMs) / 86400000);
        result.push({
          id, type: 'closing_soon',
          priority: days <= 2 ? 'high' : 'medium',
          title: 'Deal Closing Soon',
          body: `"${o.name}" closes ${days === 0 ? 'today' : `in ${days}d`} · $${Number(o.amount).toLocaleString()}`,
          link: `/opportunities/${o.id}`,
        });
      });

    // 3. Accounts not contacted in 30+ days (admin only)
    if (isAdmin) {
      accounts.slice(0, 200).forEach((account) => {
        const acctActivities = activities.filter((a) => a.accountId === account.id);
        const sorted = [...acctActivities].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        );
        const daysSince = sorted.length > 0
          ? Math.floor((todayMs - new Date(sorted[0].date + 'T00:00:00').getTime()) / 86400000)
          : 999;
        if (daysSince >= 30) {
          const id = `no_contact_${account.id}`;
          if (dismissed.has(id)) return;
          result.push({
            id, type: 'no_contact',
            priority: daysSince >= 60 ? 'high' : 'low',
            title: 'No Recent Contact',
            body: `${account.name} — ${daysSince === 999 ? 'Never contacted' : `${daysSince}d since last activity`}`,
            link: `/accounts/${account.id}`,
          });
        }
      });
    }

    // 4. Follow-up reminders from localStorage (set by cron)
    try {
      const reminders = JSON.parse(localStorage.getItem('followup_reminders') || '[]');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reminders.forEach((r: any) => {
        const id = `follow_up_${r.accountId || r.account_id}`;
        if (!dismissed.has(id)) {
          result.push({
            id, type: 'follow_up', priority: 'medium',
            title: 'Follow-up Reminder',
            body: r.message || `Follow up with ${r.accountName || r.account_name}`,
            link: r.accountId ? `/accounts/${r.accountId}` : '/accounts',
          });
        }
      });
    } catch { /* */ }

    // 5. Birthday/Anniversary within 7 days
    const today = new Date();
    const todayMD = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    contacts.forEach((c) => {
      ['birthday', 'anniversary'].forEach((field) => {
        const val = (c as Record<string, string | undefined>)[field];
        if (!val) return;
        const md = val.substring(5); // MM-DD
        // Check if within 7 days
        const eventDate = new Date(today.getFullYear(), parseInt(md.split('-')[0]) - 1, parseInt(md.split('-')[1]));
        const diff = Math.floor((eventDate.getTime() - today.getTime()) / 86400000);
        if (diff >= 0 && diff <= 7) {
          const id = `${field}_${c.id}`;
          if (!dismissed.has(id)) {
            result.push({
              id, type: 'birthday', priority: diff <= 1 ? 'medium' : 'low',
              title: field === 'birthday' ? 'Birthday Coming Up' : 'Anniversary',
              body: `${c.firstName} ${c.lastName}${diff === 0 ? ' - Today!' : ` - in ${diff} days`}`,
              link: `/contacts/${c.id}`,
            });
          }
        }
      });
    });

    return result.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.priority] - order[b.priority];
    });
  }, [tasks, opportunities, activities, accounts, contacts, userId, isAdmin, dismissed]);

  const count = notifications.length;

  function dismiss(id: string) {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    localStorage.setItem('dismissed_notifications', JSON.stringify([...next]));
  }

  function dismissAll() {
    const next = new Set(dismissed);
    notifications.forEach((n) => next.add(n.id));
    setDismissed(next);
    localStorage.setItem('dismissed_notifications', JSON.stringify([...next]));
    setIsOpen(false);
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Bell */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'relative', background: 'none', border: 'none',
          cursor: 'pointer', padding: '6px', borderRadius: '8px',
          fontSize: '20px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: count > 0 ? '#1a4731' : '#888',
        }}
        title={`${count} notifications`}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && (
          <div
            style={{
              position: 'absolute', top: '1px', right: '1px',
              minWidth: '16px', height: '16px', borderRadius: '8px',
              background: '#E24B4A', color: 'white',
              fontSize: '10px', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px solid white', padding: '0 3px',
            }}
          >
            {count > 9 ? '9+' : count}
          </div>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: '8px',
            width: '360px', background: 'white',
            border: '0.5px solid #e5e7eb', borderRadius: '12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            zIndex: 9999, maxHeight: '480px',
            overflow: 'hidden', display: 'flex', flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '14px 16px', borderBottom: '0.5px solid #e5e7eb',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <div>
              <span style={{ fontWeight: 500, fontSize: '14px' }}>Notifications</span>
              {count > 0 && (
                <span
                  style={{
                    marginLeft: '8px', background: '#E24B4A', color: 'white',
                    fontSize: '11px', padding: '1px 6px', borderRadius: '10px', fontWeight: 500,
                  }}
                >
                  {count}
                </span>
              )}
            </div>
            {count > 0 && (
              <button
                onClick={dismissAll}
                style={{
                  fontSize: '12px', color: '#888', background: 'none',
                  border: 'none', cursor: 'pointer', padding: '2px 6px',
                }}
              >
                Dismiss all
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {notifications.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: '#888' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>&#127881;</div>
                <div style={{ fontSize: '13px', fontWeight: 500 }}>All caught up!</div>
                <div style={{ fontSize: '12px', marginTop: '4px' }}>No pending notifications</div>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  style={{
                    display: 'flex', gap: '10px', padding: '12px 16px',
                    borderBottom: '0.5px solid #f3f4f6', cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#fafafa'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; }}
                  onClick={() => { setIsOpen(false); router.push(n.link); }}
                >
                  <div
                    style={{
                      width: '32px', height: '32px', borderRadius: '8px',
                      background: PRIORITY_BG[n.priority],
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '16px', flexShrink: 0,
                    }}
                  >
                    {TYPE_ICON[n.type]}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: 500, color: PRIORITY_COLOR[n.priority], marginBottom: '2px' }}>
                      {n.title}
                    </div>
                    <div
                      style={{
                        fontSize: '12px', color: '#444', lineHeight: 1.5,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}
                    >
                      {n.body}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: '#ccc', fontSize: '16px', padding: '0 4px',
                      flexShrink: 0, alignSelf: 'center',
                    }}
                    title="Dismiss"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div style={{ padding: '10px 16px', borderTop: '0.5px solid #e5e7eb', flexShrink: 0 }}>
              <div style={{ fontSize: '11px', color: '#888', textAlign: 'center' }}>
                Overdue &middot; Closing deals &middot; No contact &middot; Follow-ups
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
