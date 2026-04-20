# Cloudflare Pages Deployment Environment

## Build Settings

- Build command: `npm run build`
- Build output directory: `dist`
- Framework preset: `Vite` (or None with the above command/output)

## Required Environment Variables (Pages -> Settings -> Environment Variables)

- `VITE_BACKEND_MODE=cloud-sync`
- `VITE_APP_NAME=Unified MSEDCL Workspace`
- `VITE_SUPABASE_URL=<your-supabase-project-url>`
- `VITE_SUPABASE_ANON_KEY=<your-supabase-anon-key>`
- `VITE_FIREBASE_API_KEY=<firebase-web-api-key>`
- `VITE_FIREBASE_AUTH_DOMAIN=<firebase-auth-domain>`
- `VITE_FIREBASE_PROJECT_ID=<firebase-project-id>`
- `VITE_FIREBASE_APP_ID=<firebase-app-id>`
- `VITE_FIREBASE_MESSAGING_SENDER_ID=<firebase-messaging-sender-id>`
- `VITE_SUPABASE_ADMIN_FUNCTIONS=false` (set `true` only after admin functions are deployed)

## Notes

- Do not store service-role/private keys in frontend env vars.
- All runtime config in this app is loaded from `import.meta.env`.
- Missing env vars are validated at runtime and shown as clear app errors.
