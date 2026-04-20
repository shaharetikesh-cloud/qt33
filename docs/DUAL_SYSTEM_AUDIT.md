# Dual System Audit

## Scope

This audit compares:

- `Advance DLR ERP - login access updated v3`
- `firebase_adv`

The goal is to decide whether both can be merged into one new system that:

- runs locally now
- can later be hosted on Hostinger
- supports mobile APK packaging
- includes admin-created users, self-signup, forgot password, and strict data isolation

## System A: Advance DLR ERP

### Architecture

- Built as a static HTML, CSS, and vanilla JavaScript SPA.
- Module loading is script-based from `index.html`.
- Data access uses local/browser storage helpers plus Supabase cloud sync.
- Existing folder is already the operational reference and must stay untouched.

### Functional coverage

- Daily Log
- Battery
- Faults
- Maintenance
- Charge Handover
- Substations
- Users
- Reports and month-end export flows

### Backend and data shape

- Supabase schema already defines `user_profiles`, `app_records`, and `login_audit`.
- `app_records` stores collection data as JSON payloads.
- `storage.js` and `cloud-sync.js` form the current contract for loading, syncing, and updating records.

### Strengths

- Rich operational business logic already exists.
- DLR-specific flows are closer to real deployment needs.
- Current Supabase integration is the strongest anchor for the unified platform.

### Risks

- Heavy modules are desktop-table oriented.
- Printing is browser-window based and not ideal for mobile APK packaging.
- Sync is refresh-oriented, not realtime collaborative editing.
- Admin user creation and password reset are not production-polished from the app UI.

### Migration implication

This system should be treated as the source of truth for DLR workflows and reporting rules, but not as the final UI framework.

## System B: firebase_adv

### Architecture

- Built with React and Vite.
- Uses Firebase Auth and Firestore.
- Includes Capacitor and PWA-ready structure.
- Better suited for modern web plus mobile packaging.

### Functional coverage

- Login and signup request flow
- Admin approval page
- Substation setup
- Employee master
- Attendance sheets
- Advance shift and operator chart workflows
- Print preview oriented mobile pages

### Strengths

- Cleaner component architecture.
- Better mobile-first UX patterns.
- Faster path to Android APK through Capacitor.
- Role-aware access model already exists conceptually.

### Risks

- Backend is Firebase, which conflicts with the Supabase-based production direction.
- Domain coverage is focused on attendance, not full DLR operations.
- Forgot password and final admin provisioning are not fully finished.

### Migration implication

This system should be treated as the UX and app-shell reference, not as the backend foundation.

## Merge Verdict

### Can they be combined?

Yes, but not by directly merging folders or keeping both backends live.

### Recommended merge strategy

- Create a third new project.
- Use React for the new frontend.
- Use Supabase as the single backend.
- Port attendance UX ideas from `firebase_adv`.
- Port DLR operational rules and reporting rules from `Advance DLR ERP`.
- Keep both old projects as audit references until parity testing is complete.

### Why direct merge is risky

- Vanilla script modules and React components are not naturally composable.
- Firebase and Supabase auth and data models will duplicate user state.
- Browser-only print logic from DLR will not translate cleanly to mobile wrappers without redesign.

### Auth and access control requirements

The new system must support:

- admin-created user provisioning
- self-signup requests
- forgot password
- user sees only own data
- admin sees all data

### Security note

Admin-created accounts should be finalized with a secure Supabase Edge Function or protected backend service. A static Hostinger frontend must not contain service-role secrets.

### Hosting and mobile direction

#### Web hosting

- Hostinger shared hosting is feasible.
- `HashRouter` plus Vite `base: './'` keeps deployment simple.

#### Mobile APK

- Capacitor is the best bridge for Android packaging after the web app is stable.
- Mobile print should target PDF plus Android share or print actions instead of browser popup print.

### Final recommendation

Build the new combined platform in phases:

1. Auth, profiles, approval, and substation master
2. Employee master and attendance modules
3. DLR operational modules
4. Reports, PDF, and print actions
5. Data migration and UAT
6. Hostinger deployment and Android APK release
