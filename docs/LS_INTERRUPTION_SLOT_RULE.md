# LS Interruption Slot Rule (Daily Log / Reports)

## Final rule

Reading ज्या hour ला घेतली आहे, त्या same start-hour ला LS दाखवायचा नाही.  
LS next hour slot पासून chart/report मध्ये दिसला पाहिजे.
End hour slot include केला पाहिजे.

## Applied behavior

- Start time always maps to **next slot** for overlay rendering.
- End time maps to **included end-hour slot**.
- Hourly normalization:
  - `startHour = floor(fromTime minutes / 60)` then excluded
  - `endHour = floor(toTime minutes / 60)` then included
- This rule is centralized in `src/lib/interruptionSlots.js`.

## Example

Input interruption: `06:00` to `10:00`

- `06:00` -> normal KWH reading slot
- `07:00` -> LS
- `08:00` -> LS
- `09:00` -> LS
- `10:00` -> LS

## Shared usage

- Daily Log interruption-to-slot conversion uses `getInterruptionOverlayHourIndexes(...)`.
- Chart/table/report/print overlays consume the same derived daily-log state, so behavior is consistent across preview and report outputs.
