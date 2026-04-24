# Safe Migration Steps

## Objective

Prevent wrong deploy/build and keep all three projects independently stable.

## Phase 1 (completed in this change set)

- Canonical root markers added (`.project-root.json`)
- Legacy duplicate root marker added with deploy block
- Guarded scripts added in both web roots
- Mapping docs and checklists added
- History Register cloud-snapshot sync bridge added

## Phase 2 (manual validation gate)

Run from canonical root only:

1. `npm run guard:web`
2. `npm run build`
3. `npm run android:sync`
4. Open app and verify:
   - Daily Log sync across two devices
   - Battery/Fault/Maintenance/Charge Handover sync
   - History Register asset/event visibility across two devices

## Phase 3 (optional cleanup after sign-off)

- Move legacy duplicate tree into `archive/legacy-duplicates/` physically
- Remove duplicated scripts/docs from legacy mirror
- Keep one active deployment pipeline

## Rollback

- Since this phase does not delete trees, rollback is simple:
  - revert guard script wiring in `package.json`
  - remove marker/docs files
  - retain both roots as before
