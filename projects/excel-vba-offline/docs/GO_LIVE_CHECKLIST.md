# Go-Live Checklist

## Pre-Go-Live
- [ ] Workbook file name set to `MSEDCL_Offline_Register_v1.xlsm`
- [ ] `APP_VERSION` and `SCHEMA_VERSION` updated
- [ ] All hidden sheets created and marked VeryHidden
- [ ] Master seeds loaded (`substations`, `feeders`, `employees`, `battery sets`)
- [ ] Print settings verified on target printer (A3 + A4)
- [ ] Backup path writable

## Functional Smoke
- [ ] Save + finalize DLR
- [ ] Fault save with duplicate prevention
- [ ] Maintenance save
- [ ] Charge handover save
- [ ] History save
- [ ] Attendance rotation + monthly preview
- [ ] Month-end pack preview + page breaks

## Data Safety
- [ ] Full backup works
- [ ] Restore dry-run works on copy
- [ ] Import validator catches missing headers

## Handover
- [ ] Operator guide shared
- [ ] Supervisor sign-off complete
- [ ] Baseline backup archived
