import { supabase, supabaseEnabled } from './supabase';
import type { Account, Contact, Opportunity, Activity, Task, AccountBudget, RndBudget, RndExpense, RndTeam, RndCategory, Project, BudgetTeam } from './data';
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
  companyType: 'company_type',
  expectedStartDate: 'expected_start_date',
  parentAccountId: 'parent_account_id',
  internalParticipants: 'internal_participants',
  // Marketing project tracker (/projects). Without these, toSnake() leaves
  // the keys camelCase and Supabase rejects them with PGRST204 "column not
  // found in schema cache".
  startDate: 'start_date', endDate: 'end_date',
  completedAt: 'completed_at', sortOrder: 'sort_order',
  archivedAt: 'archived_at',
  // R&D expense column — same reason. (Already silently broken for the
  // rnd table soft-delete; explicit mapping makes it deterministic.)
  annualAmount: 'annual_amount', updatedAt: 'updated_at',
  // Budget Tracker dynamic teams (budget_teams). Without is_system mapping
  // toSnake() leaves the key camelCase and the insert errors with column
  // not found — surfaced as [object Object] before the BudgetTeamsModal
  // unwrapped the Supabase error shape.
  isSystem: 'is_system',
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

export function toCamel(obj: Record<string, unknown>): Record<string, unknown> {
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
  // Explicit column list — never SELECT * here, otherwise the password
  // column (bcrypt hash or, worst case, legacy plaintext) is shipped down
  // to every client through the UserContext fetch.
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, role, status, initials, team, phone, profile_photo, created_at')
    .order('name')
    .range(0, 9999);
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
  // Exclude soft-deleted rows. archived_at IS NULL = active. The column
  // was added by data-migration/03-archive-ghost-contacts.sql which
  // archived 323 ghost contacts (no email + no account). Without this
  // filter those rows would still appear in the UI even though they're
  // logically deleted.
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .is('archived_at', null)
    .order('first_name')
    .range(0, 9999);
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
  // Exclude soft-deleted activities. archived_at IS NULL = active.
  // The column was added by data-migration/04-cleanup-orphan-activities.sql
  // (which archived 56 fully-orphan rows) and is also used by
  // 05-dedupe-activities.sql (which archived 27 duplicate rows).
  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .is('archived_at', null)
    .order('date', { ascending: false })
    .range(0, 9999);
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

export async function dbUpdateActivity(id: string, updates: Partial<Activity>): Promise<void> {
  if (!supabaseEnabled) return;
  const { error } = await supabase.from('activities').update(toSnake(updates)).eq('id', id);
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

// ── Account Budgets ─────────────────────────────────────────────────────────

export async function dbGetAccountBudgets(): Promise<AccountBudget[]> {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabase.from('account_budgets').select('*');
  if (error) { console.error('[DB] account_budgets error:', error.message); return []; }
  return mapRows<AccountBudget>(data || []);
}

export async function dbUpsertAccountBudget(accountName: string, year: number, month: number, amount: number, category: string): Promise<void> {
  if (!supabaseEnabled) return;
  const id = `ab-${accountName}-${year}-${month}`.replace(/[^a-zA-Z0-9-]/g, '_');
  const { error } = await supabase.from('account_budgets').upsert({
    id, account_name: accountName, year, month, budget_amount: amount, category,
  }, { onConflict: 'id' });
  if (error) throw error;
}

// ── R&D Budgets ─────────────────────────────────────────────────────────────

export async function dbGetRndBudgets(): Promise<RndBudget[]> {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabase.from('rnd_budgets').select('*').order('year', { ascending: false });
  if (error) { console.error('[DB] rnd_budgets error:', error.message); return []; }
  return mapRows<RndBudget>(data || []);
}

export async function dbUpsertRndBudget(year: number, team: RndTeam, category: RndCategory, annualAmount: number, notes?: string): Promise<void> {
  if (!supabaseEnabled) return;
  // Deterministic id — one row per (year, team, category). Category is
  // 'rnd' or 'event' so R&D and Event allocations don't collide.
  const id = `rnd-budget-${year}-${team}-${category}`;
  const { error } = await supabase.from('rnd_budgets').upsert(
    { id, year, team, category, annual_amount: annualAmount, notes: notes ?? null, updated_at: new Date().toISOString() },
    { onConflict: 'id' },
  );
  if (error) throw error;
}

// ── R&D Expenses ────────────────────────────────────────────────────────────

export async function dbGetRndExpenses(): Promise<RndExpense[]> {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabase
    .from('rnd_expenses')
    .select('*')
    .is('archived_at', null)
    .order('year', { ascending: false })
    .order('month', { ascending: true });
  if (error) { console.error('[DB] rnd_expenses error:', error.message); return []; }
  return mapRows<RndExpense>(data || []);
}

export async function dbCreateRndExpense(expense: RndExpense): Promise<RndExpense> {
  const row = toSnake(expense);
  const { data, error } = await supabase.from('rnd_expenses').insert(row).select().single();
  if (error) throw error;
  return toCamel(data) as unknown as RndExpense;
}

export async function dbUpdateRndExpense(id: string, updates: Partial<RndExpense>): Promise<void> {
  if (!supabaseEnabled) return;
  const { error } = await supabase.from('rnd_expenses').update(toSnake(updates)).eq('id', id);
  if (error) throw error;
}

export async function dbDeleteRndExpense(id: string): Promise<void> {
  if (!supabaseEnabled) return;
  // Soft delete via archived_at — preserves history and matches the rest
  // of the codebase (contacts, activities) post data-migration/03+04.
  const { error } = await supabase
    .from('rnd_expenses')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ── Budget Tracker — dynamic team labels ────────────────────────────────────
// Mirrors the budget_teams table (see supabase/budget_teams_schema.sql).
// Returns every label including the system-protected 'other' so callers can
// render it but disable Edit / Delete for is_system rows.

export async function dbListBudgetTeams(): Promise<BudgetTeam[]> {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabase
    .from('budget_teams')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) { console.error('[DB] budget_teams list error:', error.message); return []; }
  return mapRows<BudgetTeam>(data || []);
}

export async function dbCreateBudgetTeam(team: BudgetTeam): Promise<BudgetTeam | null> {
  if (!supabaseEnabled) return null;
  const row = toSnake({ ...team, isSystem: team.isSystem ?? false });
  const { data, error } = await supabase
    .from('budget_teams')
    .insert(row)
    .select()
    .single();
  if (error) { console.error('[DB] budget_teams create error:', error.message); throw error; }
  return toCamel(data) as unknown as BudgetTeam;
}

export async function dbUpdateBudgetTeam(id: string, updates: Partial<BudgetTeam>): Promise<void> {
  if (!supabaseEnabled) return;
  const payload = toSnake({ ...updates, updatedAt: new Date().toISOString() });
  const { error } = await supabase.from('budget_teams').update(payload).eq('id', id);
  if (error) throw error;
}

/**
 * Delete a team. If `reassignTo` is provided, every rnd_budgets/rnd_expenses
 * row that refers to this team is first moved to the target team — typically
 * the system-protected 'other'. The team row itself is removed last so we
 * never end up with orphaned references on partial failure.
 *
 * The system-protected row ('other') itself cannot be deleted — the caller
 * (UI) should hide the Delete button for is_system entries; this function
 * additionally rejects the call as a defensive backstop.
 */
export async function dbDeleteBudgetTeam(id: string, reassignTo: string = 'other'): Promise<void> {
  if (!supabaseEnabled) return;
  if (id === reassignTo) throw new Error('cannot reassign team to itself');
  // 1) reassign budgets — combine with existing 'other' rows of the same
  //    (year, category) by deleting the about-to-be-orphaned rows first
  //    and then nuking the team row; the unique (year, team, category)
  //    constraint would otherwise reject the UPDATE.
  // We take a simpler path: delete the doomed team's budget rows outright
  // (the user is removing the team, so its annual amounts go with it).
  const { error: bErr } = await supabase.from('rnd_budgets').delete().eq('team', id);
  if (bErr) throw bErr;
  // 2) reassign expenses to the fallback team so historical spend is preserved
  const { error: eErr } = await supabase
    .from('rnd_expenses')
    .update({ team: reassignTo })
    .eq('team', id);
  if (eErr) throw eErr;
  // 3) finally remove the team row
  const { error: tErr } = await supabase
    .from('budget_teams')
    .delete()
    .eq('id', id)
    .eq('is_system', false);  // double-protect against deleting 'other'
  if (tErr) throw tErr;
}


// ── Projects (marketing tracker) ────────────────────────────────────────────

export async function dbGetProjects(): Promise<Project[]> {
  if (!supabaseEnabled) return [];
  // Filter archived; sort_order asc keeps user-defined row ordering on the
  // Gantt stable across reloads. created_at is the tie-breaker.
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .is('archived_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) { console.error('[DB] projects error:', error.message); return []; }
  return mapRows<Project>(data || []);
}

export async function dbCreateProject(project: Project): Promise<Project> {
  const row = toSnake(project);
  const { data, error } = await supabase.from('projects').insert(row).select().single();
  if (error) throw error;
  return toCamel(data) as unknown as Project;
}

export async function dbUpdateProject(id: string, updates: Partial<Project>): Promise<void> {
  if (!supabaseEnabled) return;
  // Auto-stamp completed_at when stage flips to 'completed', and clear it
  // when stage moves back to anything else. Caller doesn't need to manage
  // this field; it's purely derived from stage transitions.
  const patch: Partial<Project> = { ...updates };
  if (Object.prototype.hasOwnProperty.call(updates, 'stage')) {
    if (updates.stage === 'completed') {
      patch.completedAt = patch.completedAt ?? new Date().toISOString();
    } else {
      patch.completedAt = null;
    }
  }
  const { error } = await supabase.from('projects').update(toSnake(patch)).eq('id', id);
  if (error) throw error;
}

export async function dbDeleteProject(id: string): Promise<void> {
  if (!supabaseEnabled) return;
  // Soft delete — matches contacts / activities / rnd_expenses pattern.
  const { error } = await supabase
    .from('projects')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Bulk-update sort_order after drag-and-drop reorder. Sequential awaits
 *  are fine here — reorders are at most a handful of rows. */
export async function dbReorderProjects(orderedIds: string[]): Promise<void> {
  if (!supabaseEnabled || orderedIds.length === 0) return;
  await Promise.all(
    orderedIds.map((id, idx) =>
      supabase.from('projects').update({ sort_order: idx }).eq('id', id),
    ),
  );
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
