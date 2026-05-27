-- =====================================================================
-- R&D budget tracker schema (with per-team split).
-- Run this in Supabase SQL Editor. Idempotent — safe to re-run.
--
-- Tables:
--   rnd_budgets  — one row per (year, team) with the annual allocation.
--   rnd_expenses — individual expense entries tagged to a (year, month, team).
--
-- Teams (free-text, but the UI presents 5 fixed options):
--   ruminant, poultry, swine, latam, other
--
-- Execution order is important for the case where an earlier (team-less)
-- version of this schema was already applied:
--   1) CREATE TABLE IF NOT EXISTS — no-op if table exists.
--   2) ALTER TABLE ADD COLUMN team IF NOT EXISTS — adds the column to
--      existing tables (defaults to 'other'). Safe on fresh tables too.
--   3) Constraint migration — drop old single-column unique, add the
--      (year, team) composite unique.
--   4) Indexes — only here, AFTER `team` exists.
--   5) RLS + Realtime.
-- =====================================================================

-- ── 1) Tables (created only if missing) ────────────────────────────────

create table if not exists rnd_budgets (
  id text primary key,
  year integer not null,
  team text not null default 'other',
  annual_amount numeric not null default 0,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists rnd_expenses (
  id text primary key,
  year integer not null,
  month integer not null check (month between 1 and 12),
  team text not null default 'other',
  name text not null,
  description text,
  amount numeric not null default 0,
  owner_id text,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

-- ── 2) Forward-migration ALTERs (no-op if columns already exist) ───────

alter table rnd_budgets  add column if not exists team text not null default 'other';
alter table rnd_expenses add column if not exists team text not null default 'other';

-- ── 3) Constraint migration ────────────────────────────────────────────
-- Drop the legacy "year alone is unique" constraint so multiple teams
-- can share a year. Then add the composite (year, team) constraint.

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'rnd_budgets_year_key') then
    alter table rnd_budgets drop constraint rnd_budgets_year_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rnd_budgets_year_team_key') then
    alter table rnd_budgets add constraint rnd_budgets_year_team_key unique (year, team);
  end if;
end $$;

-- ── 4) Indexes (safe now that `team` column exists) ────────────────────

create index if not exists rnd_expenses_year_month_idx
  on rnd_expenses(year, month) where archived_at is null;
create index if not exists rnd_expenses_year_team_idx
  on rnd_expenses(year, team) where archived_at is null;
create index if not exists rnd_expenses_active_idx
  on rnd_expenses(id) where archived_at is null;
create index if not exists rnd_budgets_year_team_idx
  on rnd_budgets(year, team);

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
