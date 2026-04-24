# Unified MSEDCL Workspace - Folder/Project Mapping

This reference explains which folder belongs to which project and where future work should happen.

## Canonical working projects

1. `projects/web-connected`  
   - Project: Canonical deployed Web app + Connected Capacitor Android app  
   - Use for: web code changes, sync logic changes, connected APK changes  
   - Key folders/files:
     - `src/`, `public/`, `android/`, `scripts/`, `server/`, `supabase/`
     - `package.json`, `capacitor.config.json`, `vite.config.js`
     - `.project-root.json` (`projectId: web-connected-canonical`)
   - Commands run from here:
     - `npm run dev`
     - `npm run build`
     - `npm run android:sync`
     - `npm run android:open`

2. `projects/mobile-offline-flutter`  
   - Project: Offline Flutter mobile app  
   - Use for: Flutter-only features and offline mobile flows  
   - Key folders/files:
     - `lib/`, `android/`, `assets/`, `test/`
     - `pubspec.yaml`, `analysis_options.yaml`, `.project-root.json`
   - Commands run from here:
     - `flutter pub get`
     - `flutter run`
     - `flutter build apk --debug`
     - `flutter build apk --release`

3. `projects/excel-vba-offline`  
   - Project: Excel/VBA offline system  
   - Use for: VBA forms/modules/docs/templates flow  
   - Key folders/files:
     - `design/`, `docs/`, `templates/`, `userforms_code/`, `vba_modules/`
     - `backup_restore/`, `exports/`, `sample_data/`
     - `README.md`, `CONFIG_NOTES.md`, `.project-root.json`
   - Note:
     - Workbook binaries (`.xlsm/.xlam/.xlsx/.xls`) are handled manually by owner.

## Archive and legacy folders

4. `archive/legacy-duplicates/qt33-mirror`  
   - Project type: Archived legacy mirror (read-only)  
   - Status:
     - DO NOT use for active dev/build/deploy
     - Contains `ARCHIVE_READONLY.md` and `WARNING_DO_NOT_USE_FOR_BUILD_OR_DEPLOY.md`

5. `qt33`  
   - Project type: old legacy mirror source
   - Status:
     - Not a canonical working root now
     - Keep only for reference until fully retired

## Workspace root folders (context/support)

- `docs/`: workspace-level documentation
- `projects/`: all canonical segregated working projects
- `archive/`: legacy/duplicate archived trees
- `src/`, `public/`, `android/`, `server/`, `supabase/` at old root:
  - historical/canonical source snapshot used during migration
  - day-to-day work should move to `projects/web-connected`

## Future quick guide

- Web changes -> `projects/web-connected`
- Connected APK changes -> `projects/web-connected`
- Flutter offline changes -> `projects/mobile-offline-flutter`
- Excel/VBA offline changes -> `projects/excel-vba-offline`
- Avoid active work in -> `qt33`, `archive/legacy-duplicates/*`, old mixed roots
