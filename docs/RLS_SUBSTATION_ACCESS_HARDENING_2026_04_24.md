# RLS Substation Access Hardening (2026-04-24)

Migration file:

- `supabase/rls_substation_access_hardening_2026_04_24.sql`

## Why

App-layer scope filters were added, but direct API access must also be blocked at DB layer.
This migration applies role + substation scoped RLS policies so frontend bypass is prevented.

## Policy model

### Roles

- `owner` / `main_admin` / `super_admin` -> normalized to `super_admin` access
- `admin` / `substation_admin` -> substation-admin scoped access
- `normal_user` / `substation_user` -> assigned/mapped substation scoped access

### Access rules

- Super admin can read/write all scoped tables.
- Substation admin can access:
  - own assigned substation (`profiles.substation_id`)
  - owned/mapped substations via:
    - `substations.created_by_profile_id`
    - `substations.parent_admin_id`
    - `substations.owner_profile_id`
    - `substations.created_by_auth_user_id`
- Normal/substation user can access only assigned substation.

## Tables covered

- `public.profiles`
- `public.substations`
- `public.erp_records` (primary operational store)
- Optional (if present): `public.employees`, `public.dlr_records`, `public.attendance_sheets`

## Module coverage

Because operational modules are stored in `erp_records` by `scope/moduleName` + `substation_id`,
the policy covers:

- Daily Log
- Battery
- Faults
- Maintenance
- Charge Handover
- History
- Reports/Print/Export snapshots

## Notes

- This migration is additive/compatibility-safe (`add column if not exists`, optional table policy blocks).
- Existing pages should continue to work with app-layer allowed-substation filters + DB-layer RLS.
- Run this migration in Supabase SQL editor, then validate role-wise QA.

## Manual QA checklist

- owner sees all substations/data
- super_admin sees all substations/data
- substation_admin does not get global All visibility
- substation_admin sees only owned/mapped substations
- normal user sees only assigned substation
- cross-substation read/write/delete blocked by RLS

