import { useEffect, useState, startTransition } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  localCreateSubstation,
  localListSubstations,
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
    isMainAdmin,
    isSubstationAdmin,
    canManageUsers,
    profile,
    backendLabel,
    refreshProfile,
  } = useAuth()
  const [substations, setSubstations] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

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
        const data = await localListSubstations()

        if (!active) {
          return
        }

        const scopedSubstationId = String(profile?.substation_id || profile?.substationId || '').trim()
        const visibleRows =
          isSubstationAdmin && scopedSubstationId
            ? data.filter((item) => item.id === scopedSubstationId)
            : data

        startTransition(() => {
          setSubstations(visibleRows)
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
  }, [isSubstationAdmin, profile?.substation_id, profile?.substationId])

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setStatus('')

    try {
      const created = await localCreateSubstation(form, profile)
      setForm(emptyForm)
      setStatus('Substation create zala.')
      if (isSubstationAdmin) {
        await refreshProfile()
      }
      startTransition(() => {
        setSubstations((current) =>
          [...current, created].sort((left, right) =>
            left.name.localeCompare(right.name),
          ),
        )
      })
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page-stack">
      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{backendLabel}</p>
            <h2>Substation Master</h2>
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

      {canManageUsers ? (
        <section className="content-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Admin action</p>
              <h2>Add substation</h2>
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

          {isSubstationAdmin && (profile?.substation_id || profile?.substationId) ? (
            <div className="callout info-callout">
              <p>
                Tumcha substation scope already set aahe. Additional substation create karaycha
                asel tar Main Admin contact kara.
              </p>
            </div>
          ) : (
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

              <button type="submit" className="primary-button" disabled={saving}>
                {saving ? 'Saving...' : 'Add substation'}
              </button>
            </form>
          )}
        </section>
      ) : null}

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
                  </tr>
                ))}
                {!substations.length ? (
                  <tr>
                    <td colSpan={6}>No substations yet.</td>
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
