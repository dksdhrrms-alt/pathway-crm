-- =====================================================================
-- Budget Tracker — dynamic team labels.
-- Run in Supabase SQL Editor. Idempotent; safe to re-run.
--
-- Backstory: the rnd_budgets / rnd_expenses tables already store `team`
-- as free-form text (not an enum), so going dynamic is purely an
-- additive layer — a new `budget_teams` table holds the master list of
-- labels (id, label, color, sort_order), and the existing rows in
-- rnd_budgets/rnd_expenses keep referring to teams by their slug id.
--
-- The five legacy slugs (ruminant / poultry / swine / latam / other)
-- are seeded here so existing data lights up immediately. `other` is
-- system-protected — the UI prevents deletion, and any other team that
-- is deleted has its budgets/expenses reassigned to `other` first.
-- =====================================================================

-- ── 1) Table ──────────────────────────────────────────────────────────
create table if not exists budget_teams (
  id text primary key,                -- slug (e.g. 'ruminant', or auto-generated for new ones)
  label text not null,                -- display name shown in the UI
  color text not null default '#9CA3AF',  -- hex (#RRGGBB) chosen by the user
  sort_order integer not null default 0,
  is_system boolean not null default false,  -- 'other' is the only system row; cannot be deleted
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 2) Seed the five legacy teams ─────────────────────────────────────
insert into budget_teams (id, label, color, sort_order, is_system)
values
  ('ruminant', 'Ruminant', '#F59E0B', 10, false),
  ('poultry',  'Poultry',  '#3B82F6', 20, false),
  ('swine',    'Swine',    '#EC4899', 30, false),
  ('latam',    'LATAM',    '#10B981', 40, false),
  ('other',    'Other',    '#6B7280', 999, true)
on conflict (id) do nothing;

-- ── 3) Indexes ────────────────────────────────────────────────────────
create index if not exists budget_teams_sort_idx on budget_teams(sort_order);

-- ── 4) RLS — same "Allow all" stance as rnd_budgets/rnd_expenses ──────
alter table budget_teams enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'budget_teams' and policyname = 'Allow all') then
    create policy "Allow all" on budget_teams for all using (true) with check (true);
  end if;
end $$;

-- ── 5) Realtime publication ───────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='budget_teams'
  ) then
    alter publication supabase_realtime add table budget_teams;
  end if;
end $$;
