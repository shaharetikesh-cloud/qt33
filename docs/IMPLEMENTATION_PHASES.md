# Implementation Phases

## Phase 0: Audit freeze

- Keep both legacy projects unchanged.
- Capture data contracts, module coverage, report rules, and access expectations.
- Confirm the combined project folder as the only new development target.

## Phase 1: Identity foundation

- Supabase Auth integration
- `profiles` table
- self-signup request flow
- forgot password flow
- admin approval flow
- role-based route guards
- substation master table

## Phase 2: Attendance foundation

- employee master
- attendance sheets
- operator chart
- advance shift
- mobile-first editors
- PDF and print preview baseline

## Phase 3: DLR operational foundation

- daily log
- battery
- faults
- maintenance
- charge handover
- substation-linked operations

## Phase 4: Reporting and print hardening

- monthly summaries
- operational reports
- PDF output
- Android share and print actions
- server-assisted exports where browser-only output is fragile

## Phase 5: Migration and parity validation

- compare old and new outputs module by module
- test user isolation rules
- test admin visibility
- validate mobile entry against web visibility
- confirm report parity with legacy expectations

## Phase 6: Release targets

- local deployment sign-off
- Hostinger upload process
- environment setup
- Android Studio sync
- APK generation
- UAT sign-off
