import { Fragment, useEffect, useState, startTransition } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  localCreateEmployee,
  localDeleteEmployee,
  localListEmployees,
  localListSubstations,
  localUpdateEmployee,
} from '../lib/localApi'
import { alertDetailSaved } from '../lib/detailSavedAlert'
import { isLocalSqlMode } from '../lib/runtimeConfig'

const employeeTypes = [
  { value: 'operator',    label: 'Operator' },
  { value: 'technician',  label: 'Technician / Engineer' },
  { value: 'apprentice',  label: 'Apprentice' },
  { value: 'outsource',   label: 'Outsource' },
  { value: 'helper',      label: 'Helper' },
  { value: 'office',      label: 'Office' },
]

// Designation options per employee type
const DESIGNATION_OPTIONS = {
  operator:   ['Opt', 'Sr Opt', 'Pre. Opt', 'O/S Opt', 'Up Saha'],
  technician: ['Tech', 'Sr.Tech', 'Pre.Tech', 'Vidyu Saha', 'GTE', 'AE', 'JE'],
  apprentice: ['App'],
  outsource:  ['Tec', 'Opt'],
  helper:     ['Helper', 'Sr. Helper'],
  office:     ['Clerk', 'Jr. Clerk', 'Sr. Clerk'],
}

function getDesignationOptions(type) {
  return DESIGNATION_OPTIONS[type] || []
}

const weeklyOffOptions = [
  { value: '', label: 'Not set' },
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
]

function getWeeklyOffLabel(value) {
  const normalized = value === 0 ? '0' : value ? String(value) : ''
  return weeklyOffOptions.find((item) => item.value === normalized)?.label || '-'
}

const blankForm = {
  srNo: '',
  employeeCode: '',
  fullName: '',
  cpfNo: '',
  designation: '',
  employeeType: 'operator',
  joiningDate: '',
  workingPlace: '',
  weeklyOffDay: '',
  phone: '',
  substationId: '',
  isGeneralDutyOperator: false,
  isVacant: false,
  isActive: true,
}

function mapEditForm(employee) {
  return {
    srNo: employee.srNo ?? '',
    employeeCode: employee.employee_code || '',
    fullName: employee.full_name || '',
    cpfNo: employee.cpfNo || '',
    designation: employee.designation || '',
    employeeType: employee.employeeType || 'operator',
    joiningDate: employee.joiningDate || '',
    workingPlace: employee.workingPlace || '',
    weeklyOffDay: employee.weeklyOffDay ?? '',
    phone: employee.phone || '',
    substationId: employee.substation_id || '',
    isGeneralDutyOperator: Boolean(employee.isGeneralDutyOperator),
    isVacant: Boolean(employee.isVacant),
    isActive: employee.isActive !== false,
  }
}

export default function EmployeesPage() {
  const {
    isAdmin,
    profile,
    backendLabel,
    canCreateModule,
    canEditModule,
    canDeleteModule,
  } = useAuth()
  const canCreateEmployees = canCreateModule('employees')
  const canEditEmployees = canEditModule('employees')
  const canDeleteEmployees = canDeleteModule('employees')
  const [substations, setSubstations] = useState([])
  const [employees, setEmployees] = useState([])
  const [form, setForm] = useState(blankForm)
  const [typeFilter, setTypeFilter] = useState('')
  const [substationFilter, setSubstationFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState('')
  const [editForm, setEditForm] = useState(blankForm)

  useEffect(() => {
    let active = true

    async function bootstrap() {
      if (!isLocalSqlMode) {
        setLoading(false)
        return
      }

      setLoading(true)
      setError('')

      try {
        const [substationData, employeeData] = await Promise.all([
          localListSubstations(),
          localListEmployees(),
        ])

        if (!active) {
          return
        }

        startTransition(() => {
          setSubstations(substationData)
          setEmployees(employeeData)
          setSubstationFilter((current) =>
            current || substationData[0]?.id || '',
          )
          setForm((current) => ({
            ...current,
            substationId: current.substationId || substationData[0]?.id || '',
          }))
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

    void bootstrap()

    return () => {
      active = false
    }
  }, [])

  async function refreshEmployees(nextFilters = {}) {
    const result = await localListEmployees({
      substationId: nextFilters.substationId ?? substationFilter,
      employeeType: nextFilters.employeeType ?? typeFilter,
      search: nextFilters.search ?? search,
    })

    startTransition(() => {
      setEmployees(result)
    })
  }

  useEffect(() => {
    if (!isLocalSqlMode) {
      return
    }

    let active = true

    async function loadFilteredEmployees() {
      try {
        const result = await localListEmployees({
          substationId: substationFilter,
          employeeType: typeFilter,
          search,
        })

        if (!active) {
          return
        }

        startTransition(() => {
          setEmployees(result)
        })
      } catch (loadError) {
        if (active) {
          setError(loadError.message)
        }
      }
    }

    void loadFilteredEmployees()

    return () => {
      active = false
    }
  }, [search, substationFilter, typeFilter])

  async function handleAdd(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setStatus('')

    try {
      await localCreateEmployee(form)
      setForm((current) => ({
        ...blankForm,
        substationId: current.substationId,
      }))
      setStatus('Employee create zala.')
      alertDetailSaved()
      await refreshEmployees({
        substationId: form.substationId,
      })
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSaving(false)
    }
  }

  function startEdit(employee) {
    setEditingId(employee.id)
    setEditForm(mapEditForm(employee))
    setError('')
    setStatus('')
  }

  async function saveEdit(employeeId) {
    setSaving(true)
    setError('')
    setStatus('')

    try {
      await localUpdateEmployee(employeeId, editForm)
      setEditingId('')
      setStatus('Employee update zala.')
      alertDetailSaved()
      await refreshEmployees({
        substationId: editForm.substationId,
      })
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSaving(false)
    }
  }

  async function removeEmployee(employeeId) {
    const confirmed = window.confirm('Ha employee delete karaycha ka?')

    if (!confirmed) {
      return
    }

    setSaving(true)
    setError('')
    setStatus('')

    try {
      await localDeleteEmployee(employeeId)
      setStatus('Employee delete zala.')
      await refreshEmployees()
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleRefresh() {
    setLoading(true)
    setError('')

    try {
      await refreshEmployees()
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-stack">
      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{backendLabel}</p>
            <h2>Employee Master</h2>
          </div>
        </div>
        <p className="muted-copy">
          {isAdmin
            ? 'Admin la sarv employee rows distil.'
            : 'Tumhala fakta tumhi create केलेले employee rows distil.'}{' '}
          Current login: {profile?.email || '-'}.
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

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Filters</p>
            <h2>Employee list control</h2>
          </div>
        </div>
        <div className="details-grid">
          <div>
            <label htmlFor="employee-filter-substation">Substation</label>
            <select
              id="employee-filter-substation"
              value={substationFilter}
              onChange={(event) => setSubstationFilter(event.target.value)}
            >
              <option value="">All</option>
              {substations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="employee-filter-type">Type</label>
            <select
              id="employee-filter-type"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
            >
              <option value="">All</option>
              {employeeTypes.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="employee-filter-search">Search</label>
            <input
              id="employee-filter-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="name, code, designation"
            />
          </div>
        </div>
        <div className="inline-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleRefresh()}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Refresh list'}
          </button>
        </div>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">New employee</p>
            <h2>Add employee</h2>
          </div>
        </div>
        {!canCreateEmployees ? (
          <div className="callout warning-callout">
            <p>Current role sathi employee create/edit access off aahe. Read only list visible aahe.</p>
          </div>
        ) : null}
        <form className="form-stack" onSubmit={handleAdd}>
          <div className="details-grid">
            <div>
              <label htmlFor="employee-substation">Substation</label>
              <select
                id="employee-substation"
                value={form.substationId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    substationId: event.target.value,
                  }))
                }
                required
              >
                <option value="">Select substation</option>
                {substations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="employee-srno">Sr No</label>
              <input
                id="employee-srno"
                value={form.srNo}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    srNo: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label htmlFor="employee-code">Employee code</label>
              <input
                id="employee-code"
                value={form.employeeCode}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    employeeCode: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label htmlFor="employee-name">Employee name</label>
              <input
                id="employee-name"
                value={form.fullName}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    fullName: event.target.value,
                  }))
                }
                required
              />
            </div>
            <div>
              <label htmlFor="employee-type">Type</label>
              <select
                id="employee-type"
                value={form.employeeType}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    employeeType: event.target.value,
                    designation: '', // reset when type changes
                  }))
                }
              >
                {employeeTypes.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="employee-designation">Designation</label>
              <select
                id="employee-designation"
                value={form.designation}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    designation: event.target.value,
                  }))
                }
              >
                <option value="">Select designation…</option>
                {getDesignationOptions(form.employeeType).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
                <option value="__custom__" disabled>── Custom ──</option>
              </select>
              {/* Allow typing custom designation if needed */}
              <input
                id="employee-designation-custom"
                style={{ marginTop: '4px' }}
                value={getDesignationOptions(form.employeeType).includes(form.designation) ? '' : form.designation}
                placeholder="Or type custom…"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    designation: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label htmlFor="employee-cpf">
                CPF No
                <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 400, marginLeft: 6 }}>
                  (optional — blank for Apprentice/Outsource)
                </span>
              </label>
              <input
                id="employee-cpf"
                value={form.cpfNo}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    cpfNo: event.target.value,
                  }))
                }
                placeholder="Leave blank if N/A"
              />
            </div>
            <div>
              <label htmlFor="employee-joining">Joining date</label>
              <input
                id="employee-joining"
                type="date"
                value={form.joiningDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    joiningDate: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label htmlFor="employee-place">Working place</label>
              <input
                id="employee-place"
                value={form.workingPlace}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    workingPlace: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label htmlFor="employee-weeklyoff">Weekly off day</label>
              <select
                id="employee-weeklyoff"
                value={form.weeklyOffDay}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    weeklyOffDay: event.target.value,
                  }))
                }
              >
                {weeklyOffOptions.map((item) => (
                  <option key={item.value || 'blank'} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="employee-phone">Phone</label>
              <input
                id="employee-phone"
                value={form.phone}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <div className="checkbox-row">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.isGeneralDutyOperator}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    isGeneralDutyOperator: event.target.checked,
                  }))
                }
              />
              General duty operator
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.isVacant}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    isVacant: event.target.checked,
                  }))
                }
              />
              Vacant row
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    isActive: event.target.checked,
                  }))
                }
              />
              Active
            </label>
          </div>

          <button
            type="submit"
            className="primary-button"
            disabled={saving || !canCreateEmployees}
          >
            {saving ? 'Saving...' : 'Add employee'}
          </button>
        </form>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Current records</p>
            <h2>Employees</h2>
          </div>
        </div>
        <div className="table-shell">
          <table className="simple-table">
            <thead>
              <tr>
                <th>Sr</th>
                <th>Name / CPF</th>
                <th>Type</th>
                <th>Designation</th>
                <th>Weekly Off</th>
                <th>Substation</th>
                <th>Details</th>
                <th>Flags</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => {
                const isEditing = editingId === employee.id
                const substationName =
                  substations.find((item) => item.id === employee.substation_id)
                    ?.name || employee.substation_id

                return (
                  <Fragment key={employee.id}>
                    <tr key={employee.id}>
                      <td>{employee.srNo || '-'}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{employee.full_name}</div>
                        {employee.cpfNo && (
                          <div style={{ fontSize: '0.78rem', color: '#64748b' }}>CPF- {employee.cpfNo}</div>
                        )}
                      </td>
                      <td>{employee.employeeType || '-'}</td>
                      <td>{employee.designation || '-'}</td>
                      <td>{getWeeklyOffLabel(employee.weeklyOffDay)}</td>
                      <td>{substationName}</td>
                      <td>
                        <div style={{ display: 'grid', gap: 2 }}>
                          <span>Code: {employee.employee_code || '-'}</span>
                          <span>Phone: {employee.phone || '-'}</span>
                          <span>Place: {employee.workingPlace || '-'}</span>
                          <span>Joining: {employee.joiningDate || '-'}</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {employee.isVacant && (
                            <span style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: 999, background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' }}>Vacant</span>
                          )}
                          {employee.isGeneralDutyOperator && (
                            <span style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: 999, background: '#e0f2fe', color: '#075985', border: '1px solid #7dd3fc' }}>GD</span>
                          )}
                          {!employee.isActive && (
                            <span style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: 999, background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' }}>Inactive</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="table-actions">
                          {isEditing ? (
                            <span className="muted-copy">Editing…</span>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="ghost-light-button small-button"
                                onClick={() => startEdit(employee)}
                                disabled={!canEditEmployees}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="danger-button small-button"
                                onClick={() => void removeEmployee(employee.id)}
                                disabled={saving || !canDeleteEmployees}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isEditing ? (
                      <tr key={`${employee.id}-edit`}>
                      <td colSpan={9}>
                        <div className="details-grid" style={{ padding: '12px 0' }}>
                          <div>
                            <label>Substation</label>
                            <select
                              value={editForm.substationId}
                              onChange={(event) =>
                                setEditForm((current) => ({
                                  ...current,
                                  substationId: event.target.value,
                                }))
                              }
                            >
                              {substations.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label>Sr No</label>
                            <input
                              value={editForm.srNo}
                              onChange={(event) =>
                                setEditForm((current) => ({
                                  ...current,
                                  srNo: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div>
                            <label>Employee code</label>
                            <input
                              value={editForm.employeeCode}
                              onChange={(event) =>
                                setEditForm((current) => ({
                                  ...current,
                                  employeeCode: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div>
                            <label>Employee name</label>
                            <input
                              value={editForm.fullName}
                              onChange={(event) =>
                                setEditForm((current) => ({
                                  ...current,
                                  fullName: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div>
                            <label>CPF No</label>
                            <input
                              value={editForm.cpfNo}
                              onChange={(event) =>
                                setEditForm((current) => ({
                                  ...current,
                                  cpfNo: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div>
                            <label>Type</label>
                            <select
                              value={editForm.employeeType}
                              onChange={(event) =>
                                setEditForm((current) => ({
                                  ...current,
                                  employeeType: event.target.value,
                                  designation: '',
                                }))
                              }
                            >
                              {employeeTypes.map((item) => (
                                <option key={item.value} value={item.value}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label>Designation</label>
                            <select
                              value={getDesignationOptions(editForm.employeeType).includes(editForm.designation) ? editForm.designation : ''}
                              onChange={(event) =>
                                setEditForm((current) => ({
                                  ...current,
                                  designation: event.target.value,
                                }))
                              }
                            >
                              <option value="">Select designation…</option>
                              {getDesignationOptions(editForm.employeeType).map((item) => (
                                <option key={item} value={item}>
                                  {item}
                                </option>
                              ))}
                            </select>
                            <input
                              style={{ marginTop: '4px' }}
                              value={getDesignationOptions(editForm.employeeType).includes(editForm.designation) ? '' : editForm.designation}
                              placeholder="Or type custom…"
                              onChange={(event) =>
                                setEditForm((current) => ({
                                  ...current,
                                  designation: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div>
                            <label>Joining date</label>
                            <input
                              type="date"
                              value={editForm.joiningDate}
                              onChange={(event) =>
                                setEditForm((current) => ({
                                  ...current,
                                  joiningDate: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div>
                            <label>Working place</label>
                            <input
                              value={editForm.workingPlace}
                              onChange={(event) =>
                                setEditForm((current) => ({
                                  ...current,
                                  workingPlace: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div>
                            <label>Weekly off day</label>
                            <select
                              value={editForm.weeklyOffDay}
                              onChange={(event) =>
                                setEditForm((current) => ({
                                  ...current,
                                  weeklyOffDay: event.target.value,
                                }))
                              }
                            >
                              {weeklyOffOptions.map((item) => (
                                <option key={`edit-${item.value || 'blank'}`} value={item.value}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label>Phone</label>
                            <input
                              value={editForm.phone}
                              onChange={(event) =>
                                setEditForm((current) => ({
                                  ...current,
                                  phone: event.target.value,
                                }))
                              }
                            />
                          </div>
                        </div>

                        <div className="checkbox-row">
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={editForm.isGeneralDutyOperator}
                              onChange={(event) =>
                                setEditForm((current) => ({
                                  ...current,
                                  isGeneralDutyOperator: event.target.checked,
                                }))
                              }
                            />
                            General duty operator
                          </label>
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={editForm.isVacant}
                              onChange={(event) =>
                                setEditForm((current) => ({
                                  ...current,
                                  isVacant: event.target.checked,
                                }))
                              }
                            />
                            Vacant row
                          </label>
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={editForm.isActive}
                              onChange={(event) =>
                                setEditForm((current) => ({
                                  ...current,
                                  isActive: event.target.checked,
                                }))
                              }
                            />
                            Active
                          </label>
                        </div>

                        <div className="table-actions" style={{ marginTop: 12 }}>
                          <button
                            type="button"
                            className="primary-button small-button"
                            onClick={() => void saveEdit(employee.id)}
                            disabled={saving || !canEditEmployees}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="ghost-light-button small-button"
                            onClick={() => setEditingId('')}
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
              {!employees.length ? (
                <tr>
                  <td colSpan={9}>No employees found for current filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
