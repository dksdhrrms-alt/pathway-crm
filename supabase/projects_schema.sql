-- =====================================================================
-- Marketing project tracker schema.
-- Run this in Supabase SQL Editor. Idempotent — safe to re-run.
--
-- Tables:
--   projects — one row per project with team, stage, start/end dates.
--              Soft-delete via archived_at. Stage 'completed' flips
--              completed_at and bubbles the row into the bottom section
--              of the /projects page.
--
-- Teams:   ruminant, poultry, swine, latam, other, npd
-- Stages:  planning, in_progress, review, completed
-- =====================================================================

-- ── 1) Table ───────────────────────────────────────────────────────────

create table if not exists projects (
  id text primary key,
  name text not null,
  description text,
  team text not null default 'other',
  stage text not null default 'planning',
  start_date date not null,
  end_date date not null,
  completed_at timestamptz,
  sort_order integer not null default 0,
  owner_id text,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

-- ── 2) Forward-migration ALTERs (no-ops when columns already exist) ────

alter table projects add column if not exists team         text not null default 'other';
alter table projects add column if not exists stage        text not null default 'planning';
alter table projects add column if not exists completed_at timestamptz;
alter table projects add column if not exists sort_order   integer not null default 0;
alter table projects add column if not exists archived_at  timestamptz;

-- ── 3) Indexes ─────────────────────────────────────────────────────────

create index if not exists projects_active_idx
  on projects(id) where archived_at is null;
create index if not exists projects_date_range_idx
  on projects(start_date, end_date) where archived_at is null;
create index if not exists projects_team_stage_idx
  on projects(team, stage) where archived_at is null;
create index if not exists projects_sort_idx
  on projects(sort_order) where archived_at is null;

-- ── 4) RLS ─────────────────────────────────────────────────────────────

alter table projects enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'projects' and policyname = 'Allow all') then
    create policy "Allow all" on projects for all using (true) with check (true);
  end if;
end $$;

-- ── 5) Realtime publication ────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='projects') then
    alter publication supabase_realtime add table projects;
  end if;
end $$;
