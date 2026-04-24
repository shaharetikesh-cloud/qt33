# Phase-3 UserForm Event Wiring

## `frmDailyLog`
- `btnSave_Click` -> `modDLR.SaveDailyLog`
- `btnFinalize_Click` -> `modDLR.FinalizeDailyLog`
- `txtHour_Exit` -> `NormalizeTimeInput`
- `cmbEventCode_Change` -> `ValidateEventCode`

## `frmFaultRegister`
- `btnSave_Click` -> `modFaults.SaveFaultRecord`
- `txtFrom_Exit/txtTo_Exit` -> `DurationMinutes` preview

## `frmOperatorAttendance`
- `btnAutoRotate_Click` -> `modAttendance.GenerateOperatorRotation`
- `btnCalcNight_Click` -> `CalculateNightAllowance`

## `frmReports`
- `btnMonthEndPack_Click` -> `modReports.BuildMonthEndPack`
- `btnExportCsv_Click` -> `modExportImport.ExportToCsv`

## `frmSettings`
- `btnBackup_Click` -> `modBackupRestore.FullBackup`
- `btnRestore_Click` -> `modBackupRestore.FullRestore`
