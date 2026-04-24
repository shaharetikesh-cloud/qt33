# 2) Feature Mapping

| Existing feature | Excel VBA offline mapping |
|---|---|
| Dashboard | `frmDashboard` + `sh_dashboard` command buttons + pending counters |
| Masters | Master UserForms + hidden master sheets (`mst_*`) |
| Daily Log (DLR) | `frmDailyLog` + `tx_dlr` + derived report cache |
| Fault/Interruption | `frmFaultRegister` + `tx_faults` + duplicate validator |
| Maintenance | `frmMaintenanceRegister` + `tx_maintenance` |
| Battery Maintenance | `frmBatteryMaintenance` + `tx_battery` + weekly analysis |
| Charge Handover | `frmChargeHandover` + `tx_charge_handover` + carry-forward helper |
| History Register | `frmHistoryRegister` + `tx_history` |
| Attendance suite | Attendance forms + `tx_attendance` + `tx_shift` |
| Night Allowance | Attendance aggregation + `modReports` statement generator |
| Report Center | `frmReports` driving print sheets and export module |
| Month-End Pack | `modReports.BuildMonthEndPack` with multipage print sheets |
| PDF/CSV/Excel export | `modExportImport` to create files under `/exports` |
| Backup/Restore | `modBackupRestore` full workbook data dump and reload |

Out-of-scope by requirement:
- Login/Auth/User-role module (fully excluded)
