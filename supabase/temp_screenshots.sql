-- Temporary table — used once for User Guide screenshot embedding.
-- Drop with the API route at the same time after the guide is final.
create table if not exists _temp_screenshots (
  id text primary key,
  filename text not null,
  data_url text not null,
  created_at timestamptz not null default now()
);
alter table _temp_screenshots enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = '_temp_screenshots' and policyname = 'Allow all') then
    create policy "Allow all" on _temp_screenshots for all using (true) with check (true);
  end if;
end $$;
