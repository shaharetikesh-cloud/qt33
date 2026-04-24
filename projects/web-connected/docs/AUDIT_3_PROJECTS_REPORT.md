# Three-Project Audit Report

## 1. Current Folder Structure Summary

Primary workspace:

- `unified_msedcl_workspace/` (React + Vite + Capacitor + Supabase + Firebase)
- `unified_msedcl_workspace/qt33/` (duplicate mirror of same stack)
- `unified_msedcl_workspace/qt33_flutter/` (independent Flutter mobile app)
- `MSEDCL_Excel_VBA_Offline_System/` (independent Excel/VBA project, sibling root)

Supporting folders:

- `docs/`, `scripts/`, `server/`, `supabase/`, `android/`, `public/`, `src/`
- extra runtime/tool folders: `.codex_refs/`, `.tmp_video_tools/`, `.continue/`

## 2. Three Project Mapping

- Project A (connected web + APK canonical): `unified_msedcl_workspace/`
- Project B (connected web + APK legacy duplicate): `unified_msedcl_workspace/qt33/`
- Project C (offline mobile Flutter): `unified_msedcl_workspace/qt33_flutter/`
- Separate external offline system: `MSEDCL_Excel_VBA_Offline_System/`

## 3. Mixed / Misplaced Files List

- Duplicate source trees:
  - `src/` and `qt33/src/`
  - `android/` and `qt33/android/`
  - `server/` and `qt33/server/`
  - `supabase/` and `qt33/supabase/`
- Duplicate package/deploy entrypoints:
  - `package.json` and `qt33/package.json`
  - `capacitor.config.json` and `qt33/capacitor.config.json`
- Build artifacts in source workspace:
  - `qt33/dist/`
  - `android/build/`
  - `qt33_flutter/build/`
- Embedded non-project tool/reference trees in root:
  - `.codex_refs/`
  - `.tmp_video_tools/`

## 4. Missing Files List (project critical)

No hard blocker missing file was found for booting canonical web root.

Previously missing safety metadata was added:

- `.project-root.json` marker in canonical root
- `.project-root.json` marker in `qt33` legacy root
- `.project-root.json` marker in `qt33_flutter`

## 5. Risky Scripts / Commands List

Before hardening, all below could run from wrong folder:

- `npm run build`
- `npm run dev`
- `npm run android:sync`
- `npm run android:apk:*`
- `npm run server:local`

Now hardened:

- Canonical root scripts include `guard:web`
- Legacy `qt33` scripts include `guard:legacy` and fail intentionally for deploy/build

## 6. Bug Findings List

- History Register used localStorage-only scopes (`asset-master`, `asset-history`) and was not sync-safe.
- Data layer is mixed (localStorage + IndexedDB + outbox sync engine + local API abstraction).
- Native startup has one-time reload + cache/service-worker cleanup logic (guarded but sensitive).
- Crash boundary has manual reload (no automatic loop), but repeated startup failures can still lead to manual reload loop behavior.
- PDF generation uses canvas slicing and may split rows on page breaks.
- Native print flow is share-as-PDF behavior.

## 7. Proposed Clean Folder Structure

Recommended target logical structure:

- `projects/web-connected/`
- `projects/mobile-offline-flutter/`
- `projects/excel-vba-offline/`
- `archive/legacy-duplicates/`

This phase created mapping docs and safety guards without destructive moves.

## 8. Project-wise Required Files Checklist

See:

- `docs/PROJECT_REQUIRED_FILES_CHECKLIST.md`

## 9. Safe Migration Plan

See:

- `docs/SAFE_MIGRATION_STEPS.md`

Migration principle used:

- no delete/move in this phase
- copy/guard/document first
- block wrong deploy first
- then migrate incrementally with validation gates

## 10. Final Recommendation (without implicit destructive change)

- Keep canonical deploy/build from root `unified_msedcl_workspace/` only.
- Treat `qt33/` as legacy mirror; keep blocked for deployment commands.
- Keep Flutter and Excel/VBA independent.
- Continue phased cleanup only via explicit approval checkpoints.
