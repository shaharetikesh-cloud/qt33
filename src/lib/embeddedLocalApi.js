import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import {
  MODULE_PERMISSION_KEYS,
  ROLE_KEYS,
  canAccessAllSubstations,
  canActorManageTargetUser,
  canManageAllUsers,
  canManageUsers,
  canPerformModuleAction,
  getAssignableRolesForActor,
  getRoleLabel,
  getScopedSubstationId,
  isMainAdminRole,
  normalizeModulePermissions,
  normalizeUserRole,
} from './rbac'
import { readScope, writeScope } from './storageAdapter'

const DB_SCOPE = 'embedded-local-api-db'
const DB_FILE_PATH = 'offline/local-api-db.json'
const SEED_URL = './offline-seed.json'
const PBKDF2_PREFIX = 'pbkdf2'
const PBKDF2_ITERATIONS = 120_000
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7
const allowedMasterTypes = new Set(['divisions', 'feeders', 'batterySets', 'transformers'])
const managedOperationalModules = new Set(MODULE_PERMISSION_KEYS)

let cachedDatabase = null
let loadPromise = null
let seedPromise = null

function nowIso() {
  return new Date().toISOString()
}

function withRecordMeta(record = {}, options = {}) {
  const timestamp = nowIso()
  const createdAt = String(record.created_at || record.createdAt || timestamp).trim()
  const updatedAt = String(options.updatedAt || timestamp).trim()
  const version = Number.isFinite(Number(record.version))
    ? Number(record.version)
    : Number.isFinite(Number(record.meta?.version))
      ? Number(record.meta.version)
      : 1
  const nextVersion = options.bumpVersion ? version + 1 : Math.max(1, version)
  const backupTimestamp = String(
    options.backupTimestamp ||
      record.backup_timestamp ||
      record.backupTimestamp ||
      record.meta?.backupTimestamp ||
      '',
  ).trim()

  return {
    ...record,
    created_at: createdAt,
    updated_at: updatedAt,
    version: nextVersion,
    deleted: Boolean(record.deleted),
    backup_timestamp: backupTimestamp,
    meta: {
      localUuid: String(record.id || crypto.randomUUID()),
      createdAt,
      updatedAt,
      deleted: Boolean(record.deleted),
      version: nextVersion,
      backupTimestamp: backupTimestamp,
    },
  }
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value))
}

function getInitialDatabase() {
  return {
    version: 1,
    initializedAt: nowIso(),
    seedAppliedAt: '',
    seedSource: '',
    counters: {
      loginAudit: 1,
    },
    users: [],
    sessions: [],
    password_reset_requests: [],
    substations: [],
    employees: [],
    attendance_sheets: [],
    master_records: [],
    app_settings: {},
    dlr_records: [],
    login_audit: [],
    app_audit_events: [],
    report_snapshots: [],
    notices: [],
    feedback_entries: [],
    user_substation_mappings: [],
    backup_metadata: {
      last_exported_at: '',
      last_imported_at: '',
      last_restore_at: '',
      app_version: '1',
    },
  }
}

function randomHex(size = 16) {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function normalizeIdentifier(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeMobile(value) {
  return String(value || '').trim()
}

function buildPlaceholderEmail(username, userId = '') {
  const safeUsername = normalizeUsername(username) || 'user'
  const suffix = String(userId || crypto.randomUUID()).replace(/[^a-z0-9]/gi, '').slice(0, 8)
  return `${safeUsername}.${suffix || 'local'}@local.user`
}

function textEncoder() {
  return new TextEncoder()
}

function bytesToHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

function hexToBytes(hex) {
  const normalized = String(hex || '').trim()

  if (!normalized || normalized.length % 2 !== 0) {
    return new Uint8Array()
  }

  const bytes = new Uint8Array(normalized.length / 2)

  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16)
  }

  return bytes
}

async function pbkdf2Hash(password, saltHex, iterations = PBKDF2_ITERATIONS) {
  const importedKey = await crypto.subtle.importKey(
    'raw',
    textEncoder().encode(String(password || '')),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: hexToBytes(saltHex),
      iterations,
    },
    importedKey,
    256,
  )

  return bytesToHex(bits)
}

async function hashPassword(password, saltHex = randomHex(16)) {
  const hashHex = await pbkdf2Hash(password, saltHex)
  return `${PBKDF2_PREFIX}$${PBKDF2_ITERATIONS}$${saltHex}$${hashHex}`
}

async function verifyPassword(password, storedHash) {
  const [prefix, iterationValue, saltHex, expectedHashHex] = String(storedHash || '').split('$')

  if (prefix !== PBKDF2_PREFIX || !saltHex || !expectedHashHex) {
    return false
  }

  const iterations = Number.parseInt(iterationValue || '', 10)

  if (!Number.isFinite(iterations) || iterations < 1) {
    return false
  }

  const actualHashHex = await pbkdf2Hash(password, saltHex, iterations)
  return actualHashHex === expectedHashHex
}

function validatePasswordStrength(password) {
  if (String(password || '').length < 8) {
    throw new Error('Password kamit kami 8 characters cha hava.')
  }
}

async function readPersistedDatabase() {
  if (Capacitor.isNativePlatform()) {
    try {
      const result = await Filesystem.readFile({
        path: DB_FILE_PATH,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      })

      return JSON.parse(String(result.data || ''))
    } catch {
      return readScope(DB_SCOPE, null)
    }
  }

  return readScope(DB_SCOPE, null)
}

async function writePersistedDatabase(database) {
  const serialized = JSON.stringify(database)
  writeScope(DB_SCOPE, database)

  if (!Capacitor.isNativePlatform()) {
    return
  }

  await Filesystem.writeFile({
    path: DB_FILE_PATH,
    directory: Directory.Data,
    recursive: true,
    data: serialized,
    encoding: Encoding.UTF8,
  })
}

function nextLoginAuditId(database) {
  const nextId = Number(database.counters?.loginAudit || 1)
  database.counters = {
    ...(database.counters || {}),
    loginAudit: nextId + 1,
  }
  return nextId
}

function normalizeImportedUser(record) {
  const role = normalizeUserRole(record.role)
  const allowDelete =
    role === ROLE_KEYS.SUPER_ADMIN ||
    role === ROLE_KEYS.SUBSTATION_ADMIN ||
    Boolean(
      record.module_permissions?.modules?.employees?.delete ??
        record.modulePermissions?.modules?.employees?.delete,
    )

  return {
    id: String(record.id || crypto.randomUUID()),
    username: normalizeUsername(record.username || record.email || record.full_name || 'user'),
    email: normalizeIdentifier(record.email) || buildPlaceholderEmail(record.username || 'user'),
    full_name: String(record.full_name || record.fullName || '').trim(),
    phone: normalizeMobile(record.phone || record.mobile),
    role,
    substation_id: String(record.substation_id || record.substationId || '').trim(),
    created_by: String(record.created_by || record.createdBy || '').trim(),
    updated_by: String(record.updated_by || record.updatedBy || '').trim(),
    disabled_at: String(record.disabled_at || record.disabledAt || '').trim(),
    disabled_by: String(record.disabled_by || record.disabledBy || '').trim(),
    deleted_at: String(record.deleted_at || record.deletedAt || '').trim(),
    deleted_by: String(record.deleted_by || record.deletedBy || '').trim(),
    must_change_password: Boolean(record.must_change_password ?? record.mustChangePassword),
    password_changed_at: String(
      record.password_changed_at || record.passwordChangedAt || record.updated_at || record.updatedAt || nowIso(),
    ).trim(),
    last_login_at: String(record.last_login_at || record.lastLoginAt || '').trim(),
    module_permissions: normalizeModulePermissions(
      role,
      record.module_permissions || record.modulePermissions || {
        modules: normalizeModulePermissions(role, {}).modules,
      },
    ),
    is_active: record.is_active === false || record.isActive === false ? false : true,
    approval_status: String(record.approval_status || record.approvalStatus || 'approved').trim(),
    created_at: String(record.created_at || record.createdAt || nowIso()).trim(),
    updated_at: String(record.updated_at || record.updatedAt || nowIso()).trim(),
    password_hash: String(record.password_hash || record.passwordHash || '').trim(),
    allowDelete,
  }
}

function normalizeImportedSubstation(record) {
  return {
    id: String(record.id || crypto.randomUUID()),
    code: String(record.code || '').trim(),
    name: String(record.name || '').trim(),
    district: String(record.district || '').trim(),
    circle: String(record.circle || '').trim(),
    metadata: {
      omName: String(record.omName || '').trim(),
      subDivisionName: String(record.subDivisionName || '').trim(),
      divisionName: String(record.divisionName || '').trim(),
      sectionName: String(record.sectionName || '').trim(),
    },
    is_active: record.is_active === false ? false : true,
    created_by: String(record.created_by || record.createdBy || '').trim(),
    created_at: String(record.created_at || record.createdAt || nowIso()).trim(),
    updated_at: String(record.updated_at || record.updatedAt || nowIso()).trim(),
  }
}

function normalizeImportedEmployee(record) {
  return {
    id: String(record.id || crypto.randomUUID()),
    owner_user_id: String(record.owner_user_id || record.ownerUserId || '').trim(),
    substation_id: String(record.substation_id || record.substationId || '').trim(),
    employee_code: String(record.employee_code || record.employeeCode || '').trim(),
    full_name: String(record.full_name || record.fullName || '').trim(),
    designation: String(record.designation || '').trim(),
    phone: String(record.phone || '').trim(),
    metadata: {
      srNo: record.srNo ?? null,
      employeeType: String(record.employeeType || '').trim(),
      cpfNo: String(record.cpfNo || '').trim(),
      joiningDate: String(record.joiningDate || '').trim(),
      workingPlace: String(record.workingPlace || '').trim(),
      weeklyOffDay: record.weeklyOffDay ?? null,
      isGeneralDutyOperator: Boolean(record.isGeneralDutyOperator),
      isVacant: Boolean(record.isVacant),
      isActive: record.isActive === false ? false : true,
    },
    created_at: String(record.created_at || record.createdAt || nowIso()).trim(),
    updated_at: String(record.updated_at || record.updatedAt || nowIso()).trim(),
  }
}

function normalizeImportedMasterRecord(type, record) {
  const recordId = String(record.id || crypto.randomUUID())

  return {
    id: recordId,
    type,
    created_by: String(record.createdBy || record.created_by || '').trim(),
    payload: {
      ...record,
      id: recordId,
    },
    created_at: String(record.createdAt || record.created_at || nowIso()).trim(),
    updated_at: String(record.updatedAt || record.updated_at || nowIso()).trim(),
  }
}

function normalizeImportedAttendanceSheet(record) {
  const recordId = String(record.id || crypto.randomUUID())

  return {
    id: recordId,
    owner_user_id: String(record.ownerUserId || record.owner_user_id || '').trim(),
    substation_id: String(record.substationId || record.substation_id || '').trim(),
    sheet_type: String(record.sheetType || record.sheet_type || '').trim(),
    month_key: String(record.monthKey || record.month_key || '').trim(),
    employee_scope: String(record.employeeScope || record.employee_scope || '').trim(),
    payload: {
      ...record,
      id: recordId,
    },
    created_at: String(record.createdAt || record.created_at || nowIso()).trim(),
    updated_at: String(record.updatedAt || record.updated_at || nowIso()).trim(),
  }
}

function normalizeImportedDlrRecord(record) {
  const recordId = String(record.id || crypto.randomUUID())

  return {
    id: recordId,
    owner_user_id: String(record.ownerUserId || record.owner_user_id || '').trim(),
    substation_id: String(record.substationId || record.substation_id || '').trim(),
    module_name: String(record.moduleName || record.module_name || '').trim(),
    record_key: String(record.recordKey || record.record_key || record.id || recordId).trim(),
    operational_date: String(record.operationalDate || record.operational_date || '').trim(),
    payload: {
      ...record,
      id: recordId,
    },
    created_at: String(record.createdAt || record.created_at || nowIso()).trim(),
    updated_at: String(record.updatedAt || record.updated_at || nowIso()).trim(),
  }
}

function normalizeImportedReportSnapshot(record) {
  return {
    id: String(record.id || crypto.randomUUID()),
    owner_user_id: String(record.ownerUserId || record.owner_user_id || '').trim(),
    report_type: String(record.reportType || record.report_type || '').trim(),
    filename_base: String(record.filenameBase || record.filename_base || '').trim(),
    export_type: String(record.exportType || record.export_type || '').trim(),
    orientation: String(record.orientation || '').trim(),
    title: String(record.title || '').trim(),
    substation_id: String(record.substationId || record.substation_id || '').trim(),
    substation_label: String(record.substationLabel || record.substation_label || '').trim(),
    month_label: String(record.monthLabel || record.month_label || '').trim(),
    metadata: {
      metadata: Array.isArray(record.metadata) ? record.metadata : [],
    },
    created_at: String(record.createdAt || record.created_at || nowIso()).trim(),
    updated_at: String(record.updatedAt || record.updated_at || nowIso()).trim(),
  }
}

function normalizeImportedNotice(record) {
  return {
    id: String(record.id || crypto.randomUUID()),
    owner_user_id: String(record.ownerUserId || record.owner_user_id || '').trim(),
    substation_id: String(record.substationId || record.substation_id || '').trim(),
    title: String(record.title || '').trim(),
    message: String(record.message || '').trim(),
    priority: String(record.priority || 'normal').trim(),
    status: String(record.status || 'active').trim(),
    publish_from: String(record.publishFrom || record.publish_from || '').trim(),
    publish_to: String(record.publishTo || record.publish_to || '').trim(),
    created_at: String(record.createdAt || record.created_at || nowIso()).trim(),
    updated_at: String(record.updatedAt || record.updated_at || nowIso()).trim(),
  }
}

function normalizeImportedFeedback(record) {
  return {
    id: String(record.id || crypto.randomUUID()),
    owner_user_id: String(record.ownerUserId || record.owner_user_id || '').trim(),
    substation_id: String(record.substationId || record.substation_id || '').trim(),
    module_name: String(record.moduleName || record.module_name || '').trim(),
    category: String(record.category || '').trim(),
    priority: String(record.priority || 'medium').trim(),
    status: String(record.status || 'open').trim(),
    subject: String(record.subject || '').trim(),
    message: String(record.message || '').trim(),
    resolution_note: String(record.resolutionNote || record.resolution_note || '').trim(),
    created_at: String(record.createdAt || record.created_at || nowIso()).trim(),
    updated_at: String(record.updatedAt || record.updated_at || nowIso()).trim(),
  }
}

function normalizeImportedAuditEvent(record) {
  return {
    id: String(record.id || crypto.randomUUID()),
    action: String(record.action || 'imported_event').trim(),
    actor_id: String(record.actorId || record.actor_id || '').trim(),
    actor_email: String(record.actorEmail || record.actor_email || '').trim(),
    context: record.context && typeof record.context === 'object' ? record.context : {},
    created_at: String(record.createdAt || record.created_at || nowIso()).trim(),
  }
}

function normalizeImportedLoginAudit(record, fallbackId) {
  return {
    id: record.id ?? fallbackId,
    user_id: String(record.userId || record.user_id || '').trim(),
    username: String(record.username || '').trim(),
    email: String(record.email || '').trim(),
    action: String(record.action || 'login').trim(),
    context: record.context && typeof record.context === 'object' ? record.context : {},
    created_at: String(record.createdAt || record.created_at || nowIso()).trim(),
  }
}

async function applySeedSnapshot(
  database,
  seedPayload,
  sourceLabel = 'seed-file',
  options = {},
) {
  const snapshot = seedPayload?.snapshot && typeof seedPayload.snapshot === 'object'
    ? seedPayload.snapshot
    : seedPayload
  const resetSessions = options.resetSessions !== false

  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Offline seed snapshot valid nahi.')
  }

  const hasUsers = Array.isArray(snapshot.users)
  const importedUsers = hasUsers ? snapshot.users.map(normalizeImportedUser) : []
  const missingHashes = importedUsers.filter((user) => !user.password_hash)

  for (const user of missingHashes) {
    user.password_hash = await hashPassword('Admin@12345')
  }

  if (hasUsers) {
    database.users = importedUsers
  }
  if (resetSessions) {
    database.sessions = []
  }
  database.password_reset_requests = Array.isArray(snapshot.passwordResetRequests)
    ? snapshot.passwordResetRequests.map((item) => ({
        id: String(item.id || crypto.randomUUID()),
        user_id: String(item.userId || item.user_id || '').trim(),
        requested_by: String(item.requestedBy || item.requested_by || '').trim(),
        reset_type: String(item.resetType || item.reset_type || 'admin_temporary').trim(),
        delivery_channel: String(item.deliveryChannel || item.delivery_channel || 'manual').trim(),
        delivery_target: String(item.deliveryTarget || item.delivery_target || '').trim(),
        temporary_password_hash: String(
          item.temporaryPasswordHash || item.temporary_password_hash || '',
        ).trim(),
        status: String(item.status || 'issued').trim(),
        expires_at: String(item.expiresAt || item.expires_at || '').trim(),
        used_at: String(item.usedAt || item.used_at || '').trim(),
        completed_at: String(item.completedAt || item.completed_at || '').trim(),
        metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : {},
        created_at: String(item.createdAt || item.created_at || nowIso()).trim(),
        updated_at: String(item.updatedAt || item.updated_at || nowIso()).trim(),
      }))
    : []
  database.substations = Array.isArray(snapshot.substations)
    ? snapshot.substations.map(normalizeImportedSubstation)
    : []
  database.employees = Array.isArray(snapshot.employees)
    ? snapshot.employees.map(normalizeImportedEmployee)
    : []
  database.master_records = Array.from(allowedMasterTypes).flatMap((type) =>
    Array.isArray(snapshot.masters?.[type])
      ? snapshot.masters[type].map((record) => normalizeImportedMasterRecord(type, record))
      : [],
  )
  database.app_settings = {
    workspace_settings: {
      value: snapshot.settings && typeof snapshot.settings === 'object' ? snapshot.settings : {},
      updated_by: '',
      updated_at: nowIso(),
    },
  }
  database.user_substation_mappings = Array.isArray(snapshot.userSubstationMappings)
    ? snapshot.userSubstationMappings.map((item) => ({
        id: String(item.id || crypto.randomUUID()),
        user_id: String(item.userId || item.user_id || '').trim(),
        substation_id: String(item.substationId || item.substation_id || '').trim(),
        created_at: String(item.createdAt || item.created_at || nowIso()).trim(),
        updated_at: String(item.updatedAt || item.updated_at || nowIso()).trim(),
      }))
    : []
  database.attendance_sheets = Array.isArray(snapshot.attendanceDocuments)
    ? snapshot.attendanceDocuments.map(normalizeImportedAttendanceSheet)
    : []
  database.dlr_records = Array.isArray(snapshot.dlrRecords)
    ? snapshot.dlrRecords.map(normalizeImportedDlrRecord)
    : []
  database.report_snapshots = Array.isArray(snapshot.reportSnapshots)
    ? snapshot.reportSnapshots.map(normalizeImportedReportSnapshot)
    : []
  database.notices = Array.isArray(snapshot.notices)
    ? snapshot.notices.map(normalizeImportedNotice)
    : []
  database.feedback_entries = Array.isArray(snapshot.feedbackEntries)
    ? snapshot.feedbackEntries.map(normalizeImportedFeedback)
    : []
  database.app_audit_events = Array.isArray(snapshot.auditEvents)
    ? snapshot.auditEvents.map(normalizeImportedAuditEvent)
    : []
  if (Array.isArray(snapshot.loginAudit)) {
    database.login_audit = snapshot.loginAudit.map((item, index) =>
      normalizeImportedLoginAudit(item, index + 1),
    )
  }

  const highestLoginAuditId = (database.login_audit || []).reduce((highest, item) => {
    const numericId = Number(item.id || 0)
    return Number.isFinite(numericId) ? Math.max(highest, numericId) : highest
  }, 0)

  database.counters = {
    ...(database.counters || {}),
    loginAudit: Math.max(highestLoginAuditId + 1, 1),
  }
  database.seedAppliedAt = nowIso()
  database.seedSource = sourceLabel
}

async function ensureDefaultAdmin(database) {
  const timestamp = nowIso()
  const adminHash = await hashPassword('Admin@12345')
  const existingAdmin =
    database.users.find((item) => normalizeUsername(item.username) === 'admin') ||
    database.users.find((item) => normalizeIdentifier(item.email) === 'admin@local.test')

  if (existingAdmin) {
    existingAdmin.username = 'admin'
    existingAdmin.email = existingAdmin.email || 'admin@local.test'
    existingAdmin.full_name = existingAdmin.full_name || 'Main Admin'
    existingAdmin.role = ROLE_KEYS.SUPER_ADMIN
    existingAdmin.substation_id = ''
    existingAdmin.disabled_at = ''
    existingAdmin.disabled_by = ''
    existingAdmin.deleted_at = ''
    existingAdmin.deleted_by = ''
    existingAdmin.must_change_password = false
    existingAdmin.password_changed_at = timestamp
    existingAdmin.module_permissions = normalizeModulePermissions(ROLE_KEYS.SUPER_ADMIN, {})
    existingAdmin.is_active = true
    existingAdmin.approval_status = 'approved'
    existingAdmin.updated_at = timestamp
    existingAdmin.password_hash = adminHash
    return
  }

  const adminId = crypto.randomUUID()
  database.users.push({
    id: adminId,
    username: 'admin',
    email: 'admin@local.test',
    full_name: 'Main Admin',
    phone: '',
    role: ROLE_KEYS.SUPER_ADMIN,
    substation_id: '',
    created_by: '',
    updated_by: '',
    disabled_at: '',
    disabled_by: '',
    deleted_at: '',
    deleted_by: '',
    must_change_password: false,
    password_changed_at: timestamp,
    last_login_at: '',
    module_permissions: normalizeModulePermissions(ROLE_KEYS.SUPER_ADMIN, {}),
    is_active: true,
    approval_status: 'approved',
    created_at: timestamp,
    updated_at: timestamp,
    password_hash: adminHash,
  })
}

async function tryLoadSeedFromBundle(database) {
  if (
    database.seedAppliedAt ||
    seedPromise ||
    database.users.length ||
    database.substations.length ||
    database.employees.length ||
    database.master_records.length ||
    database.dlr_records.length ||
    database.attendance_sheets.length ||
    database.report_snapshots.length ||
    database.feedback_entries.length ||
    database.notices.length
  ) {
    return seedPromise
  }

  seedPromise = (async () => {
    try {
      const response = await fetch(SEED_URL, { cache: 'no-store' })

      if (!response.ok) {
        return
      }

      const payload = await response.json()
      await applySeedSnapshot(database, payload, 'bundled-offline-seed')
      await writePersistedDatabase(database)
    } catch {
      // No bundled seed is fine; the APK can still run with the default admin.
    }
  })()

  await seedPromise
  seedPromise = null
}

async function getDatabase() {
  if (cachedDatabase) {
    return cachedDatabase
  }

  if (!loadPromise) {
    loadPromise = (async () => {
      const stored = await readPersistedDatabase()
      const database = stored && typeof stored === 'object'
        ? {
            ...getInitialDatabase(),
            ...stored,
          }
        : getInitialDatabase()

      await tryLoadSeedFromBundle(database)
      await ensureDefaultAdmin(database)
      cachedDatabase = database
      await writePersistedDatabase(database)
      return database
    })()
  }

  cachedDatabase = await loadPromise
  loadPromise = null
  return cachedDatabase
}

async function persistDatabase(database) {
  cachedDatabase = database
  await writePersistedDatabase(database)
}

function getAllowedSubstationIdsForUser(database, user) {
  if (!user || canAccessAllSubstations(user.role)) {
    return null
  }

  const scopedSubstationId = getScopedSubstationId(user)

  if (scopedSubstationId) {
    return [scopedSubstationId]
  }

  return database.user_substation_mappings
    .filter((item) => item.user_id === user.id)
    .map((item) => item.substation_id)
    .filter(Boolean)
}

function requireMappedSubstationAccess(database, user, substationId) {
  if (!substationId || !user || canAccessAllSubstations(user.role)) {
    return true
  }

  const allowedSubstationIds = getAllowedSubstationIdsForUser(database, user)
  return Array.isArray(allowedSubstationIds) && allowedSubstationIds.includes(substationId)
}

function resolveOperationalModuleKey(moduleName) {
  const normalized = String(moduleName || '').trim().toLowerCase()

  if (!normalized) {
    return 'daily_log'
  }

  if (managedOperationalModules.has(normalized)) {
    return normalized
  }

  if (normalized === 'fault') {
    return 'faults'
  }

  return 'daily_log'
}

function hasModulePermission(database, user, moduleKey, action, substationId) {
  return (
    canPerformModuleAction(user, moduleKey, action) &&
    (!substationId || requireMappedSubstationAccess(database, user, substationId))
  )
}

function getUserByIdentifier(database, identifier) {
  const normalized = normalizeIdentifier(identifier)

  if (!normalized) {
    return null
  }

  return (
    database.users.find((item) => {
      if (item.deleted_at) {
        return false
      }

      return (
        normalizeIdentifier(item.username) === normalized ||
        normalizeIdentifier(item.email) === normalized
      )
    }) || null
  )
}

function loadUserById(database, userId) {
  return database.users.find((item) => item.id === userId) || null
}

function getSubstationById(database, substationId) {
  return database.substations.find((item) => item.id === substationId) || null
}

function mapUserRow(database, row) {
  if (!row) {
    return null
  }

  const normalizedRole = normalizeUserRole(row.role)
  const substation = getSubstationById(database, row.substation_id)
  const createdByUser = loadUserById(database, row.created_by)
  const allowedSubstationIds = getAllowedSubstationIdsForUser(database, row) || []

  return {
    id: row.id,
    auth_user_id: row.id,
    username: row.username || '',
    email: row.email || '',
    full_name: row.full_name || '',
    mobile: row.phone || '',
    phone: row.phone || '',
    role: normalizedRole,
    role_label: getRoleLabel(normalizedRole),
    is_active: Boolean(row.is_active),
    approval_status: row.approval_status || (row.is_active ? 'approved' : 'inactive'),
    substation_id: row.substation_id || '',
    substationId: row.substation_id || '',
    substation_name: substation?.name || '',
    substationName: substation?.name || '',
    allowed_substation_ids: allowedSubstationIds,
    created_by: row.created_by || '',
    created_by_name: createdByUser?.full_name || '',
    updated_by: row.updated_by || '',
    disabled_at: row.disabled_at || '',
    disabled_by: row.disabled_by || '',
    deleted_at: row.deleted_at || '',
    deleted_by: row.deleted_by || '',
    must_change_password: Boolean(row.must_change_password),
    module_permissions: normalizeModulePermissions(normalizedRole, row.module_permissions || {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function mapSessionPayload(database, row, token) {
  if (!row) {
    return null
  }

  return {
    token,
    user: {
      id: row.id,
      username: row.username || '',
      email: row.email || '',
      role: normalizeUserRole(row.role),
    },
  }
}

function mapSessionActivityRow(database, row) {
  if (!row) {
    return null
  }

  const user = loadUserById(database, row.user_id)

  return {
    token: row.token,
    userId: row.user_id,
    username: user?.username || '',
    email: user?.email || '',
    fullName: user?.full_name || '',
    role: normalizeUserRole(user?.role),
    roleLabel: getRoleLabel(user?.role),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }
}

function mapSubstationRow(row) {
  if (!row) {
    return null
  }

  return {
    id: row.id,
    code: row.code || '',
    name: row.name || '',
    district: row.district || '',
    circle: row.circle || '',
    omName: row.metadata?.omName || '',
    subDivisionName: row.metadata?.subDivisionName || '',
    divisionName: row.metadata?.divisionName || '',
    sectionName: row.metadata?.sectionName || '',
    is_active: Boolean(row.is_active),
    created_by: row.created_by || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function mapEmployeeRow(row) {
  if (!row) {
    return null
  }

  return {
    id: row.id,
    owner_user_id: row.owner_user_id || '',
    substation_id: row.substation_id || '',
    employee_code: row.employee_code || '',
    full_name: row.full_name || '',
    designation: row.designation || '',
    phone: row.phone || '',
    srNo: row.metadata?.srNo ?? '',
    employeeType: row.metadata?.employeeType || '',
    cpfNo: row.metadata?.cpfNo || '',
    joiningDate: row.metadata?.joiningDate || '',
    workingPlace: row.metadata?.workingPlace || '',
    weeklyOffDay: row.metadata?.weeklyOffDay ?? '',
    isGeneralDutyOperator: Boolean(row.metadata?.isGeneralDutyOperator),
    isVacant: Boolean(row.metadata?.isVacant),
    isActive: row.metadata?.isActive === false ? false : true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function mapMasterRecordRow(row) {
  if (!row) {
    return null
  }

  return {
    ...cloneValue(row.payload || {}),
    id: row.id,
    createdBy: row.created_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapAttendanceSheetRow(row) {
  if (!row) {
    return null
  }

  return {
    ...cloneValue(row.payload || {}),
    id: row.id,
    ownerUserId: row.owner_user_id || '',
    substationId: row.substation_id || '',
    sheetType: row.sheet_type,
    monthKey: row.month_key,
    employeeScope: row.employee_scope || row.payload?.employeeScope || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapDlrRecordRow(row) {
  if (!row) {
    return null
  }

  return {
    ...cloneValue(row.payload || {}),
    id: row.id,
    ownerUserId: row.owner_user_id || '',
    substationId: row.substation_id || '',
    moduleName: row.module_name || '',
    recordKey: row.record_key || '',
    operationalDate: row.operational_date || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapReportSnapshotRow(row) {
  if (!row) {
    return null
  }

  return {
    id: row.id,
    ownerUserId: row.owner_user_id || '',
    reportType: row.report_type || '',
    filenameBase: row.filename_base || '',
    exportType: row.export_type || '',
    orientation: row.orientation || '',
    title: row.title || '',
    substationId: row.substation_id || '',
    substationLabel: row.substation_label || '',
    monthLabel: row.month_label || '',
    metadata: row.metadata?.metadata || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapNoticeRow(row) {
  if (!row) {
    return null
  }

  return {
    id: row.id,
    ownerUserId: row.owner_user_id || '',
    substationId: row.substation_id || '',
    title: row.title || '',
    message: row.message || '',
    priority: row.priority || 'normal',
    status: row.status || 'active',
    publishFrom: row.publish_from || '',
    publishTo: row.publish_to || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapFeedbackRow(row) {
  if (!row) {
    return null
  }

  return {
    id: row.id,
    ownerUserId: row.owner_user_id || '',
    substationId: row.substation_id || '',
    moduleName: row.module_name || '',
    category: row.category || '',
    priority: row.priority || 'medium',
    status: row.status || 'open',
    subject: row.subject || '',
    message: row.message || '',
    resolutionNote: row.resolution_note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapAppAuditEventRow(row) {
  if (!row) {
    return null
  }

  return {
    id: row.id,
    action: row.action,
    actorId: row.actor_id || '',
    actorEmail: row.actor_email || '',
    context: cloneValue(row.context || {}),
    createdAt: row.created_at,
  }
}

function isNoticeVisibleToUser(database, notice, user) {
  if (!notice) {
    return false
  }

  if (isMainAdminRole(user?.role)) {
    return true
  }

  if (notice.status !== 'active') {
    return false
  }

  const now = Date.now()
  const publishFrom = notice.publishFrom ? new Date(notice.publishFrom).getTime() : null
  const publishTo = notice.publishTo ? new Date(notice.publishTo).getTime() : null

  if (publishFrom && publishFrom > now) {
    return false
  }

  if (publishTo && publishTo < now) {
    return false
  }

  return !notice.substationId || requireMappedSubstationAccess(database, user, notice.substationId)
}

function getWorkspaceSettings(database) {
  return cloneValue(database.app_settings.workspace_settings?.value || {})
}

function purgeExpiredSessions(database) {
  const now = Date.now()
  database.sessions = database.sessions.filter((item) => new Date(item.expires_at).getTime() > now)
}

function getSessionRecord(database, token) {
  if (!token) {
    return null
  }

  purgeExpiredSessions(database)
  return database.sessions.find((item) => item.token === token) || null
}

function requireAuthenticatedUser(database, token) {
  const sessionRecord = getSessionRecord(database, token)

  if (!sessionRecord) {
    throw new Error('Session valid nahi. Punha login kara.')
  }

  const user = loadUserById(database, sessionRecord.user_id)

  if (!user || user.deleted_at) {
    throw new Error('Associated user sapadla nahi.')
  }

  return {
    sessionRecord,
    user,
    profile: mapUserRow(database, user),
  }
}

function audit(database, action, user, context = {}) {
  database.login_audit.unshift({
    id: nextLoginAuditId(database),
    user_id: user?.id || '',
    username: user?.username || '',
    email: user?.email || '',
    action,
    context,
    created_at: nowIso(),
  })
  database.login_audit = database.login_audit.slice(0, 400)
}

function appAudit(database, action, user, context = {}) {
  database.app_audit_events.unshift({
    id: crypto.randomUUID(),
    action,
    actor_id: user?.id || user?.auth_user_id || '',
    actor_email: user?.email || '',
    context,
    created_at: nowIso(),
  })
  database.app_audit_events = database.app_audit_events.slice(0, 800)
}

function completePasswordResetRequests(database, userId) {
  const timestamp = nowIso()

  database.password_reset_requests = database.password_reset_requests.map((item) =>
    item.user_id === userId && item.status === 'issued'
      ? {
          ...item,
          status: 'completed',
          used_at: item.used_at || timestamp,
          completed_at: timestamp,
          updated_at: timestamp,
        }
      : item,
  )
}

function recordPasswordResetRequest(database, options) {
  const timestamp = nowIso()
  database.password_reset_requests.unshift({
    id: crypto.randomUUID(),
    user_id: options.userId,
    requested_by: options.requestedBy || '',
    reset_type: options.resetType || 'admin_temporary',
    delivery_channel: options.deliveryChannel || 'manual',
    delivery_target: options.deliveryTarget || '',
    temporary_password_hash: options.temporaryPasswordHash || '',
    status: 'issued',
    expires_at: options.expiresAt || '',
    used_at: '',
    completed_at: '',
    metadata: options.metadata && typeof options.metadata === 'object' ? options.metadata : {},
    created_at: timestamp,
    updated_at: timestamp,
  })
}

function buildModulePermissionPayload(role, options = {}) {
  const normalizedRole = normalizeUserRole(role)
  const permissions = normalizeModulePermissions(normalizedRole, {})

  if (typeof options.allowDelete === 'boolean') {
    for (const moduleKey of managedOperationalModules) {
      permissions.modules[moduleKey] = {
        ...permissions.modules[moduleKey],
        delete:
          normalizedRole === ROLE_KEYS.VIEWER
            ? false
            : options.allowDelete,
      }
    }
  }

  return permissions
}

function applyDeletePermissionOverride(role, existingPermissions, allowDelete) {
  const permissions = normalizeModulePermissions(role, existingPermissions || {})

  if (typeof allowDelete !== 'boolean') {
    return permissions
  }

  for (const moduleKey of managedOperationalModules) {
    permissions.modules[moduleKey] = {
      ...permissions.modules[moduleKey],
      delete:
        normalizeUserRole(role) === ROLE_KEYS.VIEWER
          ? false
          : allowDelete,
    }
  }

  return permissions
}

function syncUserSubstationMapping(database, userId, substationId) {
  if (!userId) {
    return
  }

  const normalizedSubstationId = String(substationId || '').trim()

  if (!normalizedSubstationId) {
    database.user_substation_mappings = database.user_substation_mappings.filter(
      (item) => item.user_id !== userId,
    )
    return
  }

  const timestamp = nowIso()
  const existing = database.user_substation_mappings.find(
    (item) => item.user_id === userId && item.substation_id === normalizedSubstationId,
  )

  if (existing) {
    existing.updated_at = timestamp
  } else {
    database.user_substation_mappings.unshift({
      id: crypto.randomUUID(),
      user_id: userId,
      substation_id: normalizedSubstationId,
      created_at: timestamp,
      updated_at: timestamp,
    })
  }

  database.user_substation_mappings = database.user_substation_mappings.filter(
    (item) => item.user_id !== userId || item.substation_id === normalizedSubstationId,
  )
}

function usernameExists(database, username, excludedUserId = '') {
  const normalized = normalizeUsername(username)

  if (!normalized) {
    return false
  }

  return database.users.some(
    (item) =>
      !item.deleted_at &&
      item.id !== excludedUserId &&
      normalizeUsername(item.username) === normalized,
  )
}

function mobileExists(database, mobile, excludedUserId = '') {
  const normalized = normalizeMobile(mobile)

  if (!normalized) {
    return false
  }

  return database.users.some(
    (item) =>
      !item.deleted_at &&
      item.id !== excludedUserId &&
      normalizeMobile(item.phone) === normalized,
  )
}

function normalizeEmployeePayload(body = {}) {
  const fullName = String(body.fullName || '').trim()
  const employeeType = String(body.employeeType || '').trim()
  const substationId = String(body.substationId || '').trim()
  const employeeCode = String(body.employeeCode || '').trim()
  const designation = String(body.designation || '').trim()
  const phone = String(body.phone || '').trim()
  const cpfNo = String(body.cpfNo || '').trim()
  const joiningDate = String(body.joiningDate || '').trim()
  const workingPlace = String(body.workingPlace || '').trim()
  const srNoValue = body.srNo
  const weeklyOffDayValue = body.weeklyOffDay

  if (!fullName) {
    throw new Error('Employee name required aahe.')
  }

  if (!employeeType) {
    throw new Error('Employee type required aahe.')
  }

  if (!substationId) {
    throw new Error('Substation required aahe.')
  }

  let srNo = null
  if (srNoValue !== '' && srNoValue !== null && srNoValue !== undefined) {
    const parsed = Number(srNoValue)

    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error('Sr No positive integer hava.')
    }

    srNo = parsed
  }

  let weeklyOffDay = null
  if (
    weeklyOffDayValue !== '' &&
    weeklyOffDayValue !== null &&
    weeklyOffDayValue !== undefined
  ) {
    const parsed = Number(weeklyOffDayValue)

    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 6) {
      throw new Error('Weekly off day 0 te 6 madhye hava.')
    }

    weeklyOffDay = parsed
  }

  return {
    employeeCode,
    fullName,
    designation,
    phone,
    substationId,
    metadata: {
      srNo,
      employeeType,
      cpfNo,
      joiningDate,
      workingPlace,
      weeklyOffDay,
      isGeneralDutyOperator: Boolean(body.isGeneralDutyOperator),
      isVacant: Boolean(body.isVacant),
      isActive: body.isActive === false ? false : true,
    },
  }
}

function buildDashboardSummary(database, user) {
  const mainAdminUser = canAccessAllSubstations(user.role)
  const allowedSubstationIds = getAllowedSubstationIdsForUser(database, user)
  const visibleSubstations = mainAdminUser || !Array.isArray(allowedSubstationIds)
    ? database.substations.filter((item) => item.is_active)
    : database.substations.filter(
        (item) => item.is_active && allowedSubstationIds.includes(item.id),
      )
  const employeeRows = mainAdminUser || !Array.isArray(allowedSubstationIds)
    ? database.employees
    : database.employees.filter((item) => allowedSubstationIds.includes(item.substation_id))
  const activeSessions = database.sessions.filter((item) =>
    mainAdminUser
      ? new Date(item.expires_at).getTime() > Date.now()
      : item.user_id === user.id && new Date(item.expires_at).getTime() > Date.now(),
  )
  const notices = database.notices
    .map(mapNoticeRow)
    .filter((item) => isNoticeVisibleToUser(database, item, user))
  const openFeedback = database.feedback_entries.filter((item) =>
    mainAdminUser
      ? !['resolved', 'closed'].includes(item.status)
      : item.owner_user_id === user.id && !['resolved', 'closed'].includes(item.status),
  )
  const recentLogins24h = database.login_audit.filter((item) => {
    const createdTime = new Date(item.created_at).getTime()
    const visible = mainAdminUser ? true : item.user_id === user.id
    return visible && Date.now() - createdTime <= 1000 * 60 * 60 * 24
  })

  return {
    substations: visibleSubstations.length,
    employees: employeeRows.length,
    operators: employeeRows.filter((item) => item.metadata?.employeeType === 'operator').length,
    activeEmployees: employeeRows.filter((item) => item.metadata?.isActive !== false).length,
    activeSessions: activeSessions.length,
    activeNotices: notices.length,
    openFeedback: openFeedback.length,
    recentLogins24h: recentLogins24h.length,
  }
}

function sortByUpdatedDesc(collection = [], updatedField = 'updated_at', createdField = 'created_at') {
  return [...collection].sort((left, right) => {
    const leftTime = new Date(left[updatedField] || left[createdField] || 0).getTime()
    const rightTime = new Date(right[updatedField] || right[createdField] || 0).getTime()
    return rightTime - leftTime
  })
}

function createSession(database, user) {
  const token = randomHex(24)
  const createdAt = nowIso()
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString()

  database.sessions.unshift({
    token,
    user_id: user.id,
    created_at: createdAt,
    expires_at: expiresAt,
  })
  user.last_login_at = createdAt
  user.updated_at = createdAt
  return mapSessionPayload(database, user, token)
}

function buildQueryParams(path) {
  const url = new URL(path, 'http://offline.local')
  return {
    pathname: url.pathname,
    params: url.searchParams,
  }
}

export async function embeddedApiRequest(path, options = {}) {
  const database = await getDatabase()
  purgeExpiredSessions(database)

  const { method = 'GET', body = {}, token = '' } = options
  const normalizedMethod = String(method || 'GET').trim().toUpperCase()
  const { pathname, params } = buildQueryParams(path)
  const routeKey = `${normalizedMethod} ${pathname}`

  if (routeKey === 'POST /auth/signup') {
    throw new Error(
      'Self signup local mode madhye off aahe. User create sathi Main Admin kiwa Substation Admin cha vapar kara.',
    )
  }

  if (routeKey === 'POST /auth/login') {
    const identifier = String(body.identifier || body.username || body.email || '').trim()
    const password = String(body.password || '')

    if (!identifier || !password) {
      throw new Error('Username/User ID ani password required aahe.')
    }

    const user = getUserByIdentifier(database, identifier)

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw new Error('Username/User ID kiwa password chukicha aahe.')
    }

    const session = createSession(database, user)
    audit(database, 'login', user, {
      source: 'embedded-offline',
      identifier: normalizeIdentifier(identifier),
    })
    await persistDatabase(database)

    return {
      session,
      profile: mapUserRow(database, user),
    }
  }

  if (routeKey === 'POST /auth/forgot-password') {
    throw new Error(
      'Self-service forgot password local mode madhye available nahi. Main Admin kiwa Substation Admin temporary password reset karu shakto.',
    )
  }

  if (routeKey === 'POST /auth/reset-password') {
    throw new Error(
      'Direct recovery token reset local mode madhye off aahe. Temporary password reset nantar user Session page varun password change karu shakel.',
    )
  }

  const { user, profile, sessionRecord } = requireAuthenticatedUser(database, token)

  if (routeKey === 'GET /auth/session') {
    return {
      session: mapSessionPayload(database, user, sessionRecord.token),
      profile,
    }
  }

  if (routeKey === 'POST /auth/logout') {
    database.sessions = database.sessions.filter((item) => item.token !== sessionRecord.token)
    audit(database, 'logout', user, {
      source: 'embedded-offline',
    })
    await persistDatabase(database)
    return { ok: true }
  }

  if (routeKey === 'POST /auth/change-password') {
    const currentPassword = String(body.currentPassword || '')
    const newPassword = String(body.newPassword || '')

    if (!currentPassword || !newPassword) {
      throw new Error('currentPassword required aahe.')
    }

    if (!(await verifyPassword(currentPassword, user.password_hash))) {
      throw new Error('Current password valid nahi.')
    }

    validatePasswordStrength(newPassword)
    user.password_hash = await hashPassword(newPassword)
    user.must_change_password = false
    user.password_changed_at = nowIso()
    user.updated_by = user.id
    user.updated_at = nowIso()
    completePasswordResetRequests(database, user.id)
    audit(database, 'password_changed_self', user, {
      source: 'embedded-offline',
    })
    appAudit(database, 'user_password_changed', user, {
      userId: user.id,
      selfService: true,
    })
    await persistDatabase(database)
    return {
      ok: true,
      message: 'Password successfully update zala.',
    }
  }

  if (routeKey === 'GET /session/activity') {
    const mainAdminUser = isMainAdminRole(user.role)
    const activeSessions = sortByUpdatedDesc(
      database.sessions.filter((item) =>
        mainAdminUser
          ? new Date(item.expires_at).getTime() > Date.now()
          : item.user_id === user.id && new Date(item.expires_at).getTime() > Date.now(),
      ),
      'created_at',
      'created_at',
    )
      .slice(0, 25)
      .map((item) => mapSessionActivityRow(database, item))
    const recentLoginAudit = database.login_audit
      .filter((item) => mainAdminUser || item.user_id === user.id)
      .slice(0, 20)
      .map((item) => ({
        id: item.id,
        userId: item.user_id || '',
        username: item.username || '',
        email: item.email || '',
        action: item.action,
        context: cloneValue(item.context || {}),
        createdAt: item.created_at,
      }))
    const recentAppAudit = database.app_audit_events
      .filter((item) => mainAdminUser || item.actor_id === user.id)
      .slice(0, 20)
      .map(mapAppAuditEventRow)

    return {
      currentSession: mapSessionActivityRow(database, sessionRecord),
      activeSessions,
      recentLoginAudit,
      recentAppAudit,
    }
  }

  if (routeKey === 'GET /admin/login-audit') {
    if (!isMainAdminRole(user.role)) {
      throw new Error('Main admin access required aahe.')
    }

    return {
      entries: database.login_audit.slice(0, 200).map((item) => ({
        id: item.id,
        userId: item.user_id || '',
        username: item.username || '',
        email: item.email || '',
        action: item.action,
        context: cloneValue(item.context || {}),
        createdAt: item.created_at,
      })),
    }
  }

  if (routeKey === 'GET /admin/app-audit-events') {
    if (!isMainAdminRole(user.role)) {
      throw new Error('Main admin access required aahe.')
    }

    return {
      entries: database.app_audit_events.slice(0, 500).map(mapAppAuditEventRow),
    }
  }

  if (routeKey === 'POST /app-audit-events') {
    const action = String(body.action || '').trim()

    if (!action) {
      throw new Error('Audit action required aahe.')
    }

    const event = {
      id: String(body.id || crypto.randomUUID()).trim(),
      action,
      actor_id: String(body.actorId || user.id || '').trim(),
      actor_email: String(body.actorEmail || user.email || '').trim(),
      context: body.context && typeof body.context === 'object' ? body.context : {},
      created_at: String(body.createdAt || nowIso()).trim(),
    }
    database.app_audit_events.unshift(event)
    await persistDatabase(database)
    return {
      entry: mapAppAuditEventRow(event),
    }
  }

  if (routeKey === 'GET /admin/users') {
    if (!canManageUsers(user.role)) {
      throw new Error('User management access required aahe.')
    }

    const search = String(params.get('search') || '').trim().toLowerCase()
    const roleFilter = normalizeUserRole(params.get('role') || '')
    const statusFilter = String(params.get('status') || '').trim().toLowerCase()
    const requestedSubstationId = String(params.get('substationId') || '').trim()
    const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1)
    const pageSize = Math.min(
      100,
      Math.max(1, Number.parseInt(params.get('pageSize') || '20', 10) || 20),
    )
    const actorSubstationId = getScopedSubstationId(profile)
    const actorAssignableRoles = new Set(
      getAssignableRolesForActor(user.role).map((item) => item.value),
    )
    let rows = database.users.filter((item) => !item.deleted_at)

    if (!canManageAllUsers(user.role)) {
      if (!actorSubstationId) {
        return {
          users: [],
          pagination: {
            page,
            pageSize,
            total: 0,
            totalPages: 0,
          },
        }
      }

      rows = rows.filter(
        (item) =>
          item.substation_id === actorSubstationId &&
          actorAssignableRoles.has(normalizeUserRole(item.role)),
      )
    } else if (requestedSubstationId) {
      rows = rows.filter((item) => item.substation_id === requestedSubstationId)
    }

    if (roleFilter && actorAssignableRoles.has(roleFilter)) {
      rows = rows.filter((item) => normalizeUserRole(item.role) === roleFilter)
    }

    if (statusFilter === 'active') {
      rows = rows.filter((item) => item.is_active)
    } else if (statusFilter === 'inactive') {
      rows = rows.filter((item) => !item.is_active)
    }

    if (search) {
      rows = rows.filter((item) => {
        const substationName = getSubstationById(database, item.substation_id)?.name || ''
        return (
          normalizeIdentifier(item.username).includes(search) ||
          normalizeIdentifier(item.full_name).includes(search) ||
          normalizeIdentifier(item.phone).includes(search) ||
          normalizeIdentifier(substationName).includes(search)
        )
      })
    }

    rows = sortByUpdatedDesc(rows, 'created_at', 'created_at')
    const total = rows.length
    const totalPages = total ? Math.ceil(total / pageSize) : 0
    const offset = (page - 1) * pageSize

    return {
      users: rows.slice(offset, offset + pageSize).map((item) => mapUserRow(database, item)),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    }
  }

  if (routeKey === 'POST /admin/users') {
    if (!canManageUsers(user.role)) {
      throw new Error('User management access required aahe.')
    }

    if (!body.fullName || !body.username || !body.password) {
      throw new Error('fullName required aahe.')
    }

    validatePasswordStrength(body.password)
    const username = normalizeUsername(body.username)

    if (!username) {
      throw new Error('Valid username required aahe.')
    }

    if (usernameExists(database, username)) {
      throw new Error('Ha username already use madhye aahe.')
    }

    const mobile = normalizeMobile(body.mobile || body.phone)

    if (mobile && mobileExists(database, mobile)) {
      throw new Error('Ha mobile number already use madhye aahe.')
    }

    const assignableRoles = getAssignableRolesForActor(user.role).map((item) => item.value)
    const requestedRole = normalizeUserRole(body.role || ROLE_KEYS.NORMAL_USER)
    const role = assignableRoles.includes(requestedRole)
      ? requestedRole
      : ROLE_KEYS.NORMAL_USER
    const requestedSubstationId = isMainAdminRole(user.role)
      ? String(body.substationId || '').trim()
      : getScopedSubstationId(profile)

    if (!canAccessAllSubstations(role) && !requestedSubstationId) {
      throw new Error('Assigned substation required aahe.')
    }

    if (requestedSubstationId && !getSubstationById(database, requestedSubstationId)) {
      throw new Error('Assigned substation sapadli nahi.')
    }

    const timestamp = nowIso()
    const userId = crypto.randomUUID()
    const allowDelete =
      role === ROLE_KEYS.SUPER_ADMIN ||
      role === ROLE_KEYS.SUBSTATION_ADMIN ||
      body.allowDelete === true

    const record = {
      id: userId,
      username,
      email: normalizeIdentifier(body.email)
        ? String(body.email).trim().toLowerCase()
        : buildPlaceholderEmail(username, userId),
      full_name: String(body.fullName || '').trim(),
      phone: mobile,
      role,
      substation_id: canAccessAllSubstations(role) ? '' : requestedSubstationId,
      created_by: user.id,
      updated_by: user.id,
      disabled_at: '',
      disabled_by: '',
      deleted_at: '',
      deleted_by: '',
      must_change_password: body.mustChangePassword === true,
      password_changed_at: timestamp,
      last_login_at: '',
      module_permissions: buildModulePermissionPayload(role, { allowDelete }),
      is_active: body.isActive === false ? false : true,
      approval_status: body.isActive === false ? 'inactive' : 'approved',
      created_at: timestamp,
      updated_at: timestamp,
      password_hash: await hashPassword(body.password),
    }

    database.users.unshift(record)
    syncUserSubstationMapping(database, record.id, record.substation_id)
    appAudit(database, 'user_created', user, {
      targetUserId: record.id,
      username: record.username,
      role: record.role,
      substationId: record.substation_id,
    })
    await persistDatabase(database)

    return {
      user: mapUserRow(database, record),
      message: 'User create zala.',
    }
  }

  if (pathname.startsWith('/admin/users/') && pathname.endsWith('/reset-password') && normalizedMethod === 'POST') {
    if (!canManageUsers(user.role)) {
      throw new Error('User management access required aahe.')
    }

    const userId = pathname.split('/')[3]
    const existingUser = loadUserById(database, userId)

    if (!existingUser || existingUser.deleted_at) {
      throw new Error('User sapadla nahi.')
    }

    if (!canActorManageTargetUser(profile, mapUserRow(database, existingUser))) {
      throw new Error('Ya user cha password reset karaycha access nahi.')
    }

    validatePasswordStrength(body.temporaryPassword)
    const timestamp = nowIso()
    const passwordHash = await hashPassword(body.temporaryPassword)

    existingUser.password_hash = passwordHash
    existingUser.must_change_password = true
    existingUser.updated_by = user.id
    existingUser.updated_at = timestamp
    database.sessions = database.sessions.filter((item) => item.user_id !== existingUser.id)
    recordPasswordResetRequest(database, {
      userId: existingUser.id,
      requestedBy: user.id,
      temporaryPasswordHash: passwordHash,
      metadata: {
        forcedPasswordChange: true,
      },
    })
    appAudit(database, 'user_password_reset', user, {
      targetUserId: existingUser.id,
      username: existingUser.username || '',
      substationId: existingUser.substation_id || '',
    })
    await persistDatabase(database)

    return {
      ok: true,
      message: 'Temporary password set zala. User la first login nantar password change karava lagel.',
      mustChangePassword: true,
    }
  }

  if (pathname.startsWith('/admin/users/') && normalizedMethod === 'PUT') {
    if (!canManageUsers(user.role)) {
      throw new Error('User management access required aahe.')
    }

    const userId = pathname.split('/')[3]
    const existingUser = loadUserById(database, userId)

    if (!existingUser || existingUser.deleted_at) {
      throw new Error('User sapadla nahi.')
    }

    if (!canActorManageTargetUser(profile, mapUserRow(database, existingUser))) {
      throw new Error('Ha user manage karaycha access nahi.')
    }

    const assignableRoles = getAssignableRolesForActor(user.role).map((item) => item.value)
    const requestedRole = normalizeUserRole(body.role || existingUser.role)
    const nextRole = assignableRoles.includes(requestedRole)
      ? requestedRole
      : normalizeUserRole(existingUser.role)
    const nextUsername = normalizeUsername(body.username || existingUser.username)
    const nextMobile = normalizeMobile(body.mobile ?? body.phone ?? existingUser.phone)
    const nextSubstationId = isMainAdminRole(user.role)
      ? String(body.substationId ?? existingUser.substation_id ?? '').trim()
      : String(existingUser.substation_id || '').trim()

    if (!nextUsername) {
      throw new Error('Valid username required aahe.')
    }

    if (usernameExists(database, nextUsername, existingUser.id)) {
      throw new Error('Ha username already use madhye aahe.')
    }

    if (nextMobile && mobileExists(database, nextMobile, existingUser.id)) {
      throw new Error('Ha mobile number already use madhye aahe.')
    }

    if (!canAccessAllSubstations(nextRole) && !nextSubstationId) {
      throw new Error('Assigned substation required aahe.')
    }

    if (nextSubstationId && !getSubstationById(database, nextSubstationId)) {
      throw new Error('Assigned substation sapadli nahi.')
    }

    const permissions = applyDeletePermissionOverride(
      nextRole,
      existingUser.module_permissions || {},
      typeof body.allowDelete === 'boolean' ? body.allowDelete : undefined,
    )
    const isActive = body.isActive === false ? false : true
    const timestamp = nowIso()
    const previousRole = normalizeUserRole(existingUser.role)
    const previousSubstationId = String(existingUser.substation_id || '')
    const previousActive = Boolean(existingUser.is_active)

    existingUser.username = nextUsername
    existingUser.full_name = String(body.fullName || existingUser.full_name || '').trim()
    existingUser.phone = nextMobile
    existingUser.role = nextRole
    existingUser.substation_id = canAccessAllSubstations(nextRole) ? '' : nextSubstationId
    existingUser.module_permissions = permissions
    existingUser.is_active = isActive
    existingUser.approval_status = isActive ? 'approved' : 'inactive'
    existingUser.disabled_at = isActive ? '' : existingUser.disabled_at || timestamp
    existingUser.disabled_by = isActive ? '' : existingUser.disabled_by || user.id
    existingUser.updated_by = user.id
    existingUser.updated_at = timestamp

    syncUserSubstationMapping(database, existingUser.id, existingUser.substation_id)
    appAudit(database, 'user_updated', user, {
      targetUserId: existingUser.id,
      username: existingUser.username,
      roleChanged: previousRole !== nextRole,
      substationChanged: previousSubstationId !== String(existingUser.substation_id || ''),
      activeChanged: previousActive !== Boolean(isActive),
    })
    await persistDatabase(database)

    return {
      user: mapUserRow(database, existingUser),
    }
  }

  if (pathname.startsWith('/admin/users/') && normalizedMethod === 'DELETE') {
    if (!canManageUsers(user.role)) {
      throw new Error('User management access required aahe.')
    }

    const userId = pathname.split('/')[3]
    const existingUser = loadUserById(database, userId)

    if (!existingUser || existingUser.deleted_at) {
      throw new Error('User sapadla nahi.')
    }

    if (existingUser.id === user.id) {
      throw new Error('Swatacha account delete karu shakat nahi.')
    }

    if (!canActorManageTargetUser(profile, mapUserRow(database, existingUser))) {
      throw new Error('Ha user delete karaycha access nahi.')
    }

    const timestamp = nowIso()
    existingUser.is_active = false
    existingUser.approval_status = 'deleted'
    existingUser.deleted_at = timestamp
    existingUser.deleted_by = user.id
    existingUser.disabled_at = existingUser.disabled_at || timestamp
    existingUser.disabled_by = existingUser.disabled_by || user.id
    existingUser.updated_by = user.id
    existingUser.updated_at = timestamp
    database.sessions = database.sessions.filter((item) => item.user_id !== existingUser.id)
    appAudit(database, 'user_deleted', user, {
      targetUserId: existingUser.id,
      username: existingUser.username,
    })
    await persistDatabase(database)

    return { ok: true }
  }

  if (routeKey === 'GET /dashboard/summary') {
    return {
      summary: buildDashboardSummary(database, user),
    }
  }

  if (routeKey === 'GET /workspace-config') {
    const allowedSubstationIds = getAllowedSubstationIdsForUser(database, user)
    const adminUser = canAccessAllSubstations(user.role)
    const masters = Object.fromEntries(
      Array.from(allowedMasterTypes).map((type) => [
        type,
        database.master_records
          .filter((item) => item.type === type)
          .map(mapMasterRecordRow)
          .filter((item) => {
            if (adminUser || type === 'divisions' || !allowedSubstationIds) {
              return true
            }

            const recordSubstationId = String(item.substationId || item.substation_id || '').trim()
            return !recordSubstationId || allowedSubstationIds.includes(recordSubstationId)
          }),
      ]),
    )

    return {
      masters,
      settings: getWorkspaceSettings(database),
      updatedAt: database.app_settings.workspace_settings?.updated_at || '',
    }
  }

  if (pathname.startsWith('/masters/') && normalizedMethod === 'POST') {
    if (!isMainAdminRole(user.role)) {
      throw new Error('Main admin access required aahe.')
    }

    const type = pathname.split('/')[2]

    if (!allowedMasterTypes.has(type)) {
      throw new Error('Master type valid nahi.')
    }

    const recordId = String(body.id || crypto.randomUUID()).trim()
    const timestamp = nowIso()
    const existing = database.master_records.find((item) => item.id === recordId && item.type === type)

    if (existing) {
      existing.payload = {
        ...body,
        id: recordId,
        createdBy: existing.created_by || user.id,
      }
      existing.updated_at = timestamp
    } else {
      database.master_records.unshift({
        id: recordId,
        type,
        created_by: user.id,
        payload: {
          ...body,
          id: recordId,
          createdBy: user.id,
        },
        created_at: timestamp,
        updated_at: timestamp,
      })
    }

    appAudit(
      database,
      existing ? 'master_record_updated_server' : 'master_record_created_server',
      user,
      {
        type,
        recordId,
      },
    )
    await persistDatabase(database)

    const saved = database.master_records.find((item) => item.id === recordId && item.type === type)
    return {
      record: mapMasterRecordRow(saved),
    }
  }

  if (pathname.startsWith('/masters/') && normalizedMethod === 'DELETE') {
    if (!isMainAdminRole(user.role)) {
      throw new Error('Main admin access required aahe.')
    }

    const [, , type, recordId] = pathname.split('/')

    if (!allowedMasterTypes.has(type)) {
      throw new Error('Master type valid nahi.')
    }

    const existing = database.master_records.find((item) => item.id === recordId && item.type === type)

    if (!existing) {
      throw new Error('Master record sapadla nahi.')
    }

    database.master_records = database.master_records.filter(
      (item) => !(item.id === existing.id && item.type === type),
    )
    appAudit(database, 'master_record_deleted_server', user, {
      type,
      recordId: existing.id,
    })
    await persistDatabase(database)
    return { ok: true }
  }

  if (routeKey === 'POST /settings') {
    if (!isMainAdminRole(user.role)) {
      throw new Error('Main admin access required aahe.')
    }

    database.app_settings.workspace_settings = {
      value: body && typeof body === 'object' ? body : {},
      updated_by: user.id,
      updated_at: nowIso(),
    }
    appAudit(database, 'settings_saved_server', user, {
      keys: Object.keys(body || {}),
    })
    await persistDatabase(database)

    return {
      settings: cloneValue(body || {}),
      updatedAt: database.app_settings.workspace_settings.updated_at,
    }
  }

  if (routeKey === 'GET /substations') {
    const allowedSubstationIds = getAllowedSubstationIdsForUser(database, user)
    const substations = database.substations
      .map(mapSubstationRow)
      .filter((item) => !allowedSubstationIds || allowedSubstationIds.includes(item.id))
      .sort((left, right) => left.name.localeCompare(right.name))

    return { substations }
  }

  if (routeKey === 'POST /substations') {
    if (!isMainAdminRole(user.role)) {
      throw new Error('Main admin access required aahe.')
    }

    const code = String(body.code || '').trim()
    const name = String(body.name || '').trim()

    if (!name) {
      throw new Error('Substation name required aahe.')
    }

    if (
      code &&
      database.substations.some((item) => normalizeIdentifier(item.code) === normalizeIdentifier(code))
    ) {
      throw new Error('Substation code already exists.')
    }

    const record = withRecordMeta({
      id: crypto.randomUUID(),
      code,
      name,
      district: String(body.district || '').trim(),
      circle: String(body.circle || '').trim(),
      metadata: {
        omName: String(body.omName || '').trim(),
        subDivisionName: String(body.subDivisionName || '').trim(),
        divisionName: String(body.divisionName || '').trim(),
        sectionName: String(body.sectionName || '').trim(),
      },
      is_active: body.is_active === false ? false : true,
      created_by: user.id,
    }, {
      updatedAt: nowIso(),
    })
    database.substations.push(record)
    await persistDatabase(database)
    return {
      substation: mapSubstationRow(record),
    }
  }

  if (routeKey === 'GET /employees') {
    const substationId = String(params.get('substationId') || '').trim()
    const employeeType = String(params.get('employeeType') || '').trim()
    const search = String(params.get('search') || '').trim().toLowerCase()
    const allowedSubstationIds = getAllowedSubstationIdsForUser(database, user)
    let rows =
      canAccessAllSubstations(user.role) || !Array.isArray(allowedSubstationIds)
        ? database.employees
        : database.employees.filter((item) => allowedSubstationIds.includes(item.substation_id))

    rows = rows
      .map(mapEmployeeRow)
      .filter((item) => !substationId || item.substation_id === substationId)
      .filter((item) => !employeeType || item.employeeType === employeeType)
      .filter(
        (item) =>
          !search ||
          item.full_name.toLowerCase().includes(search) ||
          item.employee_code.toLowerCase().includes(search) ||
          item.designation.toLowerCase().includes(search),
      )
      .sort((left, right) => {
        const leftSr = Number.isInteger(left.srNo) ? left.srNo : Number.MAX_SAFE_INTEGER
        const rightSr = Number.isInteger(right.srNo) ? right.srNo : Number.MAX_SAFE_INTEGER
        if (leftSr !== rightSr) {
          return leftSr - rightSr
        }
        return left.full_name.localeCompare(right.full_name)
      })

    return { employees: rows }
  }

  if (routeKey === 'POST /employees') {
    let payload

    try {
      payload = normalizeEmployeePayload(body)
    } catch (error) {
      throw new Error(error.message)
    }

    if (!getSubstationById(database, payload.substationId)) {
      throw new Error('Selected substation sapadla nahi.')
    }

    if (!hasModulePermission(database, profile, 'employees', 'create', payload.substationId)) {
      throw new Error('Ya substation sathi employee create access nahi.')
    }

    const timestamp = nowIso()
    const record = withRecordMeta({
      id: crypto.randomUUID(),
      owner_user_id: user.id,
      substation_id: payload.substationId,
      employee_code: payload.employeeCode,
      full_name: payload.fullName,
      designation: payload.designation,
      phone: payload.phone,
      metadata: payload.metadata,
      created_at: timestamp,
      updated_at: timestamp,
    })
    database.employees.push(record)
    await persistDatabase(database)
    return {
      employee: mapEmployeeRow(record),
    }
  }

  if (pathname.startsWith('/employees/') && normalizedMethod === 'PUT') {
    const employeeId = pathname.split('/')[2]
    const existing = database.employees.find((item) => item.id === employeeId)

    if (!existing) {
      throw new Error('Employee sapadla nahi.')
    }

    if (!hasModulePermission(database, profile, 'employees', 'update', existing.substation_id)) {
      throw new Error('Ha employee edit karaycha access nahi.')
    }

    let payload

    try {
      payload = normalizeEmployeePayload(body)
    } catch (error) {
      throw new Error(error.message)
    }

    if (!hasModulePermission(database, profile, 'employees', 'update', payload.substationId)) {
      throw new Error('Ya substation sathi employee update access nahi.')
    }

    existing.substation_id = payload.substationId
    existing.employee_code = payload.employeeCode
    existing.full_name = payload.fullName
    existing.designation = payload.designation
    existing.phone = payload.phone
    existing.metadata = payload.metadata
    existing.updated_at = nowIso()
    await persistDatabase(database)
    return {
      employee: mapEmployeeRow(existing),
    }
  }

  if (pathname.startsWith('/employees/') && normalizedMethod === 'DELETE') {
    const employeeId = pathname.split('/')[2]
    const existing = database.employees.find((item) => item.id === employeeId)

    if (!existing) {
      throw new Error('Employee sapadla nahi.')
    }

    if (!hasModulePermission(database, profile, 'employees', 'delete', existing.substation_id)) {
      throw new Error('Ha employee delete karaycha access nahi.')
    }

    database.employees = database.employees.filter((item) => item.id !== existing.id)
    await persistDatabase(database)
    return { ok: true }
  }

  if (routeKey === 'GET /attendance-sheets') {
    const sheetType = String(params.get('sheetType') || '').trim()
    const monthKey = String(params.get('monthKey') || '').trim()
    const substationId = String(params.get('substationId') || '').trim()
    const ownerUserId = String(params.get('ownerUserId') || '').trim()
    const allowedSubstationIds = getAllowedSubstationIdsForUser(database, user)
    let documents = database.attendance_sheets

    if (Array.isArray(allowedSubstationIds)) {
      documents = documents.filter((item) => allowedSubstationIds.includes(item.substation_id))
    }

    documents = sortByUpdatedDesc(documents)
      .filter((item) => !sheetType || item.sheet_type === sheetType)
      .filter((item) => !monthKey || item.month_key === monthKey)
      .filter((item) => !substationId || item.substation_id === substationId)
      .filter((item) => !ownerUserId || item.owner_user_id === ownerUserId)
      .map(mapAttendanceSheetRow)

    return { documents }
  }

  if (routeKey === 'POST /attendance-sheets') {
    const document = body || {}
    const sheetType = String(document.sheetType || '').trim()
    const monthKey = String(document.monthKey || '').trim()
    const substationId = String(document.substationId || '').trim()

    if (!sheetType || !monthKey || !substationId) {
      throw new Error('Sheet type, month, ani substation required aahet.')
    }

    const existing = document.id
      ? database.attendance_sheets.find((item) => item.id === document.id)
      : null

    if (document.id && !existing) {
      throw new Error('Attendance sheet sapadla nahi.')
    }

    const action = existing ? 'update' : 'create'

    if (!hasModulePermission(database, profile, 'attendance', action, substationId)) {
      throw new Error('Ya substation sathi attendance save access nahi.')
    }

    if (existing && !hasModulePermission(database, profile, 'attendance', 'update', existing.substation_id)) {
      throw new Error('Ha attendance sheet update karaycha access nahi.')
    }

    const timestamp = nowIso()
    const recordId = existing?.id || document.id || crypto.randomUUID()
    const payload = {
      ...document,
      id: recordId,
      ownerUserId: existing?.owner_user_id || user.id,
    }

    if (existing) {
      existing.substation_id = substationId
      existing.sheet_type = sheetType
      existing.month_key = monthKey
      existing.employee_scope = String(document.employeeScope || existing.employee_scope || '').trim()
      existing.payload = payload
      Object.assign(existing, withRecordMeta(existing, { updatedAt: timestamp, bumpVersion: true }))
    } else {
      database.attendance_sheets.unshift({
        id: recordId,
        owner_user_id: user.id,
        substation_id: substationId,
        sheet_type: sheetType,
        month_key: monthKey,
        employee_scope: String(document.employeeScope || '').trim(),
        payload,
        created_at: timestamp,
        updated_at: timestamp,
      })
      database.attendance_sheets[0] = withRecordMeta(database.attendance_sheets[0], {
        updatedAt: timestamp,
      })
    }

    await persistDatabase(database)
    const saved = database.attendance_sheets.find((item) => item.id === recordId)
    return {
      document: mapAttendanceSheetRow(saved),
    }
  }

  if (pathname.startsWith('/attendance-sheets/') && normalizedMethod === 'DELETE') {
    const sheetId = pathname.split('/')[2]
    const existing = database.attendance_sheets.find((item) => item.id === sheetId)

    if (!existing) {
      throw new Error('Attendance sheet sapadla nahi.')
    }

    if (!hasModulePermission(database, profile, 'attendance', 'delete', existing.substation_id)) {
      throw new Error('Ha attendance sheet delete karaycha access nahi.')
    }

    database.attendance_sheets = database.attendance_sheets.filter((item) => item.id !== existing.id)
    await persistDatabase(database)
    return { ok: true }
  }

  if (routeKey === 'GET /dlr-records') {
    const moduleName = String(params.get('moduleName') || '').trim()
    const substationId = String(params.get('substationId') || '').trim()
    const operationalDate = String(params.get('operationalDate') || '').trim()
    const monthKey = String(params.get('monthKey') || '').trim()
    const ownerUserId = String(params.get('ownerUserId') || '').trim()
    const allowedSubstationIds = getAllowedSubstationIdsForUser(database, user)
    let records = database.dlr_records

    if (Array.isArray(allowedSubstationIds)) {
      records = records.filter((item) => allowedSubstationIds.includes(item.substation_id))
    }

    records = sortByUpdatedDesc(records)
      .filter((item) => !moduleName || item.module_name === moduleName)
      .filter((item) => !substationId || item.substation_id === substationId)
      .filter((item) => !operationalDate || item.operational_date === operationalDate)
      .filter((item) => !monthKey || String(item.operational_date || '').startsWith(monthKey))
      .filter((item) => !ownerUserId || item.owner_user_id === ownerUserId)
      .map(mapDlrRecordRow)

    return { records }
  }

  if (routeKey === 'POST /dlr-records') {
    const record = body || {}
    const moduleName = String(record.moduleName || '').trim()
    const substationId = String(record.substationId || '').trim()
    const operationalDate = String(record.operationalDate || '').trim()

    if (!moduleName || !substationId) {
      throw new Error('Module ani substation required aahet.')
    }

    const existing = record.id ? database.dlr_records.find((item) => item.id === record.id) : null

    if (record.id && !existing) {
      throw new Error('DLR record sapadla nahi.')
    }

    const permissionModuleKey = resolveOperationalModuleKey(existing?.module_name || moduleName)
    const action = existing ? 'update' : 'create'

    if (!hasModulePermission(database, profile, permissionModuleKey, action, substationId)) {
      throw new Error('Ya substation sathi DLR save access nahi.')
    }

    if (
      existing &&
      !hasModulePermission(database, profile, permissionModuleKey, 'update', existing.substation_id)
    ) {
      throw new Error('Ha DLR record update karaycha access nahi.')
    }

    const timestamp = nowIso()
    const recordId = existing?.id || record.id || crypto.randomUUID()
    const recordKey = String(record.recordKey || existing?.record_key || recordId).trim()
    const payload = {
      ...record,
      id: recordId,
      ownerUserId: existing?.owner_user_id || user.id,
    }

    if (existing) {
      existing.substation_id = substationId
      existing.module_name = moduleName
      existing.record_key = recordKey
      existing.operational_date = operationalDate
      existing.payload = payload
      Object.assign(existing, withRecordMeta(existing, { updatedAt: timestamp, bumpVersion: true }))
    } else {
      database.dlr_records.unshift({
        id: recordId,
        owner_user_id: user.id,
        substation_id: substationId,
        module_name: moduleName,
        record_key: recordKey,
        operational_date: operationalDate,
        payload,
        created_at: timestamp,
        updated_at: timestamp,
      })
      database.dlr_records[0] = withRecordMeta(database.dlr_records[0], {
        updatedAt: timestamp,
      })
    }

    audit(database, existing ? 'dlr_record_updated' : 'dlr_record_created', user, {
      recordId,
      moduleName,
      substationId,
      operationalDate,
    })
    await persistDatabase(database)
    const saved = database.dlr_records.find((item) => item.id === recordId)
    return {
      record: mapDlrRecordRow(saved),
    }
  }

  if (pathname.startsWith('/dlr-records/') && normalizedMethod === 'DELETE') {
    const recordId = pathname.split('/')[2]
    const existing = database.dlr_records.find((item) => item.id === recordId)

    if (!existing) {
      throw new Error('DLR record sapadla nahi.')
    }

    if (
      !hasModulePermission(
        database,
        profile,
        resolveOperationalModuleKey(existing.module_name),
        'delete',
        existing.substation_id,
      )
    ) {
      throw new Error('Ha DLR record delete karaycha access nahi.')
    }

    database.dlr_records = database.dlr_records.filter((item) => item.id !== existing.id)
    audit(database, 'dlr_record_deleted', user, {
      recordId: existing.id,
      moduleName: existing.module_name,
      substationId: existing.substation_id,
      operationalDate: existing.operational_date,
    })
    await persistDatabase(database)
    return { ok: true }
  }

  if (routeKey === 'GET /report-snapshots') {
    const reportType = String(params.get('reportType') || '').trim()
    const filenameBase = String(params.get('filenameBase') || '').trim()
    const allowedSubstationIds = getAllowedSubstationIdsForUser(database, user)
    let snapshots = database.report_snapshots

    if (Array.isArray(allowedSubstationIds)) {
      snapshots = snapshots.filter((item) => !item.substation_id || allowedSubstationIds.includes(item.substation_id))
    }

    snapshots = sortByUpdatedDesc(snapshots)
      .filter((item) => !reportType || item.report_type === reportType)
      .filter((item) => !filenameBase || item.filename_base === filenameBase)
      .slice(0, 300)
      .map(mapReportSnapshotRow)

    return { snapshots }
  }

  if (routeKey === 'POST /report-snapshots') {
    const snapshot = body || {}
    const reportType = String(snapshot.reportType || '').trim()
    const substationId = String(snapshot.substationId || '').trim()

    if (!reportType) {
      throw new Error('Report type required aahe.')
    }

    const snapshotId = String(snapshot.id || crypto.randomUUID()).trim()
    const existing = database.report_snapshots.find((item) => item.id === snapshotId)

    if (existing && !requireMappedSubstationAccess(database, profile, existing.substation_id)) {
      throw new Error('Ha report snapshot update karaycha access nahi.')
    }

    const action = existing ? 'update' : 'create'

    if (!hasModulePermission(database, profile, 'reports', action, substationId || existing?.substation_id)) {
      throw new Error('Ya substation sathi report save access nahi.')
    }

    const timestamp = nowIso()
    const metadata = {
      metadata: Array.isArray(snapshot.metadata) ? snapshot.metadata : [],
    }

    if (existing) {
      existing.report_type = reportType
      existing.filename_base = String(snapshot.filenameBase || '').trim()
      existing.export_type = String(snapshot.exportType || '').trim()
      existing.orientation = String(snapshot.orientation || '').trim()
      existing.title = String(snapshot.title || '').trim()
      existing.substation_id = substationId
      existing.substation_label = String(snapshot.substationLabel || '').trim()
      existing.month_label = String(snapshot.monthLabel || '').trim()
      existing.metadata = metadata
      Object.assign(existing, withRecordMeta(existing, { updatedAt: timestamp, bumpVersion: true }))
    } else {
      database.report_snapshots.unshift({
        id: snapshotId,
        owner_user_id: user.id,
        report_type: reportType,
        filename_base: String(snapshot.filenameBase || '').trim(),
        export_type: String(snapshot.exportType || '').trim(),
        orientation: String(snapshot.orientation || '').trim(),
        title: String(snapshot.title || '').trim(),
        substation_id: substationId,
        substation_label: String(snapshot.substationLabel || '').trim(),
        month_label: String(snapshot.monthLabel || '').trim(),
        metadata,
        created_at: timestamp,
        updated_at: timestamp,
      })
      database.report_snapshots[0] = withRecordMeta(database.report_snapshots[0], {
        updatedAt: timestamp,
      })
    }

    appAudit(database, 'report_snapshot_saved_server', user, {
      snapshotId,
      reportType,
      exportType: String(snapshot.exportType || '').trim(),
      filenameBase: String(snapshot.filenameBase || '').trim(),
    })
    await persistDatabase(database)
    const saved = database.report_snapshots.find((item) => item.id === snapshotId)
    return {
      snapshot: mapReportSnapshotRow(saved),
    }
  }

  if (routeKey === 'GET /notices') {
    const status = String(params.get('status') || '').trim()
    const allowedSubstationIds = getAllowedSubstationIdsForUser(database, user)
    let notices = database.notices

    if (Array.isArray(allowedSubstationIds)) {
      notices = notices.filter(
        (item) =>
          !item.substation_id || allowedSubstationIds.includes(item.substation_id),
      )
    }

    notices = sortByUpdatedDesc(notices)
      .map(mapNoticeRow)
      .filter((item) => !status || item.status === status)
      .filter((item) => isNoticeVisibleToUser(database, item, profile))

    return { notices }
  }

  if (routeKey === 'POST /notices') {
    if (!isMainAdminRole(user.role)) {
      throw new Error('Main admin access required aahe.')
    }

    const title = String(body.title || '').trim()
    const message = String(body.message || '').trim()

    if (!title || !message) {
      throw new Error('Notice title ani message required aahe.')
    }

    const noticeId = String(body.id || crypto.randomUUID()).trim()
    const timestamp = nowIso()
    const existing = database.notices.find((item) => item.id === noticeId)

    if (existing) {
      existing.substation_id = String(body.substationId || '').trim()
      existing.title = title
      existing.message = message
      existing.priority = String(body.priority || 'normal').trim()
      existing.status = String(body.status || 'active').trim()
      existing.publish_from = String(body.publishFrom || '').trim()
      existing.publish_to = String(body.publishTo || '').trim()
      Object.assign(existing, withRecordMeta(existing, { updatedAt: timestamp, bumpVersion: true }))
    } else {
      database.notices.unshift({
        id: noticeId,
        owner_user_id: user.id,
        substation_id: String(body.substationId || '').trim(),
        title,
        message,
        priority: String(body.priority || 'normal').trim(),
        status: String(body.status || 'active').trim(),
        publish_from: String(body.publishFrom || '').trim(),
        publish_to: String(body.publishTo || '').trim(),
        created_at: timestamp,
        updated_at: timestamp,
      })
      database.notices[0] = withRecordMeta(database.notices[0], {
        updatedAt: timestamp,
      })
    }

    appAudit(database, existing ? 'notice_updated' : 'notice_created', user, {
      noticeId,
      title,
    })
    await persistDatabase(database)
    const saved = database.notices.find((item) => item.id === noticeId)
    return {
      notice: mapNoticeRow(saved),
    }
  }

  if (pathname.startsWith('/notices/') && normalizedMethod === 'DELETE') {
    if (!isMainAdminRole(user.role)) {
      throw new Error('Main admin access required aahe.')
    }

    const noticeId = pathname.split('/')[2]
    const existing = database.notices.find((item) => item.id === noticeId)

    if (!existing) {
      throw new Error('Notice sapadla nahi.')
    }

    database.notices = database.notices.filter((item) => item.id !== existing.id)
    appAudit(database, 'notice_deleted', user, {
      noticeId: existing.id,
      title: existing.title,
    })
    await persistDatabase(database)
    return { ok: true }
  }

  if (routeKey === 'GET /feedback') {
    const moduleName = String(params.get('moduleName') || '').trim()
    const status = String(params.get('status') || '').trim()
    const adminUser = canAccessAllSubstations(user.role)

    const feedbackEntries = sortByUpdatedDesc(database.feedback_entries)
      .map(mapFeedbackRow)
      .filter((item) => adminUser || item.ownerUserId === user.id)
      .filter((item) => !moduleName || item.moduleName === moduleName)
      .filter((item) => !status || item.status === status)

    return { feedbackEntries }
  }

  if (routeKey === 'POST /feedback') {
    const subject = String(body.subject || '').trim()
    const message = String(body.message || '').trim()
    const substationId = String(body.substationId || '').trim()

    if (!subject || !message) {
      throw new Error('Feedback subject ani message required aahe.')
    }

    if (!hasModulePermission(database, profile, 'feedback', 'create', substationId)) {
      throw new Error('Ya substation sathi feedback submit access nahi.')
    }

    const entry = withRecordMeta({
      id: crypto.randomUUID(),
      owner_user_id: user.id,
      substation_id: substationId,
      module_name: String(body.moduleName || '').trim(),
      category: String(body.category || '').trim(),
      priority: String(body.priority || 'medium').trim(),
      status: 'open',
      subject,
      message,
      resolution_note: '',
      created_at: nowIso(),
      updated_at: nowIso(),
    })
    database.feedback_entries.unshift(entry)
    appAudit(database, 'feedback_created', user, {
      feedbackId: entry.id,
      moduleName: entry.module_name,
    })
    await persistDatabase(database)
    return {
      feedbackEntry: mapFeedbackRow(entry),
    }
  }

  if (pathname.startsWith('/feedback/') && normalizedMethod === 'PUT') {
    const feedbackId = pathname.split('/')[2]
    const existing = database.feedback_entries.find((item) => item.id === feedbackId)

    if (!existing) {
      throw new Error('Feedback entry sapadli nahi.')
    }

    const adminUser = canAccessAllSubstations(user.role)
    const ownerUser = existing.owner_user_id === user.id

    if (!adminUser && !ownerUser) {
      throw new Error('Ha feedback edit karaycha access nahi.')
    }

    if (!adminUser && !hasModulePermission(database, profile, 'feedback', 'update', existing.substation_id)) {
      throw new Error('Ha feedback edit karaycha access nahi.')
    }

    existing.module_name = String(body.moduleName || existing.module_name || '').trim()
    existing.category = String(body.category || existing.category || '').trim()
    existing.priority = String(body.priority || existing.priority || 'medium').trim()
    existing.status = adminUser
      ? String(body.status || existing.status || 'open').trim()
      : existing.status
    existing.subject = ownerUser
      ? String(body.subject || existing.subject || '').trim()
      : existing.subject
    existing.message = ownerUser
      ? String(body.message || existing.message || '').trim()
      : existing.message
    existing.resolution_note = adminUser
      ? String(body.resolutionNote || existing.resolution_note || '').trim()
      : existing.resolution_note
    Object.assign(existing, withRecordMeta(existing, { updatedAt: nowIso(), bumpVersion: true }))

    appAudit(database, 'feedback_updated', user, {
      feedbackId: existing.id,
      status: existing.status,
    })
    await persistDatabase(database)
    return {
      feedbackEntry: mapFeedbackRow(existing),
    }
  }

  if (routeKey === 'GET /admin/user-substation-mappings') {
    if (!isMainAdminRole(user.role)) {
      throw new Error('Main admin access required aahe.')
    }

    return {
      mappings: sortByUpdatedDesc(database.user_substation_mappings).map((item) => ({
        id: item.id,
        userId: item.user_id,
        substationId: item.substation_id,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      })),
    }
  }

  if (routeKey === 'POST /admin/user-substation-mappings') {
    if (!isMainAdminRole(user.role)) {
      throw new Error('Main admin access required aahe.')
    }

    const userId = String(body.userId || '').trim()
    const substationId = String(body.substationId || '').trim()

    if (!userId || !substationId) {
      throw new Error('User ani substation required aahe.')
    }

    const mappedUser = loadUserById(database, userId)
    const substation = getSubstationById(database, substationId)

    if (!mappedUser) {
      throw new Error('User sapadla nahi.')
    }

    if (!substation) {
      throw new Error('Substation sapadli nahi.')
    }

    mappedUser.substation_id = substationId
    mappedUser.updated_by = user.id
    mappedUser.updated_at = nowIso()
    syncUserSubstationMapping(database, userId, substationId)
    const existing = database.user_substation_mappings.find(
      (item) => item.user_id === userId && item.substation_id === substationId,
    )
    appAudit(database, 'user_substation_changed', user, {
      userId,
      substationId,
    })
    await persistDatabase(database)
    return {
      mapping: {
        id: existing?.id || '',
        userId,
        substationId,
        createdAt: existing?.created_at || nowIso(),
        updatedAt: existing?.updated_at || nowIso(),
      },
    }
  }

  if (pathname.startsWith('/admin/user-substation-mappings/') && normalizedMethod === 'DELETE') {
    if (!isMainAdminRole(user.role)) {
      throw new Error('Main admin access required aahe.')
    }

    const mappingId = pathname.split('/')[3]
    const existing = database.user_substation_mappings.find((item) => item.id === mappingId)

    if (!existing) {
      throw new Error('Mapping sapadla nahi.')
    }

    database.user_substation_mappings = database.user_substation_mappings.filter(
      (item) => item.id !== existing.id,
    )

    const targetUser = loadUserById(database, existing.user_id)

    if (targetUser) {
      targetUser.substation_id = ''
      targetUser.updated_by = user.id
      targetUser.updated_at = nowIso()
    }

    audit(database, 'user_substation_mapping_deleted', user, {
      mappingId: existing.id,
      userId: existing.user_id,
      substationId: existing.substation_id,
    })
    await persistDatabase(database)
    return { ok: true }
  }

  if (routeKey === 'GET /admin/workspace-backup') {
    if (!isMainAdminRole(user.role)) {
      throw new Error('Main admin access required aahe.')
    }

    const exportTimestamp = nowIso()
    database.backup_metadata = {
      ...(database.backup_metadata || {}),
      last_exported_at: exportTimestamp,
    }
    await persistDatabase(database)

    return {
      snapshot: {
        exportedAt: exportTimestamp,
        backupMetadata: cloneValue(database.backup_metadata || {}),
        users: database.users.map((item) => ({
          ...mapUserRow(database, item),
          passwordHash: item.password_hash,
        })),
        loginAudit: database.login_audit.map((item) => ({
          id: item.id,
          userId: item.user_id,
          username: item.username,
          email: item.email,
          action: item.action,
          context: cloneValue(item.context || {}),
          createdAt: item.created_at,
        })),
        substations: database.substations.map(mapSubstationRow),
        employees: database.employees.map(mapEmployeeRow),
        masters: Object.fromEntries(
          Array.from(allowedMasterTypes).map((type) => [
            type,
            database.master_records
              .filter((item) => item.type === type)
              .map(mapMasterRecordRow),
          ]),
        ),
        settings: getWorkspaceSettings(database),
        userSubstationMappings: database.user_substation_mappings.map((item) => ({
          id: item.id,
          userId: item.user_id,
          substationId: item.substation_id,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
        })),
        attendanceDocuments: database.attendance_sheets.map(mapAttendanceSheetRow),
        dlrRecords: database.dlr_records.map(mapDlrRecordRow),
        reportSnapshots: database.report_snapshots.map(mapReportSnapshotRow),
        notices: database.notices.map(mapNoticeRow),
        feedbackEntries: database.feedback_entries.map(mapFeedbackRow),
        auditEvents: database.app_audit_events.map(mapAppAuditEventRow),
      },
    }
  }

  if (routeKey === 'POST /admin/workspace-backup/import') {
    if (!isMainAdminRole(user.role)) {
      throw new Error('Main admin access required aahe.')
    }

    const snapshot = body?.snapshot

    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error('Backup snapshot valid nahi.')
    }

    await applySeedSnapshot(database, snapshot, 'workspace-backup-import', {
      resetSessions: false,
    })
    database.backup_metadata = {
      ...(database.backup_metadata || {}),
      ...(snapshot.backupMetadata && typeof snapshot.backupMetadata === 'object'
        ? snapshot.backupMetadata
        : {}),
      last_imported_at: nowIso(),
      last_restore_at: nowIso(),
    }
    appAudit(database, 'workspace_backup_imported_server', user, {
      exportedAt: snapshot.exportedAt || '',
    })
    await ensureDefaultAdmin(database)
    await persistDatabase(database)
    return { ok: true }
  }

  throw new Error(`Offline route support available nahi: ${routeKey}`)
}
