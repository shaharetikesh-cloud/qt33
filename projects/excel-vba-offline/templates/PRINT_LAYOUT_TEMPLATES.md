# Phase-4 Print Layout Templates

## Daily Log (`A3`, landscape)
- Header rows `1:5` fixed for repeat.
- Left block: company, division, substation, date, shift.
- Main table: 25 time rows (`00:00` to `24:00`) with feeder groups.
- Event cells show code (`LS/SD/BD/EF/SF/OC`) in place of numeric text.
- Footer signature row:
  - Left: `Operator`
  - Right: `Substation Incharge`

## Attendance monthly (`A4`, landscape)
- Header with month and substation.
- Employee name line1, CPF line2: `CPF- XXXXXXX`.
- Day columns `1..31`; summary columns at right.
- Footer signature row:
  - Left: `Assistant Engineer`
  - Right: `Dy. Executive Engineer`

## Battery weekly (`A4`, portrait)
- Top metadata block (set/date/substation).
- 15-row cell table (SG, Voltage, Condition).
- Checklist section.
- Summary section (Vmax/Vmin/Vtotal, SG max/min, condition).
- Optional two reports per page for compact print mode.

## Register prints
- Fault, maintenance, handover, history all use:
  - black border grid
  - repeat header row
  - page-break safe margins
  - generated-on timestamp at bottom right
