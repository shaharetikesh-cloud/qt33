create extension if not exists pgcrypto;

create table if not exists public.erp_records (
  id text primary key,
  scope text not null,
  payload jsonb not null default '{}'::jsonb,
  substation_id text null,
  owner_user_id text null,
  updated_by text null,
  device_id text null,
  client_updated_at timestamptz not null default timezone('utc', now()),
  server_received_at timestamptz not null default timezone('utc', now()),
  version bigint not null default 1,
  deleted boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists erp_records_scope_updated_idx
  on public.erp_records(scope, updated_at desc);
create index if not exists erp_records_substation_idx
  on public.erp_records(substation_id);
create index if not exists erp_records_owner_idx
  on public.erp_records(owner_user_id);
create index if not exists erp_records_updated_by_idx
  on public.erp_records(updated_by);
create index if not exists erp_records_device_idx
  on public.erp_records(device_id);
create index if not exists erp_records_active_idx
  on public.erp_records(scope, deleted, updated_at desc);

alter table public.profiles
  add column if not exists firebase_uid text unique,
  add column if not exists substation_id text null;

create or replace function public.set_server_received_at()
returns trigger
language plpgsql
as $$
begin
  new.server_received_at = timezone('utc', now());
  new.updated_at = timezone('utc', now());
  if tg_op = 'UPDATE' then
    new.version = coalesce(old.version, 1) + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_erp_records_server_received on public.erp_records;
create trigger trg_erp_records_server_received
before insert or update on public.erp_records
for each row
execute function public.set_server_received_at();

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
      select p.role
      from public.profiles p
      where p.firebase_uid = public.current_firebase_uid()
         or p.auth_user_id::text = public.current_firebase_uid()
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
       or p.auth_user_id::text = public.current_firebase_uid()
    limit 1
  );
$$;

create or replace function public.can_access_substation(target_substation text)
returns boolean
language sql
stable
as $$
  select case
    when public.current_profile_role() = 'super_admin' then true
    when public.current_profile_role() = 'substation_admin' then target_substation = public.current_profile_substation()
    else target_substation = public.current_profile_substation()
  end;
$$;

alter table public.erp_records enable row level security;

drop policy if exists erp_records_select_policy on public.erp_records;
create policy erp_records_select_policy
  on public.erp_records
  for select
  using (
    public.current_profile_role() = 'super_admin'
    or public.can_access_substation(substation_id)
  );

drop policy if exists erp_records_insert_policy on public.erp_records;
create policy erp_records_insert_policy
  on public.erp_records
  for insert
  with check (
    public.current_profile_role() = 'super_admin'
    or (
      public.can_access_substation(substation_id)
      and (
        public.current_profile_role() = 'substation_admin'
        or owner_user_id = public.current_firebase_uid()
      )
    )
  );

drop policy if exists erp_records_update_policy on public.erp_records;
create policy erp_records_update_policy
  on public.erp_records
  for update
  using (
    public.current_profile_role() = 'super_admin'
    or public.can_access_substation(substation_id)
  )
  with check (
    public.current_profile_role() = 'super_admin'
    or (
      public.can_access_substation(substation_id)
      and (
        public.current_profile_role() = 'substation_admin'
        or owner_user_id = public.current_firebase_uid()
      )
    )
  );

drop policy if exists erp_records_delete_policy on public.erp_records;
create policy erp_records_delete_policy
  on public.erp_records
  for delete
  using (public.current_profile_role() = 'super_admin');
