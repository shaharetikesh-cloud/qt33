import { useEffect, useState } from 'react'
import {
  getSyncDiagnostics,
  retryOutboxStatuses,
  runForceSyncNow,
  runManualSyncNow,
  subscribeSyncState,
} from '../lib/syncEngine'

export default function SyncMonitorPage() {
  const [syncState, setSyncState] = useState({
    pending: 0,
    failed: 0,
    conflicts: 0,
    synced: 0,
    lastSyncAt: '',
    realtimeConnected: false,
  })
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    return subscribeSyncState((state) => {
      setSyncState(state)
    })
  }, [])

  async function refreshDiagnostics() {
    const diagnostics = await getSyncDiagnostics(300)
    setRows(diagnostics.outboxRows || [])
  }

  useEffect(() => {
    void refreshDiagnostics()
    const timerId = window.setInterval(() => {
      void refreshDiagnostics()
    }, 3000)
    return () => window.clearInterval(timerId)
  }, [])

  async function runAction(action) {
    if (busy) return
    setBusy(true)
    setNote('')
    try {
      if (action === 'manual') {
        await runManualSyncNow()
        setNote('Manual sync completed.')
      } else if (action === 'force') {
        await runForceSyncNow()
        setNote('Force sync completed.')
      } else if (action === 'retry') {
        const changed = await retryOutboxStatuses(['failed', 'conflict'])
        setNote(`Retry queued: ${changed}`)
      }
      await refreshDiagnostics()
    } catch (error) {
      setNote(error?.message || 'Action failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-stack">
      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Admin tools</p>
            <h2>Live Sync Monitor</h2>
          </div>
        </div>
        <div className="details-grid">
          <article className="detail-card">
            <small>Pending</small>
            <strong>{syncState.pending || 0}</strong>
          </article>
          <article className="detail-card">
            <small>Failed</small>
            <strong>{syncState.failed || 0}</strong>
          </article>
          <article className="detail-card">
            <small>Conflict</small>
            <strong>{syncState.conflicts || 0}</strong>
          </article>
          <article className="detail-card">
            <small>Last sync</small>
            <strong>{syncState.lastSyncAt || 'Not yet'}</strong>
          </article>
          <article className="detail-card">
            <small>Realtime</small>
            <strong>{syncState.realtimeConnected ? 'Connected' : 'Disconnected'}</strong>
          </article>
        </div>
        <div className="inline-actions">
          <button
            type="button"
            className="ghost-light-button"
            onClick={() => void runAction('manual')}
            disabled={busy}
          >
            Manual sync now
          </button>
          <button
            type="button"
            className="ghost-light-button"
            onClick={() => void runAction('retry')}
            disabled={busy}
          >
            Retry failed/conflict
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void runAction('force')}
            disabled={busy}
          >
            Force sync all pending
          </button>
        </div>
        {note ? <p className="muted-copy">{note}</p> : null}
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Queue details</p>
            <h2>Outbox status (latest 300)</h2>
          </div>
        </div>
        <div className="table-shell">
          <table className="simple-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Scope</th>
                <th>Record ID</th>
                <th>Device</th>
                <th>Retry</th>
                <th>Updated</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.queue_id}>
                  <td>{row.sync_status || '-'}</td>
                  <td>{row.entity_type || row.scope || '-'}</td>
                  <td>{row.id || '-'}</td>
                  <td>{row.device_id || '-'}</td>
                  <td>{row.retry_count || 0}</td>
                  <td>{row.updated_at || '-'}</td>
                  <td>{row.last_error || '-'}</td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={7}>No outbox rows available.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

