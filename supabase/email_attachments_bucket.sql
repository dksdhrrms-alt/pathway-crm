-- Create a Storage bucket for inbound-email attachments.
-- Run once in Supabase SQL Editor.  Idempotent — safe to re-run.
insert into storage.buckets (id, name, public)
values ('email-attachments', 'email-attachments', true)
on conflict (id) do update set public = true;

-- Public read access (so attachment URLs in Archive can be opened by
-- any signed-in CRM user without juggling signed URLs).  Service role
-- key on the inbound-email route handles uploads.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'email-attachments public read'
  ) then
    create policy "email-attachments public read"
      on storage.objects for select
      using (bucket_id = 'email-attachments');
  end if;
end $$;
