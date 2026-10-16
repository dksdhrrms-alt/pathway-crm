'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from '@hello-pangea/dnd';
import { useRouter } from 'next/navigation';
import { Opportunity, Stage, STAGE_PROBABILITY, annualizedRevenue } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import StageBadge from '@/app/components/StageBadge';
import TopBar from '@/app/components/TopBar';
import NewOpportunityModal from '@/app/components/NewOpportunityModal';
import Toast from '@/app/components/Toast';
import LoadingSpinner from '@/app/components/LoadingSpinner';
import EditOpportunityModal from '@/app/components/EditOpportunityModal';
import ViewTabs from '@/app/components/ViewTabs';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import DataTable, { type DataTableColumn } from '@/app/components/DataTable';
import { SkeletonTable } from '@/app/components/ui/Skeleton';
import { Pencil, Trash2 } from 'lucide-react';
import { useViewFilter } from '@/hooks/useViewFilter';
import { downloadOpportunitiesWorkbook } from '@/lib/exportOpportunities';

const TODAY = new Date().toISOString().split('T')[0];
const STAGES: Stage[] = [
  'Prospect',
  'Qualified',
  'Trial Started',
  'Trial Ended',
  'Results Successful',
  'Won',
  'Stalled or Lost',
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
  Qualified: 'bg-cyan-50 border-cyan-200',
  'Trial Started': 'bg-teal-50 border-teal-200',
  'Trial Ended': 'bg-blue-50 border-blue-200',
  'Results Successful': 'bg-purple-50 border-purple-200',
  Won: 'bg-green-100 border-green-300',
  'Stalled or Lost': 'bg-gray-100 border-gray-300',
};

const columnTitleStyle: Record<Stage, string> = {
  Prospect: 'text-slate-700',
  Qualified: 'text-cyan-700',
  'Trial Started': 'text-teal-700',
  'Trial Ended': 'text-blue-700',
  'Results Successful': 'text-purple-700',
  Won: 'text-green-800',
  'Stalled or Lost': 'text-gray-600',
};

export default function OpportunitiesPage() {
  const router = useRouter();
  const { opportunities: allOpps, accounts, activities, updateOpportunityStage, updateOpportunity, deleteOpportunity, loading } = useCRM();
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
  const openOpps = filteredOpps.filter((o) => o.stage !== 'Won' && o.stage !== 'Stalled or Lost');
  const totalPipeline = openOpps.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
  // Stage → default probability. Uses the canonical STAGE_PROBABILITY
  // from lib/data.ts so we never drift from the modals again. Legacy
  // stage names (Prospecting / Qualification / Proposal / Negotiation)
  // are folded in via LEGACY_STAGE_MAP so any pre-migration rows still
  // contribute to the weighted total.
  const STAGE_PROB: Record<string, number> = {
    ...STAGE_PROBABILITY,
    Prospecting:   STAGE_PROBABILITY['Prospect'],
    Qualification: STAGE_PROBABILITY['Qualified'],
    Proposal:      STAGE_PROBABILITY['Trial Ended'],
    Negotiation:   STAGE_PROBABILITY['Results Successful'],
  };
  const weightedPipeline = openOpps.reduce((sum, o) => sum + (Number(o.amount) || 0) * ((STAGE_PROB[o.stage] || 0) / 100), 0);
  const closedWonCount = filteredOpps.filter((o) => o.stage === 'Won').length;

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

  // Loading state used to swap the entire page for a <LoadingSpinner />,
  // which hid the TopBar and made the app feel like it was reloading
  // from scratch. We now keep the chrome and render a Skeleton inside
  // the list area — matches /tasks and the Dashboard.
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
        <TopBar />
        <main className="pt-16 px-6 pb-10">
          <div className="max-w-full mx-auto">
            <div className="mt-6 mb-6">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Opportunities</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Loading pipeline…</p>
            </div>
            <SkeletonTable rows={8} cols={7} />
          </div>
        </main>
      </div>
    );
  }

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
              {/*
                Export uses *oppList* (the post-owner-filter list shown on
                screen), not the full unfiltered opportunities array.
                "Export what I see" is the least-surprising behavior — if
                a user filters to Personal + Owner=Dave and clicks Export,
                they get Dave's personal pipeline, not the company's.
                Workbook structure: see lib/exportOpportunities.ts.
              */}
              <button
                onClick={() => {
                  const today = new Date().toISOString().split('T')[0];
                  const filterTag = ownerFilter === 'all' ? '' : `-${(users.find((u) => u.id === ownerFilter)?.name ?? 'owner').replace(/\s+/g, '_')}`;
                  downloadOpportunitiesWorkbook(
                    {
                      opportunities: oppList,
                      accounts,
                      users,
                      scopeLabel: `${viewLabel}${ownerFilter !== 'all' ? ` · ${users.find((u) => u.id === ownerFilter)?.name ?? ''}` : ''}`,
                    },
                    `opportunities-pipeline-${viewLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_')}${filterTag}-${today}.xlsx`,
                  );
                }}
                className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5"
                title="Download multi-sheet Excel workbook (Summary, All Deals, By Stage, Forecast, Closed History)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export Excel
              </button>
              <button
                onClick={() => setShowNewModal(true)}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                + New Opportunity
              </button>
              <div className="flex gap-1 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-lg p-1">
                <button
                  onClick={() => setView('kanban')}
                  className={`px-4 py-1.5 text-sm font-medium rounded transition-all ${
                    view === 'kanban' ? 'text-white shadow-sm' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                  style={view === 'kanban' ? { backgroundColor: 'var(--brand)' } : {}}
                >
                  Kanban
                </button>
                <button
                  onClick={() => setView('list')}
                  className={`px-4 py-1.5 text-sm font-medium rounded transition-all ${
                    view === 'list' ? 'text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                  style={view === 'list' ? { backgroundColor: 'var(--brand)' } : {}}
                >
                  List
                </button>
              </div>
            </div>
          </div>

          {/* Stats + Owner Filter — 2 across on phone, 4 on tablet,
              7 on desktop. Dropped the inline flex-wrap scheme that
              fit 1-2 tiles per row on mobile with no clear rhythm. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-5">
            <div className="rounded-xl bg-gray-50 dark:bg-slate-800 px-4 py-3.5">
              <div className="text-[11px] text-muted-fg">OPEN DEALS</div>
              <div className="text-xl sm:text-2xl font-medium text-foreground tabular-nums">{openOpps.length}</div>
            </div>
            <div className="rounded-xl bg-gray-50 dark:bg-slate-800 px-4 py-3.5">
              <div className="text-[11px] text-muted-fg">PIPELINE</div>
              <div className="text-lg sm:text-xl font-medium text-foreground tabular-nums">{formatCurrency(totalPipeline)}</div>
            </div>
            <div className="rounded-xl bg-gray-50 dark:bg-slate-800 px-4 py-3.5">
              <div className="text-[11px] text-muted-fg">WEIGHTED</div>
              <div className="text-lg sm:text-xl font-medium tabular-nums text-sky-700 dark:text-sky-300">{formatCurrency(weightedPipeline)}</div>
            </div>
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 px-4 py-3.5"
              title="Sum of monthly amount × remaining months in current year, based on Expected Start Date">
              <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">{currentYear} ANNUAL</div>
              <div className="text-lg font-medium tabular-nums text-brand">{formatCurrency(annualThisYear)}</div>
            </div>
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 px-4 py-3.5"
              title="Sum of monthly amount × 12 for opportunities starting on or before next year">
              <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">{currentYear + 1} ANNUAL</div>
              <div className="text-lg font-medium tabular-nums text-brand">{formatCurrency(annualNextYear)}</div>
            </div>
            <div className="rounded-xl bg-gray-50 dark:bg-slate-800 px-4 py-3.5">
              <div className="text-[11px] text-muted-fg">WON</div>
              <div className="text-xl sm:text-2xl font-medium tabular-nums text-brand">{closedWonCount}</div>
            </div>
            {ownerOptions.length > 1 && (
              <div className="rounded-xl bg-gray-50 dark:bg-slate-800 px-4 py-3.5 flex flex-col justify-center col-span-2 sm:col-span-1">
                <div className="text-[11px] text-muted-fg mb-1">FILTER BY OWNER</div>
                <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}
                  className="text-xs border border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand">
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
                        {/* Quick Add is available on every column now,
                            including Won and Stalled or Lost. Sales
                            director asked for parity — sometimes reps
                            need to log a deal that landed direct-to-
                            won (no earlier stages) or a stalled deal
                            they picked up from a colleague. */}
                        <button
                          onClick={() => setQuickAddStage(stage)}
                          className={`mt-1.5 w-full text-center text-[10px] font-medium py-0.5 rounded border border-dashed opacity-60 hover:opacity-100 transition-opacity ${columnTitleStyle[stage]}`}
                          style={{ borderColor: 'currentColor' }}
                        >
                          + Quick Add
                        </button>
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
                                        className="text-xs font-medium hover:underline line-clamp-2 leading-tight text-brand dark:text-white"
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
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${createdDays > 60 ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300' : createdDays > 30 ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-gray-50 text-gray-500 dark:bg-slate-700 dark:text-gray-300'}`}>
                                          {createdDays}d old
                                        </span>
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${isStale ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-300'}`}>
                                          {daysSinceAct === 999 ? 'No activity' : daysSinceAct === 0 ? 'Today' : `${daysSinceAct}d ago`}
                                        </span>
                                      </div>
                                      <div className="flex items-center justify-between mt-1">
                                        <p className="text-xs text-gray-400">
                                          Close: {formatDate(opp.closeDate)}
                                        </p>
                                        <div
                                          className="w-6 h-6 rounded-full bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-gray-300 text-[10px] font-semibold flex items-center justify-center"
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

          {/* List View — Attio-style DataTable
              Features over the previous plain <table>:
                · click headers to sort (shift-click to multi-sort)
                · double-click a cell to inline-edit (name / amount /
                  stage / close date / probability)
                · column pin / hide / reorder via the ⚙ at the right
                  of the header, persisted to localStorage
                · click a row → opportunity detail
              Kanban stays untouched above. */}
          {view === 'list' && (
            <OpportunitiesDataTable
              rows={oppList}
              getAccountName={getAccountName}
              getOwnerName={getOwnerName}
              onRowClick={(o) => router.push(`/opportunities/${o.id}`)}
              onEdit={(id) => setEditOppId(id)}
              onDelete={(id) => setConfirmDeleteId(id)}
              onUpdate={(id, patch) => updateOpportunity(id, patch)}
              onStage={(id, s) => updateOpportunityStage(id, s)}
            />
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

      <ConfirmDialog
        open={!!(confirmDeleteId && oppToDelete)}
        title="Delete this opportunity?"
        description={
          oppToDelete ? (
            <>
              <strong>{oppToDelete.name}</strong> will be removed. This cannot be undone.
            </>
          ) : null
        }
        tone="danger"
        confirmLabel="Delete"
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={handleDeleteConfirm}
      />

      {editOppId && (() => { const o = allOpps.find((x) => x.id === editOppId); return o ? <EditOpportunityModal opportunity={o} onClose={() => setEditOppId(null)} onSaved={() => { setToast('Opportunity updated'); setEditOppId(null); }} /> : null; })()}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DataTable adapter — kept in-file for proximity to the column
// definitions. Mirrors the pattern used on the Accounts list.
// ─────────────────────────────────────────────────────────────
const STAGE_OPTIONS: { label: string; value: string }[] = STAGES.map((s) => ({ label: s, value: s }));

function OpportunitiesDataTable({
  rows, getAccountName, getOwnerName, onRowClick, onEdit, onDelete, onUpdate, onStage,
}: {
  rows: Opportunity[];
  getAccountName: (id: string) => string;
  getOwnerName: (id: string) => string;
  onRowClick: (opp: Opportunity) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Opportunity>) => void;
  onStage: (id: string, stage: Stage) => void;
}) {
  const columns: DataTableColumn<Opportunity>[] = [
    {
      id: 'name', label: 'Opportunity', pinned: true, width: 240,
      accessor: (r) => r.name,
      render: (r) => (
        <span className="font-medium text-brand dark:text-emerald-300 hover:underline">{r.name}</span>
      ),
      edit: { kind: 'text', onSave: (r, v) => onUpdate(r.id, { name: v }) },
    },
    {
      id: 'account', label: 'Account', width: 200,
      accessor: (r) => getAccountName(r.accountId),
      render: (r) => <span className="text-gray-700 dark:text-gray-200">{getAccountName(r.accountId)}</span>,
    },
    {
      id: 'stage', label: 'Stage', width: 150,
      accessor: (r) => r.stage,
      render: (r) => <StageBadge stage={r.stage} />,
      edit: {
        kind: 'select', options: STAGE_OPTIONS,
        onSave: (r, v) => onStage(r.id, v as Stage),
      },
    },
    {
      id: 'amount', label: 'Amount', width: 120, align: 'right',
      accessor: (r) => Number(r.amount) || 0,
      render: (r) => <span className="font-medium tabular-nums">{formatCurrency(Number(r.amount) || 0)}</span>,
      edit: {
        kind: 'number',
        onSave: (r, v) => onUpdate(r.id, { amount: Number(v) || 0 }),
      },
    },
    {
      id: 'closeDate', label: 'Close Date', width: 140,
      accessor: (r) => r.closeDate,
      render: (r) => {
        const days = daysUntil(r.closeDate);
        return (
          <span className={days < 0 ? 'text-red-600 font-medium' : days < 7 ? 'text-amber-600' : 'text-gray-600 dark:text-gray-300'}>
            {formatDate(r.closeDate)}
          </span>
        );
      },
      edit: { kind: 'date', onSave: (r, v) => onUpdate(r.id, { closeDate: v }) },
    },
    {
      id: 'prob', label: 'Prob %', width: 90, align: 'right',
      accessor: (r) => r.probability,
      render: (r) => <span className="tabular-nums text-gray-500">{r.probability}%</span>,
      edit: {
        kind: 'number',
        onSave: (r, v) => onUpdate(r.id, { probability: Math.max(0, Math.min(100, Number(v) || 0)) }),
      },
    },
    {
      id: 'owner', label: 'Owner', width: 150,
      accessor: (r) => getOwnerName(r.ownerId),
      render: (r) => <span className="text-gray-600 dark:text-gray-300">{getOwnerName(r.ownerId)}</span>,
    },
    {
      id: 'actions', label: '', width: 80, align: 'right',
      accessor: () => '',
      render: (r) => (
        <div className="flex items-center justify-end gap-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(r.id); }}
            className="p-1 rounded text-gray-400 hover:text-brand hover:bg-brand-tint"
            title="Edit opportunity"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(r.id); }}
            className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50"
            title="Delete opportunity"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <DataTable<Opportunity>
      tableId="opportunities-list-v1"
      columns={columns}
      rows={rows}
      getRowId={(o) => o.id}
      onRowClick={onRowClick}
      emptyMessage="No opportunities match the current filters."
    />
  );
}
