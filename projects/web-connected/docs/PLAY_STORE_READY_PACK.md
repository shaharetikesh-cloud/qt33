# QT33 Play Store Ready Pack

## Product Identity
- App name: `QT33`
- Recommended final package id: `in.qt33.mobile`
- Versioning strategy:
  - `versionCode`: increment by 1 for every Play upload.
  - `versionName`: semantic style `1.0.0`, `1.0.1`, `1.1.0`.

## Build And Release Steps
1. Set production env in `.env` (Supabase/Firebase keys, `VITE_APP_NAME=QT33`).
2. Build web assets: `npm run build`
3. Sync Android: `npm run android:sync`
4. Build release AAB: `npm run android:aab:release`
5. Resolve AAB path: `npm run android:aab:release:path`

## Signing / Keystore
1. Copy `android/keystore.properties.example` -> `android/keystore.properties`
2. Create keystore:
   - `keytool -genkey -v -keystore keystore/qt33-release.jks -alias qt33_release -keyalg RSA -keysize 2048 -validity 10000`
3. Update `storeFile`, `storePassword`, `keyAlias`, `keyPassword` in `android/keystore.properties`
4. Rebuild release AAB.

## Play Listing Draft
### Short Description
QT33 utility operations app for daily logs, field reporting, and reliable web-mobile sync.

### Full Description
QT33 is a professional utility operations platform built for substation and field workflows.
It enables secure login, operational entries, report generation, PDF export/share, and reliable
offline-to-online synchronization. Data entered from mobile is visible on web, and web updates are
reflected on mobile after sync.

### Feature Highlights
- Daily operational modules: daily log, battery, faults, maintenance, charge handover, history.
- Mobile-first forms with touch-friendly controls.
- Offline queue with retry and sync status visibility.
- Report center with PDF save, print/share options.
- Role-based access controls and audit-aware workflows.

## Screenshot Plan
1. Login screen with QT33 branding
2. Dashboard overview
3. Daily log entry on mobile
4. Sync status + failed retry panel
5. Report center with PDF actions
6. About QT33 and support/legal links

## Permissions Justification
- `INTERNET`: backend authentication, sync, and report operations.
- File sharing/storage access via Android document provider for exported PDFs.

## Release Readiness Checklist
- [ ] QT33 branding verified on splash, icon, title, login, header, about.
- [ ] No user-facing `Capacitor` wording.
- [ ] Privacy, terms, and support pages hosted and reachable.
- [ ] AAB built and signed.
- [ ] Internal testing run completed on physical Android devices.
- [ ] Data safety and privacy forms updated in Play Console.
