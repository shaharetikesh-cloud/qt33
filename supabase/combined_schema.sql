create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  phone text,
  role text not null default 'substation_user' check (role in ('super_admin', 'admin', 'substation_user')),
  is_active boolean not null default false,
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.substations (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  district text,
  circle text,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  owner_auth_user_id uuid not null references auth.users(id) on delete cascade,
  substation_id uuid references public.substations(id) on delete set null,
  employee_code text,
  full_name text not null,
  designation text,
  phone text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists employees_owner_employee_code_idx
  on public.employees (owner_auth_user_id, employee_code)
  where employee_code is not null;

create table if not exists public.attendance_sheets (
  id uuid primary key default gen_random_uuid(),
  owner_auth_user_id uuid not null references auth.users(id) on delete cascade,
  substation_id uuid references public.substations(id) on delete set null,
  sheet_type text not null check (sheet_type in ('simple', 'advance_shift', 'operator_chart')),
  month_key text not null,
  employee_scope text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists attendance_owner_scope_unique_idx
  on public.attendance_sheets (
    owner_auth_user_id,
    sheet_type,
    month_key,
    coalesce(substation_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(employee_scope, '')
  );

create table if not exists public.dlr_records (
  id uuid primary key default gen_random_uuid(),
  owner_auth_user_id uuid not null references auth.users(id) on delete cascade,
  substation_id uuid references public.substations(id) on delete set null,
  module_name text not null check (
    module_name in (
      'daily_log',
      'battery',
      'fault',
      'maintenance',
      'charge_handover',
      'report_snapshot',
      'substation_note'
    )
  ),
  record_key text not null,
  operational_date date,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists dlr_records_owner_module_record_key_idx
  on public.dlr_records (owner_auth_user_id, module_name, record_key);

create table if not exists public.login_audit (
  id bigint generated always as identity primary key,
  auth_user_id uuid references auth.users(id) on delete set null,
  email text,
  action text not null check (
    action in (
      'login',
      'logout',
      'reset_requested',
      'password_updated',
      'signup_requested',
      'admin_approved',
      'admin_rejected'
    )
  ),
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create or replace function public.current_user_role()
returns text
language sql
stable
as $$
  select coalesce(
    (
      select p.role
      from public.profiles p
      where p.auth_user_id = auth.uid()
    ),
    'substation_user'
  );
$$;

create or replace function public.is_admin_user()
returns boolean
language sql
stable
as $$
  select public.current_user_role() in ('super_admin', 'admin');
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists trg_substations_updated_at on public.substations;
create trigger trg_substations_updated_at
before update on public.substations
for each row
execute function public.set_updated_at();

drop trigger if exists trg_employees_updated_at on public.employees;
create trigger trg_employees_updated_at
before update on public.employees
for each row
execute function public.set_updated_at();

drop trigger if exists trg_attendance_sheets_updated_at on public.attendance_sheets;
create trigger trg_attendance_sheets_updated_at
before update on public.attendance_sheets
for each row
execute function public.set_updated_at();

drop trigger if exists trg_dlr_records_updated_at on public.dlr_records;
create trigger trg_dlr_records_updated_at
before update on public.dlr_records
for each row
execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.substations enable row level security;
alter table public.employees enable row level security;
alter table public.attendance_sheets enable row level security;
alter table public.dlr_records enable row level security;
alter table public.login_audit enable row level security;

drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin
  on public.profiles
  for select
  using (auth.uid() = auth_user_id or public.is_admin_user());

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
  on public.profiles
  for insert
  with check (auth.uid() = auth_user_id);

drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self_or_admin
  on public.profiles
  for update
  using (auth.uid() = auth_user_id or public.is_admin_user())
  with check (auth.uid() = auth_user_id or public.is_admin_user());

drop policy if exists profiles_delete_admin_only on public.profiles;
create policy profiles_delete_admin_only
  on public.profiles
  for delete
  using (public.is_admin_user());

drop policy if exists substations_select_authenticated on public.substations;
create policy substations_select_authenticated
  on public.substations
  for select
  using (auth.role() = 'authenticated');

drop policy if exists substations_admin_insert on public.substations;
create policy substations_admin_insert
  on public.substations
  for insert
  with check (public.is_admin_user());

drop policy if exists substations_admin_update on public.substations;
create policy substations_admin_update
  on public.substations
  for update
  using (public.is_admin_user())
  with check (public.is_admin_user());

drop policy if exists substations_admin_delete on public.substations;
create policy substations_admin_delete
  on public.substations
  for delete
  using (public.is_admin_user());

drop policy if exists employees_select_owner_or_admin on public.employees;
create policy employees_select_owner_or_admin
  on public.employees
  for select
  using (owner_auth_user_id = auth.uid() or public.is_admin_user());

drop policy if exists employees_insert_owner_or_admin on public.employees;
create policy employees_insert_owner_or_admin
  on public.employees
  for insert
  with check (owner_auth_user_id = auth.uid() or public.is_admin_user());

drop policy if exists employees_update_owner_or_admin on public.employees;
create policy employees_update_owner_or_admin
  on public.employees
  for update
  using (owner_auth_user_id = auth.uid() or public.is_admin_user())
  with check (owner_auth_user_id = auth.uid() or public.is_admin_user());

drop policy if exists employees_delete_owner_or_admin on public.employees;
create policy employees_delete_owner_or_admin
  on public.employees
  for delete
  using (owner_auth_user_id = auth.uid() or public.is_admin_user());

drop policy if exists attendance_select_owner_or_admin on public.attendance_sheets;
create policy attendance_select_owner_or_admin
  on public.attendance_sheets
  for select
  using (owner_auth_user_id = auth.uid() or public.is_admin_user());

drop policy if exists attendance_insert_owner_or_admin on public.attendance_sheets;
create policy attendance_insert_owner_or_admin
  on public.attendance_sheets
  for insert
  with check (owner_auth_user_id = auth.uid() or public.is_admin_user());

drop policy if exists attendance_update_owner_or_admin on public.attendance_sheets;
create policy attendance_update_owner_or_admin
  on public.attendance_sheets
  for update
  using (owner_auth_user_id = auth.uid() or public.is_admin_user())
  with check (owner_auth_user_id = auth.uid() or public.is_admin_user());

drop policy if exists attendance_delete_owner_or_admin on public.attendance_sheets;
create policy attendance_delete_owner_or_admin
  on public.attendance_sheets
  for delete
  using (owner_auth_user_id = auth.uid() or public.is_admin_user());

drop policy if exists dlr_records_select_owner_or_admin on public.dlr_records;
create policy dlr_records_select_owner_or_admin
  on public.dlr_records
  for select
  using (owner_auth_user_id = auth.uid() or public.is_admin_user());

drop policy if exists dlr_records_insert_owner_or_admin on public.dlr_records;
create policy dlr_records_insert_owner_or_admin
  on public.dlr_records
  for insert
  with check (owner_auth_user_id = auth.uid() or public.is_admin_user());

drop policy if exists dlr_records_update_owner_or_admin on public.dlr_records;
create policy dlr_records_update_owner_or_admin
  on public.dlr_records
  for update
  using (owner_auth_user_id = auth.uid() or public.is_admin_user())
  with check (owner_auth_user_id = auth.uid() or public.is_admin_user());

drop policy if exists dlr_records_delete_owner_or_admin on public.dlr_records;
create policy dlr_records_delete_owner_or_admin
  on public.dlr_records
  for delete
  using (owner_auth_user_id = auth.uid() or public.is_admin_user());

drop policy if exists login_audit_admin_select on public.login_audit;
create policy login_audit_admin_select
  on public.login_audit
  for select
  using (public.is_admin_user());

drop policy if exists login_audit_insert_authenticated on public.login_audit;
create policy login_audit_insert_authenticated
  on public.login_audit
  for insert
  with check (
    auth.role() = 'authenticated'
    and (
      auth_user_id is null
      or auth_user_id = auth.uid()
      or public.is_admin_user()
    )
  );

comment on table public.profiles is
  'Profile rows for approved, pending, or rejected users. Admin-created auth users should be provisioned through a secure backend or Edge Function.';
