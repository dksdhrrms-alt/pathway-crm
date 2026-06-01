'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Account, Contact, Opportunity, Activity, Task, Stage, AccountBudget, generateId } from './data';
import {
  dbGetAccounts, dbCreateAccount, dbUpdateAccount, dbDeleteAccounts,
  dbGetContacts, dbCreateContact, dbUpdateContact, dbDeleteContacts,
  dbGetOpportunities, dbCreateOpportunity, dbUpdateOpportunity, dbDeleteOpportunity,
  dbGetTasks, dbCreateTask, dbUpdateTask, dbDeleteTask,
  dbGetActivities, dbCreateActivity, dbDeleteActivity, dbUpdateActivity,
  dbGetSaleRecords, dbGetUploadHistory, dbGetAccountBudgets,
  toCamel,
} from './db';
import { supabase, supabaseEnabled } from './supabase';
import type { SaleRecord, UploadHistoryEntry } from './excelParser';
import { cacheGet, cacheSet, CACHE_KEYS } from './cache';

// Surface a CRUD failure to the user via the global CRMErrorToast.
//
// Why a CustomEvent and not state plumbing: every add/update/delete in
// this file runs fire-and-forget for optimistic UX. Threading a toast
// callback through React state would tightly couple this provider to
// the toast component and force every consumer to live below it. A
// window event keeps the side-channel decoupled — CRMErrorToast (mounted
// once in LayoutShell) listens and renders a Toast.
//
// The previous behavior was `console.error(...)` and that was it, which
// is how Jeff Harding's "I logged an activity yesterday but it's gone
// today" bug went unnoticed — addActivity didn't roll back and the
// failure left no user-visible trace.
function notifyCrmError(message: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('crm-error', { detail: { message } }));
  } catch {
    // CustomEvent constructor unavailable in some old environments.
    // Non-fatal — the console.error caller still gets to log.
  }
}

interface CRMContextType {
  accounts: Account[];
  contacts: Contact[];
  opportunities: Opportunity[];
  activities: Activity[];
  tasks: Task[];
  saleRecords: SaleRecord[];
  uploadHistory: UploadHistoryEntry[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  salesBudgets: any[];
  accountBudgets: AccountBudget[];
  setAccountBudgets: React.Dispatch<React.SetStateAction<AccountBudget[]>>;
  loading: boolean;
  error: string | null;
  addAccount: (account: Account) => void;
  updateAccount: (id: string, updates: Partial<Account>) => void;
  addContact: (contact: Contact) => void;
  updateContact: (id: string, updates: Partial<Contact>) => void;
  addOpportunity: (opportunity: Opportunity) => void;
  addActivity: (activity: Activity) => void;
  addTask: (task: Task) => void;
  updateOpportunityStage: (id: string, stage: Stage) => void;
  updateOpportunityOwner: (id: string, ownerId: string) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  toggleTask: (id: string) => void;
  deleteAccount: (id: string) => void;
  deleteAccountsBulk: (ids: string[]) => void;
  deleteContact: (id: string) => void;
  deleteContactsBulk: (ids: string[]) => void;
  deleteOpportunity: (id: string) => void;
  deleteTask: (id: string) => void;
  deleteActivity: (id: string) => void;
  updateActivity: (id: string, updates: Partial<Activity>) => void;
  getActivitiesForAccount: (accountId: string) => Activity[];
  getActivitiesForContact: (contactId: string) => Activity[];
  getLastActivityDate: (accountId: string) => string | null;
  setSaleRecords: React.Dispatch<React.SetStateAction<SaleRecord[]>>;
  setUploadHistory: React.Dispatch<React.SetStateAction<UploadHistoryEntry[]>>;
  refreshData: () => Promise<void>;
  // True while non-critical data (saleRecords, uploadHistory) is still
  // being fetched. Pages that don't need these (Dashboard, /accounts,
  // /contacts, /opportunities, /tasks, /activities) ignore this. Pages
  // that do (/sales, /reports, /sales-dashboard) can show a sub-loader.
  loadingExtras: boolean;
}

const CRMContext = createContext<CRMContextType | null>(null);

export function CRMProvider({ children }: { children: React.ReactNode }) {
  // ── SWR initial state from localStorage ────────────────────────────────
  // We read each table's last snapshot from localStorage synchronously in
  // the useState initializer so React's first paint already has data —
  // no spinner gate, no flash of empty UI. The background refresh below
  // then replaces these arrays with fresh rows from Supabase. This is
  // why the dashboard feels instant on the second-and-onwards cold start
  // even though the network roundtrip still takes a few seconds.
  const [accounts, setAccounts] = useState<Account[]>(() => cacheGet<Account[]>(CACHE_KEYS.accounts) ?? []);
  const [contacts, setContacts] = useState<Contact[]>(() => cacheGet<Contact[]>(CACHE_KEYS.contacts) ?? []);
  const [opportunities, setOpportunities] = useState<Opportunity[]>(() => cacheGet<Opportunity[]>(CACHE_KEYS.opportunities) ?? []);
  const [activities, setActivities] = useState<Activity[]>(() => cacheGet<Activity[]>(CACHE_KEYS.activities) ?? []);
  const [tasks, setTasks] = useState<Task[]>(() => cacheGet<Task[]>(CACHE_KEYS.tasks) ?? []);
  const [saleRecords, setSaleRecords] = useState<SaleRecord[]>(() => cacheGet<SaleRecord[]>(CACHE_KEYS.saleRecords) ?? []);
  const [uploadHistory, setUploadHistory] = useState<UploadHistoryEntry[]>(() => cacheGet<UploadHistoryEntry[]>(CACHE_KEYS.uploadHistory) ?? []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [salesBudgets, setSalesBudgets] = useState<any[]>([]);
  const [accountBudgets, setAccountBudgets] = useState<AccountBudget[]>(() => cacheGet<AccountBudget[]>(CACHE_KEYS.accountBudgets) ?? []);
  // `loading` is for the *critical* tables (accounts/contacts/opps/tasks/
  // activities). It starts false if we already have a cached snapshot —
  // the page can render its layout immediately. It only gates rendering
  // on first-ever cold start where the cache is empty.
  const [loading, setLoading] = useState<boolean>(() => {
    const haveCriticalCache =
      !!cacheGet<Account[]>(CACHE_KEYS.accounts) &&
      !!cacheGet<Opportunity[]>(CACHE_KEYS.opportunities) &&
      !!cacheGet<Task[]>(CACHE_KEYS.tasks);
    return !haveCriticalCache;
  });
  // `loadingExtras` covers the heavyweight tables (saleRecords ~4s,
  // uploadHistory ~4s). Keeping these out of `loading` is the single
  // biggest win in this whole optimization — cuts ~6s off perceived
  // cold-start time on dashboards that don't need them.
  const [loadingExtras, setLoadingExtras] = useState<boolean>(() => {
    const haveExtrasCache =
      !!cacheGet<SaleRecord[]>(CACHE_KEYS.saleRecords);
    return !haveExtrasCache;
  });
  const [error, setError] = useState<string | null>(null);

  // Two-phase load:
  //   Phase 1 (critical, blocks `loading`): the five tables every page
  //     reads on render — accounts, contacts, opportunities, tasks,
  //     activities. Run in parallel; setLoading(false) as soon as all
  //     five resolve.
  //   Phase 2 (non-critical, blocks `loadingExtras` only): saleRecords
  //     and uploadHistory — only touched by /sales and reports.
  // Budgets are best-effort; failures are swallowed because the tables
  // may not exist in older deployments.
  const loadAll = useCallback(async () => {
    setError(null);

    // ── Phase 1: critical tables in parallel ──────────────────────────
    try {
      const [accs, cons, opps, tsks, acts] = await Promise.all([
        dbGetAccounts(), dbGetContacts(), dbGetOpportunities(),
        dbGetTasks(), dbGetActivities(),
      ]);
      setAccounts(accs); cacheSet(CACHE_KEYS.accounts, accs);
      setContacts(cons); cacheSet(CACHE_KEYS.contacts, cons);
      setOpportunities(opps); cacheSet(CACHE_KEYS.opportunities, opps);
      setTasks(tsks); cacheSet(CACHE_KEYS.tasks, tsks);
      setActivities(acts); cacheSet(CACHE_KEYS.activities, acts);
    } catch (err) {
      console.error('[CRM] critical load error:', err);
      setError('Failed to load data from database.');
    } finally {
      // Always release the gate — if a critical fetch failed but we have
      // a cached snapshot, we'd rather render stale than block forever.
      setLoading(false);
    }

    // Account budgets are small and used by dashboard / accounts pages —
    // run them with the critical phase but don't block on failure.
    try {
      const ab = await dbGetAccountBudgets();
      setAccountBudgets(ab);
      cacheSet(CACHE_KEYS.accountBudgets, ab);
    } catch { /* tolerated */ }

    // ── Phase 2: non-critical tables ──────────────────────────────────
    try {
      const [sales, uploads] = await Promise.all([
        dbGetSaleRecords(), dbGetUploadHistory(),
      ]);
      setSaleRecords(sales); cacheSet(CACHE_KEYS.saleRecords, sales);
      setUploadHistory(uploads); cacheSet(CACHE_KEYS.uploadHistory, uploads);
    } catch (err) {
      console.error('[CRM] extras load error:', err);
    } finally {
      setLoadingExtras(false);
    }

    // Budgets table is optional (older deployments). Best-effort.
    try {
      const { supabase: sb } = await import('./supabase');
      const { data: budgets } = await sb.from('sales_budgets').select('*');
      setSalesBudgets(budgets || []);
    } catch { /* tolerated */ }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Supabase Realtime: cross-user live sync ─────────────────────────────
  // Without this, every browser only sees the rows it loaded at session start
  // plus its own optimistic updates. New contacts/accounts/etc. created by
  // someone else stay invisible until the page is refreshed.
  //
  // We subscribe to postgres_changes on the five mutable tables, then merge
  // each event into local state. The merge is idempotent: if the row is
  // already present (because *we* inserted it optimistically a moment ago),
  // we skip or replace instead of duplicating.
  useEffect(() => {
    if (!supabaseEnabled) return;

    type RealtimePayload<T> = { new: Record<string, unknown> | null; old: Record<string, unknown> | null; eventType: 'INSERT' | 'UPDATE' | 'DELETE' };

    function makeHandler<T extends { id: string }>(
      setter: React.Dispatch<React.SetStateAction<T[]>>
    ) {
      return (payload: RealtimePayload<T>) => {
        if (payload.eventType === 'DELETE') {
          const id = (payload.old?.id as string) || '';
          if (!id) return;
          setter((prev) => prev.filter((row) => row.id !== id));
          return;
        }
        if (!payload.new) return;
        const row = toCamel(payload.new) as unknown as T;
        if (!row.id) return;
        if (payload.eventType === 'INSERT') {
          setter((prev) => {
            // Optimistic update may already have inserted this id — dedupe.
            if (prev.some((r) => r.id === row.id)) {
              return prev.map((r) => (r.id === row.id ? { ...r, ...row } : r));
            }
            return [row, ...prev];
          });
        } else {
          // UPDATE
          setter((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...row } : r)));
        }
      };
    }

    const channel = supabase
      .channel('crm-shared-state')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'accounts' }, makeHandler<Account>(setAccounts))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'contacts' }, makeHandler<Contact>(setContacts))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'opportunities' }, makeHandler<Opportunity>(setOpportunities))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'tasks' }, makeHandler<Task>(setTasks))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'activities' }, makeHandler<Activity>(setActivities))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // eslint-disable-next-line no-console
          console.log('[CRM] Realtime subscribed');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[CRM] Realtime status:', status);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // ── CRUD with optimistic updates ────────────────────────────────────────

  // All optimistic add* helpers below follow a single failure pattern:
  //   1. console.error so we still get the underlying message in dev
  //   2. roll back the optimistic insert so the UI matches DB truth
  //   3. notifyCrmError so the user actually learns the save failed,
  //      instead of trusting a vanishing optimistic row (the bug that
  //      lost Jeff's Ron Marriott activity).
  // Update* helpers don't optimistically add new rows, but they should
  // still surface failures — otherwise edits silently revert on next
  // refresh. We accept the small "screen flickered to old value" UX
  // because the alternative (silent data loss) is much worse.

  const addAccount = (account: Account) => {
    const id = account.id || generateId();
    const full = { ...account, id };
    setAccounts((prev) => [full, ...prev]);
    dbCreateAccount(full).catch((e) => {
      console.error('addAccount error:', e);
      setAccounts((prev) => prev.filter((a) => a.id !== id));
      notifyCrmError('Failed to save account. Please try again.');
    });
  };

  const updateAccount = (id: string, updates: Partial<Account>) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)));
    dbUpdateAccount(id, updates).catch((e) => {
      console.error('updateAccount error:', e);
      notifyCrmError('Failed to update account. Your edit may not have saved.');
    });
  };

  const addContact = (contact: Contact) => {
    const id = contact.id || generateId();
    const full = { ...contact, id };
    setContacts((prev) => [full, ...prev]);
    dbCreateContact(full).catch((e) => {
      console.error('addContact error:', e);
      setContacts((prev) => prev.filter((c) => c.id !== id));
      notifyCrmError('Failed to save contact. Please try again.');
    });
  };

  const updateContact = (id: string, updates: Partial<Contact>) => {
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
    dbUpdateContact(id, updates).catch((e) => {
      console.error('updateContact error:', e);
      notifyCrmError('Failed to update contact. Your edit may not have saved.');
    });
  };

  const addOpportunity = (opp: Opportunity) => {
    const id = opp.id || generateId();
    const full = { ...opp, id };
    setOpportunities((prev) => [full, ...prev]);
    dbCreateOpportunity(full).catch((e) => {
      console.error('addOpp error:', e);
      setOpportunities((prev) => prev.filter((o) => o.id !== id));
      notifyCrmError('Failed to save opportunity. Please try again.');
    });
  };

  // FIX: addActivity used to be the only optimistic add* helper without
  // a rollback path. dbCreateActivity().catch(console.error) silently
  // swallowed failures, so a failed save left the row visible in the UI
  // until the next refresh — at which point the fresh DB fetch wiped it
  // out and the user assumed the activity had "disappeared." This is the
  // exact failure mode behind Jeff Harding's missing Ron Marriott log
  // (May 6, 2026). Now we roll back and tell the user.
  const addActivity = (act: Activity) => {
    const id = act.id || generateId();
    const full = { ...act, id };
    setActivities((prev) => [full, ...prev]);
    dbCreateActivity(full).catch((e) => {
      console.error('addActivity error:', e);
      setActivities((prev) => prev.filter((a) => a.id !== id));
      notifyCrmError('Failed to save activity. Please try again.');
    });
  };

  const addTask = (task: Task) => {
    const id = task.id || generateId();
    const full = { ...task, id };
    setTasks((prev) => [full, ...prev]);
    dbCreateTask(full).catch((e) => {
      console.error('addTask error:', e);
      setTasks((prev) => prev.filter((t) => t.id !== id));
      notifyCrmError('Failed to save task. Please try again.');
    });
  };

  const updateOpportunityStage = (id: string, stage: Stage) => {
    setOpportunities((prev) => prev.map((o) => (o.id === id ? { ...o, stage } : o)));
    dbUpdateOpportunity(id, { stage }).catch((e) => {
      console.error('updateOpportunityStage error:', e);
      notifyCrmError('Failed to update opportunity stage.');
    });
  };

  const updateOpportunityOwner = (id: string, ownerId: string) => {
    setOpportunities((prev) => prev.map((o) => (o.id === id ? { ...o, ownerId } : o)));
    dbUpdateOpportunity(id, { ownerId } as Partial<Opportunity>).catch((e) => {
      console.error('updateOpportunityOwner error:', e);
      notifyCrmError('Failed to reassign opportunity.');
    });
  };

  const updateTask = (id: string, updates: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
    dbUpdateTask(id, updates).catch((e) => {
      console.error('updateTask error:', e);
      notifyCrmError('Failed to update task. Your edit may not have saved.');
    });
  };

  const toggleTask = (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const newStatus = task.status === 'Open' ? 'Completed' as const : 'Open' as const;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t)));
    dbUpdateTask(id, { status: newStatus }).catch((e) => {
      console.error('toggleTask error:', e);
      notifyCrmError('Failed to toggle task status.');
    });
  };

  // Delete handlers: failures here mean the row is gone from the UI but
  // still in the DB — annoying (it'll reappear on refresh) but not data
  // loss. We still surface the toast so the user knows the action wasn't
  // committed and can retry rather than assuming success.
  const deleteAccount = (id: string) => {
    setContacts((prev) => prev.filter((c) => c.accountId !== id));
    setOpportunities((prev) => prev.filter((o) => o.accountId !== id));
    setActivities((prev) => prev.filter((a) => a.accountId !== id));
    setTasks((prev) => prev.filter((t) => t.relatedAccountId !== id));
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    dbDeleteAccounts([id]).catch((e) => {
      console.error('deleteAccount error:', e);
      notifyCrmError('Failed to delete account. Refresh to see the latest state.');
    });
  };

  const deleteAccountsBulk = (ids: string[]) => {
    const idSet = new Set(ids);
    setContacts((prev) => prev.filter((c) => !idSet.has(c.accountId)));
    setOpportunities((prev) => prev.filter((o) => !idSet.has(o.accountId)));
    setActivities((prev) => prev.filter((a) => !idSet.has(a.accountId)));
    setTasks((prev) => prev.filter((t) => !idSet.has(t.relatedAccountId ?? '')));
    setAccounts((prev) => prev.filter((a) => !idSet.has(a.id)));
    dbDeleteAccounts(ids).catch((e) => {
      console.error('deleteAccountsBulk error:', e);
      notifyCrmError('Failed to delete some accounts. Refresh to see the latest state.');
    });
  };

  const deleteContact = (id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
    dbDeleteContacts([id]).catch((e) => {
      console.error('deleteContact error:', e);
      notifyCrmError('Failed to delete contact. Refresh to see the latest state.');
    });
  };

  const deleteContactsBulk = (ids: string[]) => {
    const idSet = new Set(ids);
    setContacts((prev) => prev.filter((c) => !idSet.has(c.id)));
    dbDeleteContacts(ids).catch((e) => {
      console.error('deleteContactsBulk error:', e);
      notifyCrmError('Failed to delete some contacts. Refresh to see the latest state.');
    });
  };

  const deleteOpportunity = (id: string) => {
    setOpportunities((prev) => prev.filter((o) => o.id !== id));
    dbDeleteOpportunity(id).catch((e) => {
      console.error('deleteOpportunity error:', e);
      notifyCrmError('Failed to delete opportunity. Refresh to see the latest state.');
    });
  };

  const deleteTask = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    dbDeleteTask(id).catch((e) => {
      console.error('deleteTask error:', e);
      notifyCrmError('Failed to delete task. Refresh to see the latest state.');
    });
  };

  const deleteActivity = (id: string) => {
    setActivities((prev) => prev.filter((a) => a.id !== id));
    dbDeleteActivity(id).catch((e) => {
      console.error('deleteActivity error:', e);
      notifyCrmError('Failed to delete activity. Refresh to see the latest state.');
    });
  };

  /** Edit any field on an existing activity. Optimistic update — local
   *  state flips immediately so the UI never feels laggy; on DB failure
   *  we revert and surface a toast (same pattern as deleteActivity, but
   *  with a snapshot to roll back to). */
  const updateActivity = (id: string, updates: Partial<Activity>) => {
    const snapshot = activities.find((a) => a.id === id);
    setActivities((prev) => prev.map((a) => a.id === id ? { ...a, ...updates } : a));
    dbUpdateActivity(id, updates).catch((e) => {
      console.error('updateActivity error:', e);
      if (snapshot) {
        // Roll back optimistic edit.
        setActivities((prev) => prev.map((a) => a.id === id ? snapshot : a));
      }
      notifyCrmError('Failed to update activity. Your edit was reverted.');
    });
  };

  const getActivitiesForAccount = (accountId: string) =>
    activities.filter((a) => a.accountId === accountId).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const getActivitiesForContact = (contactId: string) =>
    activities.filter((a) => a.contactId === contactId).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const getLastActivityDate = (accountId: string): string | null => {
    const acts = getActivitiesForAccount(accountId);
    return acts.length > 0 ? acts[0].date : null;
  };

  return (
    <CRMContext.Provider value={{
      accounts, contacts, opportunities, activities, tasks,
      saleRecords, uploadHistory, salesBudgets, accountBudgets, setAccountBudgets, loading, loadingExtras, error,
      addAccount, updateAccount, addContact, updateContact,
      addOpportunity, addActivity, addTask,
      updateOpportunityStage, updateOpportunityOwner, updateTask, toggleTask,
      deleteAccount, deleteAccountsBulk, deleteContact, deleteContactsBulk,
      deleteOpportunity, deleteTask, deleteActivity, updateActivity,
      getActivitiesForAccount, getActivitiesForContact, getLastActivityDate,
      setSaleRecords, setUploadHistory, refreshData: loadAll,
    }}>
      {children}
    </CRMContext.Provider>
  );
}

export function useCRM(): CRMContextType {
  const ctx = useContext(CRMContext);
  if (!ctx) throw new Error('useCRM must be used within CRMProvider');
  return ctx;
}
