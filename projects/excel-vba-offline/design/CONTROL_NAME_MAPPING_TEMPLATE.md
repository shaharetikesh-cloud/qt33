# Control Name Mapping Template (Phase-9 Ready)

Use this naming template in VBA UserForms for direct binding:

## frmDailyLog
- `txtDate`
- `cmbSubstation`
- `txtHour`
- `cmbFeeder`
- `txtAmp`
- `txtKV`
- `txtKWH`
- `cmbEventCode`
- `txtRemark`
- `btnSave`
- `btnFinalize`

## frmOperatorAttendance
- `txtMonthKey`
- `cmbSubstation`
- `cmbModuleType`
- `btnAutoRotate`
- `btnSaveAndPreview`

## frmReports
- `txtReportDate`
- `txtFromDate`
- `txtToDate`
- `txtMonthKey`
- `cmbSubstation`
- `cmbModuleType`
- `cmbBatterySet`
- `btnDailyLogReport`
- `btnMonthEndPack`
- `btnPrint`

## Binding helpers used
- `SafeControlText(form, controlName, fallback)`
- `SafeControlNumber(form, controlName, fallback)`
- `SafeControlDate(form, controlName, fallback)`
