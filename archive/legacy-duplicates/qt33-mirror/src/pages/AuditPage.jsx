import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { localListLoginAudit } from '../lib/localApi'
import {
  getSettingsBundle,
  loadWorkspaceConfiguration,
  loadAuditEvents,
  loadReportSnapshots,
  loadUserSubstationMappings,
} from '../lib/unifiedDataService'

export default function AuditPage() {
  const { isAdmin, profile } = useAuth()
  const [loginAudit, setLoginAudit] = useState([])
  const [localAudit, setLocalAudit] = useState([])
  const [reportSnapshots, setReportSnapshots] = useState([])
  const [mappings, setMappings] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAdmin) {
      return
    }

    let active = true

    async function loadAudit() {
      try {
        await loadWorkspaceConfiguration(profile)
        const loginEntries = await localListLoginAudit()

        if (!active) {
          return
        }

        setLoginAudit(loginEntries)
        setLocalAudit(await loadAuditEvents(profile))
        setReportSnapshots(await loadReportSnapshots({ profile }))
        setMappings(await loadUserSubstationMappings(profile))
      } catch (loadError) {
        if (active) {
          setError(loadError.message)
        }
      }
    }

    void loadAudit()

    return () => {
      active = false
    }
  }, [isAdmin, profile])

  if (!isAdmin) {
    return (
      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Restricted</p>
            <h2>Audit trail admin sathi reserved aahe.</h2>
          </div>
        </div>
        <p className="muted-copy">
          Admin kiwa super admin login ne audit, approval, and export trace review karta yeil.
        </p>
      </section>
    )
  }

  const settings = getSettingsBundle()

  return (
    <div className="page-stack">
      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Operational audit</p>
            <h2>Approval, login, export, and configuration trace</h2>
          </div>
        </div>
        <p className="muted-copy">
          This screen shows real audit data from the unified workspace: local auth activity,
          report export snapshots, configuration edits, and user-substation assignments.
        </p>
        {error ? (
          <div className="callout danger-callout">
            <p>{error}</p>
          </div>
        ) : null}
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Current controls</p>
            <h2>Print and role posture</h2>
          </div>
        </div>
        <div className="details-grid">
          <article className="detail-card">
            <h3>Company header</h3>
            <p>{settings.companyProfile.companyName}</p>
          </article>
          <article className="detail-card">
            <h3>Office name</h3>
            <p>{settings.companyProfile.officeName}</p>
          </article>
          <article className="detail-card">
            <h3>Default orientation</h3>
            <p>{settings.printSettings.defaultOrientation}</p>
          </article>
          <article className="detail-card">
            <h3>Compact tables</h3>
            <p>{settings.printSettings.compactTables ? 'Enabled' : 'Disabled'}</p>
          </article>
        </div>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">User mapping</p>
            <h2>Substation assignments</h2>
          </div>
        </div>
        <div className="table-shell">
          <table className="simple-table">
            <thead>
              <tr>
                <th>User ID</th>
                <th>Substation ID</th>
                <th>Updated At</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping) => (
                <tr key={mapping.id}>
                  <td>{mapping.userId}</td>
                  <td>{mapping.substationId}</td>
                  <td>{mapping.updatedAt || mapping.createdAt || '-'}</td>
                </tr>
              ))}
              {!mappings.length ? (
                <tr>
                  <td colSpan={3}>No user-substation mappings yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Login audit</p>
            <h2>Auth activity</h2>
          </div>
        </div>
        <div className="table-shell">
          <table className="simple-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Email</th>
                <th>Action</th>
                <th>Context</th>
              </tr>
            </thead>
            <tbody>
              {loginAudit.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.createdAt}</td>
                  <td>{entry.email || '-'}</td>
                  <td>{entry.action}</td>
                  <td>{JSON.stringify(entry.context || {})}</td>
                </tr>
              ))}
              {!loginAudit.length ? (
                <tr>
                  <td colSpan={4}>No login audit rows available.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Workspace audit</p>
            <h2>Data and settings events</h2>
          </div>
        </div>
        <div className="table-shell">
          <table className="simple-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Context</th>
              </tr>
            </thead>
            <tbody>
              {localAudit.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.createdAt}</td>
                  <td>{entry.action}</td>
                  <td>{entry.actorEmail || entry.actorId || '-'}</td>
                  <td>{JSON.stringify(entry.context || {})}</td>
                </tr>
              ))}
              {!localAudit.length ? (
                <tr>
                  <td colSpan={4}>No local audit events yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Report snapshots</p>
            <h2>Export and print trace</h2>
          </div>
        </div>
        <div className="table-shell">
          <table className="simple-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Report</th>
                <th>Export Type</th>
                <th>Substation</th>
                <th>Month</th>
              </tr>
            </thead>
            <tbody>
              {reportSnapshots.map((snapshot) => (
                <tr key={snapshot.id}>
                  <td>{snapshot.updatedAt || snapshot.createdAt || '-'}</td>
                  <td>{snapshot.title || snapshot.reportType}</td>
                  <td>{snapshot.exportType}</td>
                  <td>{snapshot.substationLabel || '-'}</td>
                  <td>{snapshot.monthLabel || '-'}</td>
                </tr>
              ))}
              {!reportSnapshots.length ? (
                <tr>
                  <td colSpan={5}>No report snapshots yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
