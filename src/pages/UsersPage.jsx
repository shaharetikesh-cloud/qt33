import { startTransition, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { alertDetailSaved } from '../lib/detailSavedAlert'
import { localListSubstations } from '../lib/localApi'
import {
  ROLE_KEYS,
  getAssignableRolesForActor,
  getDefaultUserFormState,
  getRoleLabel,
} from '../lib/rbac'

const defaultFilters = {
  search: '',
  role: '',
  status: '',
  substationId: '',
  page: 1,
  pageSize: 20,
}

function buildFormState(user, fallbackSubstationId) {
  return {
    ...getDefaultUserFormState(),
    fullName: user?.full_name || '',
    mobile: user?.mobile || user?.phone || '',
    username: user?.username || '',
    role: user?.role || ROLE_KEYS.NORMAL_USER,
    isActive: Boolean(user?.is_active),
    substationId: user?.substation_id || fallbackSubstationId || '',
    allowDelete: Boolean(user?.module_permissions?.modules?.employees?.delete),
  }
}

export default function UsersPage() {
  const {
    profile,
    authBusy,
    backendLabel,
    canManageUsers,
    isMainAdmin,
    roleLabel,
    listUsers,
    createUserByAdmin,
    updateUserByAdmin,
    resetUserPasswordByAdmin,
    deleteUserByAdmin,
  } = useAuth()
  const actorRole = profile?.role || ''
  const actorSubstationId = profile?.substation_id || ''
  const availableRoleOptions = useMemo(
    () => getAssignableRolesForActor(actorRole),
    [actorRole],
  )
  const [users, setUsers] = useState([])
  const [substations, setSubstations] = useState([])
  const [filters, setFilters] = useState(defaultFilters)
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [editingUser, setEditingUser] = useState(null)
  const [form, setForm] = useState(() =>
    buildFormState(null, actorSubstationId),
  )

  useEffect(() => {
    setForm((current) => ({
      ...current,
      substationId:
        current.substationId ||
        actorSubstationId ||
        substations[0]?.id ||
        '',
    }))
  }, [actorSubstationId, isMainAdmin, substations])

  useEffect(() => {
    if (!canManageUsers) {
      setLoading(false)
      return
    }

    let active = true

    async function loadPage() {
      setLoading(true)
      setError('')

      try {
        const [userPayload, substationRows] = await Promise.all([
          listUsers({
            ...filters,
            substationId: isMainAdmin ? filters.substationId : filters.substationId,
          }),
          localListSubstations({ actor: profile }),
        ])

        if (!active) {
          return
        }

        startTransition(() => {
          setUsers(userPayload.users || [])
          setPagination(
            userPayload.pagination || {
              page: 1,
              pageSize: 20,
              total: 0,
              totalPages: 0,
            },
          )
          setSubstations(substationRows || [])
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

    void loadPage()

    return () => {
      active = false
    }
  }, [actorSubstationId, canManageUsers, filters, isMainAdmin, listUsers])

  function resetForm() {
    setEditingUser(null)
    setForm(buildFormState(null, actorSubstationId))
  }

  function handleEdit(user) {
    setEditingUser(user)
    setForm(buildFormState(user, actorSubstationId))
    setStatus('')
    setError('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setStatus('')

    if (!editingUser && form.password !== form.confirmPassword) {
      setSaving(false)
      setError('Password ani confirm password same hava.')
      return
    }

    try {
      if (editingUser) {
        const updatedUser = await updateUserByAdmin(editingUser.id, {
          fullName: form.fullName,
          mobile: form.mobile,
          username: form.username,
          role: form.role,
          isActive: form.isActive,
          substationId: isMainAdmin ? form.substationId : form.substationId,
          allowDelete: form.allowDelete,
        })

        startTransition(() => {
          setUsers((current) =>
            current.map((item) => (item.id === updatedUser.id ? updatedUser : item)),
          )
        })
        setStatus('User update zala.')
        alertDetailSaved()
      } else {
        const createdUser = await createUserByAdmin({
          fullName: form.fullName,
          mobile: form.mobile,
          username: form.username,
          password: form.password,
          role: form.role,
          isActive: form.isActive,
          substationId: isMainAdmin ? form.substationId : form.substationId,
          allowDelete: form.allowDelete,
          mustChangePassword: true,
        })

        startTransition(() => {
          setUsers((current) => [createdUser, ...current])
        })
        setStatus('User create zala.')
        alertDetailSaved()
      }

      resetForm()
      setFilters((current) => ({
        ...current,
        page: 1,
      }))
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleStatus(user) {
    setError('')
    setStatus('')

    try {
      const updatedUser = await updateUserByAdmin(user.id, {
        fullName: user.full_name,
        mobile: user.mobile || user.phone || '',
        username: user.username,
        role: user.role,
        isActive: !user.is_active,
        substationId: user.substation_id,
        allowDelete: Boolean(user?.module_permissions?.modules?.employees?.delete),
      })

      startTransition(() => {
        setUsers((current) =>
          current.map((item) => (item.id === updatedUser.id ? updatedUser : item)),
        )
      })
      setStatus(updatedUser.is_active ? 'User enable zala.' : 'User disable zala.')
    } catch (updateError) {
      setError(updateError.message)
    }
  }

  async function handleResetPassword(user) {
    const temporaryPassword = window.prompt(
      `Temporary password set kara for ${user.username}`,
      'Temp@12345',
    )

    if (!temporaryPassword) {
      return
    }

    try {
      const payload = await resetUserPasswordByAdmin(user.id, temporaryPassword)
      setStatus(
        payload?.message ||
          'Temporary password set zala. User la first login nantar password change karava lagel.',
      )
    } catch (resetError) {
      setError(resetError.message)
    }
  }

  async function handleDeleteUser(user) {
    const confirmed = window.confirm(
      `${user.username} ha user soft delete karaycha ka?`,
    )

    if (!confirmed) {
      return
    }

    try {
      await deleteUserByAdmin(user.id)
      setStatus('User soft delete zala.')
      startTransition(() => {
        setUsers((current) => current.filter((item) => item.id !== user.id))
      })
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  if (!canManageUsers) {
    return (
      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Restricted</p>
            <h2>User management fakta Main Admin kiwa Substation Admin sathi aahe.</h2>
          </div>
        </div>
        <p className="muted-copy">
          Current role: {roleLabel}. Operational pages available rahatil, pan users create/edit
          करण्यासाठी admin role required aahe.
        </p>
      </section>
    )
  }

  return (
    <div className="page-stack">
      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{backendLabel}</p>
            <h2>Role Based User Management</h2>
          </div>
        </div>
        <p className="muted-copy">
          Username/password based local access active aahe. Main Admin la full access aahe,
          tar Substation Admin la fakta assigned substation users manage karta yetat.
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

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{editingUser ? 'Edit user' : 'Create user'}</p>
            <h2>{editingUser ? `Update ${editingUser.username}` : 'New local user'}</h2>
          </div>
          {editingUser ? (
            <button type="button" className="ghost-light-button" onClick={resetForm}>
              Cancel edit
            </button>
          ) : null}
        </div>

        <form className="form-stack" onSubmit={handleSubmit}>
          <div className="details-grid">
            <div>
              <label htmlFor="user-full-name">Full Name</label>
              <input
                id="user-full-name"
                type="text"
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
              <label htmlFor="user-mobile">Mobile Number</label>
              <input
                id="user-mobile"
                type="tel"
                value={form.mobile}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    mobile: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label htmlFor="user-username">Username</label>
              <input
                id="user-username"
                type="text"
                value={form.username}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    username: event.target.value,
                  }))
                }
                required
              />
            </div>
            {!editingUser ? (
              <>
                <div>
                  <label htmlFor="user-password">Temporary Password</label>
                  <input
                    id="user-password"
                    type="password"
                    value={form.password}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                    minLength={8}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="user-confirm-password">Confirm Temporary Password</label>
                  <input
                    id="user-confirm-password"
                    type="password"
                    value={form.confirmPassword}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        confirmPassword: event.target.value,
                      }))
                    }
                    minLength={8}
                    required
                  />
                </div>
              </>
            ) : null}
            <div>
              <label htmlFor="user-role">Role</label>
              <select
                id="user-role"
                value={form.role}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    role: event.target.value,
                    allowDelete:
                      event.target.value === ROLE_KEYS.SUBSTATION_ADMIN ||
                      event.target.value === ROLE_KEYS.SUPER_ADMIN
                        ? true
                        : current.allowDelete,
                  }))
                }
              >
                {availableRoleOptions.map((roleOption) => (
                  <option key={roleOption.value} value={roleOption.value}>
                    {roleOption.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="user-status">Status</label>
              <select
                id="user-status"
                value={form.isActive ? 'active' : 'inactive'}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    isActive: event.target.value === 'active',
                  }))
                }
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div>
              <label htmlFor="user-substation">Assigned Substation</label>
              <select
                id="user-substation"
                value={form.substationId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    substationId: event.target.value,
                  }))
                }
                disabled={!isMainAdmin && !substations.length}
                required={form.role !== ROLE_KEYS.SUPER_ADMIN}
              >
                <option value="">Select substation</option>
                {substations.map((substation) => (
                  <option key={substation.id} value={substation.id}>
                    {substation.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.allowDelete}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  allowDelete: event.target.checked,
                }))
              }
              disabled={
                form.role === ROLE_KEYS.SUPER_ADMIN ||
                form.role === ROLE_KEYS.SUBSTATION_ADMIN ||
                form.role === ROLE_KEYS.VIEWER
              }
            />
            <span>Allow operational delete actions later</span>
          </label>

          <div className="inline-actions">
            <button type="submit" className="primary-button" disabled={saving || authBusy}>
              {saving || authBusy
                ? 'Saving...'
                : editingUser
                  ? 'Update user'
                  : 'Create user'}
            </button>
            <button type="button" className="ghost-light-button" onClick={resetForm}>
              Reset form
            </button>
          </div>
        </form>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Search and Filters</p>
            <h2>User list controls</h2>
          </div>
        </div>

        <div className="details-grid">
          <div>
            <label htmlFor="filter-search">Search</label>
            <input
              id="filter-search"
              type="text"
              value={filters.search}
              placeholder="Username / full name / mobile / substation"
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  search: event.target.value,
                  page: 1,
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="filter-role">Role</label>
            <select
              id="filter-role"
              value={filters.role}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  role: event.target.value,
                  page: 1,
                }))
              }
            >
              <option value="">All roles</option>
              {availableRoleOptions.map((roleOption) => (
                <option key={roleOption.value} value={roleOption.value}>
                  {roleOption.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="filter-status">Status</label>
            <select
              id="filter-status"
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.target.value,
                  page: 1,
                }))
              }
            >
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label htmlFor="filter-substation">Substation</label>
            <select
              id="filter-substation"
              value={filters.substationId}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  substationId: event.target.value,
                  page: 1,
                }))
              }
              disabled={!isMainAdmin}
            >
              {isMainAdmin ? <option value="">All visible substations</option> : null}
              {substations.map((substation) => (
                <option key={substation.id} value={substation.id}>
                  {substation.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Current users</p>
            <h2>Scoped user list</h2>
          </div>
          <p className="muted-copy">
            Total {pagination.total} users
          </p>
        </div>

        {loading ? <p className="muted-copy">Users load hot aahet...</p> : null}

        {!loading ? (
          <>
            <div className="table-shell">
              <table className="simple-table">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Full Name</th>
                    <th>Mobile</th>
                    <th>Role</th>
                    <th>Substation</th>
                    <th>Status</th>
                    <th>Created By</th>
                    <th>Created Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.username || '-'}</td>
                      <td>{user.full_name || '-'}</td>
                      <td>{user.mobile || user.phone || '-'}</td>
                      <td>{getRoleLabel(user.role)}</td>
                      <td>{user.substation_name || user.substation_id || '-'}</td>
                      <td>{user.is_active ? 'Active' : 'Inactive'}</td>
                      <td>{user.created_by_name || user.created_by || '-'}</td>
                      <td>{user.created_at || '-'}</td>
                      <td>
                        <div className="table-actions">
                          <button
                            type="button"
                            className="ghost-light-button small-button"
                            onClick={() => handleEdit(user)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="ghost-light-button small-button"
                            onClick={() => void handleResetPassword(user)}
                          >
                            Reset Password
                          </button>
                          <button
                            type="button"
                            className="ghost-light-button small-button"
                            onClick={() => void handleToggleStatus(user)}
                          >
                            {user.is_active ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            type="button"
                            className="danger-button small-button"
                            onClick={() => void handleDeleteUser(user)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!users.length ? (
                    <tr>
                      <td colSpan={9}>No users found for current filters.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="inline-actions">
              <button
                type="button"
                className="ghost-light-button"
                disabled={pagination.page <= 1}
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    page: Math.max(1, current.page - 1),
                  }))
                }
              >
                Previous
              </button>
              <button type="button" className="ghost-light-button" disabled>
                Page {pagination.page} / {pagination.totalPages || 1}
              </button>
              <button
                type="button"
                className="ghost-light-button"
                disabled={
                  !pagination.totalPages || pagination.page >= pagination.totalPages
                }
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    page: current.page + 1,
                  }))
                }
              >
                Next
              </button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  )
}
