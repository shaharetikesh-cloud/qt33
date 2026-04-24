# MSEDCL Excel VBA Offline System

## Project role (segregated)

This folder is the independent **Excel/VBA offline system** copy.

- Contains VBA modules, forms, templates, and offline documentation.
- This project does not depend on web-connected or Flutter runtime/build scripts.

## Usage notes

- Open workbook files from this folder only.
- Keep forms/modules/classes changes in this folder's `userforms_code/` and `vba_modules/`.
- Keep template and documentation updates within this folder.

## Env/config safety

- No web/Flutter env files should be used here.
- Backup/export/import settings remain local to this project.

Standalone folder created from read-only analysis of existing project.

## Output order index
1. Existing project analysis summary: `docs/EXISTING_PROJECT_ANALYSIS_SUMMARY.md`
2. Feature mapping: `design/FEATURE_MAP.md`
3. Workbook architecture: `design/WORKBOOK_ARCHITECTURE.md`
4. Sheet structure: `design/WORKBOOK_ARCHITECTURE.md`
5. Hidden table schema: `design/WORKBOOK_ARCHITECTURE.md`
6. UserForms design: `design/USERFORMS_DESIGN.md`
7. VBA module plan: `docs/VBA_MODULE_PLAN.md`
8. Business rules: `design/BUSINESS_RULES.md`
9. Report formulas/rules: `design/PRINT_REPORTS_PLAN.md`
10. Print layout plan: `design/PRINT_REPORTS_PLAN.md`
11. Export/import/backup plan: `design/IMPLEMENTATION_PLAN.md`
12. Step-by-step build order: `design/IMPLEMENTATION_PLAN.md`
13. VBA code module by module: `vba_modules/*.bas`
14. Testing checklist: `design/TESTING_CHECKLIST.md`

## Phase trail
- `docs/PHASE2_PROGRESS.md` to `docs/PHASE11_PROGRESS.md`

## Release/handover
- `docs/GO_LIVE_CHECKLIST.md`
- `docs/RELEASE_PACK.md`
- `docs/DEPLOYMENT_READY_HANDOFF.md`
