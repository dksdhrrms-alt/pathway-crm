-- Pathway Intermediates USA CRM — Supabase Schema
-- Run this in the Supabase SQL Editor to create all tables.

-- Users
create table if not exists users (
  id text primary key,
  name text not null,
  email text unique not null,
  password text not null,
  phone text,
  role text not null default 'sales',
  initials text,
  status text not null default 'active',
  profile_photo text,
  created_at timestamptz default now()
);

-- Accounts
create table if not exists accounts (
  id text primary key,
  name text not null,
  industry text,
  location text,
  annual_revenue numeric default 0,
  website text,
  owner_id text,
  contact_ids text[] default '{}',
  opportunity_ids text[] default '{}',
  created_at timestamptz default now()
);

-- Contacts
create table if not exists contacts (
  id text primary key,
  first_name text not null,
  last_name text not null,
  title text,
  account_id text,
  phone text,
  email text,
  linked_in text,
  owner_id text,
  created_at timestamptz default now()
);

-- Opportunities
create table if not exists opportunities (
  id text primary key,
  name text not null,
  account_id text,
  stage text not null default 'Prospecting',
  amount numeric default 0,
  close_date text,
  probability integer default 10,
  next_step text,
  lead_source text,
  owner_id text,
  created_date text,
  contact_ids text[] default '{}',
  created_at timestamptz default now()
);

-- Tasks
create table if not exists tasks (
  id text primary key,
  subject text not null,
  due_date text,
  priority text default 'Medium',
  status text default 'Open',
  description text,
  related_account_id text,
  related_contact_id text,
  related_opportunity_id text,
  owner_id text,
  created_at timestamptz default now()
);

-- Activities
create table if not exists activities (
  id text primary key,
  type text not null,
  subject text not null,
  description text,
  date text,
  account_id text,
  contact_id text,
  owner_id text,
  created_at timestamptz default now()
);

-- Disable RLS for demo (all access allowed)
alter table users enable row level security;
alter table accounts enable row level security;
alter table contacts enable row level security;
alter table opportunities enable row level security;
alter table tasks enable row level security;
alter table activities enable row level security;

create policy "Allow all" on users for all using (true) with check (true);
create policy "Allow all" on accounts for all using (true) with check (true);
create policy "Allow all" on contacts for all using (true) with check (true);
create policy "Allow all" on opportunities for all using (true) with check (true);
create policy "Allow all" on tasks for all using (true) with check (true);
create policy "Allow all" on activities for all using (true) with check (true);
