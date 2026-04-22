# Web Connected Project (Canonical)

Canonical root:

- `f:/qt33.in/unified_msedcl_workspace/unified_msedcl_workspace`

Includes:

- React web app (`src`, `public`)
- Capacitor Android wrapper (`android`)
- Node local server (`server`)
- Supabase SQL/policies (`supabase`)

Guard marker:

- `.project-root.json` with `projectId=web-connected-canonical`

Notes:

- Use this root only for build/deploy/android sync commands.
- Legacy duplicate tree exists in `../qt33` and is guarded to prevent accidental deploy.
