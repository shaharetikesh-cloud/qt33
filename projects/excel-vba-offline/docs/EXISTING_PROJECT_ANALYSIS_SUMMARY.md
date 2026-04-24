# Existing Project Analysis Summary

## 1) Existing project analysis summary

Reference scope (read-only):
- `unified_msedcl_workspace/src/*` (primary app)
- `unified_msedcl_workspace/docs/*` (legacy compare and audit notes)
- `unified_msedcl_workspace/supabase/*` (data schema direction)

Observed business modules:
- Dashboard/Overview
- Daily Log Register (DLR)
- Battery Maintenance
- Fault / Interruption Register
- Maintenance Register
- Charge Handover
- History Register
- Attendance workflows (Operator, Advance Shift, Technician, Apprentice, Outsource, Summary, Night Allowance)
- Report Center + Month-End Pack
- Master data (substation, feeder, battery sets, transformers, employees, settings)
- Export (CSV/JSON/Workbook/PDF) + backup/restore

Operational workflow (high-level):
1. Setup masters (substation/feeders/battery/employees/settings).
2. Daily operations: DLR hourly entry + faults + maintenance + battery + charge handover + history updates.
3. Attendance month workflows by type.
4. Daily reports + monthly reports + month-end pack.
5. Export/share + backup/restore.

Critical business logic identified:
- DLR grid fixed at `00:00` to `24:00` (25 rows).
- Carry-forward KWH from previous day closing.
- Event overlays: `LS`, `SD`, `BD`, `OC`, `EF`, `SF`.
- Event scopes: single feeder, selected feeders, all 11kV, full substation.
- Auto LS generation from unresolved trailing KWH gaps.
- KWH gap interpolation between anchors with metadata.
- Meter change event support with segment-aware validation and consumption.
- Total load and main incomer-child feeder grouping logic.
- Numeric min/max ignores event-only cells and pending gaps.

Attendance rules found:
- Operator shift rotation pattern: `OFF -> II -> III -> I`.
- General duty pattern variant includes `G`.
- Weekly off day logic by employee.
- Manual override and validation checks exist.
- Night allowance based on `III` shift counts with rate overrides.
- Special attendance codes include `OD`, leave types, and non-absence codes.

Battery logic found:
- Cell-wise gravity and voltage capture.
- Weak-cell detection thresholds.
- Derived min/max/total and condition summary.
- Checklist style maintenance tasks.

Fault/interruption logic found:
- From/to time + duration derivation.
- Event type validation.
- Duplicate-control expectation (to be enforced in VBA design).
- Monthly interruption analytics integration.

Month-end/reporting dependencies:
- Daily log derived summaries feed monthly analytics.
- Energy balance uses main incomer vs mapped outgoing child feeders.
- Consumption, min/max, interruption, abnormal, completeness, reconciliation reports.
- Unified month-end pack composes multiple report sections.

Print/export observations:
- Daily log A3 landscape office print style.
- Attendance legacy office format with signatures and CPF under name.
- Export options: JSON, CSV, workbook, PDF.
- Preview and print parity emphasized.

Missing/partial gaps noted from current app docs:
- Full field-level metadata parity for all numeric metrics still partial.
- Some advanced event-scope/report print style parity still evolving.
- Legacy-specialized variants still being aligned in current project.

Conclusion for new build:
- New solution should be a standalone offline Excel VBA desktop-style register.
- Login must be excluded entirely.
- Core business logic can be rebuilt faithfully with hidden transaction sheets, UserForms, and report print sheets.
