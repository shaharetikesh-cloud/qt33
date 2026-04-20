# QT33 Flutter Android App

Dedicated, independent Flutter mobile app for QT33.  
This is **not** a web wrapper / webview app.

## 1) Architecture Plan

- **App style**: Native Flutter UI, mobile-first screen design, touch-first controls.
- **Layers**:
  - `src/features/*`: module screens + entry workflows
  - `src/data/*`: local storage repositories and persistence
  - `src/shared/*`: RBAC, session, module registry, common policies
- **Offline-first**:
  - Local SQLite (`sqflite`) for forms, registers, records, drafts
  - Local-first read/write with later sync adapter extension point
- **Sync-ready**:
  - Repository pattern allows adding `RemoteSyncService` later without UI rewrite
  - Record model keeps `createdAt/updatedAt` and stable IDs for conflict resolution
- **Security**:
  - Role-based module permissions aligned with existing role model
  - Session-managed route guard
- **Performance**:
  - Lazy list rendering
  - Module scoped queries
  - Compact payload storage for fast lookup

## 2) Screen List (Mobile-first)

- Login / session start
- Home shell with bottom navigation
- Operations modules:
  - Daily Log
  - Battery
  - Fault Register
  - Maintenance
  - Charge Handover
  - History Register
- Reports modules:
  - Report Center
  - Month End Pack
- Communication:
  - Notice Board
  - Feedback
- Admin:
  - Substations
  - Employees
  - Masters
  - Users
  - Audit Trail
  - Session

## 3) Existing -> Mobile Module Mapping

- Existing route `daily_log` -> Flutter `module/daily_log`
- Existing route `battery` -> Flutter `module/battery`
- Existing route `faults` -> Flutter `module/faults`
- Existing route `maintenance` -> Flutter `module/maintenance`
- Existing route `charge_handover` -> Flutter `module/charge_handover`
- Existing route `history_register` -> Flutter `module/history_register`
- Existing route `reports` -> Flutter `module/reports`
- Existing route `month_end_pack` -> Flutter `module/month_end_pack`
- Existing route `notices` -> Flutter `module/notices`
- Existing route `feedback` -> Flutter `module/feedback`
- Existing route `substations` -> Flutter `module/substations`
- Existing route `employees` -> Flutter `module/employees`
- Existing route `masters` -> Flutter `module/masters`
- Existing route `users` -> Flutter `module/users`
- Existing route `audit` -> Flutter `module/audit`
- Existing route `session` -> Flutter `module/session`

## 4) Current Implementation Included

- Flutter app skeleton (`lib/main.dart`)
- Route guard and session flow
- Role baseline and permission model
- Module registry aligned with existing web app module keys
- Local SQLite persistence for module records
- Generic mobile module page:
  - Search/filter
  - Card-based list (no desktop table)
  - Quick entry bottom sheet
  - Delete action with role permission

## 5) Branding (Logo + Splash + Icon)

- Config is ready in `pubspec.yaml` for:
  - Launcher icon
  - Native splash
- Place provided logo at:
  - `assets/branding/qt33_logo.png`

## 6) Build Instructions (Android APK)

1. Install Flutter SDK (3.22+ recommended) and Android Studio SDK.
2. If you see **unsupported Gradle project**, this folder must include the official `android/` scaffold. From this directory run:
   - `flutter create . --platforms=android --org=com.qt33.in --project-name=qt33`
3. In this folder run:
   - `flutter pub get`
   - `dart run flutter_launcher_icons`
   - `dart run flutter_native_splash:create`
4. Build debug APK:
   - `flutter build apk --debug`
5. Build release APK:
   - `flutter build apk --release`

### Windows: project on `F:\` but Pub cache on `C:\`

If Gradle fails with Kotlin **different roots** / incremental cache errors, `android/gradle.properties` already sets `kotlin.incremental=false`. After changing that, run `flutter clean` then build again.

## 7) Next Migration Steps (Recommended)

- Port existing calculation and report rules module-by-module into typed services
- Implement dedicated screen UIs instead of generic module page:
  - step forms, quick picks, numeric keyboard-first inputs, draft autosave
- Add print/PDF A4 templates module-wise
- Add import/export + backup restore screens
- Add sync queue + conflict resolver for future backend
