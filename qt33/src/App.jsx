import { lazy, Suspense } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppShell from './components/AppShell'
import { AuthProvider, useAuth } from './context/AuthContext'

function AdminOnlyPage({ children }) {
  const { isMainAdmin } = useAuth()

  if (!isMainAdmin) {
    return <Navigate to="/" replace />
  }

  return children
}

function UserManagerPage({ children }) {
  const { canManageUsers } = useAuth()

  if (!canManageUsers) {
    return <Navigate to="/" replace />
  }

  return children
}

function ModulePage({ moduleKey, children }) {
  const { canViewModule } = useAuth()

  if (!canViewModule(moduleKey)) {
    return <Navigate to="/" replace />
  }

  return children
}

const ArchitecturePage = lazy(() => import('./pages/ArchitecturePage'))
const AuditPage = lazy(() => import('./pages/AuditPage'))
const BatteryPage = lazy(() => import('./pages/BatteryPage'))
const ChargeHandoverPage = lazy(() => import('./pages/ChargeHandoverPage'))
const DailyLogPage = lazy(() => import('./pages/DailyLogPage'))
const EmployeesPage = lazy(() => import('./pages/EmployeesPage'))
const FeedbackPage = lazy(() => import('./pages/FeedbackPage'))
const FaultsPage = lazy(() => import('./pages/FaultsPage'))
const HistoryRegisterPage = lazy(() => import('./pages/HistoryRegisterPage'))
const HomePage = lazy(() => import('./pages/HomePage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const MaintenancePage = lazy(() => import('./pages/MaintenancePage'))
const MastersPage = lazy(() => import('./pages/MastersPage'))
const MonthEndPackPage = lazy(() => import('./pages/MonthEndPackPage'))
const NoticeBoardPage = lazy(() => import('./pages/NoticeBoardPage'))
const ReportCenterPage = lazy(() => import('./pages/ReportCenterPage'))
const SessionPage = lazy(() => import('./pages/SessionPage'))
const SubstationsPage = lazy(() => import('./pages/SubstationsPage'))
const UsersPage = lazy(() => import('./pages/UsersPage'))

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-card">
        <p className="eyebrow">Unified workspace</p>
        <h1>Loading session...</h1>
        <p>Auth, profile, ani access posture verify hot aahe.</p>
      </div>
    </div>
  )
}

function PublicRoute() {
  const { session, loading, recoveryMode } = useAuth()

  if (loading) {
    return <LoadingScreen />
  }

  if (session && !recoveryMode) {
    return <Navigate to="/" replace />
  }

  return (
    <Suspense fallback={<LoadingScreen />}>
      <LoginPage />
    </Suspense>
  )
}

function ProtectedRoute() {
  const { session, loading, recoveryMode, profile } = useAuth()
  const location = useLocation()

  if (loading) {
    return <LoadingScreen />
  }

  if (!session || recoveryMode) {
    return <Navigate to="/login" replace />
  }

  if (profile?.must_change_password && location.pathname !== '/session') {
    return <Navigate to="/session" replace />
  }

  return (
    <Suspense fallback={<LoadingScreen />}>
      <AppShell />
    </Suspense>
  )
}

function WorkspaceIndexPage() {
  return <HomePage />
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<PublicRoute />} />
          <Route path="/" element={<ProtectedRoute />}>
            <Route index element={<WorkspaceIndexPage />} />
            <Route
              path="masters"
              element={
                <AdminOnlyPage>
                  <MastersPage />
                </AdminOnlyPage>
              }
            />
            <Route
              path="substations"
              element={
                <UserManagerPage>
                  <SubstationsPage />
                </UserManagerPage>
              }
            />
            <Route
              path="employees"
              element={
                <ModulePage moduleKey="employees">
                  <EmployeesPage />
                </ModulePage>
              }
            />
            <Route
              path="daily-log"
              element={
                <ModulePage moduleKey="daily_log">
                  <DailyLogPage />
                </ModulePage>
              }
            />
            <Route
              path="battery"
              element={
                <ModulePage moduleKey="battery">
                  <BatteryPage />
                </ModulePage>
              }
            />
            <Route
              path="faults"
              element={
                <ModulePage moduleKey="faults">
                  <FaultsPage />
                </ModulePage>
              }
            />
            <Route
              path="maintenance"
              element={
                <ModulePage moduleKey="maintenance">
                  <MaintenancePage />
                </ModulePage>
              }
            />
            <Route
              path="charge-handover"
              element={
                <ModulePage moduleKey="charge_handover">
                  <ChargeHandoverPage />
                </ModulePage>
              }
            />
            <Route
              path="history-register"
              element={
                <ModulePage moduleKey="history_register">
                  <HistoryRegisterPage />
                </ModulePage>
              }
            />
            <Route
              path="report-center"
              element={
                <ModulePage moduleKey="reports">
                  <ReportCenterPage />
                </ModulePage>
              }
            />
            <Route
              path="month-end-pack"
              element={
                <ModulePage moduleKey="reports">
                  <MonthEndPackPage />
                </ModulePage>
              }
            />
            <Route
              path="notices"
              element={
                <ModulePage moduleKey="notices">
                  <NoticeBoardPage />
                </ModulePage>
              }
            />
            <Route
              path="feedback"
              element={
                <ModulePage moduleKey="feedback">
                  <FeedbackPage />
                </ModulePage>
              }
            />
            <Route
              path="audit"
              element={
                <AdminOnlyPage>
                  <AuditPage />
                </AdminOnlyPage>
              }
            />
            <Route path="session" element={<SessionPage />} />
            <Route
              path="architecture"
              element={
                <AdminOnlyPage>
                  <ArchitecturePage />
                </AdminOnlyPage>
              }
            />
            <Route
              path="users"
              element={
                <UserManagerPage>
                  <UsersPage />
                </UserManagerPage>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}
