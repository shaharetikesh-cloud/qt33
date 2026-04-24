import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { localGetDashboardSummary, localTrackVisitor } from '../lib/localApi'
import AppIcon from '../components/ui/AppIcon'
import { isLocalSqlMode } from '../lib/runtimeConfig'
import {
  listDlrRecords,
  loadDlrRecords,
} from '../lib/unifiedDataService'

const quickActions = [
  { to: '/daily-log', label: 'Open Daily Log', description: 'Hourly chart entry and feeder analytics.', moduleKey: 'daily_log' },
  { to: '/faults', label: 'Open Fault Register', description: 'Daily fault entry and fault sheet.', moduleKey: 'faults' },
  { to: '/report-center', label: 'Open Reports', description: 'Monthly reports and print previews.', moduleKey: 'reports' },
  { to: '/notices', label: 'Open Notice Board', description: 'Office notices and live instructions.', moduleKey: 'notices' },
  { to: '/feedback', label: 'Open Feedback', description: 'Suggestions, issues, and improvement requests.', moduleKey: 'feedback' },
]

function getActivityRows(profile) {
  const dailyLogs = listDlrRecords({ moduleName: 'daily_log', profile })
    .slice(0, 3)
    .map((record) => ({
      id: `daily-log-${record.id}`,
      label: 'Daily Log',
      detail: record.substationSnapshot?.name || record.substationId,
      date: record.operationalDate,
    }))
  const faults = listDlrRecords({ moduleName: 'fault', profile })
    .slice(0, 2)
    .map((record) => ({
      id: `fault-${record.id}`,
      label: 'Fault Entry',
      detail: record.substationSnapshot?.name || record.substationId,
      date: record.operationalDate,
    }))

  return [...dailyLogs, ...faults]
    .sort((left, right) => String(right.date).localeCompare(String(left.date)))
    .slice(0, 6)
}

export default function HomePage() {
  const {
    profile,
    roleLabel,
    isMainAdmin,
    isSubstationAdmin,
    canManageUsers,
    canViewModule,
  } = useAuth()
  const [recentActivity, setRecentActivity] = useState([])
  const [summary, setSummary] = useState({
    substations: 0,
    employees: 0,
    operators: 0,
    activeEmployees: 0,
    dailyLogs: 0,
    faultRows: 0,
    activeSessions: 0,
    activeNotices: 0,
    openFeedback: 0,
    recentLogins24h: 0,
  })
  const [visitorStats, setVisitorStats] = useState({ totalVisitors: 0, todayVisitors: 0 })

  const dashboardTitle = isMainAdmin
    ? 'Main Admin dashboard for all substations and users.'
    : isSubstationAdmin
      ? 'Substation Admin dashboard for your assigned substation.'
      : 'Operational dashboard for your assigned substation.'
  const dashboardSubtitle = isMainAdmin
    ? 'User management, audit, and cross-substation visibility are active in this workspace.'
    : 'Operational records are automatically filtered to your assigned substation at backend level.'
  const canViewDailyLog = canViewModule('daily_log')
  const canViewFaults = canViewModule('faults')
  const canViewReports = canViewModule('reports')
  const canViewNotices = canViewModule('notices')
  const canViewFeedback = canViewModule('feedback')
  const visibleQuickActions = canManageUsers
    ? [
        ...quickActions.filter((item) => {
          if (!item.moduleKey) return true
          if (item.moduleKey === 'daily_log') return canViewDailyLog
          if (item.moduleKey === 'faults') return canViewFaults
          if (item.moduleKey === 'reports') return canViewReports
          if (item.moduleKey === 'notices') return canViewNotices
          if (item.moduleKey === 'feedback') return canViewFeedback
          return false
        }),
        {
          to: '/users',
          label: 'Open User Management',
          description: 'Create, edit, disable, and reset local users.',
        },
      ]
    : quickActions.filter((item) => {
        if (!item.moduleKey) return true
        if (item.moduleKey === 'daily_log') return canViewDailyLog
        if (item.moduleKey === 'faults') return canViewFaults
        if (item.moduleKey === 'reports') return canViewReports
        if (item.moduleKey === 'notices') return canViewNotices
        if (item.moduleKey === 'feedback') return canViewFeedback
        return false
      })

  useEffect(() => {
    let active = true

    async function loadSummary() {
      try {
        const visitors = await localTrackVisitor()
        if (active) {
          setVisitorStats(visitors)
        }
      } catch {
        // ignore visitor metric failures to keep dashboard resilient
      }
      const [dailyLogs, faultRows] = await Promise.all([
        canViewDailyLog ? loadDlrRecords({ moduleName: 'daily_log', profile }) : Promise.resolve([]),
        canViewFaults ? loadDlrRecords({ moduleName: 'fault', profile }) : Promise.resolve([]),
      ])

      if (active) {
        setRecentActivity(
          getActivityRows(profile).filter((item) => {
            if (item.id.startsWith('daily-log-')) {
              return canViewDailyLog
            }
            if (item.id.startsWith('fault-')) {
              return canViewFaults
            }
            return true
          }),
        )
      }

      if (!isLocalSqlMode) {
        if (active) {
          setSummary((current) => ({
            ...current,
            dailyLogs: dailyLogs.length,
            faultRows: faultRows.length,
          }))
        }
        return
      }

      try {
        const data = await localGetDashboardSummary()

        if (active) {
          setSummary((current) => ({
            ...current,
            ...data,
            dailyLogs: dailyLogs.length,
            faultRows: faultRows.length,
          }))
        }
      } catch {
        if (active) {
          setSummary({
            substations: 0,
            employees: 0,
            operators: 0,
            activeEmployees: 0,
            dailyLogs: dailyLogs.length,
            faultRows: faultRows.length,
          })
        }
      }
    }

    void loadSummary()

    return () => {
      active = false
    }
  }, [canViewDailyLog, canViewFaults, profile])

  return (
    <div className="page-stack page-stack-dashboard">
      <section className="dashboard-banner">
        <div>
          <p className="eyebrow">Workspace Overview</p>
          <h2>{dashboardTitle}</h2>
          <p className="muted-copy">
            {dashboardSubtitle}
          </p>
        </div>
        <div className="dashboard-banner-meta">
          <div>
            <span>Visible user</span>
            <strong>{profile?.full_name || profile?.username || 'Local user'}</strong>
          </div>
          <div>
            <span>Access role</span>
            <strong>{roleLabel}</strong>
          </div>
          <div>
            <span>Active employees</span>
            <strong>{summary.activeEmployees}</strong>
          </div>
        </div>
      </section>

      <section className="dashboard-summary-grid">
        <article className="dashboard-stat-card">
          <span>Substations</span>
          <strong>{summary.substations}</strong>
        </article>
        <article className="dashboard-stat-card">
          <span>Employees</span>
          <strong>{summary.employees}</strong>
        </article>
        <article className="dashboard-stat-card">
          <span>Daily Logs</span>
          <strong>{summary.dailyLogs}</strong>
        </article>
        <article className="dashboard-stat-card">
          <span>Fault Rows</span>
          <strong>{summary.faultRows}</strong>
        </article>
        <article className="dashboard-stat-card">
          <span>Operators</span>
          <strong>{summary.operators}</strong>
        </article>
        <article className="dashboard-stat-card">
          <span>Active Sessions</span>
          <strong>{summary.activeSessions}</strong>
        </article>
        <article className="dashboard-stat-card">
          <span>Active Notices</span>
          <strong>{summary.activeNotices}</strong>
        </article>
        <article className="dashboard-stat-card">
          <span>Open Feedback</span>
          <strong>{summary.openFeedback}</strong>
        </article>
        <article className="dashboard-stat-card">
          <span>Recent Logins 24h</span>
          <strong>{summary.recentLogins24h}</strong>
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="content-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Quick actions</p>
              <h2>Jump back into work</h2>
            </div>
          </div>
          <div className="dashboard-action-grid">
            {visibleQuickActions.map((action) => (
              <Link key={action.to} to={action.to} className="dashboard-action-card">
                <strong>{action.label}</strong>
                <span>{action.description}</span>
              </Link>
            ))}
          </div>
        </article>

        <article className="content-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Recent activity</p>
              <h2>Latest operational work</h2>
            </div>
          </div>
          <div className="dashboard-activity-list">
            {recentActivity.length ? (
              recentActivity.map((item) => (
                <div key={item.id} className="dashboard-activity-item">
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </div>
                  <small>{item.date}</small>
                </div>
              ))
            ) : (
              <p className="muted-copy">No recent activity yet.</p>
            )}
          </div>
        </article>
      </section>

      <section className="content-card">
        <p className="muted-copy">
          Contact: qt33dlrerp@gmail.com | Visitors: {visitorStats.totalVisitors} total /{' '}
          {visitorStats.todayVisitors} today |{' '}
          <a
            href="https://youtube.com/@qt-unifiedsubstationerp?si=AMl-m0btmMKwHAjh"
            target="_blank"
            rel="noreferrer"
            aria-label="Open YouTube channel"
            title="YouTube"
          >
            <AppIcon name="youtube" size={14} />
          </a>
        </p>
        <p className="muted-copy">Copyright 2026 QT33.</p>
      </section>
    </div>
  )
}
