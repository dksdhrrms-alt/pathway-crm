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
import { useViewFilter } from '@/hooks/useViewFilter';

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
  High: 'bg-red-100 text-red-700',
  Medium: 'bg-amber-100 text-amber-700',
  Low: 'bg-gray-100 text-gray-600',
};

export default function TasksPage() {
  const { tasks: allTasks, accounts, contacts, toggleTask, deleteTask, loading } = useCRM();
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

  if (loading) return <LoadingSpinner />;

  const tabCounts: Record<FilterTab, number> = {
    All: taskList.length,
    'Due Today': taskList.filter((t) => t.dueDate === TODAY && t.status === 'Open').length,
    Overdue: taskList.filter((t) => t.dueDate < TODAY && t.status === 'Open').length,
    Upcoming: taskList.filter((t) => t.dueDate > TODAY && t.status === 'Open').length,
    Completed: taskList.filter((t) => t.status === 'Completed').length,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-7xl mx-auto">
          <div className="mt-6 mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Tasks</h1>
              <p className="text-sm text-gray-500 mt-0.5">{openTaskCount} open &middot; {viewLabel}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <ViewTabs activeView={activeView} onChange={setActiveView} teamLabel={teamLabel} showCompany={canViewCompany} showTeam={canViewTeam} />
              <button
                onClick={() => setShowNewTaskModal(true)}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#1a4731' }}
              >
                + New Task
              </button>
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
            <div style={{ background: '#f9fafb', borderRadius: '10px', padding: '14px 16px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>OPEN TASKS</div>
              <div style={{ fontSize: '22px', fontWeight: 500 }}>{openTaskCount}</div>
            </div>
            <div style={{ background: overdueCount > 0 ? '#FCEBEB' : '#f9fafb', borderRadius: '10px', padding: '14px 16px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>OVERDUE</div>
              <div style={{ fontSize: '22px', fontWeight: 500, color: overdueCount > 0 ? '#E24B4A' : 'inherit' }}>{overdueCount}</div>
            </div>
            <div style={{ background: dueTodayCount > 0 ? '#FAEEDA' : '#f9fafb', borderRadius: '10px', padding: '14px 16px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>DUE TODAY</div>
              <div style={{ fontSize: '22px', fontWeight: 500, color: dueTodayCount > 0 ? '#854F0B' : 'inherit' }}>{dueTodayCount}</div>
            </div>
            <div style={{ background: '#f9fafb', borderRadius: '10px', padding: '14px 16px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>COMPLETED</div>
              <div style={{ fontSize: '22px', fontWeight: 500, color: '#0F6E56' }}>{completedCount}</div>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex gap-1 mb-4 bg-white border border-gray-200 rounded-lg p-1 w-fit">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 text-sm font-medium rounded transition-all flex items-center gap-1.5 ${
                  activeTab === tab ? 'text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
                style={activeTab === tab ? { backgroundColor: '#1a4731' } : {}}
              >
                {tab}
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-full ${
                    activeTab === tab
                      ? 'bg-white/20 text-white'
                      : tab === 'Overdue' && tabCounts[tab] > 0
                      ? 'bg-red-100 text-red-600'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {tabCounts[tab]}
                </span>
              </button>
            ))}
          </div>

          {/* Task Table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                No tasks in this category.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="w-8 px-4 py-3"></th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Subject</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Related To</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Due Date</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Priority</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Owner</th>
                    <th className="w-10 px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((task) => {
                    const isOverdue = task.dueDate < TODAY && task.status === 'Open';
                    const isDueToday = task.dueDate === TODAY && task.status === 'Open';
                    const accountName = getAccountName(task.relatedAccountId);
                    const contactName = getContactName(task.relatedContactId);

                    return (<>
                      <tr
                        key={task.id}
                        className={`border-b border-gray-50 hover:bg-green-50/20 transition-colors group ${
                          task.status === 'Completed' ? 'opacity-60' : ''
                        }`}
                      >
                        <td className="px-4 py-3.5">
                          <button
                            onClick={() => toggleTask(task.id)}
                            className={`w-4 h-4 rounded border-2 transition-all flex-shrink-0 ${
                              task.status === 'Completed'
                                ? 'border-green-500 bg-green-500'
                                : 'border-gray-300 hover:border-green-500'
                            }`}
                            aria-label={task.status === 'Completed' ? 'Mark open' : 'Mark complete'}
                          >
                            {task.status === 'Completed' && (
                              <svg className="w-full h-full text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`font-medium text-gray-800 ${task.status === 'Completed' ? 'line-through text-gray-400' : ''}`}>
                            {task.subject}
                          </span>
                          {task.description && (
                            <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{task.description}</p>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <div>
                            {accountName && (
                              <Link
                                href={`/accounts/${task.relatedAccountId}`}
                                className="text-xs font-medium hover:underline block"
                                style={{ color: '#2d6a4f' }}
                              >
                                {accountName}
                              </Link>
                            )}
                            {contactName && (
                              <Link
                                href={`/contacts/${task.relatedContactId}`}
                                className="text-xs text-gray-400 hover:underline"
                              >
                                {contactName}
                              </Link>
                            )}
                            {!accountName && !contactName && (
                              <span className="text-xs text-gray-300">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`text-sm ${
                              isOverdue
                                ? 'text-red-600 font-medium'
                                : isDueToday
                                ? 'text-amber-600 font-medium'
                                : 'text-gray-500'
                            }`}
                          >
                            {isDueToday ? 'Today' : formatDate(task.dueDate)}
                            {isOverdue && ' ⚠'}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${priorityStyles[task.priority]}`}>
                            {task.priority}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              task.status === 'Completed'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-blue-50 text-blue-600'
                            }`}
                          >
                            {task.status}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className="text-sm text-gray-700">{getOwnerName(task.ownerId)}</span>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => setCommentTaskId(commentTaskId === task.id ? null : task.id)} className="p-1 rounded text-gray-300 hover:text-blue-500 hover:bg-blue-50" aria-label="Comment" title="Reply">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                            </button>
                            <button onClick={() => setEditTaskId(task.id)} className="p-1 rounded text-gray-300 hover:text-blue-500 hover:bg-blue-50" aria-label="Edit">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            </button>
                            <button onClick={() => deleteTask(task.id)} className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50" aria-label="Delete">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                      {commentTaskId === task.id && (
                        <tr className="bg-gray-50/50"><td colSpan={8} className="px-8 py-3">
                          <CommentThread parentType="task" parentId={task.id} />
                        </td></tr>
                      )}
                    </>);
                  })}
                </tbody>
              </table>
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

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
