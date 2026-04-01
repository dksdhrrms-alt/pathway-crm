import { supabase, supabaseEnabled } from './supabase';
import type { Account, Contact, Opportunity, Activity, Task } from './data';
import type { AppUser } from './users';
import type { SaleRecord, UploadHistoryEntry } from './excelParser';
import type { BudgetEntry } from './budgetStore';

// ── snake_case ↔ camelCase helpers ──────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SNAKE_OVERRIDES: Record<string, string> = {
  linkedIn: 'linked_in', customerPO: 'customer_po', poNumber: 'po_number',
  isKeyMan: 'is_key_man', profilePhoto: 'profile_photo',
  contactIds: 'contact_ids', opportunityIds: 'opportunity_ids',
  annualRevenue: 'annual_revenue', ownerName: 'owner_name', ownerId: 'owner_id',
  accountId: 'account_id', accountName: 'account_name', firstName: 'first_name',
  lastName: 'last_name', closeDate: 'close_date', nextStep: 'next_step',
  leadSource: 'lead_source', createdDate: 'created_date', createdAt: 'created_at',
  dueDate: 'due_date', relatedAccountId: 'related_account_id',
  relatedContactId: 'related_contact_id', relatedOpportunityId: 'related_opportunity_id',
  contactId: 'contact_id', productName: 'product_name', volumeKg: 'volume_kg',
  unitPrice: 'unit_price', paymentDue: 'payment_due', paymentStatus: 'payment_status',
  uploadBatchId: 'upload_batch_id', uploadedAt: 'uploaded_at', uploadedBy: 'uploaded_by',
  fileName: 'file_name', recordCount: 'record_count', skippedCount: 'skipped_count',
  budgetAmount: 'budget_amount',
};

const CAMEL_OVERRIDES: Record<string, string> = {};
for (const [camel, snake] of Object.entries(SNAKE_OVERRIDES)) CAMEL_OVERRIDES[snake] = camel;

function toSnake(obj: any): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    r[SNAKE_OVERRIDES[k] || k] = v;
  }
  return r;
}

function toCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (CAMEL_OVERRIDES[k]) { r[CAMEL_OVERRIDES[k]] = v; continue; }
    const ck = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    r[ck] = v;
  }
  return r;
}

function mapRows<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map((r) => toCamel(r) as T);
}

function genId(): string {
  return Math.random().toString(36).substring(2, 9);
}

// ── Users ───────────────────────────────────────────────────────────────────

export async function dbGetUsers(): Promise<AppUser[]> {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabase.from('users').select('*').order('name').range(0, 9999);
  if (error) throw error;
  return mapRows<AppUser>(data || []);
}

export async function dbGetUserByEmail(email: string): Promise<AppUser | null> {
  if (!supabaseEnabled) return null;
  const { data, error } = await supabase.from('users').select('*').eq('email', email.toLowerCase().trim()).single();
  if (error || !data) return null;
  return toCamel(data) as unknown as AppUser;
}

export async function dbCreateUser(user: Omit<AppUser, 'id'>): Promise<AppUser> {
  const id = genId();
  const row = { id, ...toSnake(user) };
  const { data, error } = await supabase.from('users').insert(row).select().single();
  if (error) throw error;
  return toCamel(data) as unknown as AppUser;
}

export async function dbUpdateUser(id: string, updates: Partial<AppUser>): Promise<void> {
  if (!supabaseEnabled) return;
  const { error } = await supabase.from('users').update(toSnake(updates)).eq('id', id);
  if (error) throw error;
}

export async function dbDeleteUser(id: string): Promise<void> {
  if (!supabaseEnabled) return;
  const { error } = await supabase.from('users').delete().eq('id', id);
  if (error) throw error;
}

// ── Accounts ────────────────────────────────────────────────────────────────

export async function dbGetAccounts(): Promise<Account[]> {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabase.from('accounts').select('*').order('name').range(0, 9999);
  if (error) throw error;
  return mapRows<Account>(data || []);
}

export async function dbCreateAccount(acct: Account): Promise<Account> {
  const row = toSnake(acct);
  const { data, error } = await supabase.from('accounts').insert(row).select().single();
  if (error) throw error;
  return toCamel(data) as unknown as Account;
}

export async function dbUpdateAccount(id: string, updates: Partial<Account>): Promise<void> {
  if (!supabaseEnabled) return;
  const { error } = await supabase.from('accounts').update(toSnake(updates)).eq('id', id);
  if (error) throw error;
}

export async function dbDeleteAccounts(ids: string[]): Promise<void> {
  if (!supabaseEnabled || ids.length === 0) return;
  for (const id of ids) {
    await supabase.from('contacts').delete().eq('account_id', id);
    await supabase.from('opportunities').delete().eq('account_id', id);
    await supabase.from('activities').delete().eq('account_id', id);
    await supabase.from('tasks').delete().eq('related_account_id', id);
  }
  const { error } = await supabase.from('accounts').delete().in('id', ids);
  if (error) throw error;
}

// ── Contacts ────────────────────────────────────────────────────────────────

export async function dbGetContacts(): Promise<Contact[]> {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabase.from('contacts').select('*').order('first_name').range(0, 9999);
  if (error) throw error;
  return mapRows<Contact>(data || []);
}

export async function dbCreateContact(contact: Contact): Promise<Contact> {
  const row = toSnake(contact);
  const { data, error } = await supabase.from('contacts').insert(row).select().single();
  if (error) throw error;
  return toCamel(data) as unknown as Contact;
}

export async function dbUpdateContact(id: string, updates: Partial<Contact>): Promise<void> {
  if (!supabaseEnabled) return;
  const { error } = await supabase.from('contacts').update(toSnake(updates)).eq('id', id);
  if (error) throw error;
}

export async function dbDeleteContacts(ids: string[]): Promise<void> {
  if (!supabaseEnabled || ids.length === 0) return;
  const { error } = await supabase.from('contacts').delete().in('id', ids);
  if (error) throw error;
}

// ── Opportunities ───────────────────────────────────────────────────────────

export async function dbGetOpportunities(): Promise<Opportunity[]> {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabase.from('opportunities').select('*').order('created_date', { ascending: false }).range(0, 9999);
  if (error) throw error;
  return mapRows<Opportunity>(data || []);
}

export async function dbCreateOpportunity(opp: Opportunity): Promise<Opportunity> {
  const row = toSnake(opp);
  const { data, error } = await supabase.from('opportunities').insert(row).select().single();
  if (error) throw error;
  return toCamel(data) as unknown as Opportunity;
}

export async function dbUpdateOpportunity(id: string, updates: Partial<Opportunity>): Promise<void> {
  if (!supabaseEnabled) return;
  const { error } = await supabase.from('opportunities').update(toSnake(updates)).eq('id', id);
  if (error) throw error;
}

export async function dbDeleteOpportunity(id: string): Promise<void> {
  if (!supabaseEnabled) return;
  const { error } = await supabase.from('opportunities').delete().eq('id', id);
  if (error) throw error;
}

// ── Tasks ───────────────────────────────────────────────────────────────────

export async function dbGetTasks(): Promise<Task[]> {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabase.from('tasks').select('*').order('due_date').range(0, 9999);
  if (error) throw error;
  return mapRows<Task>(data || []);
}

export async function dbCreateTask(task: Task): Promise<Task> {
  const row = toSnake(task);
  const { data, error } = await supabase.from('tasks').insert(row).select().single();
  if (error) throw error;
  return toCamel(data) as unknown as Task;
}

export async function dbUpdateTask(id: string, updates: Partial<Task>): Promise<void> {
  if (!supabaseEnabled) return;
  const { error } = await supabase.from('tasks').update(toSnake(updates)).eq('id', id);
  if (error) throw error;
}

export async function dbDeleteTask(id: string): Promise<void> {
  if (!supabaseEnabled) return;
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw error;
}

// ── Activities ──────────────────────────────────────────────────────────────

export async function dbGetActivities(): Promise<Activity[]> {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabase.from('activities').select('*').order('date', { ascending: false }).range(0, 9999);
  if (error) throw error;
  return mapRows<Activity>(data || []);
}

export async function dbCreateActivity(act: Activity): Promise<Activity> {
  const row = toSnake(act);
  const { data, error } = await supabase.from('activities').insert(row).select().single();
  if (error) throw error;
  return toCamel(data) as unknown as Activity;
}

export async function dbDeleteActivity(id: string): Promise<void> {
  if (!supabaseEnabled) return;
  const { error } = await supabase.from('activities').delete().eq('id', id);
  if (error) throw error;
}

// ── Sale Records ────────────────────────────────────────────────────────────

export async function dbGetSaleRecords(): Promise<SaleRecord[]> {
  if (!supabaseEnabled) return [];
  // Supabase max_rows=1000, fetch in batches
  const batch1 = await supabase.from('sale_records').select('*').order('date', { ascending: false }).range(0, 999);
  const batch2 = await supabase.from('sale_records').select('*').order('date', { ascending: false }).range(1000, 1999);
  const batch3 = await supabase.from('sale_records').select('*').order('date', { ascending: false }).range(2000, 2999);
  const all = [...(batch1.data || []), ...(batch2.data || []), ...(batch3.data || [])];
  return mapRows<SaleRecord>(all);
}

export async function dbCreateSaleRecords(records: SaleRecord[]): Promise<void> {
  if (!supabaseEnabled || records.length === 0) return;
  const rows = records.map((r) => toSnake(r));
  // Insert in batches of 500
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase.from('sale_records').insert(batch);
    if (error) throw error;
  }
}

export async function dbDeleteSaleRecordsByBatch(batchId: string): Promise<void> {
  if (!supabaseEnabled) return;
  const { error } = await supabase.from('sale_records').delete().eq('upload_batch_id', batchId);
  if (error) throw error;
}

export async function dbDeleteAllSaleRecords(): Promise<void> {
  if (!supabaseEnabled) return;
  const { error } = await supabase.from('sale_records').delete().neq('id', '');
  if (error) throw error;
}

// ── Upload History ──────────────────────────────────────────────────────────

export async function dbGetUploadHistory(): Promise<UploadHistoryEntry[]> {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabase.from('upload_history').select('*').order('uploaded_at', { ascending: false }).range(0, 9999);
  if (error) throw error;
  return mapRows<UploadHistoryEntry>(data || []);
}

export async function dbCreateUploadHistory(entry: UploadHistoryEntry): Promise<void> {
  if (!supabaseEnabled) return;
  const { error } = await supabase.from('upload_history').insert(toSnake(entry));
  if (error) throw error;
}

export async function dbDeleteUploadHistory(id: string): Promise<void> {
  if (!supabaseEnabled) return;
  const { error } = await supabase.from('upload_history').delete().eq('id', id);
  if (error) throw error;
}

export async function dbDeleteAllUploadHistory(): Promise<void> {
  if (!supabaseEnabled) return;
  const { error } = await supabase.from('upload_history').delete().neq('id', '');
  if (error) throw error;
}

// ── Sales Budgets ───────────────────────────────────────────────────────────

export async function dbGetBudgets(year: number, category: string): Promise<BudgetEntry[]> {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabase.from('sales_budgets').select('*').eq('year', year).eq('category', category);
  if (error) throw error;
  return mapRows<BudgetEntry>(data || []);
}

export async function dbUpsertBudget(entry: BudgetEntry): Promise<void> {
  if (!supabaseEnabled) return;
  const { error } = await supabase.from('sales_budgets').upsert(toSnake(entry), { onConflict: 'id' });
  if (error) throw error;
}

// ── Connection test ─────────────────────────────────────────────────────────

export async function testConnection(): Promise<boolean> {
  if (!supabaseEnabled) return false;
  try {
    const { error } = await supabase.from('users').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}
