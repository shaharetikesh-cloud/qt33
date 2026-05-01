-- QT33: Fix bigint/user-id mismatches for Firebase UID + UUID flows
-- Date: 2026-05-01
-- Safe, idempotent migration.
--
-- 1) Run this SELECT first to inspect live column types:
-- select table_name, column_name, data_type, udt_name
-- from information_schema.columns
-- where table_schema = 'public'
--   and (
--     (table_name = 'profiles' and column_name in ('id', 'auth_user_id', 'firebase_uid', 'created_by_profile_id', 'parent_admin_id'))
--     or (table_name = 'substations' and column_name in ('id', 'admin_user_id', 'created_by_auth_user_id', 'created_by_profile_id', 'parent_admin_id', 'owner_profile_id'))
--     or (table_name = 'user_substation_mappings' and column_name in ('user_id', 'substation_id'))
--     or (table_name = 'erp_records' and column_name in ('owner_user_id', 'updated_by', 'substation_id'))
--   )
-- order by table_name, column_name;

begin;

do $$
declare
  rec record;
begin
  for rec in
    select table_name, column_name, data_type, udt_name
    from information_schema.columns
    where table_schema = 'public'
      and (
        (table_name = 'profiles' and column_name in ('id', 'auth_user_id', 'firebase_uid', 'created_by_profile_id', 'parent_admin_id'))
        or (table_name = 'substations' and column_name in ('id', 'admin_user_id', 'created_by_auth_user_id', 'created_by_profile_id', 'parent_admin_id', 'owner_profile_id'))
        or (table_name = 'user_substation_mappings' and column_name in ('user_id', 'substation_id'))
        or (table_name = 'erp_records' and column_name in ('owner_user_id', 'updated_by', 'substation_id'))
      )
    order by table_name, column_name
  loop
    raise notice '[schema] %.% => data_type=%, udt_name=%',
      rec.table_name, rec.column_name, rec.data_type, rec.udt_name;
  end loop;
end $$;

-- Firebase/UUID identity columns should be text in this project.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'auth_user_id'
      and data_type in ('smallint', 'integer', 'bigint', 'numeric')
  ) then
    alter table public.profiles alter column auth_user_id type text using auth_user_id::text;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'substations' and column_name = 'admin_user_id'
      and data_type in ('smallint', 'integer', 'bigint', 'numeric')
  ) then
    alter table public.substations alter column admin_user_id type text using admin_user_id::text;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'substations' and column_name = 'created_by_auth_user_id'
      and data_type in ('smallint', 'integer', 'bigint', 'numeric')
  ) then
    alter table public.substations alter column created_by_auth_user_id type text using created_by_auth_user_id::text;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_substation_mappings' and column_name = 'user_id'
      and data_type in ('smallint', 'integer', 'bigint', 'numeric')
  ) then
    alter table public.user_substation_mappings alter column user_id type text using user_id::text;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'erp_records' and column_name = 'owner_user_id'
      and data_type in ('smallint', 'integer', 'bigint', 'numeric')
  ) then
    alter table public.erp_records alter column owner_user_id type text using owner_user_id::text;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'erp_records' and column_name = 'updated_by'
      and data_type in ('smallint', 'integer', 'bigint', 'numeric')
  ) then
    alter table public.erp_records alter column updated_by type text using updated_by::text;
  end if;
end $$;

create index if not exists profiles_auth_user_id_idx on public.profiles(auth_user_id);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'substations'
      and column_name = 'admin_user_id'
  ) then
    execute 'create index if not exists substations_admin_user_id_idx on public.substations(admin_user_id)';
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_substation_mappings'
      and column_name = 'user_id'
  ) then
    execute 'create index if not exists user_substation_mappings_user_id_idx on public.user_substation_mappings(user_id)';
  end if;
end $$;

commit;

