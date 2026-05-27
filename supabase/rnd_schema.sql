-- =====================================================================
-- Budget tracker schema (R&D + Event, split by team).
-- Run this in Supabase SQL Editor. Idempotent — safe to re-run.
--
-- Despite the legacy "rnd_*" table names, these tables hold BOTH R&D and
-- Event budget data, differentiated by the `category` column added below
-- ('rnd' or 'event'). The /rnd page has a toggle at the top to switch.
--
-- Tables:
--   rnd_budgets  — one row per (year, team, category) with the annual allocation.
--   rnd_expenses — individual expense entries tagged to (year, month, team, category).
--
-- Teams: ruminant, poultry, swine, latam, other
-- Categories: rnd, event
--
-- Execution order matters for migrations from earlier shapes of this
-- schema (team-less, category-less). Each ALTER is idempotent.
-- =====================================================================

-- ── 1) Tables (created only if missing) ────────────────────────────────

create table if not exists rnd_budgets (
  id text primary key,
  year integer not null,
  team text not null default 'other',
  category text not null default 'rnd',
  annual_amount numeric not null default 0,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists rnd_expenses (
  id text primary key,
  year integer not null,
  month integer not null check (month between 1 and 12),
  team text not null default 'other',
  category text not null default 'rnd',
  name text not null,
  description text,
  amount numeric not null default 0,
  owner_id text,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

-- ── 2) Forward-migration ALTERs (no-op when columns already exist) ─────

alter table rnd_budgets  add column if not exists team     text not null default 'other';
alter table rnd_expenses add column if not exists team     text not null default 'other';
alter table rnd_budgets  add column if not exists category text not null default 'rnd';
alter table rnd_expenses add column if not exists category text not null default 'rnd';

-- ── 3) Constraint migration ────────────────────────────────────────────
-- Drop the legacy unique constraints (year alone, then year+team), then
-- add the composite (year, team, category) so each team can have a
-- separate annual amount per category.

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'rnd_budgets_year_key') then
    alter table rnd_budgets drop constraint rnd_budgets_year_key;
  end if;
  if exists (select 1 from pg_constraint where conname = 'rnd_budgets_year_team_key') then
    alter table rnd_budgets drop constraint rnd_budgets_year_team_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rnd_budgets_year_team_category_key') then
    alter table rnd_budgets add constraint rnd_budgets_year_team_category_key unique (year, team, category);
  end if;
end $$;

-- ── 4) Indexes (safe now that `team` + `category` exist) ───────────────

create index if not exists rnd_expenses_year_month_idx
  on rnd_expenses(year, month) where archived_at is null;
create index if not exists rnd_expenses_year_team_cat_idx
  on rnd_expenses(year, team, category) where archived_at is null;
create index if not exists rnd_expenses_active_idx
  on rnd_expenses(id) where archived_at is null;
create index if not exists rnd_budgets_year_team_cat_idx
  on rnd_budgets(year, team, category);

-- ── 5) RLS ─────────────────────────────────────────────────────────────

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

-- ── 6) Realtime publication ────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rnd_budgets') then
    alter publication supabase_realtime add table rnd_budgets;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rnd_expenses') then
    alter publication supabase_realtime add table rnd_expenses;
  end if;
end $$;
