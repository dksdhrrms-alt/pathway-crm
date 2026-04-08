import { supabase, supabaseEnabled } from './supabase';

export type BudgetCategory = 'all' | 'monogastrics' | 'ruminants' | 'latam' | 'familyb2b' | 'swine';

export interface BudgetEntry {
  id: string;
  year: number;
  month: number;
  category: BudgetCategory;
  budgetAmount: number;
}

function storageKey() { return 'crm_sales_budgets'; }

function loadLocal(): BudgetEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey());
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveLocal(entries: BudgetEntry[]) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(storageKey(), JSON.stringify(entries)); } catch { /* */ }
}

export async function getBudgets(year: number, category: BudgetCategory): Promise<BudgetEntry[]> {
  if (supabaseEnabled) {
    try {
      const { data, error } = await supabase
        .from('sales_budgets')
        .select('*')
        .eq('year', year)
        .eq('category', category.toLowerCase());

      if (error) {
        console.error('[BUDGET] Supabase error:', error.message);
      }

      if (data && data.length > 0) {
        const mapped = data.map((r) => ({
          id: r.id,
          year: Number(r.year),
          month: Number(r.month),
          category: String(r.category) as BudgetCategory,
          budgetAmount: Number(r.budget_amount) || 0,
        }));
        // Also cache locally
        const existing = loadLocal().filter((b) => !(b.year === year && b.category === category));
        saveLocal([...existing, ...mapped]);
        return mapped;
      }

      // If no data found with exact match, try ilike for case-insensitive
      const { data: data2 } = await supabase
        .from('sales_budgets')
        .select('*')
        .eq('year', year)
        .ilike('category', category);

      if (data2 && data2.length > 0) {
        console.log(`[BUDGET] Found ${data2.length} budgets via ilike for ${category}`);
        return data2.map((r) => ({
          id: r.id,
          year: Number(r.year),
          month: Number(r.month),
          category: String(r.category) as BudgetCategory,
          budgetAmount: Number(r.budget_amount) || 0,
        }));
      }
    } catch (err) {
      console.error('[BUDGET] Fetch error:', err);
    }
  }
  return loadLocal().filter((b) => b.year === year && b.category === category);
}

export async function setBudget(year: number, month: number, category: BudgetCategory, amount: number): Promise<void> {
  const all = loadLocal();
  const idx = all.findIndex((b) => b.year === year && b.month === month && b.category === category);
  const entry: BudgetEntry = {
    id: idx >= 0 ? all[idx].id : `budget-${year}-${month}-${category}`,
    year, month, category, budgetAmount: amount,
  };
  if (idx >= 0) all[idx] = entry; else all.push(entry);
  saveLocal(all);

  if (supabaseEnabled) {
    await supabase.from('sales_budgets').upsert({
      id: entry.id, year, month, category, budget_amount: amount,
    }, { onConflict: 'id' });
  }
}

export async function setBudgetBulk(year: number, category: BudgetCategory, amounts: number[]): Promise<void> {
  for (let m = 1; m <= 12; m++) {
    await setBudget(year, m, category, amounts[m - 1] || 0);
  }
}

export function getBudgetAmount(budgets: BudgetEntry[], month: number): number {
  return budgets.find((b) => b.month === month)?.budgetAmount ?? 0;
}

// Build budgets from raw Supabase rows (used by CRMContext salesBudgets)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function budgetsFromRaw(raw: any[], year: number, category: string): BudgetEntry[] {
  return raw
    .filter((r) => {
      const rYear = Number(r.year);
      const rCat = String(r.category || '').toLowerCase();
      const cat = category.toLowerCase();
      return rYear === year && (cat === 'all' || rCat === cat);
    })
    .map((r) => ({
      id: r.id,
      year: Number(r.year),
      month: Number(r.month),
      category: String(r.category) as BudgetCategory,
      budgetAmount: Number(r.budget_amount ?? r.budgetAmount) || 0,
    }));
}

// Seed budgets
export function getSeedBudgets(): BudgetEntry[] {
  const entries: BudgetEntry[] = [];
  const configs: { cat: BudgetCategory; years: Record<number, number[]> }[] = [
    { cat: 'monogastrics', years: {
      2024: [150,155,160,170,175,180,180,175,170,165,155,150].map(n=>n*1000),
      2025: [170,175,185,195,200,210,210,205,195,190,180,170].map(n=>n*1000),
      2026: [190,195,205,215,220,230,230,225,215,210,200,190].map(n=>n*1000),
    }},
    { cat: 'ruminants', years: {
      2024: [80,85,88,92,95,100,100,98,95,90,85,80].map(n=>n*1000),
      2025: [90,95,100,105,108,115,115,110,105,100,95,90].map(n=>n*1000),
      2026: [100,105,110,118,122,130,130,125,118,115,108,100].map(n=>n*1000),
    }},
    { cat: 'latam', years: {
      2024: [40,42,45,50,52,55,58,55,52,48,45,40].map(n=>n*1000),
      2025: [50,52,55,60,65,70,75,70,65,60,55,50].map(n=>n*1000),
      2026: [60,65,70,75,80,85,90,85,80,75,68,60].map(n=>n*1000),
    }},
  ];
  for (const { cat, years } of configs) {
    for (const [yr, amounts] of Object.entries(years)) {
      for (let m = 1; m <= 12; m++) {
        entries.push({
          id: `budget-${yr}-${m}-${cat}`,
          year: Number(yr), month: m, category: cat,
          budgetAmount: amounts[m - 1],
        });
      }
    }
  }
  return entries;
}
