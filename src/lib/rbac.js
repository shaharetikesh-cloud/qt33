export const ROLE_KEYS = {
  SUPER_ADMIN: 'super_admin',
  SUBSTATION_ADMIN: 'substation_admin',
  NORMAL_USER: 'normal_user',
  VIEWER: 'viewer',
}

export const ROLE_LABELS = {
  [ROLE_KEYS.SUPER_ADMIN]: 'Main Admin / Super Admin',
  [ROLE_KEYS.SUBSTATION_ADMIN]: 'Substation Admin',
  [ROLE_KEYS.NORMAL_USER]: 'Normal User',
  [ROLE_KEYS.VIEWER]: 'Viewer / Read Only',
}

export const USER_MANAGEMENT_ROLE_OPTIONS = [
  {
    value: ROLE_KEYS.SUPER_ADMIN,
    label: ROLE_LABELS[ROLE_KEYS.SUPER_ADMIN],
  },
  {
    value: ROLE_KEYS.SUBSTATION_ADMIN,
    label: ROLE_LABELS[ROLE_KEYS.SUBSTATION_ADMIN],
  },
  {
    value: ROLE_KEYS.NORMAL_USER,
    label: ROLE_LABELS[ROLE_KEYS.NORMAL_USER],
  },
  {
    value: ROLE_KEYS.VIEWER,
    label: ROLE_LABELS[ROLE_KEYS.VIEWER],
  },
]

export const MODULE_PERMISSION_KEYS = [
  'employees',
  'attendance',
  'daily_log',
  'battery',
  'faults',
  'maintenance',
  'charge_handover',
  'history_register',
  'reports',
  'feedback',
  'notices',
]

const LEGACY_ROLE_ALIASES = {
  admin: ROLE_KEYS.SUPER_ADMIN,
  user: ROLE_KEYS.NORMAL_USER,
  substation_user: ROLE_KEYS.NORMAL_USER,
}

function normalizeBoolean(value, fallback = false) {
  if (value === null || value === undefined) {
    return fallback
  }

  return Boolean(value)
}

function createModulePermissionRecord(view, create, update, del) {
  return {
    view: Boolean(view),
    create: Boolean(create),
    update: Boolean(update),
    delete: Boolean(del),
  }
}

function buildPermissionMatrix(role) {
  if (role === ROLE_KEYS.SUPER_ADMIN || role === ROLE_KEYS.SUBSTATION_ADMIN) {
    return Object.fromEntries(
      MODULE_PERMISSION_KEYS.map((key) => [
        key,
        createModulePermissionRecord(true, true, true, true),
      ]),
    )
  }

  if (role === ROLE_KEYS.VIEWER) {
    return Object.fromEntries(
      MODULE_PERMISSION_KEYS.map((key) => [
        key,
        createModulePermissionRecord(true, false, false, false),
      ]),
    )
  }

  return Object.fromEntries(
    MODULE_PERMISSION_KEYS.map((key) => [
      key,
      createModulePermissionRecord(true, true, true, false),
    ]),
  )
}

export function normalizeUserRole(role) {
  const normalized = String(role || '').trim().toLowerCase()
  return LEGACY_ROLE_ALIASES[normalized] || normalized || ROLE_KEYS.NORMAL_USER
}

export function getRoleLabel(role) {
  return ROLE_LABELS[normalizeUserRole(role)] || 'User'
}

export function isMainAdminRole(role) {
  return normalizeUserRole(role) === ROLE_KEYS.SUPER_ADMIN
}

export function isSubstationAdminRole(role) {
  return normalizeUserRole(role) === ROLE_KEYS.SUBSTATION_ADMIN
}

export function isAdminRole(role) {
  const normalizedRole = normalizeUserRole(role)
  return (
    normalizedRole === ROLE_KEYS.SUPER_ADMIN ||
    normalizedRole === ROLE_KEYS.SUBSTATION_ADMIN
  )
}

export function isViewerRole(role) {
  return normalizeUserRole(role) === ROLE_KEYS.VIEWER
}

export function isReadOnlyRole(role) {
  return isViewerRole(role)
}

export function canAccessAllSubstations(role) {
  return isMainAdminRole(role)
}

export function canManageUsers(role) {
  return isAdminRole(role)
}

export function canManageAllUsers(role) {
  return isMainAdminRole(role)
}

export function canManageScopedUsers(role) {
  return isSubstationAdminRole(role)
}

export function getAssignableRolesForActor(role) {
  if (isMainAdminRole(role)) {
    return USER_MANAGEMENT_ROLE_OPTIONS
  }

  if (isSubstationAdminRole(role)) {
    return USER_MANAGEMENT_ROLE_OPTIONS.filter(
      (item) =>
        item.value === ROLE_KEYS.NORMAL_USER || item.value === ROLE_KEYS.VIEWER,
    )
  }

  return []
}

export function normalizeModulePermissions(role, overrides) {
  const normalizedRole = normalizeUserRole(role)
  const baseline = buildPermissionMatrix(normalizedRole)
  const incomingModules =
    overrides && typeof overrides === 'object' && overrides.modules
      ? overrides.modules
      : {}

  const modules = Object.fromEntries(
    MODULE_PERMISSION_KEYS.map((moduleKey) => {
      const baselineModule = baseline[moduleKey]
      const overrideModule =
        incomingModules && typeof incomingModules[moduleKey] === 'object'
          ? incomingModules[moduleKey]
          : {}

      return [
        moduleKey,
        {
          view: normalizeBoolean(overrideModule.view, baselineModule.view),
          create: normalizeBoolean(overrideModule.create, baselineModule.create),
          update: normalizeBoolean(overrideModule.update, baselineModule.update),
          delete: normalizeBoolean(overrideModule.delete, baselineModule.delete),
        },
      ]
    }),
  )

  return {
    modules,
  }
}

export function getModulePermissionsForUser(user, moduleKey) {
  const permissions = normalizeModulePermissions(
    user?.role,
    user?.module_permissions ?? user?.modulePermissions ?? {},
  )
  return (
    permissions.modules[moduleKey] ||
    createModulePermissionRecord(true, false, false, false)
  )
}

export function canPerformModuleAction(user, moduleKey, action) {
  const permissions = getModulePermissionsForUser(user, moduleKey)
  return Boolean(permissions?.[action])
}

export function getScopedSubstationId(user) {
  if (!user || canAccessAllSubstations(user.role)) {
    return ''
  }

  return String(user.substation_id || user.substationId || '').trim()
}

export function canActorManageTargetUser(actor, target) {
  if (!actor || !target) {
    return false
  }

  if (!canManageUsers(actor.role)) {
    return false
  }

  if (isMainAdminRole(actor.role)) {
    return true
  }

  const actorSubstationId = getScopedSubstationId(actor)
  const targetSubstationId = getScopedSubstationId(target)
  const targetRole = normalizeUserRole(target.role)

  return (
    Boolean(actorSubstationId) &&
    actorSubstationId === targetSubstationId &&
    targetRole !== ROLE_KEYS.SUPER_ADMIN &&
    targetRole !== ROLE_KEYS.SUBSTATION_ADMIN
  )
}

export function getDefaultUserFormState() {
  return {
    fullName: '',
    mobile: '',
    username: '',
    password: '',
    confirmPassword: '',
    role: ROLE_KEYS.NORMAL_USER,
    isActive: true,
    substationId: '',
    allowDelete: false,
  }
}
