'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from '@hello-pangea/dnd';
import { Opportunity, Stage, annualizedRevenue } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import StageBadge from '@/app/components/StageBadge';
import TopBar from '@/app/components/TopBar';
import NewOpportunityModal from '@/app/components/NewOpportunityModal';
import Toast from '@/app/components/Toast';
import LoadingSpinner from '@/app/components/LoadingSpinner';
import EditOpportunityModal from '@/app/components/EditOpportunityModal';
import ViewTabs from '@/app/components/ViewTabs';
import { useViewFilter } from '@/hooks/useViewFilter';

const TODAY = new Date().toISOString().split('T')[0];
const STAGES: Stage[] = [
  'Prospect',
  'Qualified',
  'Trial Started',
  'Proposal',
  'Negotiation',
  'Closed Won',
  'Closed Lost',
];

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function daysUntil(dateStr: string): number {
  const today = new Date(TODAY);
  const close = new Date(dateStr + 'T00:00:00');
  return Math.round((close.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

const columnHeaderStyle: Record<Stage, string> = {
  Prospect: 'bg-slate-50 border-slate-200',
  Prospecting: 'bg-gray-50 border-gray-200',
  Qualified: 'bg-cyan-50 border-cyan-200',
  Qualification: 'bg-blue-50 border-blue-200',
  'Trial Started': 'bg-teal-50 border-teal-200',
  Proposal: 'bg-amber-50 border-amber-200',
  Negotiation: 'bg-purple-50 border-purple-200',
  'Closed Won': 'bg-green-100 border-green-300',
  'Closed Lost': 'bg-gray-100 border-gray-300',
};

const columnTitleStyle: Record<Stage, string> = {
  Prospect: 'text-slate-700',
  Prospecting: 'text-gray-700',
  Qualified: 'text-cyan-700',
  Qualification: 'text-blue-700',
  'Trial Started': 'text-teal-700',
  Proposal: 'text-amber-700',
  Negotiation: 'text-purple-700',
  'Closed Won': 'text-green-800',
  'Closed Lost': 'text-gray-600',
};

export default function OpportunitiesPage() {
  const { opportunities: allOpps, accounts, activities, updateOpportunityStage, deleteOpportunity, loading } = useCRM();
  const { users } = useUsers();
  const { activeView, setActiveView, filterByView, teamLabel, viewLabel, canViewCompany, canViewTeam } = useViewFilter();

  const scopedOpps = useMemo(() => filterByView(allOpps), [allOpps, activeView, filterByView]);

  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [oppList, setOppList] = useState<Opportunity[]>([]);
  const [showNewModal, setShowNewModal] = useState(false);
  const [quickAddStage, setQuickAddStage] = useState<Stage | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [toast, setToast] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editOppId, setEditOppId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Apply owner filter on top of view filter
  const filteredOpps = useMemo(() => {
    if (ownerFilter === 'all') return scopedOpps;
    return scopedOpps.filter((o) => o.ownerId === ownerFilter);
  }, [scopedOpps, ownerFilter]);

  useEffect(() => {
    setOppList([...filteredOpps]);
  }, [filteredOpps]);

  // Stats for current view
  const openOpps = filteredOpps.filter((o) => o.stage !== 'Closed Won' && o.stage !== 'Closed Lost');
  const totalPipeline = openOpps.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
  const STAGE_PROB: Record<string, number> = { Prospect: 5, Prospecting: 10, Qualified: 20, Qualification: 25, 'Trial Started': 40, Proposal: 50, Negotiation: 75, 'Closed Won': 100, 'Closed Lost': 0 };
  const weightedPipeline = openOpps.reduce((sum, o) => sum + (Number(o.amount) || 0) * ((STAGE_PROB[o.stage] || 0) / 100), 0);
  const closedWonCount = filteredOpps.filter((o) => o.stage === 'Closed Won').length;

  // Annualized revenue projection (this year + next year) — based on Expected Start Date
  const currentYear = new Date().getFullYear();
  const annualThisYear = openOpps.reduce((sum, o) => sum + annualizedRevenue(Number(o.amount) || 0, o.expectedStartDate, currentYear), 0);
  const annualNextYear = openOpps.reduce((sum, o) => sum + annualizedRevenue(Number(o.amount) || 0, o.expectedStartDate, currentYear + 1), 0);

  // Unique owners for filter dropdown
  const ownerOptions = useMemo(() => {
    const ids = [...new Set(scopedOpps.map((o) => o.ownerId))];
    return ids.map((id) => ({ id, name: users.find((u) => u.id === id)?.name || id })).sort((a, b) => a.name.localeCompare(b.name));
  }, [scopedOpps, users]);

  // Last activity per account (for deal aging)
  const lastActivityByAccount = useMemo(() => {
    const map: Record<string, string> = {};
    activities.forEach((a) => { if (!map[a.accountId] || a.date > map[a.accountId]) map[a.accountId] = a.date; });
    return map;
  }, [activities]);

  function getAccountName(accountId: string): string {
    return accounts.find((a) => a.id === accountId)?.name ?? '';
  }

  function getOwnerName(ownerId: string): string {
    const ctxUser = users.find((u) => u.id === ownerId);
    return ctxUser?.name ?? ownerId;
  }

  function getOwnerInitials(ownerId: string): string {
    const name = getOwnerName(ownerId);
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  function handleDragEnd(result: DropResult) {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const newStage = destination.droppableId as Stage;
    updateOpportunityStage(draggableId, newStage);
    setOppList((prev) => prev.map((o) => (o.id === draggableId ? { ...o, stage: newStage } : o)));
  }

  function handleOppSaved(_opp: Opportunity) {
    setToast('Opportunity created successfully');
  }

  function handleDeleteConfirm() {
    if (!confirmDeleteId) return;
    deleteOpportunity(confirmDeleteId);
    setConfirmDeleteId(null);
    setToast('Opportunity deleted');
  }

  const oppToDelete = confirmDeleteId ? oppList.find((o) => o.id === confirmDeleteId) : null;
  const columnOpps = (stage: Stage) => oppList.filter((o) => o.stage === stage);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <TopBar />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-full mx-auto">
          <div className="mt-6 mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Opportunities</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{scopedOpps.length} opportunit{scopedOpps.length !== 1 ? 'ies' : 'y'} &middot; {viewLabel}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <ViewTabs activeView={activeView} onChange={setActiveView} teamLabel={teamLabel} showCompany={canViewCompany} showTeam={canViewTeam} />
              <button
                onClick={() => setShowNewModal(true)}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#1a4731' }}
              >
                + New Opportunity
              </button>
              <div className="flex gap-1 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-lg p-1">
                <button
                  onClick={() => setView('kanban')}
                  className={`px-4 py-1.5 text-sm font-medium rounded transition-all ${
                    view === 'kanban' ? 'text-white shadow-sm' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                  style={view === 'kanban' ? { backgroundColor: '#1a4731' } : {}}
                >
                  Kanban
                </button>
                <button
                  onClick={() => setView('list')}
                  className={`px-4 py-1.5 text-sm font-medium rounded transition-all ${
                    view === 'list' ? 'text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                  style={view === 'list' ? { backgroundColor: '#1a4731' } : {}}
                >
                  List
                </button>
              </div>
            </div>
          </div>

          {/* Stats + Owner Filter */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'stretch' }}>
            <div style={{ background: '#f9fafb', borderRadius: '10px', padding: '14px 16px', flex: '1 1 120px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>OPEN DEALS</div>
              <div style={{ fontSize: '22px', fontWeight: 500 }}>{openOpps.length}</div>
            </div>
            <div style={{ background: '#f9fafb', borderRadius: '10px', padding: '14px 16px', flex: '1 1 120px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>PIPELINE</div>
              <div style={{ fontSize: '22px', fontWeight: 500 }}>{formatCurrency(totalPipeline)}</div>
            </div>
            <div style={{ background: '#f9fafb', borderRadius: '10px', padding: '14px 16px', flex: '1 1 120px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>WEIGHTED</div>
              <div style={{ fontSize: '22px', fontWeight: 500, color: '#185FA5' }}>{formatCurrency(weightedPipeline)}</div>
            </div>
            <div style={{ background: '#ecfdf5', border: '1px solid #d1fae5', borderRadius: '10px', padding: '14px 16px', flex: '1 1 130px' }} title="Sum of monthly amount × remaining months in current year, based on Expected Start Date">
              <div style={{ fontSize: '11px', color: '#047857', marginBottom: '4px', fontWeight: 600 }}>{currentYear} ANNUAL</div>
              <div style={{ fontSize: '20px', fontWeight: 500, color: '#0F6E56' }}>{formatCurrency(annualThisYear)}</div>
            </div>
            <div style={{ background: '#ecfdf5', border: '1px solid #d1fae5', borderRadius: '10px', padding: '14px 16px', flex: '1 1 130px' }} title="Sum of monthly amount × 12 for opportunities starting on or before next year">
              <div style={{ fontSize: '11px', color: '#047857', marginBottom: '4px', fontWeight: 600 }}>{currentYear + 1} ANNUAL</div>
              <div style={{ fontSize: '20px', fontWeight: 500, color: '#0F6E56' }}>{formatCurrency(annualNextYear)}</div>
            </div>
            <div style={{ background: '#f9fafb', borderRadius: '10px', padding: '14px 16px', flex: '1 1 120px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>WON</div>
              <div style={{ fontSize: '22px', fontWeight: 500, color: '#0F6E56' }}>{closedWonCount}</div>
            </div>
            {ownerOptions.length > 1 && (
              <div style={{ background: '#f9fafb', borderRadius: '10px', padding: '14px 16px', flex: '1 1 140px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>FILTER BY OWNER</div>
                <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
                  <option value="all">All Owners</option>
                  {ownerOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Kanban View */}
          {view === 'kanban' && (
            <DragDropContext onDragEnd={handleDragEnd}>
              <div className="flex gap-4 overflow-x-auto pb-4 dark:bg-slate-950">
                {STAGES.map((stage) => {
                  const stageOpps = columnOpps(stage);
                  const stageTotal = stageOpps.reduce((s, o) => s + o.amount, 0);

                  return (
                    <div key={stage} className="flex-shrink-0 w-64">
                      <div
                        className={`rounded-t-lg border-x border-t px-3 py-2.5 ${columnHeaderStyle[stage]} dark:bg-slate-800 dark:border-slate-600`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-semibold uppercase tracking-wide ${columnTitleStyle[stage]} dark:text-gray-300`}>
                            {stage}
                          </span>
                          <span className={`text-xs font-medium ${columnTitleStyle[stage]}`}>
                            {stageOpps.length}
                          </span>
                        </div>
                        {stageOpps.length > 0 && (
                          <p className={`text-xs mt-0.5 ${columnTitleStyle[stage]} opacity-70`}>
                            {formatCurrency(stageTotal)}
                          </p>
                        )}
                        {stage !== 'Closed Won' && stage !== 'Closed Lost' && (
                          <button
                            onClick={() => setQuickAddStage(stage)}
                            className={`mt-1.5 w-full text-center text-[10px] font-medium py-0.5 rounded border border-dashed opacity-60 hover:opacity-100 transition-opacity ${columnTitleStyle[stage]}`}
                            style={{ borderColor: 'currentColor' }}
                          >
                            + Quick Add
                          </button>
                        )}
                      </div>

                      <Droppable droppableId={stage}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={`min-h-24 border border-gray-200 dark:border-slate-700 rounded-b-lg p-2 space-y-2 transition-colors ${
                              snapshot.isDraggingOver ? 'bg-green-50 dark:bg-green-950/40' : 'bg-white dark:bg-slate-900'
                            }`}
                          >
                            {stageOpps.map((opp, index) => {
                              const days = daysUntil(opp.closeDate);
                              const accountName = getAccountName(opp.accountId);
                              const createdDays = opp.createdDate ? Math.floor((Date.now() - new Date(opp.createdDate + 'T00:00:00').getTime()) / 86400000) : 0;
                              const lastAct = lastActivityByAccount[opp.accountId];
                              const daysSinceAct = lastAct ? Math.floor((Date.now() - new Date(lastAct + 'T00:00:00').getTime()) / 86400000) : 999;
                              const isStale = daysSinceAct > 14;
                              return (
                                <Draggable key={opp.id} draggableId={opp.id} index={index}>
                                  {(drag, dragSnapshot) => (
                                    <div
                                      ref={drag.innerRef}
                                      {...drag.draggableProps}
                                      {...drag.dragHandleProps}
                                      className={`bg-white dark:bg-slate-800 rounded-lg border p-3 shadow-sm cursor-grab active:cursor-grabbing transition-shadow ${
                                        dragSnapshot.isDragging ? 'shadow-lg ring-2 ring-green-400' : isStale ? 'border-amber-300 dark:border-amber-700/50' : 'border-gray-200 dark:border-slate-700'
                                      }`}
                                    >
                                      <div className="flex items-start justify-between gap-1 mb-0.5">
                                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate flex-1">{accountName}</p>
                                        <div className="relative">
                                          <button
                                            onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === opp.id ? null : opp.id); }}
                                            className="p-0.5 text-gray-300 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 rounded"
                                          >
                                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                                              <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
                                            </svg>
                                          </button>
                                          {openMenuId === opp.id && (
                                            <div className="absolute right-0 top-6 w-28 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg z-10 py-1">
                                              <button onClick={() => { setEditOppId(opp.id); setOpenMenuId(null); }}
                                                className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
                                                Edit
                                              </button>
                                              <button
                                                onClick={() => { setConfirmDeleteId(opp.id); setOpenMenuId(null); }}
                                                className="w-full text-left px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                                              >
                                                Delete
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      <Link
                                        href={`/opportunities/${opp.id}`}
                                        className="text-xs font-medium hover:underline line-clamp-2 leading-tight"
                                        style={{ color: '#1a4731' }}
                                        onClick={(e) => dragSnapshot.isDragging && e.preventDefault()}
                                      >
                                        {opp.name}
                                      </Link>
                                      <div className="flex items-center justify-between mt-2">
                                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                          {formatCurrency(opp.amount)}
                                        </span>
                                        <span
                                          className={`text-xs font-medium ${
                                            days < 0
                                              ? 'text-red-600'
                                              : days < 7
                                              ? 'text-red-500'
                                              : 'text-gray-400'
                                          }`}
                                        >
                                          {days < 0
                                            ? `${Math.abs(days)}d overdue`
                                            : days === 0
                                            ? 'Due today'
                                            : `${days}d`}
                                        </span>
                                      </div>
                                      {/* Deal aging + last activity */}
                                      <div className="flex items-center gap-2 mt-1.5">
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${createdDays > 60 ? 'bg-red-50 text-red-600' : createdDays > 30 ? 'bg-amber-50 text-amber-600' : 'bg-gray-50 text-gray-500'}`}>
                                          {createdDays}d old
                                        </span>
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${isStale ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'}`}>
                                          {daysSinceAct === 999 ? 'No activity' : daysSinceAct === 0 ? 'Today' : `${daysSinceAct}d ago`}
                                        </span>
                                      </div>
                                      <div className="flex items-center justify-between mt-1">
                                        <p className="text-xs text-gray-400">
                                          Close: {formatDate(opp.closeDate)}
                                        </p>
                                        <div
                                          className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 text-[10px] font-semibold flex items-center justify-center"
                                          title={getOwnerName(opp.ownerId)}
                                        >
                                          {getOwnerInitials(opp.ownerId)}
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </Draggable>
                              );
                            })}
                            {provided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    </div>
                  );
                })}
              </div>
            </DragDropContext>
          )}

          {/* List View */}
          {view === 'list' && (
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
                    <th className="text-left px-5 py-3 font-medium text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wide">Opportunity</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wide">Account</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wide">Stage</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Amount</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wide">Close Date</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Prob %</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wide">Owner</th>
                    <th className="w-10 px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {oppList.map((opp) => {
                    const accountName = getAccountName(opp.accountId);
                    const days = daysUntil(opp.closeDate);
                    return (
                      <tr
                        key={opp.id}
                        className="border-b border-gray-50 dark:border-slate-700 hover:bg-green-50/30 dark:hover:bg-slate-800/60 transition-colors group"
                      >
                        <td className="px-5 py-3.5">
                          <Link
                            href={`/opportunities/${opp.id}`}
                            className="font-medium hover:underline"
                            style={{ color: '#1a4731' }}
                          >
                            {opp.name}
                          </Link>
                        </td>
                        <td className="px-5 py-3.5">
                          <Link
                            href={`/accounts/${opp.accountId}`}
                            className="text-gray-600 hover:underline"
                            style={{ color: '#2d6a4f' }}
                          >
                            {accountName}
                          </Link>
                        </td>
                        <td className="px-5 py-3.5">
                          <StageBadge stage={opp.stage} />
                        </td>
                        <td className="px-5 py-3.5 text-right font-medium text-gray-700">
                          {formatCurrency(opp.amount)}
                        </td>
                        <td className="px-5 py-3.5">
                          <span
                            className={`text-sm ${
                              days < 0
                                ? 'text-red-600 font-medium'
                                : days < 7
                                ? 'text-amber-600'
                                : 'text-gray-500'
                            }`}
                          >
                            {formatDate(opp.closeDate)}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right text-gray-500">{opp.probability}%</td>
                        <td className="px-5 py-3.5 text-gray-500">{getOwnerName(opp.ownerId)}</td>
                        <td className="px-5 py-3.5">
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setEditOppId(opp.id)} className="p-1 rounded text-gray-300 hover:text-blue-500 hover:bg-blue-50" aria-label="Edit">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(opp.id)}
                            className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50"
                            aria-label="Delete"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {showNewModal && (
        <NewOpportunityModal
          onClose={() => setShowNewModal(false)}
          onSave={handleOppSaved}
        />
      )}

      {quickAddStage && (
        <NewOpportunityModal
          defaultStage={quickAddStage}
          onClose={() => setQuickAddStage(null)}
          onSave={(opp) => { handleOppSaved(opp); setQuickAddStage(null); }}
        />
      )}

      {/* Confirm delete modal */}
      {confirmDeleteId && oppToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Delete Opportunity</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
              Are you sure you want to delete <strong>{oppToDelete.name}</strong>?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-slate-700 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {editOppId && (() => { const o = allOpps.find((x) => x.id === editOppId); return o ? <EditOpportunityModal opportunity={o} onClose={() => setEditOppId(null)} onSaved={() => { setToast('Opportunity updated'); setEditOppId(null); }} /> : null; })()}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
