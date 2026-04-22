# Project-wise Required Files Checklist

## A) Web Connected Canonical (`unified_msedcl_workspace/`)

Required:

- `package.json`, `package-lock.json`
- `vite.config.js`, `index.html`
- `src/`, `public/`
- `android/` (connected Capacitor app)
- `capacitor.config.json`
- `server/` (local privileged ops)
- `supabase/` (SQL and policy scripts)
- `.env` (local runtime only, never commit)
- `.env.example`

Optional but useful:

- `docs/`, `scripts/`, `resources/`

Not required for runtime deploy:

- `dist/` (build output only)
- `node_modules/` (reinstallable)

## B) Web Connected Legacy Mirror (`unified_msedcl_workspace/qt33/`)

Status:

- keep as fallback/reference only
- build/deploy scripts are guarded

Required if retained:

- same base as project A, but do not use for production deploy

## C) Mobile Offline Flutter (`unified_msedcl_workspace/qt33_flutter/`)

Required:

- `pubspec.yaml`, `pubspec.lock`
- `lib/`, `assets/`, `android/`
- flutter tool metadata (`.metadata`, analysis config)

Not required:

- `build/` artifacts (rebuild)

## D) Excel/VBA Offline (`MSEDCL_Excel_VBA_Offline_System/`)

Required:

- `vba_modules/`
- `userforms_code/`
- `design/`, `docs/`
- workbook planning docs and templates

Not required:

- exported/generated temporary files unless explicitly needed for release package
