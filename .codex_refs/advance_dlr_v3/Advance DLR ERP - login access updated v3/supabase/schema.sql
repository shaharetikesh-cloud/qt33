create extension if not exists pgcrypto;

create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique not null references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text not null default '',
  role text not null default 'SUBSTATION_USER' check (role in ('MAIN_ADMIN','SUBSTATION_USER')),
  assigned_substation_id text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_records (
  collection_name text not null,
  record_id text not null,
  substation_id text null,
  payload jsonb not null default '{}'::jsonb,
  updated_by_auth_user_id uuid null references auth.users(id) on delete set null,
  updated_by_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  primary key (collection_name, record_id)
);

create table if not exists public.login_audit (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  action text not null,
  auth_user_id uuid null references auth.users(id) on delete set null,
  email text null,
  metadata jsonb not null default '{}'::jsonb,
  app_instance_id text null
);

create index if not exists idx_app_records_collection on public.app_records(collection_name);
create index if not exists idx_app_records_substation on public.app_records(substation_id);
create index if not exists idx_app_records_updated_at on public.app_records(updated_at desc);
create index if not exists idx_login_audit_created_at on public.login_audit(created_at desc);
create index if not exists idx_login_audit_email on public.login_audit(email);

alter table public.user_profiles enable row level security;
alter table public.app_records enable row level security;
alter table public.login_audit enable row level security;

create or replace function public.current_user_role()
returns text
language sql
stable
as $$
  select coalesce((select role from public.user_profiles where auth_user_id = auth.uid()), 'SUBSTATION_USER');
$$;

create or replace function public.current_user_substation_id()
returns text
language sql
stable
as $$
  select assigned_substation_id from public.user_profiles where auth_user_id = auth.uid();
$$;

create policy "profiles read own or admin"
on public.user_profiles
for select
using (auth.uid() = auth_user_id or public.current_user_role() = 'MAIN_ADMIN');

create policy "profiles update own or admin"
on public.user_profiles
for update
using (auth.uid() = auth_user_id or public.current_user_role() = 'MAIN_ADMIN')
with check (auth.uid() = auth_user_id or public.current_user_role() = 'MAIN_ADMIN');

create policy "records read admin or same substation"
on public.app_records
for select
using (
  public.current_user_role() = 'MAIN_ADMIN'
  or collection_name in ('settings')
  or (
    coalesce(substation_id, '') <> ''
    and substation_id = public.current_user_substation_id()
  )
);

create policy "records write admin or same substation"
on public.app_records
for all
using (
  public.current_user_role() = 'MAIN_ADMIN'
  or (
    coalesce(substation_id, '') <> ''
    and substation_id = public.current_user_substation_id()
  )
)
with check (
  public.current_user_role() = 'MAIN_ADMIN'
  or (
    coalesce(substation_id, '') <> ''
    and substation_id = public.current_user_substation_id()
  )
);

create policy "login audit insert authenticated"
on public.login_audit
for insert
with check (auth.uid() is not null);

create policy "login audit read admin only"
on public.login_audit
for select
using (public.current_user_role() = 'MAIN_ADMIN');
