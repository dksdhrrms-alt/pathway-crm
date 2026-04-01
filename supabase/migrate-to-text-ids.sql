-- Migration: Change all id columns from uuid to text
-- Run this in Supabase SQL Editor

-- Drop existing tables and recreate with text ids
-- (tables are empty so no data loss)

DROP TABLE IF EXISTS sale_records CASCADE;
DROP TABLE IF EXISTS upload_history CASCADE;
DROP TABLE IF EXISTS sales_budgets CASCADE;
DROP TABLE IF EXISTS user_permissions CASCADE;
DROP TABLE IF EXISTS activities CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS opportunities CASCADE;
DROP TABLE IF EXISTS contacts CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Recreate all tables with TEXT primary keys

CREATE TABLE users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  password text NOT NULL,
  phone text,
  role text NOT NULL DEFAULT 'sales',
  initials text,
  status text NOT NULL DEFAULT 'active',
  profile_photo text,
  team text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE accounts (
  id text PRIMARY KEY,
  name text NOT NULL,
  industry text,
  location text,
  annual_revenue numeric DEFAULT 0,
  owner_id text,
  owner_name text,
  website text,
  contact_ids text[] DEFAULT '{}',
  opportunity_ids text[] DEFAULT '{}',
  country text,
  phone text,
  employee integer,
  category text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE contacts (
  id text PRIMARY KEY,
  first_name text NOT NULL,
  last_name text NOT NULL,
  title text,
  species text,
  account_id text,
  account_name text,
  country text,
  owner_id text,
  owner_name text,
  position text,
  is_key_man boolean DEFAULT false,
  phone text,
  tel text,
  email text,
  linked_in text,
  created_at timestamptz DEFAULT now(),
  status text
);

CREATE TABLE opportunities (
  id text PRIMARY KEY,
  name text NOT NULL,
  account_id text,
  stage text NOT NULL DEFAULT 'Prospecting',
  amount numeric DEFAULT 0,
  close_date text,
  probability integer DEFAULT 10,
  next_step text,
  lead_source text,
  owner_id text,
  created_date text,
  contact_ids text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE tasks (
  id text PRIMARY KEY,
  subject text NOT NULL,
  due_date text,
  priority text DEFAULT 'Medium',
  status text DEFAULT 'Open',
  description text,
  related_account_id text,
  related_contact_id text,
  related_opportunity_id text,
  owner_id text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE activities (
  id text PRIMARY KEY,
  type text NOT NULL,
  subject text NOT NULL,
  description text,
  date text,
  account_id text,
  contact_id text,
  owner_id text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE sale_records (
  id text PRIMARY KEY,
  date text,
  customer_po text,
  po_number text,
  owner_name text,
  account_name text,
  product_name text,
  volume_kg numeric DEFAULT 0,
  amount numeric DEFAULT 0,
  unit_price numeric DEFAULT 0,
  payment_due text,
  payment_status text,
  state text,
  team text,
  country text,
  category text,
  upload_batch_id text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE upload_history (
  id text PRIMARY KEY,
  uploaded_at text,
  uploaded_by text,
  file_name text,
  record_count integer DEFAULT 0,
  skipped_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE sales_budgets (
  id text PRIMARY KEY,
  year integer NOT NULL,
  month integer NOT NULL,
  category text NOT NULL,
  budget_amount numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE user_permissions (
  user_id text NOT NULL,
  menu_item text NOT NULL,
  permission text DEFAULT 'default',
  PRIMARY KEY (user_id, menu_item)
);

-- Enable RLS with allow-all policies for demo
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON accounts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON contacts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON opportunities FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON tasks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON activities FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON sale_records FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON upload_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON sales_budgets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON user_permissions FOR ALL USING (true) WITH CHECK (true);
