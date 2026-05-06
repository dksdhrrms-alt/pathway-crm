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
}

const CRMContext = createContext<CRMContextType | null>(null);

export function CRMProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [saleRecords, setSaleRecords] = useState<SaleRecord[]>([]);
  const [uploadHistory, setUploadHistory] = useState<UploadHistoryEntry[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [salesBudgets, setSalesBudgets] = useState<any[]>([]);
  const [accountBudgets, setAccountBudgets] = useState<AccountBudget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    console.log('[CRM] Loading data from Supabase...');
    setLoading(true);
    setError(null);
    try {
      const [accs, cons, opps, tsks, acts, sales, uploads] = await Promise.all([
        dbGetAccounts(), dbGetContacts(), dbGetOpportunities(),
        dbGetTasks(), dbGetActivities(), dbGetSaleRecords(), dbGetUploadHistory(),
      ]);
      // Load budgets separately (tables might not exist)
      try {
        const { supabase: sb } = await import('./supabase');
        const { data: budgets } = await sb.from('sales_budgets').select('*');
        setSalesBudgets(budgets || []);
      } catch { /* */ }
      try {
        const ab = await dbGetAccountBudgets();
        setAccountBudgets(ab);
      } catch { /* */ }
      console.log('[CRM] Loaded: accounts=' + accs.length + ' contacts=' + cons.length + ' opps=' + opps.length + ' tasks=' + tsks.length + ' activities=' + acts.length + ' sales=' + sales.length);
      setAccounts(accs);
      setContacts(cons);
      setOpportunities(opps);
      setTasks(tsks);
      setActivities(acts);
      setSaleRecords(sales);
      setUploadHistory(uploads);
    } catch (err) {
      console.error('[CRM] Supabase load error:', err);
      setError('Failed to load data from database.');
    } finally {
      setLoading(false);
    }
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
      saleRecords, uploadHistory, salesBudgets, accountBudgets, setAccountBudgets, loading, error,
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
