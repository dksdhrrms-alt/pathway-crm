'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Task } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import NewTaskModal from '@/app/components/NewTaskModal';
import TopBar from '@/app/components/TopBar';
import Toast from '@/app/components/Toast';
import LoadingSpinner from '@/app/components/LoadingSpinner';
import EditTaskModal from '@/app/components/EditTaskModal';
import ViewTabs from '@/app/components/ViewTabs';
import CommentThread from '@/app/components/CommentThread';
import EmptyState from '@/app/components/EmptyState';
import { useViewFilter } from '@/hooks/useViewFilter';
import DataTable, { type DataTableColumn } from '@/app/components/DataTable';
import { Modal } from '@/app/components/ui/Modal';
import { SkeletonTable } from '@/app/components/ui/Skeleton';
import { Check, MessageSquare, Pencil, Trash2 } from 'lucide-react';

const TODAY = new Date().toISOString().split('T')[0];

type FilterTab = 'All' | 'Due Today' | 'Overdue' | 'Upcoming' | 'Completed';

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const priorityStyles: Record<string, string> = {
  High: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  Medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  Low: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-gray-300',
};

export default function TasksPage() {
  const { tasks: allTasks, accounts, contacts, toggleTask, deleteTask, updateTask, loading } = useCRM();
  const { users } = useUsers();
  const { activeView, setActiveView, filterByView, teamLabel, viewLabel, canViewCompany, canViewTeam } = useViewFilter();

  const taskList = useMemo(() => filterByView(allTasks), [allTasks, activeView, filterByView]);

  const [activeTab, setActiveTab] = useState<FilterTab>('All');
  const [showNewTaskModal, setShowNewTaskModal] = useState(false);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [commentTaskId, setCommentTaskId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Stats for current view
  const openTaskCount = taskList.filter((t) => t.status === 'Open').length;
  const overdueCount = taskList.filter((t) => t.dueDate < TODAY && t.status === 'Open').length;
  const dueTodayCount = taskList.filter((t) => t.dueDate === TODAY && t.status === 'Open').length;
  const completedCount = taskList.filter((t) => t.status === 'Completed').length;

  const tabs: FilterTab[] = ['All', 'Due Today', 'Overdue', 'Upcoming', 'Completed'];

  function getFilteredTasks(): Task[] {
    switch (activeTab) {
      case 'Due Today':
        return taskList.filter((t) => t.dueDate === TODAY && t.status === 'Open');
      case 'Overdue':
        return taskList.filter((t) => t.dueDate < TODAY && t.status === 'Open');
      case 'Upcoming':
        return taskList.filter((t) => t.dueDate > TODAY && t.status === 'Open');
      case 'Completed':
        return taskList.filter((t) => t.status === 'Completed');
      default:
        return [...taskList].sort((a, b) => {
          if (a.status === 'Completed' && b.status !== 'Completed') return 1;
          if (a.status !== 'Completed' && b.status === 'Completed') return -1;
          return a.dueDate.localeCompare(b.dueDate);
        });
    }
  }

  function getOwnerName(ownerId: string): string {
    const user = users.find((u) => u.id === ownerId);
    return user ? user.name : '';
  }

  function getAccountName(id?: string): string {
    return id ? (accounts.find((a) => a.id === id)?.name ?? '') : '';
  }

  function getContactName(id?: string): string {
    if (!id) return '';
    const c = contacts.find((x) => x.id === id);
    return c ? `${c.firstName} ${c.lastName}` : '';
  }

  const filtered = getFilteredTasks();

  // Loading state used to blow away the TopBar + stats row for a full-
  // screen spinner. Keep the chrome, drop a skeleton table in place.
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
        <TopBar />
        <main className="pt-16 px-6 pb-10">
          <div className="max-w-7xl mx-auto">
            <div className="mt-6 mb-6">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Tasks</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Loading tasks…</p>
            </div>
            <SkeletonTable rows={8} cols={6} />
          </div>
        </main>
      </div>
    );
  }

  const tabCounts: Record<FilterTab, number> = {
    All: taskList.length,
    'Due Today': taskList.filter((t) => t.dueDate === TODAY && t.status === 'Open').length,
    Overdue: taskList.filter((t) => t.dueDate < TODAY && t.status === 'Open').length,
    Upcoming: taskList.filter((t) => t.dueDate > TODAY && t.status === 'Open').length,
    Completed: taskList.filter((t) => t.status === 'Completed').length,
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <TopBar />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-7xl mx-auto">
          <div className="mt-6 mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Tasks</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{openTaskCount} open &middot; {viewLabel}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <ViewTabs activeView={activeView} onChange={setActiveView} teamLabel={teamLabel} showCompany={canViewCompany} showTeam={canViewTeam} />
              <button
                onClick={() => setShowNewTaskModal(true)}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                + New Task
              </button>
            </div>
          </div>

          {/* Stats — stack 2 per row on mobile, 4 across on tablet+.
              Dropped the inline-style `repeat(4, 1fr)` grid that
              squished each tile to ~75 px on a phone and made the
              numbers overlap their labels. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <div className="rounded-xl bg-gray-50 dark:bg-slate-800 px-4 py-3.5">
              <div className="text-[11px] text-muted-fg">OPEN TASKS</div>
              <div className="text-xl sm:text-2xl font-medium text-foreground tabular-nums">{openTaskCount}</div>
            </div>
            <div className={`rounded-xl px-4 py-3.5 ${overdueCount > 0 ? 'bg-red-50 dark:bg-red-950/30' : 'bg-gray-50 dark:bg-slate-800'}`}>
              <div className="text-[11px] text-muted-fg">OVERDUE</div>
              <div className={`text-xl sm:text-2xl font-medium tabular-nums ${overdueCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>{overdueCount}</div>
            </div>
            <div className={`rounded-xl px-4 py-3.5 ${dueTodayCount > 0 ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-gray-50 dark:bg-slate-800'}`}>
              <div className="text-[11px] text-muted-fg">DUE TODAY</div>
              <div className={`text-xl sm:text-2xl font-medium tabular-nums ${dueTodayCount > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'}`}>{dueTodayCount}</div>
            </div>
            <div className="rounded-xl bg-gray-50 dark:bg-slate-800 px-4 py-3.5">
              <div className="text-[11px] text-muted-fg">COMPLETED</div>
              <div className="text-xl sm:text-2xl font-medium text-brand tabular-nums">{completedCount}</div>
            </div>
          </div>

          {/* Filter Tabs — allow horizontal scroll at phone width
              so the full set stays reachable without wrapping. */}
          <div className="flex gap-1 mb-4 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-lg p-1 w-fit max-w-full overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 text-sm font-medium rounded transition-all flex items-center gap-1.5 ${
                  activeTab === tab ? 'text-white shadow-sm' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
                style={activeTab === tab ? { backgroundColor: 'var(--brand)' } : {}}
              >
                {tab}
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-full ${
                    activeTab === tab
                      ? 'bg-white/20 text-white'
                      : tab === 'Overdue' && tabCounts[tab] > 0
                      ? 'bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-300'
                      : 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-gray-400'
                  }`}
                >
                  {tabCounts[tab]}
                </span>
              </button>
            ))}
          </div>

          {/* Task Table — DataTable variant.
              Preserves everything the old table did (checkbox
              toggle, important star, "from log" badge, account/
              contact chips, overdue colouring, actions) while
              adding sort/pin/hide, Attio-style column settings,
              and inline edits for subject + due date + priority.
              The expand-in-place comment row was replaced by a
              Comments modal — easier to read on narrow laptops
              and consistent with how Opportunities handles edit. */}
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 overflow-hidden">
            {filtered.length === 0 ? (
              <EmptyState
                icon="✅"
                title="No tasks in this category"
                description="Switch tabs above or create a new task to get started."
              />
            ) : (
              <TasksDataTable
                rows={filtered}
                getOwnerName={getOwnerName}
                getAccountName={getAccountName}
                getContactName={getContactName}
                onToggle={(id) => toggleTask(id)}
                onEdit={(id) => setEditTaskId(id)}
                onDelete={(id) => deleteTask(id)}
                onComment={(id) => setCommentTaskId(id)}
                onUpdate={(id, patch) => updateTask(id, patch)}
                allTasks={allTasks}
              />
            )}
          </div>
        </div>
      </main>

      {showNewTaskModal && (
        <NewTaskModal
          onClose={() => setShowNewTaskModal(false)}
          onSave={() => setToast('Task created successfully')}
        />
      )}

      {editTaskId && (() => { const t = allTasks.find((x) => x.id === editTaskId); return t ? <EditTaskModal task={t} onClose={() => setEditTaskId(null)} onSaved={() => setToast('Task updated')} /> : null; })()}

      {/* Comment modal — the old inline-expand row was replaced
          because inline comments blew up row height and made the
          surrounding table jump around every click. A dedicated
          modal keeps focus on the thread while leaving the table
          state intact underneath. */}
      {commentTaskId && (() => {
        const t = allTasks.find((x) => x.id === commentTaskId);
        if (!t) return null;
        return (
          <Modal onClose={() => setCommentTaskId(null)} size="lg">
            <Modal.Header title="Comments" subtitle={t.subject} />
            <Modal.Body>
              <CommentThread parentType="task" parentId={t.id} />
            </Modal.Body>
          </Modal>
        );
      })()}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DataTable adapter — kept in-file for proximity to the column
// defs. Same pattern as app/opportunities/page.tsx.
// ─────────────────────────────────────────────────────────────
const PRIORITY_OPTIONS = [
  { label: 'High',   value: 'High' },
  { label: 'Medium', value: 'Medium' },
  { label: 'Low',    value: 'Low' },
];
const STATUS_OPTIONS = [
  { label: 'Open',      value: 'Open' },
  { label: 'Completed', value: 'Completed' },
];

function TasksDataTable({
  rows, getOwnerName, getAccountName, getContactName,
  onToggle, onEdit, onDelete, onComment, onUpdate, allTasks: _allTasks,
}: {
  rows: Task[];
  getOwnerName: (id: string) => string;
  getAccountName: (id?: string) => string;
  getContactName: (id?: string) => string;
  onToggle: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onComment: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Task>) => void;
  allTasks: Task[];
}) {
  const columns: DataTableColumn<Task>[] = [
    {
      id: 'done', label: '', width: 44, pinned: true,
      accessor: (r) => (r.status === 'Completed' ? 1 : 0),
      render: (r) => (
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(r.id); }}
          className={`w-4 h-4 rounded border-2 transition-all flex-shrink-0 inline-flex items-center justify-center ${
            r.status === 'Completed'
              ? 'border-emerald-500 bg-emerald-500 text-white'
              : 'border-gray-300 dark:border-slate-600 hover:border-emerald-500'
          }`}
          aria-label={r.status === 'Completed' ? 'Mark open' : 'Mark complete'}
        >
          {r.status === 'Completed' && <Check className="w-3 h-3" strokeWidth={3} />}
        </button>
      ),
    },
    {
      id: 'subject', label: 'Subject', width: 320, pinned: true,
      accessor: (r) => r.subject,
      render: (r) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {r.isImportant && <span className="text-amber-500 dark:text-amber-400 shrink-0" title="Important — appears in full in Weekly Report">★</span>}
            <span className={`font-medium text-gray-800 dark:text-gray-100 ${r.status === 'Completed' ? 'line-through text-gray-400 dark:text-gray-500' : ''}`}>
              {r.subject}
            </span>
            {r.sourceActivityId && (
              <span
                className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800"
                title="Auto-created from a logged activity"
              >
                🔗 from log
              </span>
            )}
          </div>
          {r.description && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2 whitespace-pre-wrap leading-relaxed">
              {r.description}
            </p>
          )}
        </div>
      ),
      edit: { kind: 'text', onSave: (r, v) => onUpdate(r.id, { subject: v }) },
    },
    {
      id: 'related', label: 'Related To', width: 180,
      accessor: (r) => getAccountName(r.relatedAccountId) || getContactName(r.relatedContactId),
      render: (r) => {
        const acct = getAccountName(r.relatedAccountId);
        const cont = getContactName(r.relatedContactId);
        if (!acct && !cont) return <span className="text-xs text-gray-300 dark:text-gray-600">—</span>;
        return (
          <div className="min-w-0">
            {acct && (
              <Link href={`/accounts/${r.relatedAccountId}`}
                className="text-xs font-medium hover:underline block truncate"
                style={{ color: 'var(--brand)' }}
                onClick={(e) => e.stopPropagation()}>
                {acct}
              </Link>
            )}
            {cont && (
              <Link href={`/contacts/${r.relatedContactId}`}
                className="text-xs text-gray-500 dark:text-gray-400 hover:underline truncate block"
                onClick={(e) => e.stopPropagation()}>
                {cont}
              </Link>
            )}
          </div>
        );
      },
    },
    {
      id: 'dueDate', label: 'Due Date', width: 130,
      accessor: (r) => r.dueDate,
      render: (r) => {
        const isOverdue = r.dueDate < TODAY && r.status === 'Open';
        const isDueToday = r.dueDate === TODAY && r.status === 'Open';
        return (
          <span className={isOverdue ? 'text-red-600 font-medium' : isDueToday ? 'text-amber-600 font-medium' : 'text-gray-500 dark:text-gray-400'}>
            {isDueToday ? 'Today' : formatDate(r.dueDate)}{isOverdue && ' ⚠'}
          </span>
        );
      },
      edit: { kind: 'date', onSave: (r, v) => onUpdate(r.id, { dueDate: v }) },
    },
    {
      id: 'priority', label: 'Priority', width: 110,
      accessor: (r) => r.priority,
      render: (r) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${priorityStyles[r.priority] || priorityStyles.Low}`}>
          {r.priority}
        </span>
      ),
      edit: { kind: 'select', options: PRIORITY_OPTIONS, onSave: (r, v) => onUpdate(r.id, { priority: v as Task['priority'] }) },
    },
    {
      id: 'status', label: 'Status', width: 110,
      accessor: (r) => r.status,
      render: (r) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          r.status === 'Completed'
            ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
            : 'bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300'
        }`}>{r.status}</span>
      ),
      edit: { kind: 'select', options: STATUS_OPTIONS, onSave: (r, v) => onUpdate(r.id, { status: v as Task['status'] }) },
    },
    {
      id: 'owner', label: 'Owner', width: 140,
      accessor: (r) => getOwnerName(r.ownerId),
      render: (r) => <span className="text-sm text-gray-700 dark:text-gray-200">{getOwnerName(r.ownerId)}</span>,
    },
    {
      id: 'actions', label: '', width: 110, align: 'right',
      accessor: () => '',
      render: (r) => (
        <div className="flex items-center justify-end gap-0.5">
          <button onClick={(e) => { e.stopPropagation(); onComment(r.id); }}
            className="p-1 rounded text-gray-400 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-900/30" title="Comments">
            <MessageSquare className="w-3.5 h-3.5" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onEdit(r.id); }}
            className="p-1 rounded text-gray-400 hover:text-brand hover:bg-brand-tint" title="Edit">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(r.id); }}
            className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50" title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <DataTable<Task>
      tableId="tasks-list-v1"
      columns={columns}
      rows={rows}
      getRowId={(t) => t.id}
      emptyMessage="No tasks match the current filter."
    />
  );
}
