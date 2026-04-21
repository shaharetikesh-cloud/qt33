-- Hotfix: allow owner/main_admin/admin roles for erp_records sync writes.
-- Run in Supabase SQL Editor (safe to re-run).

create or replace function public.current_firebase_uid()
returns text
language sql
stable
as $$
  select coalesce(
    auth.jwt()->>'sub',
    auth.uid()::text
  );
$$;

create or replace function public.current_profile_role()
returns text
language sql
stable
as $$
  select coalesce(
    (
      select lower(p.role)
      from public.profiles p
      where p.firebase_uid = public.current_firebase_uid()
         or p.auth_user_id = public.current_firebase_uid()
      limit 1
    ),
    'normal_user'
  );
$$;

create or replace function public.current_profile_substation()
returns text
language sql
stable
as $$
  select (
    select p.substation_id
    from public.profiles p
    where p.firebase_uid = public.current_firebase_uid()
       or p.auth_user_id = public.current_firebase_uid()
    limit 1
  );
$$;

create or replace function public.is_elevated_role(role_name text)
returns boolean
language sql
stable
as $$
  select coalesce(lower(role_name), '') in ('super_admin', 'owner', 'main_admin', 'admin');
$$;

create or replace function public.can_access_substation(target_substation text)
returns boolean
language sql
stable
as $$
  select case
    when public.is_elevated_role(public.current_profile_role()) then true
    when public.current_profile_role() = 'substation_admin' then target_substation = public.current_profile_substation()
    else target_substation = public.current_profile_substation()
  end;
$$;

alter table if exists public.erp_records enable row level security;

drop policy if exists erp_records_select_policy on public.erp_records;
create policy erp_records_select_policy
  on public.erp_records
  for select
  using (
    public.is_elevated_role(public.current_profile_role())
    or public.can_access_substation(substation_id)
    or owner_user_id = public.current_firebase_uid()
  );

drop policy if exists erp_records_insert_policy on public.erp_records;
create policy erp_records_insert_policy
  on public.erp_records
  for insert
  with check (
    public.is_elevated_role(public.current_profile_role())
    or (
      public.can_access_substation(substation_id)
      and coalesce(owner_user_id, '') in ('', public.current_firebase_uid())
    )
  );

drop policy if exists erp_records_update_policy on public.erp_records;
create policy erp_records_update_policy
  on public.erp_records
  for update
  using (
    public.is_elevated_role(public.current_profile_role())
    or public.can_access_substation(substation_id)
    or owner_user_id = public.current_firebase_uid()
  )
  with check (
    public.is_elevated_role(public.current_profile_role())
    or (
      public.can_access_substation(substation_id)
      and coalesce(owner_user_id, '') in ('', public.current_firebase_uid())
    )
  );

drop policy if exists erp_records_delete_policy on public.erp_records;
create policy erp_records_delete_policy
  on public.erp_records
  for delete
  using (public.is_elevated_role(public.current_profile_role()));

