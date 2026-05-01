-- QT33: Sync auth/RLS hardening for erp_records
-- Date: 2026-05-01
-- Safe idempotent migration.

begin;

alter table if exists public.erp_records enable row level security;

create index if not exists idx_erp_records_updated_at on public.erp_records(updated_at desc);
create index if not exists idx_erp_records_client_updated_at on public.erp_records(client_updated_at desc);
create index if not exists idx_erp_records_updated_by on public.erp_records(updated_by);
create index if not exists idx_erp_records_device_id on public.erp_records(device_id);

create or replace function public.rls_request_user_id()
returns text
language sql
stable
as $$
  select nullif(
    coalesce(auth.jwt() ->> 'sub', auth.uid()::text),
    ''
  );
$$;

create or replace function public.rls_is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.auth_user_id = public.rls_request_user_id()
      and lower(coalesce(p.role, '')) in ('owner', 'main_admin', 'super_admin')
      and coalesce(p.is_active, true) = true
  );
$$;

create or replace function public.rls_can_access_substation(target_substation_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  mapping_match boolean := false;
begin
  if to_regclass('public.user_substation_mappings') is not null then
    execute $q$
      select exists (
        select 1
        from public.user_substation_mappings m
        where m.user_id = public.rls_request_user_id()
          and m.substation_id::text = $1
      )
    $q$
    into mapping_match
    using target_substation_id;
  end if;

  return
    public.rls_is_admin_user()
    or exists (
      select 1
      from public.profiles p
      where p.auth_user_id = public.rls_request_user_id()
        and coalesce(p.is_active, true) = true
        and p.substation_id is not null
        and p.substation_id::text = target_substation_id
    )
    or mapping_match;
end;
$$;

drop policy if exists erp_records_select_authenticated on public.erp_records;
create policy erp_records_select_authenticated
on public.erp_records
for select
to authenticated
using (
  public.rls_is_admin_user()
  or owner_user_id = public.rls_request_user_id()
  or updated_by = public.rls_request_user_id()
  or (
    coalesce(substation_id, '') <> ''
    and public.rls_can_access_substation(substation_id)
  )
);

drop policy if exists erp_records_insert_authenticated on public.erp_records;
create policy erp_records_insert_authenticated
on public.erp_records
for insert
to authenticated
with check (
  public.rls_is_admin_user()
  or owner_user_id = public.rls_request_user_id()
  or updated_by = public.rls_request_user_id()
  or (
    coalesce(substation_id, '') <> ''
    and public.rls_can_access_substation(substation_id)
  )
);

drop policy if exists erp_records_update_authenticated on public.erp_records;
create policy erp_records_update_authenticated
on public.erp_records
for update
to authenticated
using (
  public.rls_is_admin_user()
  or owner_user_id = public.rls_request_user_id()
  or updated_by = public.rls_request_user_id()
  or (
    coalesce(substation_id, '') <> ''
    and public.rls_can_access_substation(substation_id)
  )
)
with check (
  public.rls_is_admin_user()
  or owner_user_id = public.rls_request_user_id()
  or updated_by = public.rls_request_user_id()
  or (
    coalesce(substation_id, '') <> ''
    and public.rls_can_access_substation(substation_id)
  )
);

do $$
begin
  alter publication supabase_realtime add table public.erp_records;
exception
  when duplicate_object then null;
  when undefined_object then null;
end
$$;

commit;

