# Unified MSEDCL Workspace Full Audit

Date: 2026-04-12
Source of truth: current unified workspace only
Mode: local codebase audit + immediate critical fix phase

## Phase 1 Affected Files

- `src/index.css`
- `src/components/AppShell.jsx`
- `src/lib/uiPreferences.js`
- `src/components/ui/AppIcon.jsx`
- `src/App.jsx`
- `src/pages/DailyLogPage.jsx`
- `src/pages/AttendancePage.jsx`
- `src/pages/BatteryPage.jsx`
- `src/pages/FaultsPage.jsx`
- `src/pages/MaintenancePage.jsx`
- `src/pages/ChargeHandoverPage.jsx`

## Expected Result For Current Fix Phase

- Expand Workspace must actually change root layout, not only button state.
- Sidebar collapse and full workspace mode must expand the main content wrapper.
- Focus/entry pages must hide helper and secondary panels in expanded mode.
- Daily Log and Attendance must feel closer to spreadsheet-style working canvases.
- Admin-only pages must be route-protected, not just hidden from the menu.

## Section 1: Current Architecture Summary

### Frontend structure

- React 19 + Vite + `HashRouter`
- Main entry:
  - `src/main.jsx`
  - `src/App.jsx`
- Protected app shell:
  - `src/components/AppShell.jsx`
- Global auth/session:
  - `src/context/AuthContext.jsx`
- Global styling:
  - `src/index.css`

### Backend / persistence structure

- Local auth + local SQL server:
  - `server/index.js`
  - `src/lib/localApi.js`
- Browser-side storage for business data:
  - `src/lib/storageAdapter.js`
  - `src/lib/unifiedDataService.js`
- Runtime switching:
  - `src/lib/runtimeConfig.js`
  - `src/lib/supabase.js`

### Business modules

- Dashboard: `src/pages/HomePage.jsx`
- Administration:
  - `SubstationsPage.jsx`
  - `EmployeesPage.jsx`
  - `MastersPage.jsx`
  - `UsersPage.jsx`
  - `AuditPage.jsx`
  - `SessionPage.jsx`
- Operations:
  - `AttendancePage.jsx`
  - `DailyLogPage.jsx`
  - `BatteryPage.jsx`
  - `FaultsPage.jsx`
  - `MaintenancePage.jsx`
  - `ChargeHandoverPage.jsx`
  - `HistoryRegisterPage.jsx`
- Reports:
  - `ReportCenterPage.jsx`
  - `MonthEndPackPage.jsx`

### Reporting stack

- Shared report primitives:
  - `src/components/reporting/ReportPrimitives.jsx`
- Concrete layouts:
  - `src/components/reporting/ReportLayouts.jsx`
- Export actions:
  - `src/components/reporting/ReportActions.jsx`
- Report builders/calculations:
  - `src/lib/reportData.js`
- PDF path:
  - `src/lib/reportPdf.js`
- Share/export helpers:
  - `src/lib/shareUtils.js`
  - `src/lib/exportUtils.js`

### State management

- Mostly page-local `useState`
- Auth/session in `AuthContext`
- No dedicated app-wide store for reference data, UI shell state, or report state
- UI preferences persisted in `src/lib/uiPreferences.js`

### Styling structure

- One very large CSS file:
  - `src/index.css` is the main styling source and currently exceeds 2,000 lines
- Styling is powerful but highly centralized, which increases regression risk

### Naming consistency

- Mostly readable at page/component level
- Data fields are mixed camelCase and snake_case because of hybrid frontend/local API contracts
- This is manageable now but creates long-term mapping noise

### Dead / duplicated / stale assets

- `src/App.css` appears unused
- Default Vite assets remain:
  - `src/assets/react.svg`
  - `src/assets/vite.svg`
  - `src/assets/hero.png`
- `dist/` exists inside workspace and should be treated as generated output, not source

## Section 2: Working Features

### Working well

- Local SQL login, logout, signup, forgot-password, reset-password
- Compact header + grouped sidebar shell
- Daily Log advanced business engine:
  - 00:00 carry-forward
  - KWH continuity validation
  - meter change segment handling
  - pending gap vs finalize-day auto LS
  - interruption consolidation
  - derived analytics
- Shared report rendering:
  - one report source reused for preview / print / PDF / share
- Battery / Fault / Maintenance / Charge Handover basic entry + report screens
- Attendance monthly editing and print views
- Report Center and Month-End Pack preview/export flows
- User management and local login audit
- Role-aware menu visibility

### Partially working

- Expand Workspace / focus mode
  - major blockers fixed in current phase
  - still needs user acceptance pass across all pages
- Report preview centering
  - architecture is in place
  - needs final visual QA on all report families
- Attendance and DLR data parity
  - core flows exist
  - full production parity still depends on deeper edge-case validation
- Localhost-first architecture
  - works for testing
  - persistence remains split between SQLite and browser localStorage

### Missing or not present

- Notice Board module
- Feedback / Suggestion module
- Issue ticketing / escalation flow
- Dedicated approval workflow UI
- Attachments / evidence upload
- Server-side DLR persistence

## Section 3: Bugs / Issues Found

### 1. Root shell width bug kept workspace narrow

- Severity: Critical
- Module: Global UI shell
- Exact files:
  - `src/index.css`
- Root cause:
  - legacy `.app-shell` grid rules still reserved a fixed left column even after new workspace-body logic was added
- Reproduction:
  1. Open Daily Log
  2. Click `Expand Workspace`
  3. Observe content still looks narrow or left-bound
- Expected:
  - root workspace should fully expand
- Actual:
  - content remained constrained by the old shell grid
- Recommended fix:
  - override `.app-shell` to full-width block layout and let `.workspace-body` own the grid
- Status:
  - Fixed in current phase

### 2. Expand Workspace button changed UI state but not full layout hierarchy

- Severity: Critical
- Module: App shell / focus mode
- Exact files:
  - `src/components/AppShell.jsx`
  - `src/lib/uiPreferences.js`
  - `src/index.css`
- Root cause:
  - expanded state was not propagated strongly enough to root/body/layout wrappers
- Reproduction:
  1. Toggle Expand Workspace
  2. Sidebar changed visually
  3. Child layout still did not fully switch to single-column mode
- Expected:
  - expanded mode should alter root layout, sidebar visibility, and content width together
- Actual:
  - state change was only partially applied
- Recommended fix:
  - add root class, body class, and stronger expanded-mode CSS
- Status:
  - Fixed in current phase

### 3. Secondary helper panels remained visible in focus mode

- Severity: High
- Module: Daily Log / Attendance / entry pages
- Exact files:
  - `src/pages/DailyLogPage.jsx`
  - `src/pages/AttendancePage.jsx`
  - `src/pages/BatteryPage.jsx`
  - `src/pages/FaultsPage.jsx`
  - `src/pages/MaintenancePage.jsx`
  - `src/pages/ChargeHandoverPage.jsx`
  - `src/index.css`
- Root cause:
  - pages lacked consistent `primary` vs `secondary` panel markers
- Reproduction:
  1. Open any entry page
  2. Expand workspace
  3. Observe register/preview/helper cards still consuming working area
- Expected:
  - only main working panel should remain in focus mode
- Actual:
  - helper panels still appeared on several pages
- Recommended fix:
  - classify page sections and hide secondary panels in expanded mode
- Status:
  - Fixed in current phase for core operations pages

### 4. Admin-only pages were hidden in menu but not route-protected

- Severity: High
- Module: Routing / access control
- Exact files:
  - `src/App.jsx`
- Root cause:
  - menu-level hiding existed, but route-level admin guard was missing for `masters`, `users`, and `audit`
- Reproduction:
  1. Login as non-admin
  2. Open direct URL/hash route
  3. Page route still renders
- Expected:
  - direct route access should be blocked
- Actual:
  - direct navigation bypassed menu-level restriction
- Recommended fix:
  - wrap admin-only routes in `AdminOnlyPage`
- Status:
  - Fixed in current phase

### 5. Data is split between SQLite and localStorage

- Severity: Critical
- Module: Architecture / persistence
- Exact files:
  - `server/index.js`
  - `src/lib/localApi.js`
  - `src/lib/unifiedDataService.js`
  - `src/lib/storageAdapter.js`
- Root cause:
  - auth/substations/employees are persisted in SQLite, but masters/settings/mappings/attendance/DLR/report snapshots are stored in browser localStorage
- Reproduction:
  1. Save DLR or attendance data on one browser
  2. Login from another browser or clear storage
  3. Observe mismatch with server-backed auth/master data
- Expected:
  - one authoritative persistence layer
- Actual:
  - hybrid persistence causes drift, loss risk, and audit inconsistency
- Recommended fix:
  - move business data into local API / SQLite now, keep localStorage only as offline cache
- Status:
  - Open

### 6. Local SQL APIs ignore user-substation mapping restrictions

- Severity: Critical
- Module: Access control / data visibility
- Exact files:
  - `server/index.js`
  - `src/pages/SubstationsPage.jsx`
  - `src/pages/EmployeesPage.jsx`
  - `src/lib/unifiedDataService.js`
- Root cause:
  - client-side mapping logic exists in `unifiedDataService`, but local SQL endpoints do not enforce substation mapping
- Reproduction:
  1. Use non-admin user in local SQL mode
  2. Query substations / employees
  3. Results are filtered by owner/admin rules, not true user-substation mapping
- Expected:
  - all data access paths should follow the same substation restriction policy
- Actual:
  - SQLite-backed pages and localStorage-backed pages use different visibility rules
- Recommended fix:
  - add user-substation mapping tables/endpoints in SQLite and enforce them server-side
- Status:
  - Open

### 7. PDF generation is screenshot-based, not document-native

- Severity: High
- Module: Reports / print engine
- Exact files:
  - `src/lib/reportPdf.js`
  - `src/components/reporting/ReportActions.jsx`
- Root cause:
  - `html2canvas` rasterizes report DOM into one long image, then slices it into PDF pages
- Reproduction:
  1. Generate long report
  2. Export PDF
  3. Compare with print preview/header repetition/page breaks
- Expected:
  - structured multi-page PDF matching table header repeat and page-break rules
- Actual:
  - raster PDF risks blurry text, weak pagination, and inconsistent multi-page behavior
- Recommended fix:
  - add a document-native PDF path or server-assisted PDF renderer for long office reports
- Status:
  - Open

### 8. Daily Log page and business engine are too large and tightly coupled

- Severity: High
- Module: Daily Log
- Exact files:
  - `src/pages/DailyLogPage.jsx`
  - `src/lib/dailyLog.js`
- Root cause:
  - page orchestration, entry UX, status handling, derived state, and report wiring remain concentrated in a few oversized files
- Reproduction:
  - read/change code in Daily Log flow
- Expected:
  - smaller modules for toolbar, interruption editor, meter change editor, register list, report actions, and engine slices
- Actual:
  - regression risk is high and onboarding cost is high
- Recommended fix:
  - split page UI and split engine into carry-forward, validation, event resolution, analytics, and layout config modules
- Status:
  - Open

### 9. Notice Board and Feedback modules are missing

- Severity: Medium
- Module: Functional coverage
- Exact files:
  - no route/pages/components currently present
- Root cause:
  - modules not yet implemented
- Reproduction:
  - check routes and navigation
- Expected:
  - Notice Board and Feedback/Suggestion modules exist
- Actual:
  - modules are absent
- Recommended fix:
  - add routes, storage contracts, page shells, and admin moderation flow
- Status:
  - Open

### 10. Business data has no server-side validation in local mode

- Severity: High
- Module: Data integrity
- Exact files:
  - `src/lib/unifiedDataService.js`
  - `src/lib/storageAdapter.js`
  - page-level save flows across DLR and attendance modules
- Root cause:
  - DLR and attendance records are validated only on the client and then written directly to browser localStorage
- Reproduction:
  1. Manipulate browser storage or bypass UI
  2. Invalid records can exist without server validation
- Expected:
  - authoritative validation at persistence layer
- Actual:
  - browser is the authority for most business records
- Recommended fix:
  - move save/load validation to local API and use browser storage only for drafts/cache
- Status:
  - Open

## Section 4: Logic Problems

### Daily Log

- Carry-forward, KWH monotonic validation, meter change segments, and two-stage gap engine are present and significantly improved.
- Risk remains around complex overwrite flows:
  - manual correction inside previously auto-generated interruption spans still lacks a dedicated visual reconciliation UI
- `dailyLog.js` carries many responsibilities:
  - configuration building
  - event overlay
  - KWH validation
  - gap interpolation
  - AMP derivation
  - analytics
  - report summarization
- This increases the chance of cross-regression when one rule changes.

### Attendance

- Attendance sheet generation works from employee master + rules + overrides.
- Logic is still tightly tied to page-level overrides and monthly build functions.
- There is no server-backed approval/finalization layer for attendance sheets.
- Role + substation behavior depends on mixed localStorage visibility rather than one backend contract.

### Analytics

- Daily analytics builders exist and follow required formulas.
- However, they depend on derived daily state that is still browser-side only.
- PDF/export parity is limited by screenshot-based PDF generation.

### Role and access

- Menu hiding is not enough; route guards needed and were partially fixed.
- True substation restriction is not uniformly enforced across SQLite pages and localStorage pages.

## Section 5: UI/UX Problems

### Layout-level

- Root shell had a legacy width bug and kept pages narrow.
- Expand Workspace behavior was visually available before it became structurally effective.
- Too many helper/preview/register panels compete with primary workspaces on entry pages.
- `src/index.css` centralizes too many layout concerns, making regressions easy.

### Daily Log

- Best part of the current app, but still heavy.
- Focus mode needs final QA for:
  - chart-first view
  - minimum vertical chrome
  - helper content moved out of the primary screen

### Attendance

- Entry grid is usable but still less spreadsheet-like than Daily Log.
- It needs:
  - compact sticky action bar
  - clearer full-width focus mode
  - better month/substation/tool grouping

### Dashboard

- Dashboard is cleaner than before, but still not role-smart enough.
- It should show station-wise work queues, pending items, and record freshness more explicitly.

### Reports

- Report preview structure is strong.
- Remaining polish areas:
  - preview centering consistency on every report page
  - clearer full width vs print preview mode
  - long-report PDF fidelity

## Section 6: Performance / Maintainability Issues

- `src/index.css` is very large and now mixes:
  - legacy starter styles
  - app shell
  - forms
  - entry tables
  - report styles
  - dashboard styles
  - print styles
- Oversized files:
  - `src/index.css` ~2181 lines
  - `src/lib/dailyLog.js` ~2047 lines
  - `src/lib/reportData.js` ~1831 lines
  - `src/pages/DailyLogPage.jsx` ~1400 lines
- Repeated page bootstrap logic:
  - many pages separately load reference data/settings/documents
- Business logic and UI orchestration are still mixed in page components
- `cloneValue()` uses JSON stringify/parse repeatedly, which is simple but expensive and brittle

## Section 7: Security / Validation / Data Integrity

- Browser localStorage is mutable and currently stores operational data, audit events, settings, and mappings.
- Password reset flow in local mode returns recovery token directly to frontend.
  - acceptable for localhost testing only
- Local SQL endpoints do not yet implement user-substation mapping enforcement.
- No server-side DLR validation pipeline exists for local mode.
- Sign-up in local SQL mode auto-approves users immediately.
  - may conflict with intended approval workflow

## Section 8: Suggested Advanced Features

### 1. Keyboard navigation shortcuts

- Benefit:
  - faster entry for Daily Log and Attendance
- Complexity:
  - Medium
- Priority:
  - High
- Suggested files:
  - `DailyLogEntryTable.jsx`
  - `AttendancePage.jsx`
  - new `src/lib/keyboardShortcuts.js`

### 2. Saved filter presets

- Benefit:
  - faster repeat work for reports and history screens
- Complexity:
  - Low
- Priority:
  - Medium
- Suggested files:
  - `ReportCenterPage.jsx`
  - `MonthEndPackPage.jsx`
  - `HistoryRegisterPage.jsx`
  - `uiPreferences.js`

### 3. Draft vs finalized record banner + lock rules

- Benefit:
  - clearer data state and safer operations
- Complexity:
  - Medium
- Priority:
  - High
- Suggested files:
  - `dailyLog.js`
  - `AttendancePage.jsx`
  - `unifiedDataService.js`

### 4. Compare with previous day

- Benefit:
  - stronger DLR decision support
- Complexity:
  - Medium
- Priority:
  - High
- Suggested files:
  - `DailyLogPage.jsx`
  - `dailyLog.js`

### 5. Feeder anomaly alerts

- Benefit:
  - proactive issue detection
- Complexity:
  - High
- Priority:
  - Medium
- Suggested files:
  - `dailyLog.js`
  - `reportData.js`
  - Dashboard

### 6. Pinned reports / favorites

- Benefit:
  - faster navigation
- Complexity:
  - Low
- Priority:
  - Medium
- Suggested files:
  - `AppShell.jsx`
  - `uiPreferences.js`

### 7. Notice Board

- Benefit:
  - central operational communication
- Complexity:
  - Medium
- Priority:
  - Medium
- Suggested files:
  - new `NoticeBoardPage.jsx`
  - new storage/API module
  - `navigation.js`

### 8. Feedback / Suggestion + issue ticketing

- Benefit:
  - structured user improvement pipeline
- Complexity:
  - Medium
- Priority:
  - Medium
- Suggested files:
  - new `FeedbackPage.jsx`
  - new audit/status workflow module

### 9. Attachment support

- Benefit:
  - store meter photos, fault photos, or signed pages
- Complexity:
  - High
- Priority:
  - Medium
- Suggested files:
  - DLR entry pages
  - storage/API layer

### 10. Station-wise dashboard widgets

- Benefit:
  - better supervisor view
- Complexity:
  - Medium
- Priority:
  - High
- Suggested files:
  - `HomePage.jsx`
  - `reportData.js`
  - `unifiedDataService.js`

## Section 9: Priority Roadmap

### Phase 1: Critical bug fixes

- unify root layout and workspace expansion
- route-protect admin-only pages
- hide secondary panels in focus mode
- remove remaining width blockers from root shell

### Phase 2: Business logic stabilization

- move DLR/attendance persistence behind local API
- implement SQLite user-substation mapping
- unify access control across client and server
- add stronger save/finalize consistency

### Phase 3: UI/UX cleanup

- split `index.css`
- split `DailyLogPage.jsx`
- split `dailyLog.js`
- standardize focus-mode toolbars across all entry pages

### Phase 4: Reports and print polish

- replace screenshot-based PDF for long reports
- tighten paper-centered preview pages
- improve table chunking and pagination fidelity

### Phase 5: Advanced features

- notice board
- feedback/suggestion
- saved filters
- keyboard shortcuts
- anomaly alerts

### Phase 6: APK/mobile optimization

- native file preview path
- tighter touch-first toolbars
- mobile drafts/offline sync strategy
- reduced render cost on large tables

## Top 10 Immediate Fixes To Do First

1. Complete the root full-width workspace cleanup across all pages.
2. Replace localStorage DLR persistence with local API / SQLite persistence.
3. Implement SQLite user-substation mapping and enforce it server-side.
4. Replace screenshot-based PDF export for long reports.
5. Split `DailyLogPage.jsx` into toolbar/editor/panels/report containers.
6. Split `dailyLog.js` into engine modules.
7. Split `index.css` into shell, forms, tables, reports, and print layers.
8. Add route-level protection for every admin-only route.
9. Add Notice Board and Feedback modules.
10. Add finalization/lock-state guardrails for DLR and attendance.

## How to make this app look much cleaner and more professional

### Layout changes

- Keep one shell rule source.
- Remove residual legacy layout rules from the top of `index.css`.
- Use three layout modes only:
  - dashboard mode
  - entry/focus mode
  - report/print mode

### Page structure changes

- Every entry page should have:
  - compact sticky toolbar
  - one primary workspace panel
  - optional secondary panels hidden in focus mode
- Every report page should have:
  - compact filter bar
  - centered paper preview
  - sticky export toolbar

### Sidebar/header redesign

- Sidebar is already directionally good.
- Next polish:
  - slightly better label spacing
  - stronger active-state contrast
  - pinned shortcuts
- Header is usable.
- Next polish:
  - tighter breadcrumb typography
  - less visual competition on the right side

### Full-width working mode

- Expanded mode should become the default memory for Daily Log and Attendance.
- Entry pages should prioritize table visibility over helper text.

### Dashboard cleanup

- Remove generic summary feel.
- Show:
  - pending finalization counts
  - today’s station activity
  - quick jump into Daily Log / Attendance / Faults

### Report polish

- Keep previews centered and paper-like.
- Strengthen:
  - metadata spacing
  - section title rhythm
  - print-page fidelity

### Typography and spacing

- Reduce giant `h2` usage on work pages.
- Use smaller uppercase section labels and stronger numeric emphasis.
- Keep page paddings between 10px and 16px on focus pages.

### Visual hierarchy

- Working data should always dominate.
- Guidance/help should move into:
  - collapsible blocks
  - tooltip/help buttons
  - secondary panels only

### What to remove

- redundant helper intro sections on entry pages
- stale starter CSS/files
- duplicate save/filter blocks
- repeated status/explanation panels where one compact badge is enough

### What to simplify

- page bootstrap patterns
- report export button wiring
- shell state management
- mixed persistence strategy

