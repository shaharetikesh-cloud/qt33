# Implementation Notes

- This folder is fully independent from existing project.
- Existing project used only as read-only business reference.
- Login system intentionally excluded.
- Prefer array/bulk range operations over per-cell loops.
- Use `Application.ScreenUpdating = False` and `Application.Calculation = xlCalculationManual` around heavy routines.
- Keep all imports/exports in local relative folders under this solution root.
