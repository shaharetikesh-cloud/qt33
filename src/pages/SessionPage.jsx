import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  getNavigationGroupState,
  getPreferredSubstationId,
  getSidebarCollapsed,
} from '../lib/uiPreferences'
import { alertDetailSaved } from '../lib/detailSavedAlert'
import { loadSessionActivity } from '../lib/unifiedDataService'

export default function SessionPage() {
  const {
    profile,
    session,
    backendLabel,
    isApproved,
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
            <p>{profile?.username || session?.user?.username || 'Not available'}</p>
          </article>
          <article className="detail-card">
            <h3>Role</h3>
            <p>{roleLabel || 'Pending profile'}</p>
          </article>
          <article className="detail-card">
            <h3>Approval</h3>
            <p>{isApproved ? 'Approved' : profile?.approval_status || 'Pending'}</p>
          </article>
          <article className="detail-card">
            <h3>Backend</h3>
            <p>{backendLabel}</p>
          </article>
          <article className="detail-card">
            <h3>Access</h3>
            <p>{isSuperAdmin ? 'Main Admin' : isAdmin ? 'Substation Admin' : roleLabel}</p>
          </article>
          <article className="detail-card">
            <h3>Assigned Substation</h3>
            <p>{profile?.substation_name || profile?.substation_id || 'All substations'}</p>
          </article>
        </div>
      </section>

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
