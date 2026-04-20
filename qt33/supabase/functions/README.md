# Admin Edge Functions

## Functions

- `admin-create-user`
- `admin-disable-user`
- `admin-reset-user-password`

All functions:

- Verify Firebase ID token from `Authorization: Bearer <token>`
- Resolve actor profile from `profiles`
- Enforce RBAC:
  - `super_admin`: full access
  - `substation_admin`: only users in same substation, cannot manage admin roles

## Required env vars (Supabase project secrets)

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FIREBASE_WEB_API_KEY`

## Deploy

```bash
supabase functions deploy admin-create-user
supabase functions deploy admin-disable-user
supabase functions deploy admin-reset-user-password
```

Then in frontend environment:

- `VITE_SUPABASE_ADMIN_FUNCTIONS=true`
