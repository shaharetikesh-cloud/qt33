export const legacySystems = [
  {
    id: 'advance-dlr-erp',
    name: 'Advance DLR ERP',
    stack: 'Vanilla JavaScript SPA + Supabase + IndexedDB cache',
    deploymentState: 'Already deployed against Supabase and treated as the current operational baseline.',
    strengths: [
      'DLR-specific modules already exist for daily log, battery, faults, maintenance, charge handover, substations, users, and reports.',
      'Supabase data sync is already in place through cloud bootstrap and per-record sync helpers.',
      'Operational report logic is mature enough to be used as the business-rules source while the new system is rebuilt.',
    ],
    risks: [
      'Large modules are tightly coupled to desktop-style tables and browser print flows.',
      'Current cloud sync is refresh-based, not realtime collaborative editing.',
      'Admin user management and password reset flows are incomplete for a polished multi-tenant rollout.',
    ],
    keyAnchors: [
      'index.html bootstraps module scripts and Supabase config.',
      'js/storage.js and js/cloud-sync.js define the current data contracts and sync flow.',
      'js/reports.js contains month-end export logic that should be ported carefully, not guessed.',
    ],
  },
  {
    id: 'firebase-adv',
    name: 'firebase_adv',
    stack: 'React + Firebase Auth + Firestore + Vite + Android runtime packaging',
    deploymentState: 'Local/mobile-oriented project with better UX patterns but a different backend.',
    strengths: [
      'React component architecture is cleaner for long-term maintenance.',
      'Mobile-first data-entry and print-preview patterns are already proven.',
      'Android runtime packaging and PWA setup reduce effort for APK delivery.',
    ],
    risks: [
      'Business domain is narrower and does not cover the full DLR operational scope.',
      'Firebase backend cannot be mixed directly with the Supabase-first production direction without duplication.',
      'Forgot password and unified admin provisioning are still incomplete.',
    ],
    keyAnchors: [
      'src/context/AuthContext.jsx shows signup approval and role-based patterns.',
      'src/pages/* demonstrate mobile-friendly editing and print rendering patterns.',
      'firestore.rules show data isolation concepts that should be recreated with Supabase RLS.',
    ],
  },
]

export const targetModules = [
  {
    name: 'Identity and Access',
    source: 'Supabase Auth foundation + Firebase approval ideas',
    scope:
      'Admin-created accounts, self-signup requests, forgot password, role management, and per-user data visibility.',
  },
  {
    name: 'Employee and Substation Master',
    source: 'Advance DLR ERP + selected firebase_adv UX patterns',
    scope:
      'Employee registry, substation scoping, and mobile-friendly data entry patterns for DLR modules.',
  },
  {
    name: 'DLR Operations',
    source: 'Advance DLR ERP',
    scope:
      'Daily log, faults, maintenance, battery, charge handover, substations, and consolidated reporting.',
  },
  {
    name: 'Reporting and Printing',
    source: 'Both systems',
    scope:
      'A4 PDF output, share/print actions on mobile, and eventual server-assisted heavy exports where browser-only logic is too fragile.',
  },
]

export const architectureDecisions = [
  {
    title: 'Use a third project instead of direct folder merge',
    detail:
      'A clean new codebase avoids coupling React and vanilla modules while keeping both legacy apps safe as audit references.',
  },
  {
    title: 'Choose Supabase as the unified backend',
    detail:
      'The production DLR system already depends on Supabase, and Hostinger can serve the frontend while Supabase handles auth, database, and reset email flows.',
  },
  {
    title: 'Adopt HashRouter for shared hosting',
    detail:
      'Hash-based routing avoids complex rewrite rules when the build is uploaded to Hostinger shared hosting.',
  },
  {
    title: 'Enforce data isolation through RLS',
    detail:
      'Users should only read their own records, while admins can see all data. This must live in the database layer, not just in the UI.',
  },
  {
    title: 'Use Android runtime packaging after web flows stabilize',
    detail:
      'The same React app can later be packaged as Android APK without forking the business logic.',
  },
]

export const deliveryPhases = [
  'Phase 1: auth, profiles, admin approval, and substation master',
  'Phase 2: employee master and shared UX patterns from firebase_adv',
  'Phase 3: DLR operational modules from Advance DLR ERP',
  'Phase 4: reports, print, PDF, and mobile polish',
  'Phase 5: migration utilities and UAT against real operational data',
  'Phase 6: Hostinger deployment and Android APK release',
]
