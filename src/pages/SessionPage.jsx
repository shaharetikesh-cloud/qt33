import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import {
  getNavigationGroupState,
  getPreferredSubstationId,
  getSidebarCollapsed,
  getUiTheme,
  setUiTheme,
} from '../lib/uiPreferences'
import { alertDetailSaved } from '../lib/detailSavedAlert'
import { loadSessionActivity } from '../lib/unifiedDataService'
import { backendLabel, isOfflineLocalSingleUserProfile } from '../lib/runtimeConfig'
import { APP_VERSION_NAME } from '../lib/appVersion'

function resolveDisplayUsername(profile, sessionUser) {
  const direct = String(profile?.username || sessionUser?.username || '').trim()
  if (direct) return direct

  const email = String(profile?.email || sessionUser?.email || '').trim().toLowerCase()
  if (email.includes('@')) {
    return email.split('@')[0]
  }

  return String(profile?.full_name || '').trim() || 'Not set'
}

function estimateStorageUsageKb() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return 0
  }
  let bytes = 0
  for (const key of Object.keys(window.localStorage)) {
    if (!key.startsWith('umsw.')) {
      continue
    }
    const value = window.localStorage.getItem(key) || ''
    bytes += key.length + value.length
  }
  return Math.round(bytes / 1024)
}

export default function SessionPage() {
  const navigate = useNavigate()
  const {
    profile,
    session,
    isAdmin,
    isSuperAdmin,
    roleLabel,
    changePassword,
  } = useAuth()
  const groupState = useMemo(() => getNavigationGroupState(), [])
  const [activity, setActivity] = useState({
    currentSession: null,
    activeSessions: [],
    recentLoginAudit: [],
    recentAppAudit: [],
  })
  const [error, setError] = useState('')
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [passwordStatus, setPasswordStatus] = useState('')
  const [storageUsageKb] = useState(() =>
    isOfflineLocalSingleUserProfile ? estimateStorageUsageKb() : 0,
  )
  const [uiTheme, setUiThemeState] = useState(() => getUiTheme())
  function handleToggleUiTheme() {
    setUiThemeState((current) => {
      const next = current === 'dark' ? 'light' : 'dark'
      setUiTheme(next)
      return next
    })
  }
  function handleResetLocalData() {
    const confirmed = window.confirm(
      'All data on this device will be deleted. Backup export kelay ka? हा action undo hot nahi.',
    )
    if (!confirmed) {
      return
    }
    const keysToDelete = Object.keys(window.localStorage).filter((key) => key.startsWith('umsw.'))
    for (const key of keysToDelete) {
      window.localStorage.removeItem(key)
    }
    if (typeof window.indexedDB !== 'undefined') {
      window.indexedDB.deleteDatabase('umsw-offline-db')
    }
    window.alert('Local device data reset complete. App reload hot aahe.')
    window.location.reload()
  }

  useEffect(() => {
    let active = true

    async function loadActivity() {
      try {
        const payload = await loadSessionActivity(profile)

        if (!active) {
          return
        }

        setActivity(payload)
        setError('')
      } catch (loadError) {
        if (active) {
          setError(loadError.message)
        }
      }
    }

    void loadActivity()

    return () => {
      active = false
    }
  }, [profile])

  async function handlePasswordChange(event) {
    event.preventDefault()
    setError('')
    setPasswordStatus('')

    if (passwordForm.newPassword.length < 8) {
      setError('New password kamit kami 8 characters cha hava.')
      return
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError('New password ani confirm password same hava.')
      return
    }

    try {
      const payload = await changePassword(
        passwordForm.currentPassword,
        passwordForm.newPassword,
      )
      setPasswordStatus(payload?.message || 'Password update zala.')
      alertDetailSaved()
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      })
    } catch (changeError) {
      setError(changeError.message)
    }
  }

  return (
    <div className="page-stack page-stack-admin">
      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Administration</p>
            <h2>Session</h2>
          </div>
        </div>
        <div className="details-grid">
          <article className="detail-card">
            <h3>User</h3>
            <p>{profile?.full_name || session?.user?.email || 'Guest'}</p>
          </article>
          <article className="detail-card">
            <h3>Username</h3>
            <p>{resolveDisplayUsername(profile, session?.user)}</p>
          </article>
          <article className="detail-card">
            <h3>Role</h3>
            <p>{isOfflineLocalSingleUserProfile ? 'User' : roleLabel || 'Pending profile'}</p>
          </article>
          <article className="detail-card">
            <h3>Status</h3>
            <p>Active</p>
          </article>
          {!isOfflineLocalSingleUserProfile ? (
            <article className="detail-card">
              <h3>Backend</h3>
              <p>{backendLabel}</p>
            </article>
          ) : null}
          <article className="detail-card">
            <h3>Access</h3>
            <p>
              {isOfflineLocalSingleUserProfile
                ? 'User'
                : isSuperAdmin ? 'Main Admin' : isAdmin ? 'Substation Admin' : roleLabel}
            </p>
          </article>
          <article className="detail-card">
            <h3>Assigned Substation</h3>
            <p>{profile?.substation_name || profile?.substation_id || 'All substations'}</p>
          </article>
        </div>
      </section>

      {isOfflineLocalSingleUserProfile ? (
        <section className="content-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Settings</p>
              <h2>Device backup and storage</h2>
            </div>
          </div>
          <div className="details-grid">
            <article className="detail-card">
              <h3>Profile</h3>
              <p>User</p>
            </article>
            <article className="detail-card">
              <h3>App version</h3>
              <p>{APP_VERSION_NAME}</p>
            </article>
            <article className="detail-card">
              <h3>Storage usage</h3>
              <p>{storageUsageKb} KB (approx)</p>
            </article>
          </div>
          <div className="inline-actions">
            <button type="button" className="ghost-light-button" onClick={handleToggleUiTheme}>
              {uiTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            </button>
            <button type="button" className="primary-button" onClick={() => navigate('/masters')}>
              Backup Export / Import
            </button>
            <button type="button" className="danger-button" onClick={handleResetLocalData}>
              Reset Local Data
            </button>
          </div>
          <p className="muted-copy">Data is saved on this device. Regular backup export recommended.</p>
        </section>
      ) : null}

      {profile?.must_change_password ? (
        <section className="callout warning-callout">
          <p>
            Temporary password vaparla aahe. Security sathi ata Session page वरून navi password
            set kara.
          </p>
        </section>
      ) : null}

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Security</p>
            <h2>Change Password</h2>
          </div>
        </div>
        {passwordStatus ? (
          <div className="callout success-callout">
            <p>{passwordStatus}</p>
          </div>
        ) : null}
        <form className="form-stack" onSubmit={handlePasswordChange}>
          <div className="details-grid">
            <div>
              <label htmlFor="session-current-password">Current password</label>
              <input
                id="session-current-password"
                type="password"
                value={passwordForm.currentPassword}
                onChange={(event) =>
                  setPasswordForm((current) => ({
                    ...current,
                    currentPassword: event.target.value,
                  }))
                }
                required
              />
            </div>
            <div>
              <label htmlFor="session-new-password">New password</label>
              <input
                id="session-new-password"
                type="password"
                value={passwordForm.newPassword}
                onChange={(event) =>
                  setPasswordForm((current) => ({
                    ...current,
                    newPassword: event.target.value,
                  }))
                }
                minLength={8}
                required
              />
            </div>
            <div>
              <label htmlFor="session-confirm-password">Confirm password</label>
              <input
                id="session-confirm-password"
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(event) =>
                  setPasswordForm((current) => ({
                    ...current,
                    confirmPassword: event.target.value,
                  }))
                }
                minLength={8}
                required
              />
            </div>
          </div>
          <button type="submit" className="primary-button">
            Update password
          </button>
        </form>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2>Remembered UI state</h2>
          </div>
        </div>
        <div className="details-grid">
          <article className="detail-card">
            <h3>Sidebar mode</h3>
            <p>{getSidebarCollapsed() ? 'Collapsed' : 'Expanded'}</p>
          </article>
          <article className="detail-card">
            <h3>Preferred substation</h3>
            <p>{getPreferredSubstationId() || 'Not selected'}</p>
          </article>
          <article className="detail-card">
            <h3>Open menu groups</h3>
            <p>
              {Object.entries(groupState)
                .filter(([, value]) => value)
                .map(([key]) => key)
                .join(', ') || 'None'}
            </p>
          </article>
        </div>
      </section>

      {error ? (
        <section className="callout danger-callout">
          <p>{error}</p>
        </section>
      ) : null}

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Session activity</p>
            <h2>Current session and active logins</h2>
          </div>
        </div>
        <div className="details-grid">
          <article className="detail-card">
            <h3>Current session created</h3>
            <p>{activity.currentSession?.createdAt || '-'}</p>
          </article>
          <article className="detail-card">
            <h3>Current session expires</h3>
            <p>{activity.currentSession?.expiresAt || '-'}</p>
          </article>
          <article className="detail-card">
            <h3>Active sessions</h3>
            <p>{activity.activeSessions.length}</p>
          </article>
        </div>
        <div className="table-shell">
          <table className="simple-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Created</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {activity.activeSessions.map((entry) => (
                <tr key={entry.token}>
                  <td>{entry.fullName || entry.email || entry.userId}</td>
                  <td>{entry.roleLabel || entry.role || '-'}</td>
                  <td>{entry.createdAt}</td>
                  <td>{entry.expiresAt}</td>
                </tr>
              ))}
              {!activity.activeSessions.length ? (
                <tr>
                  <td colSpan={4}>No active sessions available.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recent activity</p>
            <h2>Login and workspace trace</h2>
          </div>
        </div>
        <div className="table-shell">
          <table className="simple-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Action</th>
                <th>Context</th>
              </tr>
            </thead>
            <tbody>
              {[
                ...activity.recentLoginAudit.map((item) => ({
                  id: `login-${item.id}`,
                  time: item.createdAt,
                  type: 'Login',
                  action: item.action,
                  context: JSON.stringify({
                    username: item.username || '',
                    ...(item.context || {}),
                  }),
                })),
                ...activity.recentAppAudit.map((item) => ({
                  id: `app-${item.id}`,
                  time: item.createdAt,
                  type: 'Workspace',
                  action: item.action,
                  context: JSON.stringify(item.context || {}),
                })),
              ]
                .sort((left, right) => String(right.time).localeCompare(String(left.time)))
                .slice(0, 20)
                .map((item) => (
                  <tr key={item.id}>
                    <td>{item.time}</td>
                    <td>{item.type}</td>
                    <td>{item.action}</td>
                    <td>{item.context}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
