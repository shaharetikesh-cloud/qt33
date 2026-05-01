import { useEffect, useState, startTransition } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  localCreateSubstation,
  localDeleteSubstation,
  localListSubstations,
  localUpdateSubstation,
} from '../lib/localApi'
import { isLocalSqlMode } from '../lib/runtimeConfig'

const emptyForm = {
  code: '',
  name: '',
  omName: '',
  subDivisionName: '',
  district: '',
  circle: '',
}

export default function SubstationsPage() {
  const {
    profile,
  } = useAuth()
  const [substations, setSubstations] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  async function reloadSubstations({ silent = false } = {}) {
    if (!isLocalSqlMode) {
      if (!silent) setLoading(false)
      return
    }
    if (!silent) {
      setLoading(true)
    }
    setError('')
    try {
      const data = await localListSubstations({ actor: profile })
      startTransition(() => {
        setSubstations(data)
      })
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    let active = true

    async function load() {
      if (!isLocalSqlMode) {
        setLoading(false)
        return
      }

      setLoading(true)
      setError('')

      try {
        const data = await localListSubstations({ actor: profile })

        if (!active) {
          return
        }

        startTransition(() => {
          setSubstations(data)
        })
      } catch (loadError) {
        if (active) {
          setError(loadError.message)
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [profile])

  useEffect(() => {
    if (!isLocalSqlMode) {
      return () => {}
    }
    const timerId = window.setInterval(() => {
      void reloadSubstations({ silent: true })
    }, 5000)
    return () => window.clearInterval(timerId)
  }, [profile])

  function resetForm() {
    setForm(emptyForm)
    setEditingId('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setStatus('')

    try {
      const saved = editingId
        ? await localUpdateSubstation(editingId, form, profile)
        : await localCreateSubstation(form, profile)
      resetForm()
      setStatus(editingId ? 'Substation update zala.' : 'Substation create zala.')
      startTransition(() => {
        setSubstations((current) => {
          const next = editingId
            ? current.map((item) => (item.id === saved.id ? { ...item, ...saved } : item))
            : [...current, saved]
          return next.sort((left, right) => left.name.localeCompare(right.name))
        })
      })
      await reloadSubstations({ silent: true })
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(substationId) {
    const shouldDelete = window.confirm('Delete this substation?')
    if (!shouldDelete) {
      return
    }
    setError('')
    setStatus('')
    try {
      await localDeleteSubstation(substationId, profile)
      startTransition(() => {
        setSubstations((current) => current.filter((item) => item.id !== substationId))
      })
      if (editingId === substationId) {
        resetForm()
      }
      setStatus('Substation delete zala.')
      await reloadSubstations({ silent: true })
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  return (
    <div className="page-stack">
      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Local Setup</p>
            <h2>Substation Setup</h2>
          </div>
        </div>
        <p className="muted-copy">
          Employee master, reports, ani DLR operational records sathi common
          location master ithe maintain hoil.
        </p>
      </section>

      {!isLocalSqlMode ? (
        <section className="content-card">
          <p className="muted-copy">
            Ya page sathi local SQL mode active hava. Cloud mode binding nantar add
            hoil.
          </p>
        </section>
      ) : null}

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Setup</p>
            <h2>{editingId ? 'Edit substation' : 'Add substation'}</h2>
          </div>
        </div>

          {status ? (
            <div className="callout success-callout">
              <p>{status}</p>
            </div>
          ) : null}

          {error ? (
            <div className="callout danger-callout">
              <p>{error}</p>
            </div>
          ) : null}

          <form className="form-stack" onSubmit={handleSubmit}>
            <div className="details-grid">
              <div>
                <label htmlFor="substation-code">Code</label>
                <input
                  id="substation-code"
                  value={form.code}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      code: event.target.value,
                    }))
                  }
                  placeholder="e.g. 33KV-SELU"
                />
              </div>
              <div>
                <label htmlFor="substation-name">Substation name</label>
                <input
                  id="substation-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div>
                <label htmlFor="substation-om">O&M</label>
                <input
                  id="substation-om"
                  value={form.omName}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      omName: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label htmlFor="substation-subdivision">Sub Division</label>
                <input
                  id="substation-subdivision"
                  value={form.subDivisionName}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      subDivisionName: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label htmlFor="substation-district">District</label>
                <input
                  id="substation-district"
                  value={form.district}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      district: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label htmlFor="substation-circle">Circle</label>
                <input
                  id="substation-circle"
                  value={form.circle}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      circle: event.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="inline-actions">
              <button type="submit" className="primary-button" disabled={saving}>
                {saving ? 'Saving...' : editingId ? 'Update substation' : 'Add substation'}
              </button>
              {editingId ? (
                <button type="button" className="ghost-light-button" onClick={resetForm}>
                  Cancel edit
                </button>
              ) : null}
            </div>
          </form>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Current list</p>
            <h2>Substations</h2>
          </div>
        </div>

        {loading ? <p className="muted-copy">Substations load hot aahet...</p> : null}

        {!loading ? (
          <div className="table-shell">
            <table className="simple-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>O&M</th>
                  <th>Sub Division</th>
                  <th>District</th>
                  <th>Circle</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {substations.map((item) => (
                  <tr key={item.id}>
                    <td>{item.code || '-'}</td>
                    <td>{item.name}</td>
                    <td>{item.omName || '-'}</td>
                    <td>{item.subDivisionName || '-'}</td>
                    <td>{item.district || '-'}</td>
                    <td>{item.circle || '-'}</td>
                    <td>
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="ghost-light-button"
                          onClick={() => {
                            setEditingId(item.id)
                            setForm({
                              code: item.code || '',
                              name: item.name || '',
                              omName: item.omName || '',
                              subDivisionName: item.subDivisionName || '',
                              district: item.district || '',
                              circle: item.circle || '',
                            })
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="ghost-light-button"
                          onClick={() => void handleDelete(item.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!substations.length ? (
                  <tr>
                    <td colSpan={7}>No substations yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  )
}
