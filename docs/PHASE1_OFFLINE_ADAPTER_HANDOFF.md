# QT33 Offline APK - Phase 1 Implementation Handoff

Date: 2026-04-28  
Scope: Start Phase-1 offline adapter runtime for Android APK (single-user local mode)

## Objective

Implement the first production-ready offline adapter layer with:

- direct no-login startup
- local-only runtime dependencies
- stable local persistence metadata
- offline backup metadata trail
- mobile-first UI compaction on core operator pages

## Changes Implemented

### 1) Offline runtime profile wiring

Updated:

- `.env.offline`
- `src/lib/envConfig.js`
- `src/lib/firebase.js`
- `src/lib/supabase.js`

What changed:

- Added `VITE_RUNTIME_PROFILE=offline-local-single-user` to offline build profile.
- Env validation now bypasses Firebase/Supabase required keys when offline single-user profile is active.
- Firebase app/auth initialization is skipped entirely in offline single-user profile.
- Supabase client initialization is skipped entirely in offline single-user profile.

Impact:

- No cloud auth/bootstrap runtime dependency for offline profile.
- App can boot directly in offline mode without login and without internet.

### 2) Local DB metadata hardening for offline adapter

Updated:

- `src/lib/embeddedLocalApi.js`

What changed:

- Added record metadata normalizer `withRecordMeta(...)` to enforce:
  - `localUuid` (via `id`)
  - `created_at`
  - `updated_at`
  - `deleted`
  - `version`
  - `backup_timestamp`
- Added persistent `backup_metadata` node in embedded local DB initial state:
  - `last_exported_at`
  - `last_imported_at`
  - `last_restore_at`
  - `app_version`
- Applied metadata normalization on major save/update flows:
  - substations
  - employees
  - attendance sheets
  - dlr records (daily log, maintenance, battery, faults, charge handover, history register via module_name)
  - report snapshots
  - notices
  - feedback entries
- Enhanced backup export/import routes:
  - export now stamps and returns `backupMetadata`
  - import now updates `last_imported_at` and `last_restore_at`

### 3) Mobile-first compaction improvements

Updated:

- `src/responsive-system.css`

What changed:

- Reduced toolbar/header density and heading scale on small screens for:
  - Daily Log
  - Maintenance
  - History Register
  - Report surfaces
- Enforced horizontal-safe table wrappers on targeted pages.
- Improved report preview layout toggle behavior on small screens for touch use.

## Phase-1 Local Storage Structure (Current Runtime)

Primary offline collections (embedded local DB):

- `substations`
- `master_records` (includes feeders/assets via master payloads)
- `employees`
- `attendance_sheets`
- `dlr_records` (covers daily log, maintenance, battery, faults, charge handover, history register module payloads)
- `report_snapshots`
- `app_settings`
- `app_audit_events`
- `login_audit`
- `feedback_entries`
- `notices`
- `user_substation_mappings`
- `backup_metadata`

Per-record metadata envelope:

- `id` (local UUID)
- `created_at`
- `updated_at`
- `deleted`
- `version`
- `backup_timestamp`
- `meta.localUuid`
- `meta.createdAt`
- `meta.updatedAt`
- `meta.deleted`
- `meta.version`
- `meta.backupTimestamp`

## Notes for Next Agent

1. Keep `runtimeProfile=offline-local-single-user` path isolated from cloud-connected profiles.
2. Preserve parity-locked business logic (Daily Log formulas, maintenance linking, report/PDF semantics).
3. Continue Phase-1 by expanding metadata normalization to any remaining persistence branches not yet covered.
4. Execute mandatory real-device test matrix after APK build and record outcomes.
