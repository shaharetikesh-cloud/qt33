# 8) Business Rules

## DLR rules
- One record per `Date + Substation`.
- 25 hourly slots: `00:00` ... `24:00`.
- Time input normalization:
  - `1000 -> 10:00`
  - `930 -> 09:30`
  - `2400 -> 24:00`
- Event codes: `LS, SD, BD, EF, SF, OC`.
- Event-coded display replaces numeric cell view but raw numeric data remains protected.
- Numeric min/max excludes event-only and pending-gap cells.
- Carry-forward opening KWH from latest prior day closing.
- Auto LS for unresolved end-of-day gap (when day finalized).
- KWH decrease invalid unless meter change exists.
- Main incomer amp can auto-sum child feeders.

## Feeder master rules
- Required: feeder name, type, CT ratio, MF, sort order, active.
- Parent feeder links child grouping.
- `is incomer` controls INC-based grouping and totals.
- Include-in-total flag only through controlled setting (no ad-hoc sheet edits).

## Battery rules
- Weekly entry supports 15 rows baseline (extendable by set config).
- Per-cell SG + voltage mandatory for analysis.
- Auto calc: total, max/min voltage, max/min gravity.
- Condition:
  - Good: no weak cells
  - Average: weak cells <= 15%
  - Poor: weak cells > 15%
- Maintenance checkbox tasks drive auto-remarks.

## Fault/interruption rules
- Required: date, feeder, event type, from, to.
- Duration auto calculated.
- Duplicate prevention key: `Date+Feeder+EventType+From+To`.
- Monthly interruption summary includes counts + duration.

## Maintenance rules
- Required: date, equipment, type, description, action/staff/status.
- Open/Closed status lifecycle.

## Charge handover rules
- Required: date, shift, outgoing, incoming, pending notes.
- Carry-forward previous unresolved pending items.

## History register rules
- Asset identity fields mandatory for first install.
- Later records append to change history timeline (replace/repair/update).

## Attendance rules
- Employee print format: line1 name, line2 `CPF- XXXXXXX`.
- Operator rotation: `OFF -> II -> III -> I`.
- General duty rotation variant supports `G`.
- Weekly off enforced by employee weekly-off setting.
- Manual override allowed with audit remark.
- Night allowance = count(`III`) * configured rate.
- `OD/training/duty-out` treated as non-absence.
