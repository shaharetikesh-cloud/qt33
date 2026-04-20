# Unified ERP Cloud Migration (Production)

## Target Architecture

- **Auth**: Firebase Authentication (email/password + forgot password)
- **Primary DB**: Supabase PostgreSQL (`erp_records`, `profiles`, `substations`)
- **Offline DB**: IndexedDB (`records`, `outbox`)
- **Sync**: Browser-driven queue with retries + online listeners
- **Hosting**: Cloudflare Pages (static Vite build + edge cache)

## New Folder/Module Layout

- `src/lib/firebase.js`: Firebase app/auth bootstrap
- `src/lib/supabase.js`: Supabase client with Firebase token injection
- `src/lib/indexedDb.js`: IndexedDB wrapper and sync queue tables
- `src/lib/syncEngine.js`: Auto sync engine (`navigator.onLine` + retry)
- `src/lib/localApi.js`: Data-access facade now backed by IndexedDB + Supabase

## Sync Model

Each offline record uses:

- `id`
- `payload`
- `sync_status` (`pending` / `synced` / `failed`)
- `updated_at`

Writes always go to IndexedDB first, then queue into outbox.  
When online, outbox pushes to Supabase and marks synced.  
Retries run up to 5 attempts before `failed`.

## Conflict Strategy

Last-write-wins with `updated_at`.

- All writes include `updated_at`.
- Supabase upserts by `id`.
- Newer client write replaces older record.

## Supabase SQL + RLS

Apply this in Supabase SQL editor:

```sql
create table if not exists public.erp_records (
  id text primary key,
  scope text not null,
  payload jsonb not null default '{}'::jsonb,
  substation_id text null,
  owner_user_id text null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  firebase_uid text unique,
  auth_user_id text unique,
  email text,
  username text,
  full_name text,
  mobile text,
  role text not null default 'normal_user',
  substation_id text null,
  is_active boolean not null default true,
  module_permissions jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.erp_records enable row level security;
alter table public.profiles enable row level security;

-- assumes JWT `sub` = Firebase UID and role claim optional
create policy "main-admin full records"
on public.erp_records
for all
using (
  exists (
    select 1 from public.profiles p
    where (p.firebase_uid = auth.jwt()->>'sub' or p.auth_user_id = auth.jwt()->>'sub')
      and p.role = 'super_admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where (p.firebase_uid = auth.jwt()->>'sub' or p.auth_user_id = auth.jwt()->>'sub')
      and p.role = 'super_admin'
  )
);

create policy "substation scoped records"
on public.erp_records
for all
using (
  exists (
    select 1 from public.profiles p
    where (p.firebase_uid = auth.jwt()->>'sub' or p.auth_user_id = auth.jwt()->>'sub')
      and p.role in ('substation_admin', 'normal_user', 'viewer')
      and coalesce(p.substation_id, '') = coalesce(erp_records.substation_id, '')
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where (p.firebase_uid = auth.jwt()->>'sub' or p.auth_user_id = auth.jwt()->>'sub')
      and p.role in ('substation_admin', 'normal_user', 'viewer')
      and coalesce(p.substation_id, '') = coalesce(erp_records.substation_id, '')
  )
);
```

## Firebase Setup

1. Enable Email/Password provider.
2. Add project web app and copy keys to `.env`.
3. Configure password reset template URL to your Cloudflare Pages URL.
4. Ensure Firebase UID is stored in `profiles.firebase_uid`.

## Cloudflare Pages Deployment

1. Build command: `npm run build`
2. Build output: `dist`
3. Add env vars:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_APP_ID`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
4. Enable Cloudflare cache and Brotli for static assets.
5. Add SPA fallback for route handling.
6. Keep `public/_headers` and `public/_redirects` in deployment artifacts.

## Migration Checklist

1. Export old SQL/Firebase/local snapshots.
2. Import legacy entities into `erp_records` by scope.
3. Import users into Firebase Auth; map each UID in `profiles`.
4. Verify role/substation policies with test users.
5. Launch canary users; validate offline capture + sync recovery.
6. Decommission old local SQL server and localStorage duplication.

## Phase 2 Hardening (Applied)

- Added optional Supabase Edge Function admin bridge:
  - `admin-create-user`
  - `admin-disable-user`
  - `admin-reset-user-password`
- Toggle via `VITE_SUPABASE_ADMIN_FUNCTIONS=true`.
- Added one-time legacy localStorage migration:
  - Reads `umsw.v1.*` scopes
  - Moves data into IndexedDB + outbox queue
  - Marks completion with `umsw.v2.legacy-migrated=1`

## Phase 3 Hardening (Applied)

- Added Supabase Edge Functions with role/scope checks:
  - `admin-create-user`
  - `admin-disable-user`
  - `admin-reset-user-password`
- Added shared function auth utility:
  - Verifies Firebase ID token using `FIREBASE_WEB_API_KEY`
  - Loads actor profile and enforces admin permissions
- Added deployment guide in `supabase/functions/README.md`

### Edge Function Deploy Commands

```bash
supabase functions deploy admin-create-user
supabase functions deploy admin-disable-user
supabase functions deploy admin-reset-user-password
```
