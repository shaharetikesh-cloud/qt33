# QT33 Offline APK - Phase 0 Parity Lock

## 1) Canonical Path

- Canonical source path: `f:\qt33.in\unified_msedcl_workspace\unified_msedcl_workspace`
- Canonical app identity marker: `.project-root.json` with `projectId = web-connected-canonical`

Deprecated mirror paths (do not edit for parity work):

- `f:\qt33.in\unified_msedcl_workspace\unified_msedcl_workspace\projects\web-connected`
- `f:\qt33.in\unified_msedcl_workspace\unified_msedcl_workspace\qt33`
- `f:\qt33.in\unified_msedcl_workspace\unified_msedcl_workspace\archive\legacy-duplicates\qt33-mirror`
- `f:\qt33.in\unified_msedcl_workspace\qt33_offline_android`

## 2) Golden Fixture Setup

Fixture folder:

- `tests/parity-fixtures/`

Fixture files:

- `daily-log-hourly.fixture.json`
- `ls-slot-mapping.fixture.json`
- `interruption-handling.fixture.json`
- `maintenance-history-linking.fixture.json`
- `feeder-account-summary.fixture.json`
- `asset-account-summary.fixture.json`
- `report-totals.fixture.json`
- `pdf-values.fixture.json`
- `expected-snapshots.json`

Readiness gate test:

- `tests/parity-fixture-integrity.test.js`

How fixtures are used:

- These fixtures are immutable parity references for offline APK migration.
- Any business logic change touching protected areas must compare output against `expected-snapshots.json`.
- If snapshot changes are intentional, approval and snapshot version bump are mandatory.

## 3) Protected Logic Map (No rewrite in Phase 0)

These files are parity-protected and must be wrapped, not redesigned:

- `src/lib/dailyLog.js` (`deriveDailyLogState`, daily log derivations, interruption overlays)
- `src/lib/interruptionSlots.js` (slot and duration mapping)
- `src/lib/reportData.js` (report aggregation builders)
- `src/lib/reportPdf.js` (PDF value rendering and pagination behavior)
- `src/lib/unifiedDataService.js` (record read/write boundary used by reports and history views)
- `src/pages/MaintenancePage.jsx`
- `src/pages/HistoryRegisterPage.jsx`

## 4) Offline Adapter Boundary Plan

Target: isolate cloud-dependent runtime calls behind an adapter profile without changing business formulas.

Adapter profile: `offline-local-single-user`

Runtime split:

- Cloud path (existing): `localApi`, Supabase profile/auth/sync path
- Offline path (target): `embeddedLocalApi` + local persistent store

Phase 0 file-touch plan (minimal, no formula rewrite):

- `src/lib/runtimeConfig.js` (declare explicit `offline-local-single-user` runtime profile)
- `src/lib/nativeRuntime.js` (startup routes all reads/writes to offline adapter for this profile)
- `src/lib/unifiedDataService.js` (adapter selector boundary only, no formula edits)
- `src/context/AuthContext.jsx` (offline profile bypasses cloud login/profile fetch)
- `src/lib/embeddedLocalApi.js` (primary API for offline profile)
- `src/main.jsx` (boot sequence chooses offline startup path)

Non-goal in Phase 0:

- No UI redesign
- No broad page refactor
- No change to protected business-calculation functions

## 5) Restart-Safe Offline Boot Flow

Startup flow for offline APK:

1. App launch
2. Read runtime profile (`offline-local-single-user`)
3. Skip login and Supabase profile fetch path entirely
4. Initialize local DB/storage
5. Load dashboard from local store
6. Recover unsaved local draft if present
7. Continue normal operation fully offline

Mandatory behavior:

- App opens without internet
- App opens without Supabase profile fetch
- App opens without login prompt

## 6) Mobile PDF Safety Strategy

Current risk: heavy raster PDF (`html2canvas`) on low-memory devices.

Phase 0 parity-safe strategy:

- Keep current values and totals source unchanged
- Introduce lightweight preview mode (table summary, no full raster)
- Generate full PDF only on explicit user action
- For long reports, paginate by row chunks before render
- Reuse report DTO totals from `reportData` to prevent drift

## 7) Build Readiness Gate (Before APK Phase-1)

Must pass:

- Golden fixtures present and locked
- Parity fixture integrity test passes
- Offline boot path defined and enforceable
- Offline cold-start test passes in airplane mode (no network)
- Protected logic untouched by redesign
- Daily Log and interruption rules parity maintained
- Maintenance-history linking fixtures stable
- Report totals and PDF value fixtures stable
- No calculation drift against fixture snapshots

Decision:

- **APK Phase-1 readiness: CONDITIONAL HOLD**
- Reason: foundation lock complete; full parity execution in offline runtime must be validated against these fixtures before starting broad APK conversion.
