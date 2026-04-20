# Unified MSEDCL Workspace

This folder is a new standalone project created to combine:

- `Advance DLR ERP` operational workflows currently backed by Supabase
- selected `firebase_adv` UX and mobile-ready implementation ideas where they fit DLR operations

The original folders stay untouched. This project is the new merge target.

## Current foundation

- React + Vite frontend with `HashRouter` for easier Hostinger deployment
- Local SQL starter with SQLite, signup, login, logout, forgot password, and admin user creation
- Supabase-ready auth layer that can be switched on later
- Mobile-ready direction via Capacitor scripts for Android APK packaging
- Documentation for audit findings, merge mapping, and phased implementation
- Draft Supabase schema for admin/user visibility rules and ownership-based access

## Local run

1. Copy `.env.example` to `.env`
2. Install packages with `npm install`
3. Start local development with `npm run dev`
4. Open `http://localhost:5173/#/login`

If `5173` port busy asel tar app ata clear error dakhavel. Old Vite process close karun command punha run kara.

Default local admin:

- Email: `admin@local.test`
- Password: `Admin@12345`

This mode stores its SQLite file in `local-data/unified-msedcl-local.sqlite`.

## Backend modes

- `local-sql`: default offline test mode
- `supabase`: future cloud mode once real project credentials are available

## Hostinger deployment

This project uses `base: './'` and `HashRouter`, so the output from `npm run build` can be uploaded to Hostinger shared hosting without complex rewrite rules.

## Cloudflare Pages deployment

- Build command: `npm run build`
- Output directory: `dist`
- Environment variables guide: `docs/CLOUDFLARE_PAGES_ENV.md`

## Android APK direction (QT DLR)

Quick path:

1. Run `npm run build`
2. Run `npm run android:sync`
3. Run `npm run android:open`
4. Build the APK from Android Studio (app name: `QT DLR`)

Direct debug APK build on Windows:

1. Ensure Android SDK, `adb`, and Java 21 are installed
2. Ensure `JAVA_HOME` points to a Java 21 JDK before running Gradle
   - Example (PowerShell): `$env:JAVA_HOME='C:\Program Files\Zulu\zulu-21'; $env:Path="$env:JAVA_HOME\bin;$env:Path"`
3. Run `npm run android:apk:debug`
4. Run `npm run android:apk:debug:path`

Default debug APK output:

- `android/app/build/outputs/apk/debug/app-debug.apk`

Unsigned release APK build:

1. Ensure Java 21 `JAVA_HOME` is active in the shell
2. Run `npm run android:apk:release`
3. Run `npm run android:apk:release:path`

Unsigned release APK output:

- `android/app/build/outputs/apk/release/app-release-unsigned.apk`
- Sign this APK with your release keystore before Play Store/internal distribution.

Native mobile runtime updates added:

- App resume triggers fast sync catch-up
- Native online/offline status listener with toast notification
- Existing outbox + conflict handling + `device_id` logic is reused in Android runtime (same Supabase backend)
- Offline store now supports fallback persistence via Capacitor Preferences when IndexedDB is unavailable on device

## Release signing setup (production)

1. Copy `android/keystore.properties.example` to `android/keystore.properties`
2. Create a release keystore (example):
   - `keytool -genkey -v -keystore keystore/qt-dlr-release.jks -alias qt_dlr -keyalg RSA -keysize 2048 -validity 10000`
3. Update `android/keystore.properties` values (`storeFile`, passwords, alias)
4. Build release:
   - `npm run android:apk:release`
5. Resolve outputs:
   - Unsigned path: `npm run android:apk:release:path`
   - Signed path (only after keystore setup): `npm run android:apk:release:signed:path`

## Play Store AAB pipeline

Google Play prefers Android App Bundle (`.aab`) uploads.

1. Ensure signing is configured (`android/keystore.properties`)
2. Build release bundle:
   - `npm run android:aab:release`
3. Resolve output:
   - `npm run android:aab:release:path`

Expected output:

- `android/app/build/outputs/bundle/release/app-release.aab`

## Final release checklist (QT DLR)

- Verify Firebase + Supabase production env values in `.env`
- Confirm same backend project is used by web and mobile
- Build + smoke test debug APK on at least one physical Android device
- Build signed release APK + release AAB
- Validate offline data entry, app resume sync, and conflict handling (`device_id` paths)
- Verify PDF generation/share and critical modules: Daily Log, Interruptions, History Register, Maintenance, Charge Handover
- Upload `app-release.aab` to Play Console internal testing first

## QT DLR branding assets

- Source-of-truth folder: `resources/android/`
- Add high resolution icon/splash files as documented in:
  - `resources/android/README.md`
- Then regenerate assets from Android Studio Image Asset tool and rebuild APK.

## Offline APK variant

This workspace now also supports a second APK variant that runs fully offline without the local Express server.

- Build command: `npm run android:apk:offline`
- APK output: `android/app/build/outputs/apk/debug/unified-msedcl-offline-debug.apk`
- Storage mode: embedded on-device store using Capacitor Filesystem
- Seed data: the build command exports the current `local-data/unified-msedcl-local.sqlite` content into the APK at build time, then removes the temporary seed file

Default offline admin login:

- Username: `admin`
- Password: `Admin@12345`

If the local SQLite file already contains users, substations, masters, and reports, the offline APK starts with that seeded data.

Virtual device test flow:

1. Start the emulator from Android Studio Device Manager
2. Run `adb devices` and confirm one device is `device`
3. Install the build with `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`
4. Open the app on the emulator and verify print, PDF, share, and data-entry flows

This workspace was last verified with an Android emulator AVD named `UnifiedMSEDCL_API36`.

## Important security note

Local SQL mode is only for testing on localhost. For cloud deployment, admin-created users and approval flows should be finalized through secure Supabase Edge Functions or another protected backend layer. A pure static frontend on Hostinger should not contain service-role secrets.
![1775667721971](image/README/1775667721971.png)
