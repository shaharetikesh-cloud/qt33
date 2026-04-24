# 9) Report formulas/rules + 10) Print layout plan

## Reports to generate
- Daily Log print (A3 landscape)
- Battery weekly report (A4 portrait, 2 reports/page option)
- Fault report
- Maintenance register
- Charge handover
- History register
- Attendance monthly (operator/tech/outsource/apprentice/other)
- Night allowance statement
- Monthly consumption
- Daily min/max feeder
- Monthly min/max
- Monthly interruption
- Energy balance/loss
- Month-end pack

## Formula/rule highlights
- `DurationMin = (ToTime - FromTime) * 1440`
- `NightAmount = NightCount * NightRate`
- `Consumption = Units * MF`
- `Diff = Consumption - ExpectedUnit`
- `Loss% = (InputSentOut - ChildOutgoing) / InputSentOut * 100`
- Max/min ignores event text cells.

## Print standards
- Office-ready black & white.
- Borders: clean single-line grids.
- Signature blocks where required.
- Header repeats on page breaks.
- Print preview layout must match final print.
- Fit-to-page strategy:
  - DLR: width 1 page, height auto, A3 landscape
  - Attendance: A4 landscape
  - Registers: A4 portrait/landscape based on width
