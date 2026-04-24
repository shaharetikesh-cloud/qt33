-- Compatibility RLS hotfix for client-side cloud-sync mode.
-- Context: this app uses Firebase auth + Supabase anon key for PostgREST writes.
-- In this mode, auth.jwt() role mapping is often unavailable, causing 42501 on erp_records upserts.
--
-- SECURITY NOTE:
-- This is intentionally permissive for erp_records sync continuity.
-- Apply tighter tenant/user constraints later through Edge Functions or server-side signed JWT flow.

alter table if exists public.erp_records enable row level security;

drop policy if exists erp_records_select_policy on public.erp_records;
drop policy if exists erp_records_insert_policy on public.erp_records;
drop policy if exists erp_records_update_policy on public.erp_records;
drop policy if exists erp_records_delete_policy on public.erp_records;

create policy erp_records_select_policy
  on public.erp_records
  for select
  to anon, authenticated
  using (true);

create policy erp_records_insert_policy
  on public.erp_records
  for insert
  to anon, authenticated
  with check (true);

create policy erp_records_update_policy
  on public.erp_records
  for update
  to anon, authenticated
  using (true)
  with check (true);

-- App uses soft-delete (deleted=true upsert), so hard delete can stay blocked.
create policy erp_records_delete_policy
  on public.erp_records
  for delete
  to anon, authenticated
  using (false);

