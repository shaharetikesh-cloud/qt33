# Release Pack Notes

Release contents:
- `vba_modules/` all `.bas`
- `userforms_code/` all `.frm` skeleton code
- `design/` architecture, mappings, print plans
- `sample_data/` starter CSV files
- `templates/` import and print templates
- `backup_restore/` backup strategy
- `docs/PHASE*.md` implementation trail

Build tag suggestion:
- `MSEDCL_VBA_OFFLINE_R1_PHASE10`

Recommended archive steps:
1. Export all VBA modules/forms from VBE
2. Save final `.xlsm`
3. Create zip with this folder + workbook
4. Store one copy in `/backup_restore/release_archive`
