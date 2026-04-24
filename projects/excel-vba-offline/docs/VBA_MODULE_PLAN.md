# 7) VBA Module Plan

- `modGlobals`: constants, sheet names, enum values, global cache.
- `modUtils`: generic helpers (array, dictionary, range, logging).
- `modValidation`: required checks, duplicate checks, business validation messages.
- `modDateTime`: time parse/normalize (`930` to `09:30`, `2400` support), duration helpers.
- `modMasterData`: CRUD for all master sheets.
- `modDLR`: daily log create/load/save/finalize, carry-forward, total load.
- `modFaults`: fault register CRUD + duplicate prevention + duration.
- `modMaintenance`: maintenance CRUD + status transitions.
- `modBattery`: weekly battery capture + weak cell analysis + remarks.
- `modChargeHandover`: shift handover save/load + carry-forward pending.
- `modHistory`: asset lifecycle records and timeline.
- `modAttendance`: all attendance sheets + operator rotation + night count.
- `modReports`: report datasets + month-end pack builder.
- `modPrint`: page setup, print preview, print dispatch.
- `modExportImport`: CSV/Excel import/export mapping.
- `modBackupRestore`: full backup and restore with manifest.
