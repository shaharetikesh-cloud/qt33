-- Additive-safe migration for Firebase + Supabase profile compatibility.
-- Non-destructive: preserves existing owner/main admin rows.

alter table if exists public.profiles
  add column if not exists id uuid default gen_random_uuid();

alter table if exists public.profiles
  add column if not exists username text;

alter table if exists public.profiles
  add column if not exists mobile text;

alter table if exists public.profiles
  add column if not exists module_permissions jsonb not null default '{}'::jsonb;

alter table if exists public.profiles
  add column if not exists must_change_password boolean not null default false;

alter table if exists public.profiles
  add column if not exists created_by_profile_id uuid;

alter table if exists public.profiles
  add column if not exists parent_admin_id uuid;

alter table if exists public.profiles
  add column if not exists email_verified boolean not null default false;

alter table if exists public.profiles
  add column if not exists last_login_at timestamptz;

create unique index if not exists profiles_id_unique_idx on public.profiles(id);
create index if not exists profiles_email_idx on public.profiles(lower(email));
create index if not exists profiles_created_by_profile_id_idx on public.profiles(created_by_profile_id);
create index if not exists profiles_parent_admin_id_idx on public.profiles(parent_admin_id);

create table if not exists public.app_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id text not null,
  actor_email text,
  action text not null,
  context_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.visitor_hits (
  id bigint generated always as identity primary key,
  visitor_key text not null,
  visit_day date not null,
  first_seen_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  unique(visitor_key, visit_day)
);

create index if not exists visitor_hits_visit_day_idx on public.visitor_hits(visit_day);
