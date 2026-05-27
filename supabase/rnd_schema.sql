-- =====================================================================
-- R&D budget tracker schema
-- Run this in Supabase SQL Editor once.
--
-- Two tables:
--   1. rnd_budgets  — one row per year with the annual R&D allocation.
--   2. rnd_expenses — individual R&D expense entries tagged to a
--                     (year, month) cell of the on-screen 12-card grid.
--
-- Soft-delete via archived_at on expenses (matches the rest of the app's
-- convention from data-migration/03 and /04). Budgets are usually edited
-- in-place rather than archived, so they have no archived_at column.
-- =====================================================================

create table if not exists rnd_budgets (
  id text primary key,
  year integer not null unique,
  annual_amount numeric not null default 0,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists rnd_expenses (
  id text primary key,
  year integer not null,
  month integer not null check (month between 1 and 12),
  name text not null,
  description text,
  amount numeric not null default 0,
  owner_id text,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

-- Common filters: by year on both tables, and by (year, month) on expenses.
create index if not exists rnd_expenses_year_month_idx
  on rnd_expenses(year, month) where archived_at is null;
create index if not exists rnd_expenses_active_idx
  on rnd_expenses(id) where archived_at is null;

-- Enable RLS and a permissive "all authenticated" policy to match how
-- the rest of the project handles new tables. Tighten later if needed.
alter table rnd_budgets enable row level security;
alter table rnd_expenses enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'rnd_budgets' and policyname = 'Allow all') then
    create policy "Allow all" on rnd_budgets for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'rnd_expenses' and policyname = 'Allow all') then
    create policy "Allow all" on rnd_expenses for all using (true) with check (true);
  end if;
end $$;

-- =====================================================================
-- Realtime: enable on both tables so CRMContext's `postgres_changes`
-- subscription (in lib/CRMContext.tsx) can keep multi-user views in sync.
-- =====================================================================
alter publication supabase_realtime add table rnd_budgets;
alter publication supabase_realtime add table rnd_expenses;
