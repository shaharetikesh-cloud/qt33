# Production Hardening Report

## 1) Root Cause Issues Found

- Outbox queue lacked deterministic dedupe keys, allowing duplicate sync attempts after refresh/restart.
- Sync retries were linear and immediate; no exponential backoff or `next_retry_at`.
- Conflict handling relied on naive overwrite behavior and did not detect stale-device edits.
- No strict metadata for multi-device attribution (`device_id`, `updated_by`, `client_updated_at`).
- Read model used broad fetch patterns and no incremental cursor strategy.
- Existing RLS patterns were not fully scoped to Firebase UID + substation boundaries for generic ERP records.

## 2) Files Updated

- `src/lib/indexedDb.js`
- `src/lib/syncEngine.js`
- `src/lib/localApi.js`
- `src/lib/clientIdentity.js`
- `public/sw.js`
- `supabase/production_hardening.sql`
- `scripts/migrate-legacy-to-erp-records.mjs`
- `package.json`

## 3) Final Sync Engine Improvements

- Device-aware queue with dedupe key: `queue_key = entity_type:id:device_id`.
- Outbox schema now tracks:
  - `id`
  - `entity_type`
  - `operation_type`
  - `payload`
  - `sync_status`
  - `retry_count`
  - `last_error`
  - `updated_at`
  - `device_id`
- Exponential backoff with `next_retry_at`.
- Tombstone-based deletes (`deleted=true`) to prevent ghost record resurrection.
- Debounced scheduling (`scheduleSync`) and visibility-triggered sync.
- Incremental pull cursor per scope (`sync_cursor:<scope>`) to avoid full-table reload.

## 4) Conflict Handling Logic

- Conflict detection compares:
  - `base_server_updated_at` from the device edit start point
  - current server `updated_at`
  - changed field overlap
- If stale-device overlap detected:
  - operation is marked failed with explicit conflict error
  - no silent overwrite
- If no overlap or same device:
  - safe merge and version bump

## 5) Security Validation (RLS + Firebase JWT)

- Added hardened SQL in `supabase/production_hardening.sql`:
  - `current_firebase_uid()`
  - `current_profile_role()`
  - `current_profile_substation()`
  - `can_access_substation()`
- RLS enforced for `erp_records`:
  - Main Admin: full
  - Substation Admin: same substation
  - User: own entry writes within same substation
- Includes `firebase_uid` backfill-ready column on `profiles`.

## 6) Migration Script

- `scripts/migrate-legacy-to-erp-records.mjs`
- Handles legacy exports from `local-data/` and upserts into `erp_records`.
- Dedupes by stable `id` (`onConflict: id`) to prevent duplicates.

## 7) Performance Improvements

- IndexedDB indexes for scope and updated ordering.
- Outbox retry index for scalable pending scan.
- Incremental server pull by `updated_at` cursor.
- Batch sync sizing and debounced trigger reduce UI jitter/network spikes.
- SQL includes query-critical indexes (`scope+updated_at`, `substation_id`, `owner_user_id`, `device_id`).

## 8) Final Go-Live Checklist

1. Apply `supabase/production_hardening.sql`.
2. Backfill `profiles.firebase_uid`, `role`, `substation_id`.
3. Deploy admin edge functions and set `VITE_SUPABASE_ADMIN_FUNCTIONS=true`.
4. Run `npm run migrate:legacy:erp` with service role key in secure env.
5. Validate with test matrix:
   - same user on 2 devices editing same day
   - 100+ concurrent write operations
   - offline create/update/delete then reconnect
   - cross-substation access denial checks
6. Monitor failed/conflict queue counts in UI and logs for first rollout week.
7. Enable Cloudflare production caching + Brotli, confirm service worker offline boot path.
