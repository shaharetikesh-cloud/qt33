# Legacy Attendance Compare Notes

Source reviewed: `e:\Attendance software\Easy Attendance\Share MSEDCL Attendance.zip`

Key legacy attendance files extracted and compared:

- `templates/easy/operator_chart.html`
- `templates/easy/tech_attendance.html`
- `templates/easy/apprentice_attendance.html`
- `templates/easy/outsource_attendance.html`
- `templates/easy/advance_shift_chart.html`
- `templates/easy/pdf/operator_chart_pdf.html`
- `templates/easy/pdf/tech_attendance_pdf.html`
- `templates/easy/pdf/apprentice_attendance_pdf.html`
- `templates/easy/pdf/outsource_attendance_pdf.html`
- `templates/easy/pdf/advance_shift_chart_pdf.html`
- `static/css/app.css`
- `static/css/pdf.css`

Legacy behavior confirmed:

- Operator module uses two editable monthly tables:
  - Attendance table
  - Shift table
- Operator module includes inline editable night shift allowance.
- Employee name always prints CPF directly below the name.
- Non-operator monthly sheets use one attendance table plus remarks/certificate block.
- Advance shift chart uses a separate shift-only table.
- PDF output is office-style:
  - centered MSEDCL company header
  - station line
  - month title
  - two-row day header
  - black border grid
  - certificate block
  - remark block
  - signature lines
- Operator PDF includes:
  - attendance table
  - shift table
  - night allowance table
  - certificate and remark area
  - `Sub-Station Incharge` and `Dy. Engineer` signatures
- Tech / apprentice / outsource PDFs include:
  - single attendance table
  - certificate and remark area
  - `Assistant Engineer` and `Dy. Executive Engineer` signatures

Unified workspace parity work implemented from this compare:

- Added operator separate shift grid editing in attendance page.
- Added `certificateText`, `remark`, `shiftOverrides`, and `nightRateOverrides` to attendance document payload.
- Added legacy-style attendance report data:
  - attendance cells
  - shift cells
  - night allowance rows
  - report remark lines
  - signature labels by sheet type
- Rebuilt attendance preview / print / PDF layout to match the legacy office sheet structure more closely.
