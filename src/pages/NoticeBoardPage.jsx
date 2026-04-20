import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { alertDetailSaved } from '../lib/detailSavedAlert'
import {
  deleteNotice,
  loadNotices,
  loadReferenceData,
  saveNotice,
} from '../lib/unifiedDataService'

const blankNotice = {
  id: '',
  substationId: '',
  title: '',
  message: '',
  priority: 'normal',
  status: 'active',
  publishFrom: '',
  publishTo: '',
}

export default function NoticeBoardPage() {
  const { profile, isMainAdmin } = useAuth()
  const [referenceData, setReferenceData] = useState({
    substations: [],
    employees: [],
  })
  const [notices, setNotices] = useState([])
  const [form, setForm] = useState(blankNotice)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const refreshNotices = useCallback(async () => {
    setNotices(await loadNotices({ profile }))
  }, [profile])

  useEffect(() => {
    let active = true

    async function bootstrap() {
      const [bundle, noticeRows] = await Promise.all([
        loadReferenceData(profile),
        loadNotices({ profile }),
      ])

      if (!active) {
        return
      }

      setReferenceData(bundle)
      setNotices(noticeRows)
    }

    void bootstrap()

    return () => {
      active = false
    }
  }, [profile])

  useEffect(() => {
    const timerId = window.setInterval(() => {
      void refreshNotices()
    }, 60000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [refreshNotices])

  async function handleSave() {
    try {
      await saveNotice(form, profile)
      await refreshNotices()
      setForm(blankNotice)
      setStatus('Notice saved.')
      setError('')
      alertDetailSaved()
    } catch (saveError) {
      setError(saveError.message)
      setStatus('')
    }
  }

  async function handleDelete(noticeId) {
    await deleteNotice(noticeId, profile)
    await refreshNotices()
    setStatus('Notice deleted.')
    setError('')
  }

  return (
    <div className="page-stack">
      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Communication</p>
            <h2>Notice Board</h2>
          </div>
        </div>
        <p className="muted-copy">
          Active operational notices, print reminders, and office instructions are visible here.
        </p>
      </section>

      {status ? (
        <section className="callout success-callout">
          <p>{status}</p>
        </section>
      ) : null}
      {error ? (
        <section className="callout danger-callout">
          <p>{error}</p>
        </section>
      ) : null}

      {isMainAdmin ? (
        <section className="content-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Admin</p>
              <h2>Create or update notice</h2>
            </div>
          </div>
          <div className="details-grid">
            <div>
              <label htmlFor="notice-substation">Substation</label>
              <select
                id="notice-substation"
                value={form.substationId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    substationId: event.target.value,
                  }))
                }
              >
                <option value="">All visible substations</option>
                {referenceData.substations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="notice-title">Title</label>
              <input
                id="notice-title"
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label htmlFor="notice-priority">Priority</label>
              <select
                id="notice-priority"
                value={form.priority}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    priority: event.target.value,
                  }))
                }
              >
                <option value="normal">Normal</option>
                <option value="important">Important</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label htmlFor="notice-status">Status</label>
              <select
                id="notice-status"
                value={form.status}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    status: event.target.value,
                  }))
                }
              >
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div>
              <label htmlFor="notice-from">Publish From</label>
              <input
                id="notice-from"
                type="date"
                value={form.publishFrom}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    publishFrom: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label htmlFor="notice-to">Publish To</label>
              <input
                id="notice-to"
                type="date"
                value={form.publishTo}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    publishTo: event.target.value,
                  }))
                }
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="notice-message">Message</label>
              <textarea
                id="notice-message"
                rows={4}
                value={form.message}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    message: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <div className="inline-actions">
            <button type="button" className="primary-button" onClick={() => void handleSave()}>
              {form.id ? 'Update notice' : 'Save notice'}
            </button>
            <button type="button" className="ghost-light-button" onClick={() => setForm(blankNotice)}>
              Clear
            </button>
          </div>
        </section>
      ) : null}

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Visible notices</p>
            <h2>Current board</h2>
          </div>
        </div>
        <div className="table-shell">
          <table className="simple-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Title</th>
                <th>Priority</th>
                <th>Substation</th>
                <th>Message</th>
                {isMainAdmin ? <th>Action</th> : null}
              </tr>
            </thead>
            <tbody>
              {notices.map((notice) => (
                <tr key={notice.id}>
                  <td>{notice.updatedAt || notice.createdAt}</td>
                  <td>{notice.title}</td>
                  <td>{notice.priority}</td>
                  <td>
                    {referenceData.substations.find((item) => item.id === notice.substationId)?.name ||
                      (notice.substationId ? notice.substationId : 'All')}
                  </td>
                  <td>{notice.message}</td>
                  {isMainAdmin ? (
                    <td>
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="ghost-light-button small-button"
                          onClick={() => setForm(notice)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="danger-button small-button"
                          onClick={() => void handleDelete(notice.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
              {!notices.length ? (
                <tr>
                  <td colSpan={isMainAdmin ? 6 : 5}>No visible notices available.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
