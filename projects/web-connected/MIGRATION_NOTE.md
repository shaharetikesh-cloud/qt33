# Web-Connected Migration Note

This folder is a self-contained copy of the canonical deployed web + connected Capacitor project.

Source copied from:

- `f:/qt33.in/unified_msedcl_workspace/unified_msedcl_workspace`

Safety:

- Uses `.project-root.json` and `scripts/ensure-project-root.mjs` guard.
- `.env` was intentionally not copied.
- Use local `.env` created from `.env.example` for this project only.

Run (from this folder):

- `npm install`
- `npm run guard:web`
- `npm run dev`
- `npm run build`
- `npm run android:sync`
