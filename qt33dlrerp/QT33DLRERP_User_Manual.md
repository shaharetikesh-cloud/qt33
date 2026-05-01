# QT33 DLR ERP - Complete User Manual

Version: 1.0  
Prepared for: QT33 Unified Substation ERP users  
Application type: Web app with Firebase Auth + Supabase cloud sync

---

## 1) Project Overview

QT33 DLR ERP is a substation operations web application focused on:

- Daily operational data entry
- Battery maintenance tracking
- Fault register tracking
- Maintenance register tracking
- Charge handover tracking
- History register tracking
- Reports and audit visibility
- Multi-device cloud sync for shared operational records

Core stack:

- Frontend: React + Vite
- Auth: Firebase Authentication
- Data sync/store: Supabase + local IndexedDB sync engine

---

## 2) Roles and Access

Main roles in app:

- `super_admin` (Main Admin / Super Admin)
- `substation_admin`
- `substation_user` / normal user
- `viewer` (read only)

General behavior:

- Admin roles can see broader data.
- Substation-scoped users see only allowed substations.
- Some pages/actions are role-protected.

---

## 3) First-Time Setup for New User

### 3.1 Sign Up

1. Open login page.
2. Click **Sign Up**.
3. Enter Full Name, Email, Password, Phone (if asked).
4. Submit sign-up form.
5. Verify email from inbox.

### 3.2 Login

1. Return to login page.
2. Enter email/username and password.
3. Click **Sign In**.
4. If account requires approval/activation, contact admin.

### 3.3 Password Reset

1. Click **Forgot Password** on login page.
2. Enter registered email.
3. Follow reset link/instructions.

---

## 4) Main Navigation and Dashboard

After login:

- Top area shows user, role, sync state, and selected substation.
- Sidebar provides modules:
  - Daily Log
  - Battery
  - Faults
  - Maintenance
  - Charge Handover
  - History Register
  - Reports, Notices, Feedback (as per permissions)

Dashboard cards show summary metrics:

- Substations
- Employees
- Daily Logs
- Fault Rows
- Active Sessions / Notices / Feedback

If counts mismatch across devices, always click **Sync now** and then refresh module page.

---

## 5) Global Working Pattern (Important)

For every module, use this safe sequence:

1. Select correct **Substation**.
2. Select correct **Date**.
3. Enter data.
4. Click **Save**.
5. Click header **Sync now**.
6. On second device, click **Sync now** and reload module.

This ensures cloud push + pull is completed.

---

## 6) Module-Wise Step-by-Step Usage

## 6.1 Daily Log

1. Open **Daily Log**.
2. Select Date and Substation.
3. Fill feeder readings hour-wise (Amp, KV, KWH).
4. Add interruptions (if needed).
5. Add meter change event (if needed).
6. Click **Save Data**.
7. If day complete, click **Finalize Day**.
8. Use **Sync now** to publish to cloud.

Tips:

- Use **Reload** if remote updates are expected.
- Use **Recalculate** when validation/summaries need refresh.

---

## 6.2 Battery Module

1. Open **Battery**.
2. Select Date, Substation, Battery Set.
3. Fill checklist and cell values (SG, Voltage, remarks).
4. Save record.
5. Run **Sync now**.

---

## 6.3 Fault Register

1. Open **Faults**.
2. Select Date and Substation.
3. Enter From/To time, feeder, fault type, cause, remark.
4. Save entry.
5. Run **Sync now**.

---

## 6.4 Maintenance

1. Open **Maintenance**.
2. Select Date and Substation.
3. Enter maintenance activity details.
4. Save.
5. Run **Sync now**.

---

## 6.5 Charge Handover

1. Open **Charge Handover**.
2. Select date/substation/shift info.
3. Enter outgoing and incoming operator details.
4. Record pending points and status.
5. Save and run **Sync now**.

---

## 6.6 History Register

1. Open **History Register**.
2. Apply filters (substation, type, status, feeder, date range).
3. View or add entries as per access.
4. Save and sync.

---

## 7) Masters and Admin Operations

For admin users:

1. Open **Masters** to manage:
   - Divisions
   - Feeders
   - Battery Sets
   - Transformers
2. Keep feeder naming and ordering consistent.
3. Save each master update and sync.

Note:

- Masters data affects downstream operational modules.

---

## 8) Multi-Device Data Sync Checklist

If data not visible on another device:

1. Confirm same user role/substation access.
2. Confirm record saved successfully.
3. On source device: click **Sync now**.
4. On target device: click **Sync now**.
5. Reload target module (not only dashboard).
6. Check selected date/substation filters.
7. Verify internet connectivity.

---

## 9) Refresh Behavior and Session

Expected behavior:

- Refresh should keep user logged in (if Firebase persistence active).
- App should reopen current route once auth initialization completes.

If you see login redirect unexpectedly:

1. Wait 2-3 seconds (auth bootstrap).
2. Re-open same route from sidebar.
3. If repeated, admin should check auth configuration.

---

## 10) Troubleshooting Quick Guide

- Data saved but not visible:
  - Check date/substation filter mismatch.
  - Trigger sync on both devices.
- Dashboard counts mismatch:
  - Module-level data may be newer than dashboard snapshot.
  - Open module and reload after sync.
- Validation errors:
  - Correct field values and save again.
- Access denied:
  - Role may not allow create/update/delete action.

---

## 11) Best Practices

- Use one substation context at a time.
- Save frequently.
- Run sync before leaving page.
- For daily closing, finalize only after validation.
- Avoid duplicate records for same date/substation unless intentionally updating.

---

## 12) Contact and Support

Support Email: `qt33dlrerp@gmail.com`  
Use in-app Feedback module to report:

- bug details
- module name
- date/substation
- screenshot + exact steps

