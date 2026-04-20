# Subscription Plan (15-day Trial)

## Current behavior

- Login page var self-signup available aahe.
- Signup role options fakta:
  - `substation_admin`
  - `super_admin` (Main Admin)
- New signup request `pending` + `inactive` state madhye create hoto.
- Trial window 15 divas consider hoto.
- Trial samplya nantar login sathi paid subscription active pahije.

## Data model

Subscription metadata `profiles.module_permissions.subscription` madhe store hota:

```json
{
  "status": "trial",
  "trialStartedAt": "2026-04-20T10:00:00.000Z",
  "trialEndsAt": "2026-05-05T10:00:00.000Z",
  "planCode": "trial-15-days",
  "paidUntil": null
}
```

## Activate paid plan manually (Supabase SQL)

```sql
update public.profiles
set
  is_active = true,
  approval_status = 'approved',
  module_permissions = jsonb_set(
    coalesce(module_permissions, '{}'::jsonb),
    '{subscription}',
    jsonb_build_object(
      'status', 'active',
      'planCode', 'monthly-299',
      'trialStartedAt', coalesce(module_permissions->'subscription'->>'trialStartedAt', timezone('utc', now())::text),
      'trialEndsAt', coalesce(module_permissions->'subscription'->>'trialEndsAt', timezone('utc', now())::text),
      'paidUntil', (timezone('utc', now()) + interval '30 days')::text
    ),
    true
  )
where email = 'user@example.com';
```

## Revoke/expire subscription manually

```sql
update public.profiles
set module_permissions = jsonb_set(
  coalesce(module_permissions, '{}'::jsonb),
  '{subscription,status}',
  '"expired"'::jsonb,
  true
)
where email = 'user@example.com';
```

