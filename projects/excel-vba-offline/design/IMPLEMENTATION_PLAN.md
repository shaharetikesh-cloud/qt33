# 11) Export/import/backup plan

Export:
- Print sheet exporter for each report.
- PDF export via `ExportAsFixedFormat`.
- CSV export for selected hidden tables.
- Excel export pack as new workbook with selected sheets.

Import:
- Source templates in `/templates`.
- Column mapping validator before import commit.
- Reject rows with mandatory field failures; generate error log in `/exports`.

Backup:
- Full backup command writes timestamped workbook copy + CSV dump of hidden tables in `/backup_restore`.
- Backup manifest includes workbook version and schema version.

Restore:
- Restore wizard reads manifest.
- Pre-restore current auto-backup.
- Clear and reload hidden tables in transactional order (masters then transactions).

# 12) Step-by-step build order

1. Create workbook and hidden table sheets.
2. Build `modGlobals`, `modUtils`, `modValidation`, `modDateTime`.
3. Build master data modules + master forms.
4. Build DLR core (`modDLR`) and `frmDailyLog`.
5. Build fault, maintenance, battery, handover, history modules/forms.
6. Build attendance logic + all attendance forms.
7. Build report engine + print engine.
8. Build export/import + backup/restore.
9. Load sample data and run checklist.
10. Freeze v1 release backup.
