# Cloud deployment guide

This package has been upgraded into a **hybrid deployment starter**:
- **Primary UX:** same DLR ERP UI and report logic
- **Offline cache:** IndexedDB in browser
- **Cloud sync:** Supabase tables via `app_records`
- **Authentication:** Supabase email/password
- **Hosting:** Cloudflare Pages
- **Admin visibility:** every login/logout/reset request writes to `login_audit`

## Important scope note
This package is a **practical deployable starter**, not a fully re-engineered backend rewrite of every module. The main app screens, report logic, and local cache remain intact. Cloud mode now handles:
- sign in with email/password
- reset password email
- loading records from Supabase into the app cache
- syncing record upserts/deletes back to Supabase
- login audit logging

## 1) Create Supabase project
1. Create a new Supabase project.
2. In SQL Editor, run `supabase/schema.sql`.
3. In Authentication, enable **Email** provider.
4. Create your first auth user in Supabase Auth.
5. Insert matching row in `public.user_profiles`.

### First admin profile example
```sql
insert into public.user_profiles (auth_user_id, email, full_name, role, assigned_substation_id, is_active)
values (
  'AUTH_USER_UUID_HERE',
  'admin@example.com',
  'Main Admin',
  'MAIN_ADMIN',
  null,
  true
);
```

## 2) Configure frontend
1. Copy `js/cloud-config.js.example` to `js/cloud-config.js`
2. Fill:
   - `supabaseUrl`
   - `supabaseAnonKey`
   - `appInstanceId`

## 3) Seed your existing offline data
Open the app locally first, export backup JSON, then import into the deployed app while signed in as admin.
That import now syncs the imported collections into Supabase.

## 4) Deploy to Cloudflare Pages
You can deploy as a static site.

### Option A: drag-and-drop
Upload the full folder contents to a new Pages project.

### Option B: Git
Push this folder to GitHub and connect the repo to Cloudflare Pages.
Build command: none
Output directory: /

## 5) After first deploy
- open the app URL
- sign in with admin email/password
- import your backup JSON if needed
- verify `login_audit` rows appear in Supabase Table Editor
- create additional auth users in Supabase
- insert matching `user_profiles` rows

## 6) Recommended next hardening work
- move user creation into an Edge Function or admin service
- add conflict resolution UI for simultaneous edits
- add record version column and optimistic locking
- move heavy report exports to a server function
- expose admin screen for login audit table
- add invite flow for user creation from inside the app

## 7) Known limits
- browser still computes most reports locally after syncing data down
- concurrent edits can overwrite each other because current app logic is last-write-wins
- user creation/reset is not yet fully admin-driven from inside the UI; Supabase Auth remains source of truth
- full bug-free certification across every screen was not possible without a much larger end-to-end test cycle
