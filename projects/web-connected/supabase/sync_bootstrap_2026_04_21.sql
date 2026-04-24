-- Bootstrap missing cloud-sync tables for legacy projects.
-- Safe to run multiple times.

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
create index if not exists erp_records_scope_deleted_updated_idx
  on public.erp_records(scope, deleted, updated_at desc);

create or replace function public.set_erp_records_timestamps()
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

drop trigger if exists trg_erp_records_timestamps on public.erp_records;
create trigger trg_erp_records_timestamps
before insert or update on public.erp_records
for each row
execute function public.set_erp_records_timestamps();

create table if not exists public.substations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text,
  division text,
  location text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists substations_name_idx on public.substations(name);

