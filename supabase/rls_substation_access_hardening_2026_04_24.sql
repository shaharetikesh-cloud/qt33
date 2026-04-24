-- RLS hardening migration (2026-04-24)
-- Enforces role-based substation data boundaries at database layer.
--
-- Target rules:
-- 1) super_admin / owner / main_admin => full access
-- 2) substation_admin => only owned/mapped substations + related data
-- 3) normal/substation user => only assigned/mapped substation data
--
-- NOTE:
-- This migration keeps compatibility with Firebase-token derived identity via
-- auth.jwt()->>'sub' fallback.

create extension if not exists pgcrypto;

-- -------------------------------------------------------------------
-- 0) Compatibility columns (if missing)
-- -------------------------------------------------------------------
alter table if exists public.profiles add column if not exists created_by_profile_id uuid;
alter table if exists public.profiles add column if not exists parent_admin_id uuid;
alter table if exists public.profiles add column if not exists substation_id text;
alter table if exists public.profiles add column if not exists firebase_uid text;

alter table if exists public.substations add column if not exists created_by_profile_id uuid;
alter table if exists public.substations add column if not exists parent_admin_id uuid;
alter table if exists public.substations add column if not exists owner_profile_id uuid;
alter table if exists public.substations add column if not exists created_by_auth_user_id text;

create index if not exists substations_created_by_profile_id_idx
  on public.substations(created_by_profile_id);
create index if not exists substations_parent_admin_id_idx
  on public.substations(parent_admin_id);
create index if not exists substations_owner_profile_id_idx
  on public.substations(owner_profile_id);

-- -------------------------------------------------------------------
-- 1) Identity + role resolver helpers
-- -------------------------------------------------------------------
create or replace function public.current_actor_uid_text()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt()->>'sub', auth.uid()::text, '');
$$;

create or replace function public.current_actor_profile_id_text()
returns text
language sql
stable
as $$
  select p.id::text
  from public.profiles p
  where p.auth_user_id::text = public.current_actor_uid_text()
     or p.firebase_uid = public.current_actor_uid_text()
  limit 1;
$$;

create or replace function public.current_actor_role()
returns text
language sql
stable
as $$
  select coalesce(
    (
      select case
        when lower(coalesce(p.role, '')) in ('owner', 'main_admin', 'super_admin') then 'super_admin'
        when lower(coalesce(p.role, '')) in ('admin', 'substation_admin') then 'substation_admin'
        when lower(coalesce(p.role, '')) in ('user', 'substation_user', 'normal_user') then 'substation_user'
        else lower(coalesce(p.role, 'substation_user'))
      end
      from public.profiles p
      where p.auth_user_id::text = public.current_actor_uid_text()
         or p.firebase_uid = public.current_actor_uid_text()
      limit 1
    ),
    'substation_user'
  );
$$;

create or replace function public.is_super_admin_actor()
returns boolean
language sql
stable
as $$
  select public.current_actor_role() = 'super_admin';
$$;

create or replace function public.is_substation_admin_actor()
returns boolean
language sql
stable
as $$
  select public.current_actor_role() = 'substation_admin';
$$;

-- -------------------------------------------------------------------
-- 2) Substation scope helpers
-- -------------------------------------------------------------------
create or replace function public.actor_profile_substation_text()
returns text
language sql
stable
as $$
  select coalesce(
    (
      select nullif(trim(coalesce(p.substation_id::text, '')), '')
      from public.profiles p
      where p.auth_user_id::text = public.current_actor_uid_text()
         or p.firebase_uid = public.current_actor_uid_text()
      limit 1
    ),
    ''
  );
$$;

create or replace function public.is_substation_owned_by_actor(target_substation_id text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.substations s
    where s.id::text = target_substation_id
      and (
        s.created_by_profile_id::text = public.current_actor_profile_id_text()
        or s.parent_admin_id::text = public.current_actor_profile_id_text()
        or s.owner_profile_id::text = public.current_actor_profile_id_text()
        or s.created_by_auth_user_id = public.current_actor_uid_text()
      )
  );
$$;

create or replace function public.can_access_substation_text(target_substation_id text)
returns boolean
language sql
stable
as $$
  select case
    when target_substation_id is null or trim(target_substation_id) = '' then false
    when public.is_super_admin_actor() then true
    when public.is_substation_admin_actor() then
      (
        target_substation_id = public.actor_profile_substation_text()
        or public.is_substation_owned_by_actor(target_substation_id)
      )
    else target_substation_id = public.actor_profile_substation_text()
  end;
$$;

create or replace function public.resolve_record_substation_text(
  direct_substation text,
  payload jsonb default '{}'::jsonb
)
returns text
language sql
stable
as $$
  select coalesce(
    nullif(trim(coalesce(direct_substation, '')), ''),
    nullif(trim(coalesce(payload->>'substationId', '')), ''),
    nullif(trim(coalesce(payload->>'substation_id', '')), '')
  );
$$;

-- -------------------------------------------------------------------
-- 3) RLS for profiles
-- -------------------------------------------------------------------
alter table if exists public.profiles enable row level security;

drop policy if exists profiles_select_secured_scope on public.profiles;
create policy profiles_select_secured_scope
  on public.profiles
  for select
  using (
    public.is_super_admin_actor()
    or auth_user_id::text = public.current_actor_uid_text()
    or (
      public.is_substation_admin_actor()
      and (
        parent_admin_id::text = public.current_actor_profile_id_text()
        or public.can_access_substation_text(substation_id::text)
      )
    )
  );

drop policy if exists profiles_insert_secured_scope on public.profiles;
create policy profiles_insert_secured_scope
  on public.profiles
  for insert
  with check (
    public.is_super_admin_actor()
    or (
      public.is_substation_admin_actor()
      and (
        lower(coalesce(role, '')) not in ('super_admin', 'owner', 'main_admin')
        and parent_admin_id::text = public.current_actor_profile_id_text()
        and public.can_access_substation_text(substation_id::text)
      )
    )
    or auth_user_id::text = public.current_actor_uid_text()
  );

drop policy if exists profiles_update_secured_scope on public.profiles;
create policy profiles_update_secured_scope
  on public.profiles
  for update
  using (
    public.is_super_admin_actor()
    or auth_user_id::text = public.current_actor_uid_text()
    or (
      public.is_substation_admin_actor()
      and parent_admin_id::text = public.current_actor_profile_id_text()
      and public.can_access_substation_text(substation_id::text)
    )
  )
  with check (
    public.is_super_admin_actor()
    or auth_user_id::text = public.current_actor_uid_text()
    or (
      public.is_substation_admin_actor()
      and lower(coalesce(role, '')) not in ('super_admin', 'owner', 'main_admin')
      and parent_admin_id::text = public.current_actor_profile_id_text()
      and public.can_access_substation_text(substation_id::text)
    )
  );

drop policy if exists profiles_delete_secured_scope on public.profiles;
create policy profiles_delete_secured_scope
  on public.profiles
  for delete
  using (
    public.is_super_admin_actor()
    or (
      public.is_substation_admin_actor()
      and parent_admin_id::text = public.current_actor_profile_id_text()
      and lower(coalesce(role, '')) not in ('super_admin', 'owner', 'main_admin')
      and public.can_access_substation_text(substation_id::text)
    )
  );

-- -------------------------------------------------------------------
-- 4) RLS for substations
-- -------------------------------------------------------------------
alter table if exists public.substations enable row level security;

drop policy if exists substations_select_secured_scope on public.substations;
create policy substations_select_secured_scope
  on public.substations
  for select
  using (
    public.is_super_admin_actor()
    or public.can_access_substation_text(id::text)
  );

drop policy if exists substations_insert_secured_scope on public.substations;
create policy substations_insert_secured_scope
  on public.substations
  for insert
  with check (
    public.is_super_admin_actor()
    or (
      public.is_substation_admin_actor()
      and (
        created_by_profile_id::text = public.current_actor_profile_id_text()
        or parent_admin_id::text = public.current_actor_profile_id_text()
        or owner_profile_id::text = public.current_actor_profile_id_text()
        or created_by_auth_user_id = public.current_actor_uid_text()
      )
    )
  );

drop policy if exists substations_update_secured_scope on public.substations;
create policy substations_update_secured_scope
  on public.substations
  for update
  using (
    public.is_super_admin_actor()
    or (
      public.is_substation_admin_actor()
      and (
        created_by_profile_id::text = public.current_actor_profile_id_text()
        or parent_admin_id::text = public.current_actor_profile_id_text()
        or owner_profile_id::text = public.current_actor_profile_id_text()
        or created_by_auth_user_id = public.current_actor_uid_text()
      )
    )
  )
  with check (
    public.is_super_admin_actor()
    or (
      public.is_substation_admin_actor()
      and (
        created_by_profile_id::text = public.current_actor_profile_id_text()
        or parent_admin_id::text = public.current_actor_profile_id_text()
        or owner_profile_id::text = public.current_actor_profile_id_text()
        or created_by_auth_user_id = public.current_actor_uid_text()
      )
    )
  );

drop policy if exists substations_delete_secured_scope on public.substations;
create policy substations_delete_secured_scope
  on public.substations
  for delete
  using (
    public.is_super_admin_actor()
    or (
      public.is_substation_admin_actor()
      and (
        created_by_profile_id::text = public.current_actor_profile_id_text()
        or parent_admin_id::text = public.current_actor_profile_id_text()
        or owner_profile_id::text = public.current_actor_profile_id_text()
        or created_by_auth_user_id = public.current_actor_uid_text()
      )
    )
  );

-- -------------------------------------------------------------------
-- 5) RLS for erp_records (primary operational data store)
-- -------------------------------------------------------------------
alter table if exists public.erp_records enable row level security;

drop policy if exists erp_records_select_policy on public.erp_records;
create policy erp_records_select_policy
  on public.erp_records
  for select
  using (
    public.is_super_admin_actor()
    or public.can_access_substation_text(
      public.resolve_record_substation_text(substation_id, payload)
    )
  );

drop policy if exists erp_records_insert_policy on public.erp_records;
create policy erp_records_insert_policy
  on public.erp_records
  for insert
  with check (
    public.is_super_admin_actor()
    or (
      public.can_access_substation_text(
        public.resolve_record_substation_text(substation_id, payload)
      )
      and (
        public.is_substation_admin_actor()
        or owner_user_id = public.current_actor_uid_text()
      )
    )
  );

drop policy if exists erp_records_update_policy on public.erp_records;
create policy erp_records_update_policy
  on public.erp_records
  for update
  using (
    public.is_super_admin_actor()
    or public.can_access_substation_text(
      public.resolve_record_substation_text(substation_id, payload)
    )
  )
  with check (
    public.is_super_admin_actor()
    or (
      public.can_access_substation_text(
        public.resolve_record_substation_text(substation_id, payload)
      )
      and (
        public.is_substation_admin_actor()
        or owner_user_id = public.current_actor_uid_text()
      )
    )
  );

drop policy if exists erp_records_delete_policy on public.erp_records;
create policy erp_records_delete_policy
  on public.erp_records
  for delete
  using (
    public.is_super_admin_actor()
    or (
      public.can_access_substation_text(
        public.resolve_record_substation_text(substation_id, payload)
      )
      and (
        public.is_substation_admin_actor()
        or owner_user_id = public.current_actor_uid_text()
      )
    )
  );

-- -------------------------------------------------------------------
-- 6) Optional RLS for legacy/aux tables (if present)
-- -------------------------------------------------------------------
do $$
begin
  if to_regclass('public.employees') is not null then
    execute 'alter table public.employees enable row level security';
    execute 'drop policy if exists employees_select_substation_scope on public.employees';
    execute 'create policy employees_select_substation_scope on public.employees for select using (public.is_super_admin_actor() or public.can_access_substation_text(substation_id::text))';
    execute 'drop policy if exists employees_insert_substation_scope on public.employees';
    execute 'create policy employees_insert_substation_scope on public.employees for insert with check (public.is_super_admin_actor() or public.can_access_substation_text(substation_id::text))';
    execute 'drop policy if exists employees_update_substation_scope on public.employees';
    execute 'create policy employees_update_substation_scope on public.employees for update using (public.is_super_admin_actor() or public.can_access_substation_text(substation_id::text)) with check (public.is_super_admin_actor() or public.can_access_substation_text(substation_id::text))';
    execute 'drop policy if exists employees_delete_substation_scope on public.employees';
    execute 'create policy employees_delete_substation_scope on public.employees for delete using (public.is_super_admin_actor() or public.can_access_substation_text(substation_id::text))';
  end if;

  if to_regclass('public.dlr_records') is not null then
    execute 'alter table public.dlr_records enable row level security';
    execute 'drop policy if exists dlr_records_select_substation_scope on public.dlr_records';
    execute 'create policy dlr_records_select_substation_scope on public.dlr_records for select using (public.is_super_admin_actor() or public.can_access_substation_text(substation_id::text))';
    execute 'drop policy if exists dlr_records_insert_substation_scope on public.dlr_records';
    execute 'create policy dlr_records_insert_substation_scope on public.dlr_records for insert with check (public.is_super_admin_actor() or public.can_access_substation_text(substation_id::text))';
    execute 'drop policy if exists dlr_records_update_substation_scope on public.dlr_records';
    execute 'create policy dlr_records_update_substation_scope on public.dlr_records for update using (public.is_super_admin_actor() or public.can_access_substation_text(substation_id::text)) with check (public.is_super_admin_actor() or public.can_access_substation_text(substation_id::text))';
    execute 'drop policy if exists dlr_records_delete_substation_scope on public.dlr_records';
    execute 'create policy dlr_records_delete_substation_scope on public.dlr_records for delete using (public.is_super_admin_actor() or public.can_access_substation_text(substation_id::text))';
  end if;

  if to_regclass('public.attendance_sheets') is not null then
    execute 'alter table public.attendance_sheets enable row level security';
    execute 'drop policy if exists attendance_sheets_select_substation_scope on public.attendance_sheets';
    execute 'create policy attendance_sheets_select_substation_scope on public.attendance_sheets for select using (public.is_super_admin_actor() or public.can_access_substation_text(substation_id::text))';
    execute 'drop policy if exists attendance_sheets_insert_substation_scope on public.attendance_sheets';
    execute 'create policy attendance_sheets_insert_substation_scope on public.attendance_sheets for insert with check (public.is_super_admin_actor() or public.can_access_substation_text(substation_id::text))';
    execute 'drop policy if exists attendance_sheets_update_substation_scope on public.attendance_sheets';
    execute 'create policy attendance_sheets_update_substation_scope on public.attendance_sheets for update using (public.is_super_admin_actor() or public.can_access_substation_text(substation_id::text)) with check (public.is_super_admin_actor() or public.can_access_substation_text(substation_id::text))';
    execute 'drop policy if exists attendance_sheets_delete_substation_scope on public.attendance_sheets';
    execute 'create policy attendance_sheets_delete_substation_scope on public.attendance_sheets for delete using (public.is_super_admin_actor() or public.can_access_substation_text(substation_id::text))';
  end if;
end
$$;

