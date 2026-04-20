# Legacy DLR Compare Notes

Reference inspected from:

- `e:\dlr erp\v4\Advance DLR ERP v3 - supabase-cloudflare-starter.zip`
- Legacy paths:
  - `js/dailylog.js`
  - `js/reports.js`
  - `css/print.css`

This note captures the legacy behaviors that matter for the unified workspace.

## Daily Log logic confirmed in legacy

- `00:00` opening row auto-carries previous day feeder-wise closing KWH.
- Reading metadata is logic-heavy:
  - `actual`
  - `estimated`
  - `missing`
  - `ls_blocked`
- KWH interpolation is interactive:
  - estimate intermediate hours
  - mark gap as manual `LS`
  - leave blank for automatic LS
- Explicit events override normal cell rendering in the chart.
- Auto LS is derived from missing KWH gaps between actual anchors.
- Main incoming feeder amps can be auto-calculated from child feeders.
- Total amp is derived from effective main-incomer amp values.
- Meter-change events are tracked separately and affect continuity/consumption logic.
- Event scope in legacy supports:
  - `single_feeder`
  - `selected_feeders`
  - `all_11kv_only`
  - `full_substation`

## Daily Log print confirmed in legacy

- Daily Log print opens in `A3` landscape-style flow.
- Print body class: `print-dailylog`
- Print shell classes:
  - `daily-log-print-sheet`
  - `daily-log-print-table-shell`
  - `daily-log-print-table`
- Legacy print rules use:
  - border `0.8px solid black`
  - table body font around `8.4pt`
  - summary font around `8.6pt`
  - line-height around `1.15`
  - table header repeat on page breaks

## Monthly report logic confirmed in legacy

- Month-end pack uses section definitions, workbook-sheet generation, JSON/CSV/Excel export, and page-break sections.
- Monthly reports include `main_inc_reconciliation`.
- Monthly consumption logic is meter-change-aware.
- Interruption/event logic is reused into monthly analytics.
- Report printing/exporting is centralized from the report module.

## Unified workspace gap after compare

Already aligned:

- dynamic feeder hierarchy
- carry-forward
- interruption overlay
- auto LS detection
- grouped print layout
- battery-set columns
- transformer tap + temperature
- monthly consumption status with Day-1 opening discipline
- meter-change-aware monthly sent-out and abnormal checks
- main incomer energy balance and reconciliation tables
- month-end pack workbook sections from report tables
- PDF/share/export path from one render source

Still to align further with legacy:

- field-level reading metadata parity for `amp` / `kv` / `kwh`
- event scopes beyond single feeder
- stronger daily print parity with legacy `A3` tuning and summary notes
- deeper report-center/month-end parity around specialized print styling and filter variants
