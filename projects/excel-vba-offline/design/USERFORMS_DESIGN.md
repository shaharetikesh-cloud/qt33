# 6) UserForms Design

- frmDashboard: KPI tiles, recent records, quick buttons
- frmSubstationMaster: substation CRUD
- frmFeederMaster: feeder hierarchy, inc flags, MF, CT ratio
- frmBatterySetMaster: battery set + cell count
- frmEmployeeMaster: employee identity, type, weekly off, GD/vacancy
- frmDailyLog: hourly grid + interruption/events + meter-change
- frmFaultRegister: event entries with duration + duplicate check
- frmMaintenanceRegister: work log + status
- frmBatteryMaintenance: weekly 15-row cell capture + checklist
- frmChargeHandover: shift handover + carry-forward pending
- frmHistoryRegister: asset lifecycle ledger
- frmOperatorAttendance: day matrix + shift matrix + night allowance
- frmAdvanceShift: rotation planning
- frmTechAttendance, frmOutsourceAttendance, frmApprenticeAttendance, frmOtherAttendance: module-specific attendance
- frmReports: report center + print/export/month-end pack
- frmSettings: app settings, print settings, rates

## Control-level blueprint (Phase-2)

### frmDailyLog
- Header controls: `cmbSubstation`, `txtDate`, `cmbShift`, `txtOperator`, `txtIncharge`
- Grid controls: `lstDLRGrid` (25 rows), `lstInterruptions`, `lstMeterChanges`
- Action buttons: `btnNew`, `btnLoad`, `btnSave`, `btnValidate`, `btnFinalize`, `btnPrint`, `btnClose`
- Helpers: `btnAutoGapFill`, `btnAddEvent`, `btnAddMeterChange`

### frmOperatorAttendance
- Header: `cmbSubstation`, `txtMonthKey`, `txtNightRate`
- Employee matrix: `lstAttendance`, `lstShift`
- Totals area: `lblPresent`, `lblLeave`, `lblNightCount`, `lblNightAmount`
- Actions: `btnAutoRotate`, `btnApplyWeeklyOff`, `btnSave`, `btnPrint`, `btnExport`

### frmBatteryMaintenance
- Header: `cmbSubstation`, `cmbBatterySet`, `txtDate`
- Cells table: `lstBatteryCells` (15 row default)
- Checklist checkboxes: `chkTopUp`, `chkCleaning`, `chkTightening`, `chkCharging`
- Analysis labels: `lblVmax`, `lblVmin`, `lblVtotal`, `lblSGMax`, `lblSGMin`, `lblCondition`
- Actions: `btnSave`, `btnPrint`, `btnClose`

### frmReports
- Filters: `cmbSubstation`, `txtFromDate`, `txtToDate`, `txtMonthKey`, `cmbReportType`
- Preview: `lstReportPreview`
- Actions: `btnBuild`, `btnPreviewPrint`, `btnPrint`, `btnPdf`, `btnCsv`, `btnExcel`, `btnMonthEndPack`
