# Migration Notice (Project-Wise Working Roots)

Use only these canonical working roots:

- `projects/web-connected` -> canonical web app + connected Capacitor APK
- `projects/mobile-offline-flutter` -> offline Flutter mobile project
- `projects/excel-vba-offline` -> offline Excel/VBA system

Do not work from these locations:

- old workspace root for day-to-day feature work
- `qt33` legacy mirror
- `archive/legacy-duplicates/*` archive trees

Rules:

- Run web dev/build/android commands only from `projects/web-connected`.
- Run Flutter commands only from `projects/mobile-offline-flutter`.
- Keep Excel/VBA updates only in `projects/excel-vba-offline`.
- Archive folders are read-only reference only.
