# Backup Restore Notes

Backup output:
- Full workbook copy (.xlsm)
- CSV dump of all hidden tables
- Manifest file with timestamp and schema version

Restore sequence:
1. Validate manifest
2. Backup current state
3. Load masters
4. Load transactions
5. Rebuild report cache
6. Run sanity checks
