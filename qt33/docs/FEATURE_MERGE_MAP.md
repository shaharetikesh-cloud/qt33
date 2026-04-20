# Feature Merge Map

| Area | Primary legacy source | Carry into new project | Merge note |
| --- | --- | --- | --- |
| Login | Both | Yes | Rebuild on Supabase Auth with self-signup, forgot password, and admin approval. |
| Role management | `firebase_adv` ideas + DLR admin need | Yes | Enforce through Supabase RLS and admin tools. |
| User isolation | New requirement | Yes | Every business table needs `owner_auth_user_id`; admin bypass through role-aware policies. |
| Substations | Both | Yes | Merge as one shared master table used by attendance and DLR records. |
| Employee master | `firebase_adv` | Yes | Keep mobile-friendly editors and connect to shared substation model. |
| Attendance sheets | `firebase_adv` | Yes | Port month-editor UX and print/export patterns into Supabase-backed tables. |
| Daily log | DLR | Yes | Port business logic first, redesign UI for mobile cards and steps. |
| Battery | DLR | Yes | Keep record structure, redesign mobile print and entry flows. |
| Faults | DLR | Yes | Preserve filters and report outputs while simplifying forms for touch use. |
| Maintenance | DLR | Yes | Same data logic, new responsive UI. |
| Charge handover | DLR | Yes | Keep operational workflow and per-user ownership metadata. |
| Reports | DLR | Yes | Port carefully in phases; some heavy exports may move to server-side later. |
| PWA install | `firebase_adv` | Yes | Retain service worker and manifest direction. |
| Android APK | `firebase_adv` | Yes | Use Capacitor after web features stabilize. |
| Firebase backend | `firebase_adv` | No | Replace with Supabase to avoid dual-backend complexity. |
| Legacy browser popup printing | DLR | Partial | Replace with PDF plus native share or print on mobile. |
