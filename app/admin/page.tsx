'use client';

import { useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import { UserRole, UserStatus, getRoleLabel } from '@/lib/users';
import { MENU_ITEMS, MenuItem, getUserPerms, saveUserPerms, getUserDataVisibility, saveUserDataVisibility, PermState } from '@/lib/permissions';
import TopBar from '@/app/components/TopBar';
import Toast from '@/app/components/Toast';

const TODAY = new Date().toISOString().split('T')[0];

const ASSIGNABLE_ROLES: UserRole[] = ['administrative_manager', 'admin', 'ceo', 'sales_director', 'coo', 'sales', 'marketing'];

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

type StatusFilter = 'all' | 'pending' | 'active' | 'inactive';

const statusBadge: Record<UserStatus, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-green-100 text-green-700' },
  pending: { label: 'Pending', className: 'bg-amber-100 text-amber-700' },
  inactive: { label: 'Inactive', className: 'bg-gray-100 text-gray-500' },
};

const roleColors: Record<string, string> = {
  administrative_manager: 'bg-green-100 text-green-800',
  admin: 'bg-blue-100 text-blue-800',
  ceo: 'bg-indigo-100 text-indigo-800',
  sales_director: 'bg-purple-100 text-purple-800',
  coo: 'bg-violet-100 text-violet-800',
  sales: 'bg-sky-100 text-sky-700',
  marketing: 'bg-amber-100 text-amber-700',
};

export default function AdminPage() {
  const { data: session } = useSession();
  const currentUserId = session?.user?.id ?? '';

  const { opportunities, tasks, activities, accounts, saleRecords } = useCRM();
  const { users: allUsers, updateUserById } = useUsers();

  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'permissions' | 'health'>('overview');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [toast, setToast] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const totalOpenDeals = opportunities.filter((o) => o.stage !== 'Closed Won' && o.stage !== 'Closed Lost').length;
  const totalPipeline = opportunities.filter((o) => o.stage !== 'Closed Won' && o.stage !== 'Closed Lost').reduce((s, o) => s + o.amount, 0);
  const totalOverdue = tasks.filter((t) => t.status === 'Open' && t.dueDate < TODAY).length;

  const repStats = useMemo(
    () =>
      allUsers.map((user) => {
        const userOpps = opportunities.filter((o) => o.ownerId === user.id);
        const userTasks = tasks.filter((t) => t.ownerId === user.id);
        const userActs = activities.filter((a) => a.ownerId === user.id);
        const openDeals = userOpps.filter((o) => o.stage !== 'Closed Won' && o.stage !== 'Closed Lost').length;
        const pipelineValue = userOpps.filter((o) => o.stage !== 'Closed Won' && o.stage !== 'Closed Lost').reduce((s, o) => s + o.amount, 0);
        const openTaskCount = userTasks.filter((t) => t.status === 'Open').length;
        const overdueTaskCount = userTasks.filter((t) => t.status === 'Open' && t.dueDate < TODAY).length;
        const sortedActs = [...userActs].sort((a, b) => b.date.localeCompare(a.date));
        const lastActivity = sortedActs.length > 0 ? sortedActs[0].date : null;
        return { user, openDeals, pipelineValue, openTaskCount, overdueTaskCount, lastActivity };
      }),
    [allUsers, opportunities, tasks, activities]
  );

  const pendingCount = allUsers.filter((u) => u.status === 'pending').length;

  // Sales records whose account name doesn't match any CRM Account
  const orphanSalesAccounts = useMemo(() => {
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,'"&()]/g, '');
    const acctSet = new Set(accounts.map((a) => norm(a.name)));
    const acctNorms = accounts.map((a) => ({ id: a.id, name: a.name, n: norm(a.name) }));
    const map = new Map<string, { name: string; recordCount: number; totalAmount: number; lastDate: string; suggestion: string | null }>();
    for (const r of saleRecords) {
      const raw = (r.accountName || '').trim();
      if (!raw) continue;
      const n = norm(raw);
      if (acctSet.has(n)) continue;
      // Fuzzy suggestion: find an account whose normalized name shares the longest prefix
      let suggestion: string | null = null;
      let bestLen = 0;
      for (const a of acctNorms) {
        if (n.includes(a.n) || a.n.includes(n)) {
          const overlap = Math.min(n.length, a.n.length);
          if (overlap > bestLen && overlap >= 4) { bestLen = overlap; suggestion = a.name; }
        }
      }
      const existing = map.get(n);
      if (existing) {
        existing.recordCount += 1;
        existing.totalAmount += r.amount || 0;
        if (r.date > existing.lastDate) existing.lastDate = r.date;
      } else {
        map.set(n, { name: raw, recordCount: 1, totalAmount: r.amount || 0, lastDate: r.date || '', suggestion });
      }
    }
    return [...map.values()].sort((a, b) => b.totalAmount - a.totalAmount);
  }, [saleRecords, accounts]);

  const orphanCount = orphanSalesAccounts.length;
  const orphanTotalAmount = orphanSalesAccounts.reduce((s, o) => s + o.totalAmount, 0);
  const orphanRecordCount = orphanSalesAccounts.reduce((s, o) => s + o.recordCount, 0);

  const filteredUsers = useMemo(() => {
    if (statusFilter === 'all') return allUsers;
    return allUsers.filter((u) => u.status === statusFilter);
  }, [allUsers, statusFilter]);

  function handleRoleChange(userId: string, newRole: UserRole, userName: string) {
    updateUserById(userId, { role: newRole });
    setToast(`${userName}'s role updated to ${getRoleLabel(newRole)}`);
  }

  function handleStatusChange(userId: string, newStatus: UserStatus) {
    updateUserById(userId, { status: newStatus });
  }

  const [showDeleteUser, setShowDeleteUser] = useState<{ id: string; name: string } | null>(null);
  const [showCreateUser, setShowCreateUser] = useState(false);

  async function handleRemoveUser(userId: string, userName: string) {
    setShowDeleteUser({ id: userId, name: userName });
  }

  async function confirmDeleteUser() {
    if (!showDeleteUser) return;
    try {
      const { dbDeleteUser } = await import('@/lib/db');
      await dbDeleteUser(showDeleteUser.id);
      // Also remove from context
      updateUserById(showDeleteUser.id, { status: 'inactive' });
      // Force remove from local state
      setToast(`${showDeleteUser.name} has been permanently deleted`);
    } catch { setToast('Failed to delete user'); }
    setShowDeleteUser(null);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-7xl mx-auto">
          <div className="mt-6 mb-6">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Admin Panel</h1>
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold text-white bg-purple-600">Admin</span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              Pathway Intermediates USA · Signed in as {session?.user?.name}
            </p>
          </div>

          {/* Seed Database */}
          <div className="mb-6 bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Seed Database</p>
              <p className="text-xs text-gray-500">Populate Supabase with demo data (only works if tables are empty)</p>
            </div>
            <button
              onClick={async () => {
                setSeeding(true);
                try {
                  const res = await fetch('/api/seed', { method: 'POST' });
                  const data = await res.json();
                  setToast(data.message);
                } catch {
                  setToast('Failed to seed database.');
                } finally {
                  setSeeding(false);
                }
              }}
              disabled={seeding}
              className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
              style={{ backgroundColor: '#1a4731' }}
            >
              {seeding ? 'Seeding...' : 'Seed Database'}
            </button>
          </div>

          {/* Migrate Passwords */}
          <div className="mb-6 bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Secure Passwords</p>
              <p className="text-xs text-gray-500">Hash all plain-text passwords with bcrypt (one-time migration)</p>
            </div>
            <button
              onClick={async () => {
                try {
                  const res = await fetch('/api/admin/migrate-passwords', { method: 'POST' });
                  const data = await res.json();
                  setToast(data.message || data.error);
                } catch { setToast('Migration failed.'); }
              }}
              className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Migrate Passwords
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'overview' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Team Overview
            </button>
            <button
              onClick={() => setActiveTab('users')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                activeTab === 'users' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              User Management
              {pendingCount > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {pendingCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('permissions')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'permissions' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              User Permissions
            </button>
            <button
              onClick={() => setActiveTab('health')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                activeTab === 'health' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Data Health
              {orphanCount > 0 && (
                <span className="bg-amber-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {orphanCount}
                </span>
              )}
            </button>
          </div>

          {activeTab === 'overview' && (
            <>
              {/* Company totals */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Open Deals</p>
                  <p className="text-3xl font-bold text-gray-900 mt-1">{totalOpenDeals}</p>
                  <p className="text-xs text-gray-400 mt-1">Across all reps</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Pipeline</p>
                  <p className="text-3xl font-bold mt-1" style={{ color: '#1a4731' }}>{formatCurrency(totalPipeline)}</p>
                  <p className="text-xs text-gray-400 mt-1">Sum of open deal values</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Overdue Tasks</p>
                  <p className={`text-3xl font-bold mt-1 ${totalOverdue > 0 ? 'text-red-600' : 'text-gray-900'}`}>{totalOverdue}</p>
                  <p className="text-xs text-gray-400 mt-1">Past due, still open</p>
                </div>
              </div>

              {/* Team table */}
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h2 className="text-base font-semibold text-gray-900">Team Overview</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{allUsers.length} users</p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">User</th>
                      <th className="text-left px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Role</th>
                      <th className="text-right px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Open Deals</th>
                      <th className="text-right px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Pipeline Value</th>
                      <th className="text-right px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Open Tasks</th>
                      <th className="text-right px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Overdue</th>
                      <th className="text-left px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Last Activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repStats.map(({ user, openDeals, pipelineValue, overdueTaskCount, openTaskCount, lastActivity }) => {
                      const isCurrentUser = user.id === currentUserId;
                      return (
                        <tr key={user.id} className={`border-b border-gray-50 transition-colors ${isCurrentUser ? 'bg-green-50/40' : 'hover:bg-gray-50/60'}`}>
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 overflow-hidden"
                                style={{ backgroundColor: user.profilePhoto ? 'transparent' : '#1a4731' }}
                              >
                                {user.profilePhoto ? (
                                  <img src={user.profilePhoto} alt={user.name} className="w-8 h-8 object-cover" />
                                ) : (
                                  getInitials(user.name)
                                )}
                              </div>
                              <div>
                                <p className="font-medium text-gray-900">
                                  {user.name}
                                  {isCurrentUser && <span className="ml-1.5 text-xs text-gray-400">(you)</span>}
                                </p>
                                <p className="text-xs text-gray-400">{user.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${roleColors[user.role] ?? 'bg-gray-100 text-gray-600'}`}>
                              {getRoleLabel(user.role)}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-right">
                            <span className={`font-semibold ${openDeals > 0 ? 'text-gray-900' : 'text-gray-400'}`}>{openDeals}</span>
                          </td>
                          <td className="px-5 py-4 text-right">
                            <span className="font-medium" style={{ color: pipelineValue > 0 ? '#1a4731' : '#9ca3af' }}>
                              {pipelineValue > 0 ? formatCurrency(pipelineValue) : '—'}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-right text-gray-600">{openTaskCount}</td>
                          <td className="px-5 py-4 text-right">
                            <span className={`font-medium ${overdueTaskCount > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                              {overdueTaskCount > 0 ? overdueTaskCount : '—'}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-gray-500">{formatDate(lastActivity)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {activeTab === 'users' && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">User Management</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{allUsers.length} users</p>
                </div>
                <button onClick={() => setShowCreateUser(true)} className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90" style={{ backgroundColor: '#1a4731' }}>
                  + Create User
                </button>
              </div>

              {/* Status filter tabs */}
              <div className="flex gap-1 px-4 py-3 border-b border-gray-100 bg-gray-50">
                {(['all', 'pending', 'active', 'inactive'] as StatusFilter[]).map((f) => {
                  const count = f === 'all' ? allUsers.length : allUsers.filter((u) => u.status === f).length;
                  return (
                    <button
                      key={f}
                      onClick={() => setStatusFilter(f)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                        statusFilter === f ? 'bg-white text-gray-900 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                      {f === 'pending' && count > 0 ? (
                        <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none">
                          {count}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">({count})</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">User</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Phone</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Team</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Role</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Status</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => {
                    const isCurrentUser = user.id === currentUserId;
                    const badge = statusBadge[user.status];
                    return (
                      <tr key={user.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 overflow-hidden"
                              style={{ backgroundColor: user.profilePhoto ? 'transparent' : '#1a4731' }}
                            >
                              {user.profilePhoto ? (
                                <img src={user.profilePhoto} alt={user.name} className="w-9 h-9 object-cover" />
                              ) : (
                                getInitials(user.name)
                              )}
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">
                                {user.name}
                                {isCurrentUser && <span className="ml-1.5 text-xs text-gray-400">(you)</span>}
                              </p>
                              <p className="text-xs text-gray-400">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-gray-500 text-xs">{user.phone || '—'}</td>
                        <td className="px-5 py-4">
                          <select value={(user as { team?: string }).team || ''} onChange={async (e) => {
                            const newTeam = e.target.value;
                            updateUserById(user.id, { team: newTeam } as Partial<Pick<import('@/lib/users').AppUser, 'role' | 'status' | 'name' | 'phone' | 'profilePhoto'>>);
                            try {
                              const { createClient } = await import('@supabase/supabase-js');
                              const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');
                              await sb.from('users').update({ team: newTeam }).eq('id', user.id);
                              setToast(`${user.name}'s team updated`);
                            } catch { setToast('Failed to update team'); }
                          }} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
                            <option value="">— No team —</option>
                            <option value="monogastrics">Monogastrics</option>
                            <option value="swine">↳ Swine</option>
                            <option value="ruminants">Ruminants</option>
                            <option value="latam">LATAM</option>
                            <option value="familyb2b">Family / B2B</option>
                            <option value="marketing">Marketing</option>
                            <option value="management">Management</option>
                          </select>
                        </td>
                        <td className="px-5 py-4">
                          <select
                            value={user.role}
                            onChange={(e) => handleRoleChange(user.id, e.target.value as UserRole, user.name)}
                            disabled={isCurrentUser}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed bg-white"
                          >
                            {ASSIGNABLE_ROLES.map((r) => (
                              <option key={r} value={r}>{getRoleLabel(r)}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {user.status === 'pending' && (
                              <button
                                onClick={() => handleStatusChange(user.id, 'active')}
                                className="text-xs px-2.5 py-1 rounded-lg bg-green-100 text-green-700 font-medium hover:bg-green-200 transition-colors"
                              >
                                Activate
                              </button>
                            )}
                            {user.status === 'active' && !isCurrentUser && (
                              <button
                                onClick={() => handleStatusChange(user.id, 'inactive')}
                                className="text-xs px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 font-medium hover:bg-gray-200 transition-colors"
                              >
                                Deactivate
                              </button>
                            )}
                            {user.status === 'inactive' && (
                              <button
                                onClick={() => handleStatusChange(user.id, 'active')}
                                className="text-xs px-2.5 py-1 rounded-lg bg-green-100 text-green-700 font-medium hover:bg-green-200 transition-colors"
                              >
                                Reactivate
                              </button>
                            )}
                            {!isCurrentUser && (
                              <button
                                onClick={() => handleRemoveUser(user.id, user.name)}
                                className="text-xs px-2.5 py-1 rounded-lg bg-red-50 text-red-600 font-medium hover:bg-red-100 transition-colors"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredUsers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-sm text-gray-400">
                        No users match this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'permissions' && (
            <UserPermissionsPanel users={allUsers} onSave={(msg) => setToast(msg)} />
          )}

          {activeTab === 'health' && (
            <div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Orphan Account Names</p>
                  <p className={`text-3xl font-bold mt-1 ${orphanCount > 0 ? 'text-amber-600' : 'text-gray-900'}`}>{orphanCount}</p>
                  <p className="text-xs text-gray-400 mt-1">In sales data but not in CRM</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Sales Records Affected</p>
                  <p className="text-3xl font-bold text-gray-900 mt-1">{orphanRecordCount.toLocaleString()}</p>
                  <p className="text-xs text-gray-400 mt-1">Of {saleRecords.length.toLocaleString()} total</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Unattributed Revenue</p>
                  <p className="text-3xl font-bold mt-1" style={{ color: orphanTotalAmount > 0 ? '#b45309' : '#1a4731' }}>{formatCurrency(orphanTotalAmount)}</p>
                  <p className="text-xs text-gray-400 mt-1">Not linked to any account</p>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h2 className="text-base font-semibold text-gray-900">Sales Data Without CRM Account</h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {orphanCount === 0
                      ? 'All sales records are linked to a CRM Account. ✓'
                      : `${orphanCount} unique account name${orphanCount > 1 ? 's' : ''} in sales data have no matching CRM Account. Create the missing accounts to attribute their revenue properly.`}
                  </p>
                </div>
                {orphanCount > 0 ? (
                  <div className="overflow-x-auto" style={{ maxHeight: 600 }}>
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-gray-50">
                        <tr className="border-b border-gray-100">
                          <th className="text-left px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Account Name (from Sales)</th>
                          <th className="text-right px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Records</th>
                          <th className="text-right px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Total Revenue</th>
                          <th className="text-left px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Last Sale</th>
                          <th className="text-left px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Possible Match?</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orphanSalesAccounts.map((o, i) => (
                          <tr key={i} className="border-b border-gray-50 hover:bg-amber-50/30 transition-colors">
                            <td className="px-5 py-3">
                              <p className="font-medium text-gray-900">{o.name}</p>
                            </td>
                            <td className="px-5 py-3 text-right text-gray-700 font-medium">{o.recordCount.toLocaleString()}</td>
                            <td className="px-5 py-3 text-right font-semibold" style={{ color: '#1a4731' }}>{formatCurrency(o.totalAmount)}</td>
                            <td className="px-5 py-3 text-sm text-gray-500">{formatDate(o.lastDate)}</td>
                            <td className="px-5 py-3">
                              {o.suggestion ? (
                                <span className="text-xs">
                                  <span className="text-gray-400">Did you mean </span>
                                  <span className="font-medium text-blue-700">{o.suggestion}</span>
                                  <span className="text-gray-400">?</span>
                                </span>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-6 py-12 text-center">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 mb-3">
                      <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    </div>
                    <p className="text-sm font-medium text-gray-900">All clear!</p>
                    <p className="text-xs text-gray-500 mt-1">Every sales record is linked to a known CRM Account.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Delete User Confirmation */}
      {showDeleteUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Delete User Permanently</h2>
            <p className="text-sm text-gray-600 mb-4">Are you sure you want to permanently delete <strong>{showDeleteUser.name}</strong>? This will remove their account from the system completely. This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowDeleteUser(null)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
              <button onClick={confirmDeleteUser} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">Delete Permanently</button>
            </div>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {showCreateUser && (
        <CreateUserModal onClose={() => setShowCreateUser(false)} onCreated={(name) => { setShowCreateUser(false); setToast(`${name} account created successfully`); }} />
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

// ── User Permissions Panel ──────────────────────────────────────────────────

function UserPermissionsPanel({ users, onSave }: { users: import('@/lib/users').AppUser[]; onSave: (msg: string) => void }) {
  const [search, setSearch] = useState('');
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [userPerms, setUserPerms] = useState(() => getUserPerms());
  const [dataVis, setDataVis] = useState(() => getUserDataVisibility());

  const filteredUsers = users.filter((u) =>
    !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
  );

  function cyclePerm(userId: string, menu: string) {
    const current = userPerms[userId]?.[menu] ?? 'default';
    const next: PermState = current === 'default' ? 'allow' : current === 'allow' ? 'deny' : 'default';
    setUserPerms((prev) => ({
      ...prev,
      [userId]: { ...(prev[userId] ?? {}), [menu]: next },
    }));
  }

  async function saveForUser(userId: string, userName: string) {
    console.log('SAVE CLICKED - userId:', userId, 'perms:', JSON.stringify(userPerms[userId]));
    // Save to localStorage as backup
    saveUserPerms(userPerms);
    saveUserDataVisibility(dataVis);

    // Save to Supabase directly
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
      );

      // Delete existing
      const { error: delErr } = await sb.from('user_permissions').delete().eq('user_id', userId);
      console.log('[PERMS] Delete existing for', userId, 'error:', delErr);

      // Insert non-default permissions
      const toInsert = Object.entries(userPerms[userId] || {})
        .filter(([, perm]) => perm !== 'default')
        .map(([menuItem, permission]) => ({ user_id: userId, menu_item: menuItem.toLowerCase().replace(/ /g, '_'), permission }));

      console.log('[PERMS] Inserting', toInsert.length, 'rows:', toInsert);

      if (toInsert.length > 0) {
        const { error: insErr } = await sb.from('user_permissions').insert(toInsert);
        console.log('[PERMS] Insert error:', insErr);
      }
    } catch (e) { console.error('[PERMS] Failed:', e); }

    onSave(`Permissions updated for ${userName}`);
  }

  const overrideCount = (userId: string) => {
    const perms = userPerms[userId];
    if (!perms) return 0;
    return Object.values(perms).filter((v) => v !== 'default').length;
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">User Permissions</h2>
        <p className="text-xs text-gray-500 mt-0.5">Grant or restrict menu access for each individual user. Individual permissions override role defaults.</p>
      </div>

      <div className="mb-4">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users..."
          className="w-64 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
      </div>

      <div className="space-y-2">
        {filteredUsers.map((user) => {
          const isExpanded = expandedUserId === user.id;
          const count = overrideCount(user.id);
          return (
            <div key={user.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <button onClick={() => setExpandedUserId(isExpanded ? null : user.id)}
                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors text-left">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                  style={{ backgroundColor: '#1a4731' }}>
                  {user.initials || user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-900">{user.name}</span>
                  <span className="ml-2 text-xs text-gray-400">{user.email}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColors[user.role] ?? 'bg-gray-100 text-gray-600'}`}>
                  {getRoleLabel(user.role)}
                </span>
                {count > 0 && <span className="text-xs text-amber-600 font-medium">{count} override{count > 1 ? 's' : ''}</span>}
                <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isExpanded && (
                <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/50">
                  {/* Permission grid */}
                  <div className="overflow-x-auto mb-4">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-gray-200">
                        {MENU_ITEMS.map((m) => <th key={m} className="text-center px-2 py-1.5 font-medium text-gray-500 whitespace-nowrap">{m}</th>)}
                      </tr></thead>
                      <tbody><tr>
                        {MENU_ITEMS.map((menu) => {
                          const perm = (userPerms[user.id]?.[menu] ?? 'default') as PermState;
                          return (
                            <td key={menu} className="text-center px-2 py-2">
                              <button onClick={() => cyclePerm(user.id, menu)}
                                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                                  perm === 'allow' ? 'bg-green-100 text-green-700' :
                                  perm === 'deny' ? 'bg-red-100 text-red-600' :
                                  'bg-gray-100 text-gray-500'
                                }`}>
                                {perm === 'allow' ? '✓ Allow' : perm === 'deny' ? '✗ Deny' : '— Default'}
                              </button>
                            </td>
                          );
                        })}
                      </tr></tbody>
                    </table>
                  </div>

                  {/* Data visibility */}
                  <div className="flex items-center gap-4 mb-4">
                    <span className="text-xs font-medium text-gray-700">Data visibility:</span>
                    {(['default', 'own', 'all'] as const).map((v) => (
                      <label key={v} className="flex items-center gap-1 text-xs text-gray-600">
                        <input type="radio" name={`vis-${user.id}`} checked={(dataVis[user.id] ?? 'default') === v}
                          onChange={() => setDataVis((prev) => ({ ...prev, [user.id]: v }))}
                          className="text-green-600" />
                        {v === 'default' ? 'Role default' : v === 'own' ? 'Own data only' : 'All data'}
                      </label>
                    ))}
                  </div>

                  <button onClick={() => saveForUser(user.id, user.name)}
                    className="px-4 py-1.5 text-xs font-medium text-white rounded-lg hover:opacity-90" style={{ backgroundColor: '#1a4731' }}>
                    Save permissions for {user.name}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Create User Modal ──────────────────────────────────────────────────────

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('sales');
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Name is required';
    if (!email.trim()) errs.email = 'Email is required';
    if (!password) errs.password = 'Password is required';
    else if (password.length < 8) errs.password = 'Min 8 characters';
    if (password !== confirmPw) errs.confirmPw = 'Passwords do not match';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    try {
      const res = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim().toLowerCase(), password, phone: phone.trim(), role }),
      });
      const data = await res.json();
      if (!res.ok) { setErrors({ email: data.error || 'Failed to create user' }); setSaving(false); return; }
      onCreated(name.trim());
    } catch { setErrors({ email: 'Network error' }); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Create New User</h2>
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
            <div className="relative">
              <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 8 characters"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 pr-10" />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">{showPw ? 'Hide' : 'Show'}</button>
            </div>
            {errors.password && <p className="text-xs text-red-600 mt-1">{errors.password}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password *</label>
            <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            {errors.confirmPw && <p className="text-xs text-red-600 mt-1">{errors.confirmPw}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (555) 000-0000" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
              {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{getRoleLabel(r)}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: '#1a4731' }}>
              {saving ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
