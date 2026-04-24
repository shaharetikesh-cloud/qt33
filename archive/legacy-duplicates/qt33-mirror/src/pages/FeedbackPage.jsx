import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { alertDetailSaved } from '../lib/detailSavedAlert'
import {
  loadFeedbackEntries,
  loadReferenceData,
  saveFeedbackEntry,
  updateFeedbackEntry,
} from '../lib/unifiedDataService'

const blankFeedback = {
  substationId: '',
  moduleName: 'daily_log',
  category: 'suggestion',
  priority: 'medium',
  subject: '',
  message: '',
}

const moduleOptions = [
  { value: 'daily_log', label: 'Daily Log' },
  { value: 'battery', label: 'Battery' },
  { value: 'fault', label: 'Faults' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'charge_handover', label: 'Charge Handover' },
  { value: 'report_center', label: 'Report Center' },
  { value: 'general', label: 'General' },
]

export default function FeedbackPage() {
  const { profile, isMainAdmin, canCreateModule } = useAuth()
  const canCreateFeedback = canCreateModule('feedback')
  const [referenceData, setReferenceData] = useState({
    substations: [],
    employees: [],
  })
  const [entries, setEntries] = useState([])
  const [form, setForm] = useState(blankFeedback)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const refreshFeedback = useCallback(async () => {
    setEntries(await loadFeedbackEntries({ profile }))
  }, [profile])

  useEffect(() => {
    let active = true

    async function bootstrap() {
      const [bundle, feedbackRows] = await Promise.all([
        loadReferenceData(profile),
        loadFeedbackEntries({ profile }),
      ])

      if (!active) {
        return
      }

      setReferenceData(bundle)
      setEntries(feedbackRows)
      setForm((current) => ({
        ...current,
        substationId: current.substationId || bundle.substations[0]?.id || '',
      }))
    }

    void bootstrap()

    return () => {
      active = false
    }
  }, [profile])

  useEffect(() => {
    const timerId = window.setInterval(() => {
      void refreshFeedback()
    }, 60000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [refreshFeedback])

  async function handleSubmit() {
    if (!canCreateFeedback) {
      setError('Current role sathi feedback submit access nahi.')
      setStatus('')
      return
    }

    try {
      await saveFeedbackEntry(form, profile)
      await refreshFeedback()
      setForm((current) => ({
        ...blankFeedback,
        substationId: current.substationId,
      }))
      setStatus('Feedback submitted.')
      setError('')
      alertDetailSaved()
    } catch (saveError) {
      setError(saveError.message)
      setStatus('')
    }
  }

  async function handleStatusUpdate(entryId, nextStatus) {
    try {
      await updateFeedbackEntry(entryId, { status: nextStatus }, profile)
      await refreshFeedback()
      setStatus('Feedback status updated.')
      setError('')
      alertDetailSaved()
    } catch (saveError) {
      setError(saveError.message)
      setStatus('')
    }
  }

  return (
    <div className="page-stack">
      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Communication</p>
            <h2>Feedback & Suggestions</h2>
          </div>
        </div>
        <p className="muted-copy">
          Users can submit practical feedback here, and admins can track module-wise improvement requests.
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
      {!canCreateFeedback ? (
        <section className="callout warning-callout">
          <p>Feedback form current role sathi read only mode madhye aahe.</p>
        </section>
      ) : null}

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Submit</p>
            <h2>New feedback</h2>
          </div>
        </div>
        <div className="details-grid">
          <div>
            <label htmlFor="feedback-substation">Substation</label>
            <select
              id="feedback-substation"
              value={form.substationId}
              disabled={!canCreateFeedback}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  substationId: event.target.value,
                }))
              }
            >
              <option value="">Select substation</option>
              {referenceData.substations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="feedback-module">Module</label>
            <select
              id="feedback-module"
              value={form.moduleName}
              disabled={!canCreateFeedback}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  moduleName: event.target.value,
                }))
              }
            >
              {moduleOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="feedback-category">Category</label>
            <select
              id="feedback-category"
              value={form.category}
              disabled={!canCreateFeedback}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  category: event.target.value,
                }))
              }
            >
              <option value="suggestion">Suggestion</option>
              <option value="bug">Bug</option>
              <option value="ux">UI/UX</option>
              <option value="report">Report</option>
            </select>
          </div>
          <div>
            <label htmlFor="feedback-priority">Priority</label>
            <select
              id="feedback-priority"
              value={form.priority}
              disabled={!canCreateFeedback}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  priority: event.target.value,
                }))
              }
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="feedback-subject">Subject</label>
            <input
              id="feedback-subject"
              value={form.subject}
              disabled={!canCreateFeedback}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  subject: event.target.value,
                }))
              }
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="feedback-message">Message</label>
            <textarea
              id="feedback-message"
              rows={4}
              value={form.message}
              disabled={!canCreateFeedback}
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
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleSubmit()}
            disabled={!canCreateFeedback}
          >
            Submit feedback
          </button>
        </div>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{isMainAdmin ? 'Admin queue' : 'Your entries'}</p>
            <h2>Feedback register</h2>
          </div>
        </div>
        <div className="table-shell">
          <table className="simple-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Module</th>
                <th>Category</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Subject</th>
                <th>Message</th>
                {isMainAdmin ? <th>Action</th> : null}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.updatedAt || entry.createdAt}</td>
                  <td>{entry.moduleName || '-'}</td>
                  <td>{entry.category || '-'}</td>
                  <td>{entry.priority}</td>
                  <td>{entry.status}</td>
                  <td>{entry.subject}</td>
                  <td>{entry.message}</td>
                  {isMainAdmin ? (
                    <td>
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="ghost-light-button small-button"
                          onClick={() => void handleStatusUpdate(entry.id, 'in_review')}
                        >
                          In Review
                        </button>
                        <button
                          type="button"
                          className="primary-button small-button"
                          onClick={() => void handleStatusUpdate(entry.id, 'resolved')}
                        >
                          Resolve
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
              {!entries.length ? (
                <tr>
                  <td colSpan={isMainAdmin ? 8 : 7}>No feedback entries yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
