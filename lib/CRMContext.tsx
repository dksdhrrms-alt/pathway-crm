'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Account, Contact, Opportunity, Activity, Task, Stage, AccountBudget, generateId } from './data';
import {
  dbGetAccounts, dbCreateAccount, dbUpdateAccount, dbDeleteAccounts,
  dbGetContacts, dbCreateContact, dbUpdateContact, dbDeleteContacts,
  dbGetOpportunities, dbCreateOpportunity, dbUpdateOpportunity, dbDeleteOpportunity,
  dbGetTasks, dbCreateTask, dbUpdateTask, dbDeleteTask,
  dbGetActivities, dbCreateActivity, dbDeleteActivity,
  dbGetSaleRecords, dbGetUploadHistory, dbGetAccountBudgets,
  toCamel,
} from './db';
import { supabase, supabaseEnabled } from './supabase';
import type { SaleRecord, UploadHistoryEntry } from './excelParser';
import { cacheGet, cacheSet, CACHE_KEYS } from './cache';

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

  const addAccount = (account: Account) => {
    const id = account.id || generateId();
    const full = { ...account, id };
    setAccounts((prev) => [full, ...prev]);
    dbCreateAccount(full).catch((e) => { console.error('addAccount error:', e); setAccounts((prev) => prev.filter((a) => a.id !== id)); });
  };

  const updateAccount = (id: string, updates: Partial<Account>) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)));
    dbUpdateAccount(id, updates).catch(console.error);
  };

  const addContact = (contact: Contact) => {
    const id = contact.id || generateId();
    const full = { ...contact, id };
    setContacts((prev) => [full, ...prev]);
    dbCreateContact(full).catch((e) => { console.error('addContact error:', e); setContacts((prev) => prev.filter((c) => c.id !== id)); });
  };

  const updateContact = (id: string, updates: Partial<Contact>) => {
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
    dbUpdateContact(id, updates).catch(console.error);
  };

  const addOpportunity = (opp: Opportunity) => {
    const id = opp.id || generateId();
    const full = { ...opp, id };
    setOpportunities((prev) => [full, ...prev]);
    dbCreateOpportunity(full).catch((e) => { console.error('addOpp error:', e); setOpportunities((prev) => prev.filter((o) => o.id !== id)); });
  };

  const addActivity = (act: Activity) => {
    const id = act.id || generateId();
    const full = { ...act, id };
    setActivities((prev) => [full, ...prev]);
    dbCreateActivity(full).catch(console.error);
  };

  const addTask = (task: Task) => {
    const id = task.id || generateId();
    const full = { ...task, id };
    setTasks((prev) => [full, ...prev]);
    dbCreateTask(full).catch((e) => { console.error('addTask error:', e); setTasks((prev) => prev.filter((t) => t.id !== id)); });
  };

  const updateOpportunityStage = (id: string, stage: Stage) => {
    setOpportunities((prev) => prev.map((o) => (o.id === id ? { ...o, stage } : o)));
    dbUpdateOpportunity(id, { stage }).catch(console.error);
  };

  const updateOpportunityOwner = (id: string, ownerId: string) => {
    setOpportunities((prev) => prev.map((o) => (o.id === id ? { ...o, ownerId } : o)));
    dbUpdateOpportunity(id, { ownerId } as Partial<Opportunity>).catch(console.error);
  };

  const updateTask = (id: string, updates: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
    dbUpdateTask(id, updates).catch(console.error);
  };

  const toggleTask = (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const newStatus = task.status === 'Open' ? 'Completed' as const : 'Open' as const;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t)));
    dbUpdateTask(id, { status: newStatus }).catch(console.error);
  };

  const deleteAccount = (id: string) => {
    setContacts((prev) => prev.filter((c) => c.accountId !== id));
    setOpportunities((prev) => prev.filter((o) => o.accountId !== id));
    setActivities((prev) => prev.filter((a) => a.accountId !== id));
    setTasks((prev) => prev.filter((t) => t.relatedAccountId !== id));
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    dbDeleteAccounts([id]).catch(console.error);
  };

  const deleteAccountsBulk = (ids: string[]) => {
    const idSet = new Set(ids);
    setContacts((prev) => prev.filter((c) => !idSet.has(c.accountId)));
    setOpportunities((prev) => prev.filter((o) => !idSet.has(o.accountId)));
    setActivities((prev) => prev.filter((a) => !idSet.has(a.accountId)));
    setTasks((prev) => prev.filter((t) => !idSet.has(t.relatedAccountId ?? '')));
    setAccounts((prev) => prev.filter((a) => !idSet.has(a.id)));
    dbDeleteAccounts(ids).catch(console.error);
  };

  const deleteContact = (id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
    dbDeleteContacts([id]).catch(console.error);
  };

  const deleteContactsBulk = (ids: string[]) => {
    const idSet = new Set(ids);
    setContacts((prev) => prev.filter((c) => !idSet.has(c.id)));
    dbDeleteContacts(ids).catch(console.error);
  };

  const deleteOpportunity = (id: string) => {
    setOpportunities((prev) => prev.filter((o) => o.id !== id));
    dbDeleteOpportunity(id).catch(console.error);
  };

  const deleteTask = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    dbDeleteTask(id).catch(console.error);
  };

  const deleteActivity = (id: string) => {
    setActivities((prev) => prev.filter((a) => a.id !== id));
    dbDeleteActivity(id).catch(console.error);
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
      deleteOpportunity, deleteTask, deleteActivity,
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
