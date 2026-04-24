/* global Buffer, process */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { DatabaseSync } from 'node:sqlite'
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
} from '../src/lib/rbac.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const dataDir = path.join(rootDir, 'local-data')
const dbPath = path.join(dataDir, 'unified-msedcl-local.sqlite')
const port = Number(process.env.LOCAL_SERVER_PORT || 8787)
const webPort = Number(process.env.LOCAL_WEB_PORT || 5173)
const defaultAdminUsername = process.env.LOCAL_ADMIN_USERNAME || 'admin'
const defaultAdminEmail =
  process.env.LOCAL_ADMIN_EMAIL || `${defaultAdminUsername}@local.test`
const defaultAdminPassword =
  process.env.LOCAL_ADMIN_PASSWORD || 'Admin@12345'
const allowedMasterTypes = new Set(['divisions', 'feeders', 'batterySets', 'transformers'])
const managedOperationalModules = new Set(MODULE_PERMISSION_KEYS)

fs.mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(dbPath)

function nowIso() {
  return new Date().toISOString()
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || '').split(':')

  if (!salt || !hash) {
    return false
  }

  const derived = crypto.scryptSync(password, salt, 64).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(derived))
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
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

function buildPlaceholderEmail(username, userId = '') {
  const safeUsername = normalizeUsername(username) || 'user'
  const suffix = String(userId || crypto.randomUUID()).replace(/[^a-z0-9]/gi, '').slice(0, 8)
  return `${safeUsername}.${suffix || 'local'}@local.user`
}

function tableHasColumn(tableName, columnName) {
  return db
    .prepare(`pragma table_info(${tableName})`)
    .all()
    .some((row) => row.name === columnName)
}

function ensureColumn(tableName, columnName, definition) {
  if (!tableHasColumn(tableName, columnName)) {
    db.exec(`alter table ${tableName} add column ${columnName} ${definition}`)
  }
}

function getUserAllowedSubstationIds(row) {
  const normalizedRole = normalizeUserRole(row?.role)

  if (!row || canAccessAllSubstations(normalizedRole)) {
    return []
  }

  const directSubstationId = String(row.substation_id || '').trim()

  if (directSubstationId) {
    return [directSubstationId]
  }

  return db
    .prepare(
      `
        select substation_id
        from user_substation_mappings
        where user_id = ?
        order by created_at asc
      `,
    )
    .all(row.id)
    .map((item) => item.substation_id)
    .filter(Boolean)
}

function mapUserRow(row) {
  if (!row) {
    return null
  }

  const normalizedRole = normalizeUserRole(row.role)
  const modulePermissions = normalizeModulePermissions(
    normalizedRole,
    parseJson(row.module_permissions_json, {}),
  )
  const allowedSubstationIds = getUserAllowedSubstationIds(row)

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
    substation_name: row.substation_name || '',
    substationName: row.substation_name || '',
    allowed_substation_ids: allowedSubstationIds,
    created_by: row.created_by || '',
    created_by_name: row.created_by_name || '',
    updated_by: row.updated_by || '',
    disabled_at: row.disabled_at || '',
    disabled_by: row.disabled_by || '',
    deleted_at: row.deleted_at || '',
    deleted_by: row.deleted_by || '',
    must_change_password: Boolean(row.must_change_password),
    module_permissions: modulePermissions,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function mapSubstationRow(row) {
  if (!row) {
    return null
  }

  const metadata = parseJson(row.metadata_json)

  return {
    id: row.id,
    code: row.code || '',
    name: row.name,
    district: row.district || '',
    circle: row.circle || '',
    omName: metadata.omName || '',
    subDivisionName: metadata.subDivisionName || '',
    divisionName: metadata.divisionName || '',
    sectionName: metadata.sectionName || '',
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

  const metadata = parseJson(row.metadata_json)

  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    substation_id: row.substation_id || '',
    employee_code: row.employee_code || '',
    full_name: row.full_name,
    designation: row.designation || '',
    phone: row.phone || '',
    srNo: metadata.srNo ?? '',
    employeeType: metadata.employeeType || '',
    cpfNo: metadata.cpfNo || '',
    joiningDate: metadata.joiningDate || '',
    workingPlace: metadata.workingPlace || '',
    weeklyOffDay: metadata.weeklyOffDay ?? '',
    isGeneralDutyOperator: Boolean(metadata.isGeneralDutyOperator),
    isVacant: Boolean(metadata.isVacant),
    isActive: metadata.isActive === false ? false : true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function mapMasterRecordRow(row) {
  if (!row) {
    return null
  }

  return {
    ...parseJson(row.payload_json, {}),
    id: row.id,
    createdBy: row.created_by || '',
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
    context: parseJson(row.context_json, {}),
    createdAt: row.created_at,
  }
}

function mapReportSnapshotRow(row) {
  if (!row) {
    return null
  }

  const metadata = parseJson(row.metadata_json, {})

  return {
    id: row.id,
    ownerUserId: row.owner_user_id || '',
    reportType: row.report_type,
    filenameBase: row.filename_base || '',
    exportType: row.export_type || '',
    orientation: row.orientation || '',
    title: row.title || '',
    substationId: row.substation_id || '',
    substationLabel: row.substation_label || '',
    monthLabel: row.month_label || '',
    metadata: metadata.metadata || [],
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

function mapSessionActivityRow(row) {
  if (!row) {
    return null
  }

  return {
    token: row.token,
    userId: row.user_id,
    username: row.username || '',
    email: row.email || '',
    fullName: row.full_name || '',
    role: normalizeUserRole(row.role),
    roleLabel: getRoleLabel(row.role),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }
}

function isNoticeVisibleToUser(notice, user) {
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

  return !notice.substationId || requireMappedSubstationAccess(user, notice.substationId)
}

function mapAttendanceSheetRow(row) {
  if (!row) {
    return null
  }

  const stored = parseJson(row.payload_json, {})

  return {
    ...stored,
    id: row.id,
    ownerUserId: row.owner_user_id,
    substationId: row.substation_id || '',
    sheetType: row.sheet_type,
    monthKey: row.month_key,
    employeeScope: row.employee_scope || stored.employeeScope || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapDlrRecordRow(row) {
  if (!row) {
    return null
  }

  const stored = parseJson(row.payload_json, {})

  return {
    ...stored,
    id: row.id,
    ownerUserId: row.owner_user_id,
    substationId: row.substation_id || '',
    moduleName: row.module_name,
    recordKey: row.record_key,
    operationalDate: row.operational_date || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapSessionPayload(row, token) {
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

function audit(action, user, context = {}) {
  db.prepare(
    `
      insert into login_audit (
        user_id,
        username,
        email,
        action,
        context_json,
        created_at
      ) values (?, ?, ?, ?, ?, ?)
    `,
  ).run(
    user?.id ?? null,
    user?.username ?? null,
    user?.email ?? null,
    action,
    JSON.stringify(context),
    nowIso(),
  )
}

function appAudit(action, user, context = {}) {
  db.prepare(
    `
      insert into app_audit_events (
        id,
        action,
        actor_id,
        actor_email,
        context_json,
        created_at
      ) values (?, ?, ?, ?, ?, ?)
    `,
  ).run(
    crypto.randomUUID(),
    action,
    user?.id ?? user?.auth_user_id ?? null,
    user?.email ?? null,
    JSON.stringify(context),
    nowIso(),
  )
}

function createSession(user) {
  const token = crypto.randomBytes(24).toString('hex')
  const createdAt = nowIso()
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString()

  db.prepare(
    `
      insert into sessions (
        token,
        user_id,
        created_at,
        expires_at
      ) values (?, ?, ?, ?)
    `,
  ).run(token, user.id, createdAt, expiresAt)

  if (tableHasColumn('users', 'last_login_at')) {
    db.prepare(
      `
        update users
        set last_login_at = ?,
            updated_at = coalesce(updated_at, ?)
        where id = ?
      `,
    ).run(createdAt, createdAt, user.id)
  }

  return mapSessionPayload(user, token)
}

function getUserByIdentifier(identifier) {
  const normalized = normalizeIdentifier(identifier)

  if (!normalized) {
    return null
  }

  return db
    .prepare(
      `
        select *
        from users
        where deleted_at is null
          and (
            lower(username) = ?
            or lower(email) = ?
          )
      `,
    )
    .get(normalized, normalized)
}

function requireFields(fields, body) {
  for (const field of fields) {
    if (!body?.[field]) {
      return `${field} required aahe.`
    }
  }

  return null
}

function normalizeMobile(value) {
  return String(value || '').trim()
}

function usernameExists(username, excludedUserId = '') {
  const normalized = normalizeUsername(username)

  if (!normalized) {
    return false
  }

  return Boolean(
    db
      .prepare(
        `
          select id
          from users
          where lower(username) = lower(?)
            and (? = '' or id != ?)
          limit 1
        `,
      )
      .get(normalized, excludedUserId, excludedUserId),
  )
}

function mobileExists(mobile, excludedUserId = '') {
  const normalized = normalizeMobile(mobile)

  if (!normalized) {
    return false
  }

  return Boolean(
    db
      .prepare(
        `
          select id
          from users
          where deleted_at is null
            and trim(coalesce(phone, '')) != ''
            and phone = ?
            and (? = '' or id != ?)
          limit 1
        `,
      )
      .get(normalized, excludedUserId, excludedUserId),
  )
}

function generateUniqueUsername(seed, excludedUserId = '') {
  const base = normalizeUsername(seed) || 'user'
  let counter = 1
  let candidate = base

  while (usernameExists(candidate, excludedUserId)) {
    candidate = `${base}-${counter}`
    counter += 1
  }

  return candidate
}

function cascadeDisableManagedUsers(parentUserId, actorUserId) {
  if (!parentUserId) {
    return 0
  }
  const timestamp = nowIso()
  const result = db.prepare(
    `
      update users
      set is_active = 0,
          approval_status = 'inactive',
          disabled_at = coalesce(disabled_at, ?),
          disabled_by = coalesce(disabled_by, ?),
          updated_by = ?,
          updated_at = ?
      where deleted_at is null
        and created_by = ?
        and id != ?
    `,
  ).run(timestamp, actorUserId, actorUserId, timestamp, parentUserId, parentUserId)
  db.prepare(
    `
      delete from sessions
      where user_id in (
        select id
        from users
        where deleted_at is null
          and created_by = ?
          and id != ?
      )
    `,
  ).run(parentUserId, parentUserId)
  return Number(result?.changes || 0)
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

function syncUserSubstationMapping(userId, substationId) {
  if (!userId) {
    return
  }

  const normalizedSubstationId = String(substationId || '').trim()

  if (!normalizedSubstationId) {
    db.prepare('delete from user_substation_mappings where user_id = ?').run(userId)
    return
  }

  const timestamp = nowIso()
  const existing = db
    .prepare(
      `
        select *
        from user_substation_mappings
        where user_id = ? and substation_id = ?
      `,
    )
    .get(userId, normalizedSubstationId)

  if (existing) {
    db.prepare(
      `
        update user_substation_mappings
        set updated_at = ?
        where id = ?
      `,
    ).run(timestamp, existing.id)
  } else {
    db.prepare(
      `
        insert into user_substation_mappings (
          id,
          user_id,
          substation_id,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?)
      `,
    ).run(crypto.randomUUID(), userId, normalizedSubstationId, timestamp, timestamp)
  }

  db.prepare(
    `
      delete from user_substation_mappings
      where user_id = ?
        and substation_id != ?
    `,
  ).run(userId, normalizedSubstationId)
}

function initializeDatabase() {
  db.exec(`
    create table if not exists users (
      id text primary key,
      username text not null,
      email text not null unique,
      password_hash text not null,
      full_name text,
      phone text,
      role text not null default 'normal_user',
      substation_id text,
      created_by text,
      updated_by text,
      disabled_at text,
      disabled_by text,
      deleted_at text,
      deleted_by text,
      must_change_password integer not null default 0,
      password_changed_at text,
      last_login_at text,
      module_permissions_json text not null default '{}',
      is_active integer not null default 1,
      approval_status text not null default 'approved',
      created_at text not null,
      updated_at text not null
    );

    create table if not exists sessions (
      token text primary key,
      user_id text not null,
      created_at text not null,
      expires_at text not null,
      foreign key(user_id) references users(id) on delete cascade
    );

    create table if not exists password_resets (
      recovery_token text primary key,
      user_id text not null,
      created_at text not null,
      expires_at text not null,
      used_at text,
      foreign key(user_id) references users(id) on delete cascade
    );

    create table if not exists password_reset_requests (
      id text primary key,
      user_id text not null,
      requested_by text,
      reset_type text not null default 'admin_temporary',
      delivery_channel text not null default 'manual',
      delivery_target text,
      temporary_password_hash text,
      status text not null default 'issued',
      expires_at text,
      used_at text,
      completed_at text,
      metadata_json text not null default '{}',
      created_at text not null,
      updated_at text not null,
      foreign key(user_id) references users(id) on delete cascade
    );

    create table if not exists substations (
      id text primary key,
      code text unique,
      name text not null,
      district text,
      circle text,
      metadata_json text not null default '{}',
      is_active integer not null default 1,
      created_by text,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists employees (
      id text primary key,
      owner_user_id text not null,
      substation_id text,
      employee_code text,
      full_name text not null,
      designation text,
      phone text,
      metadata_json text not null default '{}',
      created_at text not null,
      updated_at text not null
    );

    create table if not exists attendance_sheets (
      id text primary key,
      owner_user_id text not null,
      substation_id text,
      sheet_type text not null,
      month_key text not null,
      employee_scope text,
      payload_json text not null default '{}',
      created_at text not null,
      updated_at text not null
    );

    create table if not exists master_records (
      id text primary key,
      type text not null,
      created_by text,
      payload_json text not null default '{}',
      created_at text not null,
      updated_at text not null
    );

    create index if not exists idx_master_records_type
      on master_records (type, updated_at desc);

    create table if not exists app_settings (
      key text primary key,
      value_json text not null default '{}',
      updated_by text,
      updated_at text not null
    );

    create table if not exists dlr_records (
      id text primary key,
      owner_user_id text not null,
      substation_id text,
      module_name text not null,
      record_key text not null,
      operational_date text,
      payload_json text not null default '{}',
      created_at text not null,
      updated_at text not null
    );

    create table if not exists login_audit (
      id integer primary key autoincrement,
      user_id text,
      username text,
      email text,
      action text not null,
      context_json text not null default '{}',
      created_at text not null
    );

    create table if not exists app_audit_events (
      id text primary key,
      action text not null,
      actor_id text,
      actor_email text,
      context_json text not null default '{}',
      created_at text not null
    );

    create table if not exists report_snapshots (
      id text primary key,
      owner_user_id text not null,
      report_type text not null,
      filename_base text,
      export_type text,
      orientation text,
      title text,
      substation_id text,
      substation_label text,
      month_label text,
      metadata_json text not null default '{}',
      created_at text not null,
      updated_at text not null
    );

    create table if not exists notices (
      id text primary key,
      owner_user_id text not null,
      substation_id text,
      title text not null,
      message text not null,
      priority text not null default 'normal',
      status text not null default 'active',
      publish_from text,
      publish_to text,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists feedback_entries (
      id text primary key,
      owner_user_id text not null,
      substation_id text,
      module_name text,
      category text,
      priority text not null default 'medium',
      status text not null default 'open',
      subject text not null,
      message text not null,
      resolution_note text,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists user_substation_mappings (
      id text primary key,
      user_id text not null,
      substation_id text not null,
      created_at text not null,
      updated_at text not null,
      foreign key(user_id) references users(id) on delete cascade,
      foreign key(substation_id) references substations(id) on delete cascade
    );

    create unique index if not exists idx_user_substation_mapping_unique
      on user_substation_mappings (user_id, substation_id);
  `)

  ensureColumn('users', 'username', "text default ''")
  ensureColumn('users', 'substation_id', 'text')
  ensureColumn('users', 'created_by', 'text')
  ensureColumn('users', 'updated_by', 'text')
  ensureColumn('users', 'disabled_at', 'text')
  ensureColumn('users', 'disabled_by', 'text')
  ensureColumn('users', 'deleted_at', 'text')
  ensureColumn('users', 'deleted_by', 'text')
  ensureColumn('users', 'must_change_password', 'integer not null default 0')
  ensureColumn('users', 'password_changed_at', 'text')
  ensureColumn('users', 'last_login_at', 'text')
  ensureColumn('users', 'module_permissions_json', "text not null default '{}'")
  ensureColumn('login_audit', 'username', 'text')

  const existingUser = db
    .prepare(
      `
        select id
        from users
        limit 1
      `,
    )
    .get()

  if (!existingUser) {
    const adminId = crypto.randomUUID()
    const timestamp = nowIso()

    db.prepare(
      `
        insert into users (
          id,
          username,
          email,
          password_hash,
          full_name,
          phone,
          role,
          substation_id,
          created_by,
          updated_by,
          is_active,
          approval_status,
          must_change_password,
          password_changed_at,
          module_permissions_json,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      adminId,
      normalizeUsername(defaultAdminUsername),
      defaultAdminEmail,
      hashPassword(defaultAdminPassword),
      'Local Admin',
      '',
      ROLE_KEYS.SUPER_ADMIN,
      '',
      adminId,
      adminId,
      1,
      'approved',
      0,
      timestamp,
      JSON.stringify(buildModulePermissionPayload(ROLE_KEYS.SUPER_ADMIN, { allowDelete: true })),
      timestamp,
      timestamp,
    )

    audit(
      'bootstrap_admin_created',
      {
        id: adminId,
        username: normalizeUsername(defaultAdminUsername),
        email: defaultAdminEmail,
      },
      {
        mode: 'local-sql',
      },
    )

    console.log('Local SQL admin bootstrap complete')
    console.log(`Username: ${defaultAdminUsername}`)
    console.log(`Password: ${defaultAdminPassword}`)
    return
  }

  const users = db
    .prepare(
      `
        select *
        from users
        order by created_at asc
      `,
    )
    .all()

  for (const user of users) {
    const normalizedRole = normalizeUserRole(user.role)
    const mappedSubstation = db
      .prepare(
        `
          select substation_id
          from user_substation_mappings
          where user_id = ?
          order by created_at asc
          limit 1
        `,
      )
      .get(user.id)
    const scopedSubstationId = canAccessAllSubstations(normalizedRole)
      ? ''
      : String(user.substation_id || mappedSubstation?.substation_id || '').trim()
    const nextUsername = generateUniqueUsername(
      user.username ||
        String(user.email || '').split('@')[0] ||
        user.full_name ||
        `user-${String(user.id || '').slice(0, 6)}`,
      user.id,
    )
    const nextEmail = normalizeIdentifier(user.email)
      ? String(user.email).trim().toLowerCase()
      : buildPlaceholderEmail(nextUsername, user.id)
    const nextCreatedBy = String(user.created_by || user.id).trim()
    const nextUpdatedBy = String(user.updated_by || nextCreatedBy || user.id).trim()
    const permissions = normalizeIdentifier(user.module_permissions_json)
      ? normalizeModulePermissions(normalizedRole, parseJson(user.module_permissions_json, {}))
      : buildModulePermissionPayload(normalizedRole, {
          allowDelete:
            normalizedRole === ROLE_KEYS.SUPER_ADMIN ||
            normalizedRole === ROLE_KEYS.SUBSTATION_ADMIN,
        })

    db.prepare(
      `
        update users
        set username = ?,
            email = ?,
            role = ?,
            substation_id = ?,
            created_by = ?,
            updated_by = ?,
            module_permissions_json = ?,
            approval_status = ?,
            updated_at = coalesce(updated_at, ?)
        where id = ?
      `,
    ).run(
      nextUsername,
      nextEmail,
      normalizedRole,
      scopedSubstationId,
      nextCreatedBy,
      nextUpdatedBy,
      JSON.stringify(permissions),
      user.is_active ? 'approved' : 'inactive',
      user.created_at || nowIso(),
      user.id,
    )

    syncUserSubstationMapping(user.id, scopedSubstationId)
  }

  db.exec(`
    create unique index if not exists idx_users_username_unique
      on users (lower(username));

    create unique index if not exists idx_users_mobile_unique
      on users (phone)
      where deleted_at is null and trim(coalesce(phone, '')) != '';

    create index if not exists idx_users_scope_listing
      on users (substation_id, role, is_active, created_at desc);

    create index if not exists idx_password_reset_requests_user
      on password_reset_requests (user_id, status, created_at desc);

    create index if not exists idx_employees_substation_listing
      on employees (substation_id, updated_at desc, created_at desc);

    create index if not exists idx_attendance_sheets_scope
      on attendance_sheets (substation_id, month_key, updated_at desc, created_at desc);

    create index if not exists idx_dlr_records_scope
      on dlr_records (substation_id, module_name, operational_date, updated_at desc);

    create index if not exists idx_report_snapshots_scope
      on report_snapshots (substation_id, owner_user_id, updated_at desc, created_at desc);

    create index if not exists idx_notices_scope
      on notices (substation_id, status, updated_at desc, created_at desc);

    create index if not exists idx_feedback_entries_scope
      on feedback_entries (substation_id, owner_user_id, status, updated_at desc, created_at desc);
  `)
}

initializeDatabase()

const app = express()

// Daily log and backup payloads can exceed the default ~100kb JSON cap (HTTP 413).
app.use(express.json({ limit: '100mb' }))

app.use((_, response, next) => {
  response.setHeader('Cache-Control', 'no-store')
  next()
})

function authenticate(request, response, next) {
  const authorization = request.headers.authorization || ''
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : ''

  if (!token) {
    response.status(401).json({ error: 'Login required aahe.' })
    return
  }

  const sessionRow = db
    .prepare(
      `
        select s.token, s.expires_at, u.*
        from sessions s
        join users u on u.id = s.user_id
        where s.token = ?
      `,
    )
    .get(token)

  if (!sessionRow) {
    response.status(401).json({ error: 'Session invalid aahe.' })
    return
  }

  if (new Date(sessionRow.expires_at).getTime() < Date.now()) {
    db.prepare('delete from sessions where token = ?').run(token)
    response.status(401).json({ error: 'Session expire zali aahe.' })
    return
  }

  request.user = mapUserRow(sessionRow)
  request.sessionToken = token
  next()
}

function requireMainAdmin(request, response, next) {
  if (!request.user || !isMainAdminRole(request.user.role)) {
    response.status(403).json({ error: 'Main admin access required aahe.' })
    return
  }

  next()
}

function requireUserManager(request, response, next) {
  if (!request.user || !canManageUsers(request.user.role)) {
    response.status(403).json({ error: 'User management access required aahe.' })
    return
  }

  next()
}

function getAllowedSubstationIdsForUser(user) {
  if (!user || canAccessAllSubstations(user.role)) {
    return null
  }

  const scopedSubstationId = getScopedSubstationId(user)

  if (scopedSubstationId) {
    return [scopedSubstationId]
  }

  return db
    .prepare(
      `
        select substation_id
        from user_substation_mappings
        where user_id = ?
      `,
    )
    .all(user.id)
    .map((item) => item.substation_id)
}

function requireMappedSubstationAccess(user, substationId) {
  if (!substationId || !user || canAccessAllSubstations(user.role)) {
    return true
  }

  const allowedSubstationIds = getAllowedSubstationIdsForUser(user)
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

function hasModulePermission(user, moduleKey, action, substationId) {
  return (
    canPerformModuleAction(user, moduleKey, action) &&
    (!substationId || requireMappedSubstationAccess(user, substationId))
  )
}

function loadUserById(userId) {
  return db
    .prepare(
      `
        select
          u.*,
          s.name as substation_name,
          cb.full_name as created_by_name
        from users u
        left join substations s on s.id = u.substation_id
        left join users cb on cb.id = u.created_by
        where u.id = ?
      `,
    )
    .get(userId)
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

function loadEmployeeById(employeeId) {
  return db
    .prepare(
      `
        select *
        from employees
        where id = ?
      `,
    )
    .get(employeeId)
}

function loadAttendanceSheetById(sheetId) {
  return db
    .prepare(
      `
        select *
        from attendance_sheets
        where id = ?
      `,
    )
    .get(sheetId)
}

function loadDlrRecordById(recordId) {
  return db
    .prepare(
      `
        select *
        from dlr_records
        where id = ?
      `,
    )
    .get(recordId)
}

function validatePasswordStrength(password) {
  if (String(password || '').length < 8) {
    throw new Error('Password kamit kami 8 characters cha hava.')
  }
}

function recordPasswordResetRequest({
  userId,
  requestedBy = '',
  resetType = 'admin_temporary',
  deliveryChannel = 'manual',
  deliveryTarget = '',
  temporaryPasswordHash = '',
  expiresAt = '',
  metadata = {},
}) {
  const timestamp = nowIso()

  db.prepare(
    `
      insert into password_reset_requests (
        id,
        user_id,
        requested_by,
        reset_type,
        delivery_channel,
        delivery_target,
        temporary_password_hash,
        status,
        expires_at,
        metadata_json,
        created_at,
        updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    crypto.randomUUID(),
    userId,
    requestedBy || null,
    resetType,
    deliveryChannel,
    deliveryTarget || null,
    temporaryPasswordHash || null,
    'issued',
    expiresAt || null,
    JSON.stringify(metadata || {}),
    timestamp,
    timestamp,
  )
}

function completePasswordResetRequests(userId) {
  const timestamp = nowIso()

  db.prepare(
    `
      update password_reset_requests
      set status = 'completed',
          used_at = coalesce(used_at, ?),
          completed_at = ?,
          updated_at = ?
      where user_id = ?
        and status = 'issued'
    `,
  ).run(timestamp, timestamp, timestamp, userId)
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

app.get('/', (request, response) => {
  const protocol = request.protocol || 'http'
  const hostname = request.hostname || 'localhost'
  const frontendUrl = `${protocol}://${hostname}:${webPort}`
  const healthUrl = `${protocol}://${hostname}:${port}/api/health`

  response
    .status(200)
    .type('html')
    .send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Unified MSEDCL Local API</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        background: #f4f1e8;
        color: #1d2b34;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(190, 217, 197, 0.45), transparent 38%),
          linear-gradient(180deg, #f7f3ea 0%, #efe5cf 100%);
      }
      main {
        width: min(680px, calc(100vw - 32px));
        padding: 28px;
        border-radius: 24px;
        background: rgba(255, 255, 255, 0.92);
        box-shadow: 0 24px 60px rgba(47, 62, 70, 0.14);
      }
      h1 {
        margin: 0 0 10px;
        font-size: clamp(1.8rem, 3vw, 2.4rem);
      }
      p {
        margin: 0 0 16px;
        line-height: 1.6;
      }
      .eyebrow {
        margin-bottom: 10px;
        font-size: 0.82rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #6b7d58;
      }
      .grid {
        display: grid;
        gap: 14px;
        margin: 22px 0;
      }
      .card {
        padding: 16px 18px;
        border-radius: 16px;
        background: #f9f6ef;
        border: 1px solid #e4d8be;
      }
      a {
        color: #0f5c7a;
        font-weight: 600;
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      code {
        padding: 2px 6px;
        border-radius: 6px;
        background: #edf2f4;
        font-family: Consolas, "Courier New", monospace;
      }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">Local Development</p>
      <h1>Unified MSEDCL API server is running.</h1>
      <p>
        Port <code>${port}</code> ha backend/API sathi aahe. Browser UI sathi frontend
        Vite app <code>${webPort}</code> port var open kara.
      </p>
      <div class="grid">
        <section class="card">
          <strong>Open frontend</strong>
          <p><a href="${frontendUrl}" target="_blank" rel="noreferrer">${frontendUrl}</a></p>
        </section>
        <section class="card">
          <strong>API health</strong>
          <p><a href="${healthUrl}" target="_blank" rel="noreferrer">${healthUrl}</a></p>
        </section>
      </div>
      <p>
        Quick tip: login UI <a href="${frontendUrl}" target="_blank" rel="noreferrer">frontend page</a>
        var available aahe; <code>http://localhost:${port}</code> direct browser API endpoint aahe.
      </p>
    </main>
  </body>
</html>`)
})

app.get('/api/health', (_, response) => {
  response.json({
    ok: true,
    mode: 'local-sql',
    databasePath: dbPath,
    defaultAdmin: {
      username: defaultAdminUsername,
      email: defaultAdminEmail,
      password: defaultAdminPassword,
    },
  })
})

app.post('/api/auth/signup', (request, response) => {
  response.status(403).json({
    error:
      'Self signup local mode madhye off aahe. User create sathi Main Admin kiwa Substation Admin cha vapar kara.',
  })
})

app.post('/api/auth/login', (request, response) => {
  const identifier = String(
    request.body?.identifier || request.body?.username || request.body?.email || '',
  ).trim()
  const password = String(request.body?.password || '')

  if (!identifier || !password) {
    response.status(400).json({
      error: 'Username/User ID ani password required aahe.',
    })
    return
  }

  const user = getUserByIdentifier(identifier)

  if (!user || !verifyPassword(password, user.password_hash)) {
    response.status(401).json({ error: 'Username/User ID kiwa password chukicha aahe.' })
    return
  }

  if (!user.is_active) {
    response.status(403).json({ error: 'Inactive user login karu shakat nahi.' })
    return
  }

  const session = createSession(user)

  audit('login', user, {
    source: 'local-sql',
    identifier: normalizeIdentifier(identifier),
  })

  response.json({
    session,
    profile: mapUserRow(loadUserById(user.id) || user),
  })
})

app.get('/api/auth/session', authenticate, (request, response) => {
  response.json({
    session: mapSessionPayload(request.user, request.sessionToken),
    profile: request.user,
  })
})

app.get('/api/session/activity', authenticate, (request, response) => {
  const mainAdminUser = isMainAdminRole(request.user.role)
  const currentSession = db
    .prepare(
      `
        select s.token, s.user_id, s.created_at, s.expires_at, u.username, u.email, u.full_name, u.role
        from sessions s
        join users u on u.id = s.user_id
        where s.token = ?
      `,
    )
    .get(request.sessionToken)

  const activeSessions = db
    .prepare(
      mainAdminUser
        ? `
            select s.token, s.user_id, s.created_at, s.expires_at, u.username, u.email, u.full_name, u.role
            from sessions s
            join users u on u.id = s.user_id
            where s.expires_at > ?
            order by s.created_at desc
            limit 25
          `
        : `
            select s.token, s.user_id, s.created_at, s.expires_at, u.username, u.email, u.full_name, u.role
            from sessions s
            join users u on u.id = s.user_id
            where s.expires_at > ? and s.user_id = ?
            order by s.created_at desc
            limit 25
          `,
    )
    .all(
      ...(mainAdminUser ? [nowIso()] : [nowIso(), request.user.id]),
    )
    .map(mapSessionActivityRow)

  const recentLoginAudit = db
    .prepare(
      mainAdminUser
        ? `
            select id, user_id, username, email, action, context_json, created_at
            from login_audit
            order by created_at desc
            limit 20
          `
        : `
            select id, user_id, username, email, action, context_json, created_at
            from login_audit
            where user_id = ?
            order by created_at desc
            limit 20
          `,
    )
    .all(...(mainAdminUser ? [] : [request.user.id]))
    .map((row) => ({
      id: row.id,
      userId: row.user_id || '',
      username: row.username || '',
      email: row.email || '',
      action: row.action,
      context: parseJson(row.context_json, {}),
      createdAt: row.created_at,
    }))

  const recentAppAudit = db
    .prepare(
      mainAdminUser
        ? `
            select *
            from app_audit_events
            order by created_at desc
            limit 20
          `
        : `
            select *
            from app_audit_events
            where actor_id = ?
            order by created_at desc
            limit 20
          `,
    )
    .all(...(mainAdminUser ? [] : [request.user.id]))
    .map(mapAppAuditEventRow)

  response.json({
    currentSession: mapSessionActivityRow(currentSession),
    activeSessions,
    recentLoginAudit,
    recentAppAudit,
  })
})

app.post('/api/auth/logout', authenticate, (request, response) => {
  db.prepare('delete from sessions where token = ?').run(request.sessionToken)

  audit('logout', request.user, {
    source: 'local-sql',
  })

  response.json({
    ok: true,
  })
})

app.post('/api/auth/change-password', authenticate, (request, response) => {
  const validationError = requireFields(['currentPassword', 'newPassword'], request.body)

  if (validationError) {
    response.status(400).json({ error: validationError })
    return
  }

  const currentUser = loadUserById(request.user.id)

  if (!currentUser || !verifyPassword(request.body.currentPassword, currentUser.password_hash)) {
    response.status(400).json({ error: 'Current password valid nahi.' })
    return
  }

  try {
    validatePasswordStrength(request.body.newPassword)
  } catch (error) {
    response.status(400).json({ error: error.message })
    return
  }

  const timestamp = nowIso()

  db.prepare(
    `
      update users
      set password_hash = ?,
          must_change_password = 0,
          password_changed_at = ?,
          updated_by = ?,
          updated_at = ?
      where id = ?
    `,
  ).run(
    hashPassword(request.body.newPassword),
    timestamp,
    request.user.id,
    timestamp,
    request.user.id,
  )

  completePasswordResetRequests(request.user.id)

  audit('password_changed_self', request.user, {
    source: 'local-sql',
  })

  appAudit('user_password_changed', request.user, {
    userId: request.user.id,
    selfService: true,
  })

  response.json({
    ok: true,
    message: 'Password successfully update zala.',
  })
})

app.post('/api/auth/forgot-password', (request, response) => {
  response.status(400).json({
    error:
      'Self-service forgot password local mode madhye available nahi. Main Admin kiwa Substation Admin temporary password reset karu shakto.',
  })
})

app.post('/api/auth/reset-password', (request, response) => {
  response.status(400).json({
    error:
      'Direct recovery token reset local mode madhye off aahe. Temporary password reset nantar user Session page varun password change karu shakel.',
  })
})

app.get('/api/admin/users', authenticate, requireUserManager, (request, response) => {
  const search = String(request.query.search || '').trim().toLowerCase()
  const roleFilter = normalizeUserRole(request.query.role || '')
  const statusFilter = String(request.query.status || '').trim().toLowerCase()
  const requestedSubstationId = String(request.query.substationId || '').trim()
  const page = Math.max(1, Number.parseInt(request.query.page || '1', 10) || 1)
  const pageSize = Math.min(
    100,
    Math.max(1, Number.parseInt(request.query.pageSize || '20', 10) || 20),
  )
  const actorSubstationId = getScopedSubstationId(request.user)
  const actorAssignableRoles = new Set(
    getAssignableRolesForActor(request.user.role).map((item) => item.value),
  )
  const whereClauses = ['u.deleted_at is null']
  const params = []

  if (!canManageAllUsers(request.user.role)) {
    if (!actorSubstationId) {
      response.json({
        users: [],
        pagination: { page, pageSize, total: 0, totalPages: 0 },
      })
      return
    }

    whereClauses.push('u.substation_id = ?')
    params.push(actorSubstationId)
    whereClauses.push(`u.role in (${Array.from(actorAssignableRoles).map(() => '?').join(',')})`)
    params.push(...actorAssignableRoles)
  } else if (requestedSubstationId) {
    whereClauses.push('u.substation_id = ?')
    params.push(requestedSubstationId)
  }

  if (roleFilter && actorAssignableRoles.has(roleFilter)) {
    whereClauses.push('u.role = ?')
    params.push(roleFilter)
  }

  if (statusFilter === 'active') {
    whereClauses.push('u.is_active = 1')
  } else if (statusFilter === 'inactive') {
    whereClauses.push('u.is_active = 0')
  }

  if (search) {
    whereClauses.push(
      `(lower(u.username) like ?
        or lower(coalesce(u.full_name, '')) like ?
        or lower(coalesce(u.phone, '')) like ?
        or lower(coalesce(s.name, '')) like ?)`,
    )
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`)
  }

  const whereSql = whereClauses.length ? `where ${whereClauses.join(' and ')}` : ''
  const totalRow = db
    .prepare(
      `
        select count(*) as total
        from users u
        left join substations s on s.id = u.substation_id
        ${whereSql}
      `,
    )
    .get(...params)
  const total = Number(totalRow?.total || 0)
  const totalPages = total ? Math.ceil(total / pageSize) : 0
  const offset = (page - 1) * pageSize
  const rows = db
    .prepare(
      `
        select
          u.*,
          s.name as substation_name,
          cb.full_name as created_by_name
        from users u
        left join substations s on s.id = u.substation_id
        left join users cb on cb.id = u.created_by
        ${whereSql}
        order by u.created_at desc
        limit ? offset ?
      `,
    )
    .all(...params, pageSize, offset)

  response.json({
    users: rows.map(mapUserRow),
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
    },
  })
})

app.get('/api/admin/login-audit', authenticate, requireMainAdmin, (_, response) => {
  const entries = db
    .prepare(
      `
        select
          id,
          user_id,
          username,
          email,
          action,
          context_json,
          created_at
        from login_audit
        order by created_at desc
        limit 200
      `,
    )
    .all()
    .map((row) => ({
      id: row.id,
      userId: row.user_id || '',
      username: row.username || '',
      email: row.email || '',
      action: row.action,
      context: parseJson(row.context_json, {}),
      createdAt: row.created_at,
    }))

  response.json({
    entries,
  })
})

app.get('/api/admin/app-audit-events', authenticate, requireMainAdmin, (_, response) => {
  const entries = db
    .prepare(
      `
        select
          id,
          action,
          actor_id,
          actor_email,
          context_json,
          created_at
        from app_audit_events
        order by created_at desc
        limit 500
      `,
    )
    .all()
    .map(mapAppAuditEventRow)

  response.json({ entries })
})

app.post('/api/app-audit-events', authenticate, (request, response) => {
  const action = String(request.body.action || '').trim()

  if (!action) {
    response.status(400).json({ error: 'Audit action required aahe.' })
    return
  }

  const eventId = String(request.body.id || crypto.randomUUID()).trim()
  const actorId = String(
    request.body.actorId || request.user.id || request.user.auth_user_id || '',
  ).trim()
  const actorEmail = String(
    request.body.actorEmail || request.user.email || '',
  ).trim()
  const createdAt = String(request.body.createdAt || nowIso()).trim()
  const context =
    request.body.context && typeof request.body.context === 'object'
      ? request.body.context
      : {}

  db.prepare(
    `
      insert into app_audit_events (
        id,
        action,
        actor_id,
        actor_email,
        context_json,
        created_at
      ) values (?, ?, ?, ?, ?, ?)
    `,
  ).run(
    eventId,
    action,
    actorId || null,
    actorEmail || null,
    JSON.stringify(context),
    createdAt,
  )

  response.status(201).json({
    entry: mapAppAuditEventRow(
      db
        .prepare(
          `
            select *
            from app_audit_events
            where id = ?
          `,
        )
        .get(eventId),
    ),
  })
})

app.get('/api/admin/user-substation-mappings', authenticate, requireMainAdmin, (_, response) => {
  const mappings = db
    .prepare(
      `
        select
          id,
          user_id,
          substation_id,
          created_at,
          updated_at
        from user_substation_mappings
        order by updated_at desc, created_at desc
      `,
    )
    .all()
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      substationId: row.substation_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))

  response.json({ mappings })
})

app.post('/api/admin/user-substation-mappings', authenticate, requireMainAdmin, (request, response) => {
  const userId = String(request.body.userId || '').trim()
  const substationId = String(request.body.substationId || '').trim()

  if (!userId || !substationId) {
    response.status(400).json({ error: 'User ani substation required aahe.' })
    return
  }

  const user = loadUserById(userId)
  const substation = db.prepare('select * from substations where id = ?').get(substationId)

  if (!user) {
    response.status(404).json({ error: 'User sapadla nahi.' })
    return
  }

  if (!substation) {
    response.status(404).json({ error: 'Substation sapadli nahi.' })
    return
  }

  const timestamp = nowIso()
  db.prepare(
    `
      update users
      set substation_id = ?,
          updated_by = ?,
          updated_at = ?
      where id = ?
    `,
  ).run(substationId, request.user.id, timestamp, userId)

  syncUserSubstationMapping(userId, substationId)

  appAudit('user_substation_changed', request.user, {
    userId,
    substationId,
  })

  const existing = db
    .prepare(
      `
        select *
        from user_substation_mappings
        where user_id = ? and substation_id = ?
      `,
    )
    .get(userId, substationId)

  response.status(201).json({
    mapping: {
      id: existing?.id || '',
      userId,
      substationId,
      createdAt: existing?.created_at || timestamp,
      updatedAt: existing?.updated_at || timestamp,
    },
  })
})

app.delete(
  '/api/admin/user-substation-mappings/:mappingId',
  authenticate,
  requireMainAdmin,
  (request, response) => {
    const existing = db
      .prepare(
        `
          select *
          from user_substation_mappings
          where id = ?
        `,
      )
      .get(request.params.mappingId)

    if (!existing) {
      response.status(404).json({ error: 'Mapping sapadla nahi.' })
      return
    }

    db.prepare('delete from user_substation_mappings where id = ?').run(existing.id)
    db.prepare(
      `
        update users
        set substation_id = '',
            updated_by = ?,
            updated_at = ?
        where id = ?
      `,
    ).run(request.user.id, nowIso(), existing.user_id)

    audit('user_substation_mapping_deleted', request.user, {
      mappingId: existing.id,
      userId: existing.user_id,
      substationId: existing.substation_id,
    })

    response.json({ ok: true })
  },
)

app.post('/api/admin/users', authenticate, requireUserManager, (request, response) => {
  const validationError = requireFields(['fullName', 'username', 'password'], request.body)

  if (validationError) {
    response.status(400).json({ error: validationError })
    return
  }

  try {
    validatePasswordStrength(request.body.password)
  } catch (error) {
    response.status(400).json({ error: error.message })
    return
  }

  const username = normalizeUsername(request.body.username)

  if (!username) {
    response.status(400).json({ error: 'Valid username required aahe.' })
    return
  }

  if (usernameExists(username)) {
    response.status(409).json({ error: 'Ha username already use madhye aahe.' })
    return
  }

  const mobile = normalizeMobile(request.body.mobile || request.body.phone)

  if (mobile && mobileExists(mobile)) {
    response.status(409).json({ error: 'Ha mobile number already use madhye aahe.' })
    return
  }

  const assignableRoles = getAssignableRolesForActor(request.user.role).map(
    (item) => item.value,
  )
  const requestedRole = normalizeUserRole(request.body.role || ROLE_KEYS.NORMAL_USER)
  const role = assignableRoles.includes(requestedRole)
    ? requestedRole
    : ROLE_KEYS.NORMAL_USER
  const requestedSubstationId = isMainAdminRole(request.user.role)
    ? String(request.body.substationId || '').trim()
    : getScopedSubstationId(request.user)

  if (!canAccessAllSubstations(role) && !requestedSubstationId) {
    response.status(400).json({ error: 'Assigned substation required aahe.' })
    return
  }

  if (requestedSubstationId) {
    const substation = db
      .prepare(
        `
          select id
          from substations
          where id = ?
        `,
      )
      .get(requestedSubstationId)

    if (!substation) {
      response.status(404).json({ error: 'Assigned substation sapadli nahi.' })
      return
    }
  }

  const userId = crypto.randomUUID()
  const timestamp = nowIso()
  const allowDelete =
    role === ROLE_KEYS.SUPER_ADMIN ||
    role === ROLE_KEYS.SUBSTATION_ADMIN ||
    request.body.allowDelete === true
  const permissions = buildModulePermissionPayload(role, { allowDelete })
  const user = {
    id: userId,
    username,
    email: normalizeIdentifier(request.body.email)
      ? String(request.body.email).trim().toLowerCase()
      : buildPlaceholderEmail(username, userId),
    full_name: String(request.body.fullName).trim(),
    phone: mobile,
    role,
    substation_id: canAccessAllSubstations(role) ? '' : requestedSubstationId,
    is_active: request.body.isActive === false ? 0 : 1,
    approval_status:
      request.body.isActive === false ? 'inactive' : 'approved',
    created_by: request.user.id,
    updated_by: request.user.id,
    must_change_password: 1,
    password_changed_at: timestamp,
    module_permissions_json: JSON.stringify(permissions),
    created_at: timestamp,
    updated_at: timestamp,
  }

  db.prepare(
    `
      insert into users (
        id,
        username,
        email,
        password_hash,
        full_name,
        phone,
        role,
        substation_id,
        created_by,
        updated_by,
        must_change_password,
        password_changed_at,
        module_permissions_json,
        is_active,
        approval_status,
        created_at,
        updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    user.id,
    user.username,
    user.email,
    hashPassword(request.body.password),
    user.full_name,
    user.phone,
    user.role,
    user.substation_id,
    user.created_by,
    user.updated_by,
    user.must_change_password,
    user.password_changed_at,
    user.module_permissions_json,
    user.is_active,
    user.approval_status,
    user.created_at,
    user.updated_at,
  )

  syncUserSubstationMapping(user.id, user.substation_id)

  appAudit('user_created', request.user, {
    targetUserId: user.id,
    username: user.username,
    role: user.role,
    substationId: user.substation_id,
  })

  response.status(201).json({
    user: mapUserRow(loadUserById(user.id)),
    message: 'User create zala.',
  })
})

app.put('/api/admin/users/:userId', authenticate, requireUserManager, (request, response) => {
  const existingUser = loadUserById(request.params.userId)

  if (!existingUser || existingUser.deleted_at) {
    response.status(404).json({ error: 'User sapadla nahi.' })
    return
  }

  if (!canActorManageTargetUser(request.user, existingUser)) {
    response.status(403).json({ error: 'Ha user manage karaycha access nahi.' })
    return
  }

  const assignableRoles = getAssignableRolesForActor(request.user.role).map(
    (item) => item.value,
  )
  const requestedRole = normalizeUserRole(request.body.role || existingUser.role)
  const nextRole = assignableRoles.includes(requestedRole)
    ? requestedRole
    : normalizeUserRole(existingUser.role)
  const nextUsername = normalizeUsername(request.body.username || existingUser.username)
  const nextMobile = normalizeMobile(
    request.body.mobile ?? request.body.phone ?? existingUser.phone,
  )
  const nextSubstationId = isMainAdminRole(request.user.role)
    ? String(request.body.substationId ?? existingUser.substation_id ?? '').trim()
    : String(existingUser.substation_id || '').trim()

  if (!nextUsername) {
    response.status(400).json({ error: 'Valid username required aahe.' })
    return
  }

  if (usernameExists(nextUsername, existingUser.id)) {
    response.status(409).json({ error: 'Ha username already use madhye aahe.' })
    return
  }

  if (nextMobile && mobileExists(nextMobile, existingUser.id)) {
    response.status(409).json({ error: 'Ha mobile number already use madhye aahe.' })
    return
  }

  if (!canAccessAllSubstations(nextRole) && !nextSubstationId) {
    response.status(400).json({ error: 'Assigned substation required aahe.' })
    return
  }

  if (nextSubstationId) {
    const substation = db
      .prepare(
        `
          select id
          from substations
          where id = ?
        `,
      )
      .get(nextSubstationId)

    if (!substation) {
      response.status(404).json({ error: 'Assigned substation sapadli nahi.' })
      return
    }
  }

  const existingPermissions = parseJson(existingUser.module_permissions_json, {})
  const permissions = applyDeletePermissionOverride(
    nextRole,
    existingPermissions,
    typeof request.body.allowDelete === 'boolean'
      ? request.body.allowDelete
      : undefined,
  )
  const isActive = request.body.isActive === false ? 0 : 1
  const approvalStatus = isActive ? 'approved' : 'inactive'
  const timestamp = nowIso()

  db.prepare(
    `
      update users
      set username = ?,
          full_name = ?,
          phone = ?,
          role = ?,
          substation_id = ?,
          module_permissions_json = ?,
          is_active = ?,
          approval_status = ?,
          disabled_at = ?,
          disabled_by = ?,
          updated_by = ?,
          updated_at = ?
      where id = ?
    `,
  ).run(
    nextUsername,
    String(request.body.fullName || existingUser.full_name || '').trim(),
    nextMobile,
    nextRole,
    canAccessAllSubstations(nextRole) ? '' : nextSubstationId,
    JSON.stringify(permissions),
    isActive,
    approvalStatus,
    isActive ? null : existingUser.disabled_at || timestamp,
    isActive ? null : existingUser.disabled_by || request.user.id,
    request.user.id,
    timestamp,
    existingUser.id,
  )

  syncUserSubstationMapping(
    existingUser.id,
    canAccessAllSubstations(nextRole) ? '' : nextSubstationId,
  )

  appAudit('user_updated', request.user, {
    targetUserId: existingUser.id,
    username: nextUsername,
    roleChanged: normalizeUserRole(existingUser.role) !== nextRole,
    substationChanged:
      String(existingUser.substation_id || '') !==
      String(canAccessAllSubstations(nextRole) ? '' : nextSubstationId),
    activeChanged: Boolean(existingUser.is_active) !== Boolean(isActive),
  })

  if (
    normalizeUserRole(existingUser.role) === ROLE_KEYS.SUBSTATION_ADMIN &&
    Boolean(existingUser.is_active) &&
    !Boolean(isActive)
  ) {
    const impactedUsers = cascadeDisableManagedUsers(existingUser.id, request.user.id)
    appAudit('user_cascade_deactivated', request.user, {
      targetUserId: existingUser.id,
      impactedUsers,
    })
  }

  response.json({
    user: mapUserRow(loadUserById(existingUser.id)),
  })
})

app.post(
  '/api/admin/users/:userId/reset-password',
  authenticate,
  requireUserManager,
  (request, response) => {
    const existingUser = loadUserById(request.params.userId)

    if (!existingUser || existingUser.deleted_at) {
      response.status(404).json({ error: 'User sapadla nahi.' })
      return
    }

    if (!canActorManageTargetUser(request.user, existingUser)) {
      response.status(403).json({ error: 'Ya user cha password reset karaycha access nahi.' })
      return
    }

    try {
      validatePasswordStrength(request.body.temporaryPassword)
    } catch (error) {
      response.status(400).json({ error: error.message })
      return
    }

    const timestamp = nowIso()
    const passwordHash = hashPassword(request.body.temporaryPassword)

    db.prepare(
      `
        update users
        set password_hash = ?,
            must_change_password = 1,
            updated_by = ?,
            updated_at = ?
        where id = ?
      `,
    ).run(passwordHash, request.user.id, timestamp, existingUser.id)

    db.prepare('delete from sessions where user_id = ?').run(existingUser.id)

    recordPasswordResetRequest({
      userId: existingUser.id,
      requestedBy: request.user.id,
      temporaryPasswordHash: passwordHash,
      metadata: {
        forcedPasswordChange: true,
      },
    })

    appAudit('user_password_reset', request.user, {
      targetUserId: existingUser.id,
      username: existingUser.username || '',
      substationId: existingUser.substation_id || '',
    })

    response.json({
      ok: true,
      message: 'Temporary password set zala. User la first login nantar password change karava lagel.',
      mustChangePassword: true,
    })
  },
)

app.delete('/api/admin/users/:userId', authenticate, requireUserManager, (request, response) => {
  const existingUser = loadUserById(request.params.userId)

  if (!existingUser || existingUser.deleted_at) {
    response.status(404).json({ error: 'User sapadla nahi.' })
    return
  }

  if (existingUser.id === request.user.id) {
    response.status(400).json({ error: 'Swatacha account delete karu shakat nahi.' })
    return
  }

  if (!canActorManageTargetUser(request.user, existingUser)) {
    response.status(403).json({ error: 'Ha user delete karaycha access nahi.' })
    return
  }

  const timestamp = nowIso()

  db.prepare(
    `
      update users
      set is_active = 0,
          approval_status = 'deleted',
          deleted_at = ?,
          deleted_by = ?,
          disabled_at = coalesce(disabled_at, ?),
          disabled_by = coalesce(disabled_by, ?),
          updated_by = ?,
          updated_at = ?
      where id = ?
    `,
  ).run(
    timestamp,
    request.user.id,
    timestamp,
    request.user.id,
    request.user.id,
    timestamp,
    existingUser.id,
  )

  db.prepare('delete from sessions where user_id = ?').run(existingUser.id)

  appAudit('user_deleted', request.user, {
    targetUserId: existingUser.id,
    username: existingUser.username || '',
    substationId: existingUser.substation_id || '',
  })

  if (normalizeUserRole(existingUser.role) === ROLE_KEYS.SUBSTATION_ADMIN) {
    const impactedUsers = cascadeDisableManagedUsers(existingUser.id, request.user.id)
    appAudit('user_cascade_deactivated', request.user, {
      targetUserId: existingUser.id,
      impactedUsers,
    })
  }

  response.json({ ok: true })
})

app.get('/api/dashboard/summary', authenticate, (request, response) => {
  const mainAdminUser = canAccessAllSubstations(request.user.role)
  const allowedSubstationIds = getAllowedSubstationIdsForUser(request.user)
  const substationCountRow =
    mainAdminUser || !Array.isArray(allowedSubstationIds)
      ? db
          .prepare(
            `
              select count(*) as count
              from substations
              where is_active = 1
            `,
          )
          .get()
      : {
          count: allowedSubstationIds.length,
        }
  const employeeRows = (
    mainAdminUser
      ? db.prepare(`select * from employees`).all()
      : Array.isArray(allowedSubstationIds) && !allowedSubstationIds.length
        ? []
        : db
            .prepare(
              `
                select *
                from employees
                where substation_id in (${(allowedSubstationIds || []).map(() => '?').join(',')})
              `,
            )
            .all(...(allowedSubstationIds || []))
  ).map(mapEmployeeRow)

  const now = nowIso()
  const activeSessionsCountRow = db
    .prepare(
      mainAdminUser
        ? `
            select count(*) as count
            from sessions
            where expires_at > ?
          `
        : `
            select count(*) as count
            from sessions
            where expires_at > ? and user_id = ?
          `,
    )
    .get(
      ...(mainAdminUser ? [now] : [now, request.user.id]),
    )

  const notices = db
    .prepare(
      `
        select *
        from notices
        order by updated_at desc, created_at desc
      `,
    )
    .all()
    .map(mapNoticeRow)
    .filter((notice) => isNoticeVisibleToUser(notice, request.user))

  const openFeedbackCountRow = db
    .prepare(
      mainAdminUser
        ? `
            select count(*) as count
            from feedback_entries
            where status not in ('resolved', 'closed')
          `
        : `
            select count(*) as count
            from feedback_entries
            where status not in ('resolved', 'closed')
              and owner_user_id = ?
          `,
    )
    .get(...(mainAdminUser ? [] : [request.user.id]))

  const recentLoginsCountRow = db
    .prepare(
      mainAdminUser
        ? `
            select count(*) as count
            from login_audit
            where created_at >= datetime('now', '-1 day')
          `
        : `
            select count(*) as count
            from login_audit
            where created_at >= datetime('now', '-1 day')
              and user_id = ?
          `,
    )
    .get(...(mainAdminUser ? [] : [request.user.id]))

  response.json({
    summary: {
      substations: substationCountRow?.count ?? 0,
      employees: employeeRows.length,
      operators: employeeRows.filter((item) => item.employeeType === 'operator')
        .length,
      activeEmployees: employeeRows.filter((item) => item.isActive).length,
      activeSessions: activeSessionsCountRow?.count ?? 0,
      activeNotices: notices.length,
      openFeedback: openFeedbackCountRow?.count ?? 0,
      recentLogins24h: recentLoginsCountRow?.count ?? 0,
    },
  })
})

app.get('/api/workspace-config', authenticate, (request, response) => {
  const allowedSubstationIds = getAllowedSubstationIdsForUser(request.user)
  const adminUser = canAccessAllSubstations(request.user.role)

  const masters = Object.fromEntries(
    Array.from(allowedMasterTypes).map((type) => [
      type,
      db
        .prepare(
          `
            select *
            from master_records
            where type = ?
            order by updated_at desc, created_at desc
          `,
        )
        .all(type)
        .map(mapMasterRecordRow)
        .filter((item) => {
          if (adminUser || type === 'divisions' || !allowedSubstationIds) {
            return true
          }

          const recordSubstationId = String(item.substationId || item.substation_id || '').trim()

          if (!recordSubstationId) {
            return true
          }

          return allowedSubstationIds.includes(recordSubstationId)
        }),
    ]),
  )

  const settingsRow = db
    .prepare(
      `
        select *
        from app_settings
        where key = 'workspace_settings'
      `,
    )
    .get()

  response.json({
    masters,
    settings: parseJson(settingsRow?.value_json, {}),
    updatedAt: settingsRow?.updated_at || '',
  })
})

app.post('/api/masters/:type', authenticate, requireMainAdmin, (request, response) => {
  const type = String(request.params.type || '').trim()

  if (!allowedMasterTypes.has(type)) {
    response.status(400).json({ error: 'Master type valid nahi.' })
    return
  }

  const timestamp = nowIso()
  const recordId = String(request.body.id || crypto.randomUUID()).trim()
  const existing = db
    .prepare(
      `
        select *
        from master_records
        where id = ? and type = ?
      `,
    )
    .get(recordId, type)

  const payloadJson = JSON.stringify({
    ...request.body,
    id: recordId,
    createdBy: existing?.created_by || request.user.id,
  })

  if (existing) {
    db.prepare(
      `
        update master_records
        set payload_json = ?,
            updated_at = ?
        where id = ? and type = ?
      `,
    ).run(payloadJson, timestamp, existing.id, type)
  } else {
    db.prepare(
      `
        insert into master_records (
          id,
          type,
          created_by,
          payload_json,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?)
      `,
    ).run(
      recordId,
      type,
      request.user.id,
      payloadJson,
      timestamp,
      timestamp,
    )
  }

  appAudit(existing ? 'master_record_updated_server' : 'master_record_created_server', request.user, {
    type,
    recordId,
  })

  response.status(existing ? 200 : 201).json({
    record: mapMasterRecordRow(
      db
        .prepare(
          `
            select *
            from master_records
            where id = ? and type = ?
          `,
        )
        .get(recordId, type),
    ),
  })
})

app.delete('/api/masters/:type/:recordId', authenticate, requireMainAdmin, (request, response) => {
  const type = String(request.params.type || '').trim()

  if (!allowedMasterTypes.has(type)) {
    response.status(400).json({ error: 'Master type valid nahi.' })
    return
  }

  const existing = db
    .prepare(
      `
        select *
        from master_records
        where id = ? and type = ?
      `,
    )
    .get(request.params.recordId, type)

  if (!existing) {
    response.status(404).json({ error: 'Master record sapadla nahi.' })
    return
  }

  db.prepare('delete from master_records where id = ? and type = ?').run(existing.id, type)

  appAudit('master_record_deleted_server', request.user, {
    type,
    recordId: existing.id,
  })

  response.json({ ok: true })
})

app.post('/api/settings', authenticate, requireMainAdmin, (request, response) => {
  const valueJson = JSON.stringify(request.body || {})
  const timestamp = nowIso()
  const existing = db
    .prepare(
      `
        select *
        from app_settings
        where key = 'workspace_settings'
      `,
    )
    .get()

  if (existing) {
    db.prepare(
      `
        update app_settings
        set value_json = ?,
            updated_by = ?,
            updated_at = ?
        where key = 'workspace_settings'
      `,
    ).run(valueJson, request.user.id, timestamp)
  } else {
    db.prepare(
      `
        insert into app_settings (
          key,
          value_json,
          updated_by,
          updated_at
        ) values (?, ?, ?, ?)
      `,
    ).run('workspace_settings', valueJson, request.user.id, timestamp)
  }

  appAudit('settings_saved_server', request.user, {
    keys: Object.keys(request.body || {}),
  })

  response.json({
    settings: request.body || {},
    updatedAt: timestamp,
  })
})

app.get('/api/substations', authenticate, (request, response) => {
  const allowedSubstationIds = getAllowedSubstationIdsForUser(request.user)

  const substations = db
    .prepare(
      `
        select *
        from substations
        order by name collate nocase asc
      `,
    )
    .all()
    .map(mapSubstationRow)
    .filter(
      (item) =>
        !allowedSubstationIds || allowedSubstationIds.includes(item.id),
    )

  response.json({ substations })
})

app.post('/api/substations', authenticate, requireMainAdmin, (request, response) => {
  const code = String(request.body.code || '').trim()
  const name = String(request.body.name || '').trim()

  if (!name) {
    response.status(400).json({ error: 'Substation name required aahe.' })
    return
  }

  if (code) {
    const existingCode = db
      .prepare(
        `
          select id
          from substations
          where lower(code) = lower(?)
        `,
      )
      .get(code)

    if (existingCode) {
      response.status(409).json({ error: 'Substation code already exists.' })
      return
    }
  }

  const timestamp = nowIso()
  const record = {
    id: crypto.randomUUID(),
    code,
    name,
    district: String(request.body.district || '').trim(),
    circle: String(request.body.circle || '').trim(),
    metadata_json: JSON.stringify({
      omName: String(request.body.omName || '').trim(),
      subDivisionName: String(request.body.subDivisionName || '').trim(),
      divisionName: String(request.body.divisionName || '').trim(),
      sectionName: String(request.body.sectionName || '').trim(),
    }),
    is_active: request.body.is_active === false ? 0 : 1,
    created_by: request.user.id,
    created_at: timestamp,
    updated_at: timestamp,
  }

  db.prepare(
    `
      insert into substations (
        id,
        code,
        name,
        district,
        circle,
        metadata_json,
        is_active,
        created_by,
        created_at,
        updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    record.id,
    record.code,
    record.name,
    record.district,
    record.circle,
    record.metadata_json,
    record.is_active,
    record.created_by,
    record.created_at,
    record.updated_at,
  )

  response.status(201).json({
    substation: mapSubstationRow(record),
  })
})

app.get('/api/employees', authenticate, (request, response) => {
  const substationId = String(request.query.substationId || '').trim()
  const employeeType = String(request.query.employeeType || '').trim()
  const search = String(request.query.search || '').trim().toLowerCase()

  const allowedSubstationIds = getAllowedSubstationIdsForUser(request.user)
  const mainAdminUser = canAccessAllSubstations(request.user.role)
  const rows =
    mainAdminUser
      ? db.prepare(`select * from employees`).all()
      : Array.isArray(allowedSubstationIds) && !allowedSubstationIds.length
        ? []
        : db
            .prepare(
              `
                select *
                from employees
                where substation_id in (${(allowedSubstationIds || []).map(() => '?').join(',')})
              `,
            )
            .all(...(allowedSubstationIds || []))

  const employees = rows
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
      const rightSr = Number.isInteger(right.srNo)
        ? right.srNo
        : Number.MAX_SAFE_INTEGER

      if (leftSr !== rightSr) {
        return leftSr - rightSr
      }

      return left.full_name.localeCompare(right.full_name)
    })

  response.json({ employees })
})

app.post('/api/employees', authenticate, (request, response) => {
  let payload

  try {
    payload = normalizeEmployeePayload(request.body)
  } catch (error) {
    response.status(400).json({ error: error.message })
    return
  }

  const substation = db
    .prepare(
      `
        select id
        from substations
        where id = ?
      `,
    )
    .get(payload.substationId)

  if (!substation) {
    response.status(404).json({ error: 'Selected substation sapadla nahi.' })
    return
  }

  if (!hasModulePermission(request.user, 'employees', 'create', payload.substationId)) {
    response.status(403).json({ error: 'Ya substation sathi employee create access nahi.' })
    return
  }

  const timestamp = nowIso()
  const record = {
    id: crypto.randomUUID(),
    owner_user_id: request.user.id,
    substation_id: payload.substationId,
    employee_code: payload.employeeCode,
    full_name: payload.fullName,
    designation: payload.designation,
    phone: payload.phone,
    metadata_json: JSON.stringify(payload.metadata),
    created_at: timestamp,
    updated_at: timestamp,
  }

  db.prepare(
    `
      insert into employees (
        id,
        owner_user_id,
        substation_id,
        employee_code,
        full_name,
        designation,
        phone,
        metadata_json,
        created_at,
        updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    record.id,
    record.owner_user_id,
    record.substation_id,
    record.employee_code,
    record.full_name,
    record.designation,
    record.phone,
    record.metadata_json,
    record.created_at,
    record.updated_at,
  )

  response.status(201).json({
    employee: mapEmployeeRow(record),
  })
})

app.put('/api/employees/:employeeId', authenticate, (request, response) => {
  const existing = loadEmployeeById(request.params.employeeId)

  if (!existing) {
    response.status(404).json({ error: 'Employee sapadla nahi.' })
    return
  }

  if (!hasModulePermission(request.user, 'employees', 'update', existing.substation_id)) {
    response.status(403).json({ error: 'Ha employee edit karaycha access nahi.' })
    return
  }

  let payload

  try {
    payload = normalizeEmployeePayload(request.body)
  } catch (error) {
    response.status(400).json({ error: error.message })
    return
  }

  if (!hasModulePermission(request.user, 'employees', 'update', payload.substationId)) {
    response.status(403).json({ error: 'Ya substation sathi employee update access nahi.' })
    return
  }

  db.prepare(
    `
      update employees
      set substation_id = ?,
          employee_code = ?,
          full_name = ?,
          designation = ?,
          phone = ?,
          metadata_json = ?,
          updated_at = ?
      where id = ?
    `,
  ).run(
    payload.substationId,
    payload.employeeCode,
    payload.fullName,
    payload.designation,
    payload.phone,
    JSON.stringify(payload.metadata),
    nowIso(),
    existing.id,
  )

  response.json({
    employee: mapEmployeeRow(loadEmployeeById(existing.id)),
  })
})

app.delete('/api/employees/:employeeId', authenticate, (request, response) => {
  const existing = loadEmployeeById(request.params.employeeId)

  if (!existing) {
    response.status(404).json({ error: 'Employee sapadla nahi.' })
    return
  }

  if (!hasModulePermission(request.user, 'employees', 'delete', existing.substation_id)) {
    response.status(403).json({ error: 'Ha employee delete karaycha access nahi.' })
    return
  }

  db.prepare('delete from employees where id = ?').run(existing.id)

  response.json({
    ok: true,
  })
})

app.get('/api/attendance-sheets', authenticate, (request, response) => {
  const sheetType = String(request.query.sheetType || '').trim()
  const monthKey = String(request.query.monthKey || '').trim()
  const substationId = String(request.query.substationId || '').trim()
  const ownerUserId = String(request.query.ownerUserId || '').trim()
  const allowedSubstationIds = getAllowedSubstationIdsForUser(request.user)

  if (Array.isArray(allowedSubstationIds) && !allowedSubstationIds.length) {
    response.json({ documents: [] })
    return
  }

  const whereClauses = []
  const params = []

  if (Array.isArray(allowedSubstationIds)) {
    whereClauses.push(`substation_id in (${allowedSubstationIds.map(() => '?').join(',')})`)
    params.push(...allowedSubstationIds)
  }

  if (sheetType) {
    whereClauses.push('sheet_type = ?')
    params.push(sheetType)
  }

  if (monthKey) {
    whereClauses.push('month_key = ?')
    params.push(monthKey)
  }

  if (substationId) {
    whereClauses.push('substation_id = ?')
    params.push(substationId)
  }

  if (ownerUserId) {
    whereClauses.push('owner_user_id = ?')
    params.push(ownerUserId)
  }

  const whereSql = whereClauses.length ? `where ${whereClauses.join(' and ')}` : ''
  const documents = db
    .prepare(
      `
        select *
        from attendance_sheets
        ${whereSql}
        order by updated_at desc, created_at desc
      `,
    )
    .all(...params)
    .map(mapAttendanceSheetRow)

  response.json({ documents })
})

app.post('/api/attendance-sheets', authenticate, (request, response) => {
  const document = request.body || {}
  const sheetType = String(document.sheetType || '').trim()
  const monthKey = String(document.monthKey || '').trim()
  const substationId = String(document.substationId || '').trim()
  const timestamp = nowIso()

  if (!sheetType || !monthKey || !substationId) {
    response.status(400).json({ error: 'Sheet type, month, ani substation required aahet.' })
    return
  }

  const existing = document.id ? loadAttendanceSheetById(document.id) : null

  if (document.id && !existing) {
    response.status(404).json({ error: 'Attendance sheet sapadla nahi.' })
    return
  }

  const action = existing ? 'update' : 'create'

  if (!hasModulePermission(request.user, 'attendance', action, substationId)) {
    response.status(403).json({ error: 'Ya substation sathi attendance save access nahi.' })
    return
  }

  if (existing && !hasModulePermission(request.user, 'attendance', 'update', existing.substation_id)) {
    response.status(403).json({ error: 'Ha attendance sheet update karaycha access nahi.' })
    return
  }

  const recordId = existing?.id || document.id || crypto.randomUUID()
  const payloadJson = JSON.stringify({
    ...document,
    id: recordId,
    ownerUserId: existing?.owner_user_id || request.user.id,
  })

  if (existing) {
    db.prepare(
      `
        update attendance_sheets
        set substation_id = ?,
            sheet_type = ?,
            month_key = ?,
            employee_scope = ?,
            payload_json = ?,
            updated_at = ?
        where id = ?
      `,
    ).run(
      substationId,
      sheetType,
      monthKey,
      String(document.employeeScope || existing.employee_scope || '').trim(),
      payloadJson,
      timestamp,
      existing.id,
    )
  } else {
    db.prepare(
      `
        insert into attendance_sheets (
          id,
          owner_user_id,
          substation_id,
          sheet_type,
          month_key,
          employee_scope,
          payload_json,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      recordId,
      request.user.id,
      substationId,
      sheetType,
      monthKey,
      String(document.employeeScope || '').trim(),
      payloadJson,
      timestamp,
      timestamp,
    )
  }

  audit(existing ? 'attendance_sheet_updated' : 'attendance_sheet_created', request.user, {
    documentId: recordId,
    sheetType,
    monthKey,
    substationId,
  })

  response.status(existing ? 200 : 201).json({
    document: mapAttendanceSheetRow(loadAttendanceSheetById(recordId)),
  })
})

app.delete('/api/attendance-sheets/:sheetId', authenticate, (request, response) => {
  const existing = loadAttendanceSheetById(request.params.sheetId)

  if (!existing) {
    response.status(404).json({ error: 'Attendance sheet sapadla nahi.' })
    return
  }

  if (!hasModulePermission(request.user, 'attendance', 'delete', existing.substation_id)) {
    response.status(403).json({ error: 'Ha attendance sheet delete karaycha access nahi.' })
    return
  }

  db.prepare('delete from attendance_sheets where id = ?').run(existing.id)

  audit('attendance_sheet_deleted', request.user, {
    documentId: existing.id,
    substationId: existing.substation_id,
    sheetType: existing.sheet_type,
    monthKey: existing.month_key,
  })

  response.json({ ok: true })
})

app.get('/api/dlr-records', authenticate, (request, response) => {
  const moduleName = String(request.query.moduleName || '').trim()
  const substationId = String(request.query.substationId || '').trim()
  const operationalDate = String(request.query.operationalDate || '').trim()
  const monthKey = String(request.query.monthKey || '').trim()
  const ownerUserId = String(request.query.ownerUserId || '').trim()
  const allowedSubstationIds = getAllowedSubstationIdsForUser(request.user)

  if (Array.isArray(allowedSubstationIds) && !allowedSubstationIds.length) {
    response.json({ records: [] })
    return
  }

  const whereClauses = []
  const params = []

  if (Array.isArray(allowedSubstationIds)) {
    whereClauses.push(`substation_id in (${allowedSubstationIds.map(() => '?').join(',')})`)
    params.push(...allowedSubstationIds)
  }

  if (moduleName) {
    whereClauses.push('module_name = ?')
    params.push(moduleName)
  }

  if (substationId) {
    whereClauses.push('substation_id = ?')
    params.push(substationId)
  }

  if (operationalDate) {
    whereClauses.push('operational_date = ?')
    params.push(operationalDate)
  }

  if (monthKey) {
    whereClauses.push('operational_date like ?')
    params.push(`${monthKey}%`)
  }

  if (ownerUserId) {
    whereClauses.push('owner_user_id = ?')
    params.push(ownerUserId)
  }

  const whereSql = whereClauses.length ? `where ${whereClauses.join(' and ')}` : ''
  const records = db
    .prepare(
      `
        select *
        from dlr_records
        ${whereSql}
        order by updated_at desc, created_at desc
      `,
    )
    .all(...params)
    .map(mapDlrRecordRow)

  response.json({ records })
})

app.post('/api/dlr-records', authenticate, (request, response) => {
  const record = request.body || {}
  const moduleName = String(record.moduleName || '').trim()
  const substationId = String(record.substationId || '').trim()
  const operationalDate = String(record.operationalDate || '').trim()
  const timestamp = nowIso()

  if (!moduleName || !substationId) {
    response.status(400).json({ error: 'Module ani substation required aahet.' })
    return
  }

  const existing = record.id ? loadDlrRecordById(record.id) : null

  if (record.id && !existing) {
    response.status(404).json({ error: 'DLR record sapadla nahi.' })
    return
  }

  const permissionModuleKey = resolveOperationalModuleKey(
    existing?.module_name || moduleName,
  )
  const action = existing ? 'update' : 'create'

  if (!hasModulePermission(request.user, permissionModuleKey, action, substationId)) {
    response.status(403).json({ error: 'Ya substation sathi DLR save access nahi.' })
    return
  }

  if (
    existing &&
    !hasModulePermission(
      request.user,
      permissionModuleKey,
      'update',
      existing.substation_id,
    )
  ) {
    response.status(403).json({ error: 'Ha DLR record update karaycha access nahi.' })
    return
  }

  const recordId = existing?.id || record.id || crypto.randomUUID()
  const recordKey = String(record.recordKey || existing?.record_key || recordId).trim()
  const payloadJson = JSON.stringify({
    ...record,
    id: recordId,
    ownerUserId: existing?.owner_user_id || request.user.id,
  })

  if (existing) {
    db.prepare(
      `
        update dlr_records
        set substation_id = ?,
            module_name = ?,
            record_key = ?,
            operational_date = ?,
            payload_json = ?,
            updated_at = ?
        where id = ?
      `,
    ).run(
      substationId,
      moduleName,
      recordKey,
      operationalDate,
      payloadJson,
      timestamp,
      existing.id,
    )
  } else {
    db.prepare(
      `
        insert into dlr_records (
          id,
          owner_user_id,
          substation_id,
          module_name,
          record_key,
          operational_date,
          payload_json,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      recordId,
      request.user.id,
      substationId,
      moduleName,
      recordKey,
      operationalDate,
      payloadJson,
      timestamp,
      timestamp,
    )
  }

  audit(existing ? 'dlr_record_updated' : 'dlr_record_created', request.user, {
    recordId,
    moduleName,
    substationId,
    operationalDate,
  })

  response.status(existing ? 200 : 201).json({
    record: mapDlrRecordRow(loadDlrRecordById(recordId)),
  })
})

app.delete('/api/dlr-records/:recordId', authenticate, (request, response) => {
  const existing = loadDlrRecordById(request.params.recordId)

  if (!existing) {
    response.status(404).json({ error: 'DLR record sapadla nahi.' })
    return
  }

  if (
    !hasModulePermission(
      request.user,
      resolveOperationalModuleKey(existing.module_name),
      'delete',
      existing.substation_id,
    )
  ) {
    response.status(403).json({ error: 'Ha DLR record delete karaycha access nahi.' })
    return
  }

  db.prepare('delete from dlr_records where id = ?').run(existing.id)

  audit('dlr_record_deleted', request.user, {
    recordId: existing.id,
    moduleName: existing.module_name,
    substationId: existing.substation_id,
    operationalDate: existing.operational_date,
  })

  response.json({ ok: true })
})

app.get('/api/report-snapshots', authenticate, (request, response) => {
  const reportType = String(request.query.reportType || '').trim()
  const filenameBase = String(request.query.filenameBase || '').trim()
  const allowedSubstationIds = getAllowedSubstationIdsForUser(request.user)

  if (Array.isArray(allowedSubstationIds) && !allowedSubstationIds.length) {
    response.json({ snapshots: [] })
    return
  }

  const whereClauses = []
  const params = []

  if (Array.isArray(allowedSubstationIds)) {
    whereClauses.push(`substation_id in (${allowedSubstationIds.map(() => '?').join(',')})`)
    params.push(...allowedSubstationIds)
  }

  if (reportType) {
    whereClauses.push('report_type = ?')
    params.push(reportType)
  }

  if (filenameBase) {
    whereClauses.push('filename_base = ?')
    params.push(filenameBase)
  }

  const whereSql = whereClauses.length ? `where ${whereClauses.join(' and ')}` : ''
  const snapshots = db
    .prepare(
      `
        select *
        from report_snapshots
        ${whereSql}
        order by updated_at desc, created_at desc
        limit 300
      `,
    )
    .all(...params)
    .map(mapReportSnapshotRow)

  response.json({ snapshots })
})

app.post('/api/report-snapshots', authenticate, (request, response) => {
  const snapshot = request.body || {}
  const reportType = String(snapshot.reportType || '').trim()
  const substationId = String(snapshot.substationId || '').trim()

  if (!reportType) {
    response.status(400).json({ error: 'Report type required aahe.' })
    return
  }

  const snapshotId = String(snapshot.id || crypto.randomUUID()).trim()
  const timestamp = nowIso()
  const existing = db
    .prepare(
      `
        select *
        from report_snapshots
        where id = ?
      `,
    )
    .get(snapshotId)

  if (existing && !requireMappedSubstationAccess(request.user, existing.substation_id)) {
    response.status(403).json({ error: 'Ha report snapshot update karaycha access nahi.' })
    return
  }

  const action = existing ? 'update' : 'create'

  if (!hasModulePermission(request.user, 'reports', action, substationId || existing?.substation_id)) {
    response.status(403).json({ error: 'Ya substation sathi report save access nahi.' })
    return
  }

  const metadataJson = JSON.stringify({
    metadata: Array.isArray(snapshot.metadata) ? snapshot.metadata : [],
  })

  if (existing) {
    db.prepare(
      `
        update report_snapshots
        set report_type = ?,
            filename_base = ?,
            export_type = ?,
            orientation = ?,
            title = ?,
            substation_id = ?,
            substation_label = ?,
            month_label = ?,
            metadata_json = ?,
            updated_at = ?
        where id = ?
      `,
    ).run(
      reportType,
      String(snapshot.filenameBase || '').trim(),
      String(snapshot.exportType || '').trim(),
      String(snapshot.orientation || '').trim(),
      String(snapshot.title || '').trim(),
      substationId,
      String(snapshot.substationLabel || '').trim(),
      String(snapshot.monthLabel || '').trim(),
      metadataJson,
      timestamp,
      existing.id,
    )
  } else {
    db.prepare(
      `
        insert into report_snapshots (
          id,
          owner_user_id,
          report_type,
          filename_base,
          export_type,
          orientation,
          title,
          substation_id,
          substation_label,
          month_label,
          metadata_json,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      snapshotId,
      request.user.id,
      reportType,
      String(snapshot.filenameBase || '').trim(),
      String(snapshot.exportType || '').trim(),
      String(snapshot.orientation || '').trim(),
      String(snapshot.title || '').trim(),
      substationId,
      String(snapshot.substationLabel || '').trim(),
      String(snapshot.monthLabel || '').trim(),
      metadataJson,
      timestamp,
      timestamp,
    )
  }

  appAudit('report_snapshot_saved_server', request.user, {
    snapshotId,
    reportType,
    exportType: String(snapshot.exportType || '').trim(),
    filenameBase: String(snapshot.filenameBase || '').trim(),
  })

  response.status(existing ? 200 : 201).json({
    snapshot: mapReportSnapshotRow(
      db
        .prepare(
          `
            select *
            from report_snapshots
            where id = ?
          `,
        )
        .get(snapshotId),
    ),
  })
})

app.get('/api/notices', authenticate, (request, response) => {
  const status = String(request.query.status || '').trim()
  const allowedSubstationIds = getAllowedSubstationIdsForUser(request.user)

  if (Array.isArray(allowedSubstationIds) && !allowedSubstationIds.length) {
    response.json({ notices: [] })
    return
  }

  const whereClauses = []
  const params = []

  if (status) {
    whereClauses.push('status = ?')
    params.push(status)
  }

  if (Array.isArray(allowedSubstationIds)) {
    whereClauses.push(
      `(substation_id = '' or substation_id is null or substation_id in (${allowedSubstationIds.map(() => '?').join(',')}))`,
    )
    params.push(...allowedSubstationIds)
  }

  const whereSql = whereClauses.length ? `where ${whereClauses.join(' and ')}` : ''
  const notices = db
    .prepare(
      `
        select *
        from notices
        ${whereSql}
        order by updated_at desc, created_at desc
      `,
    )
    .all(...params)
    .map(mapNoticeRow)
    .filter((notice) => !status || notice.status === status)
    .filter((notice) => isNoticeVisibleToUser(notice, request.user))

  response.json({ notices })
})

app.post('/api/notices', authenticate, requireMainAdmin, (request, response) => {
  const notice = request.body || {}
  const title = String(notice.title || '').trim()
  const message = String(notice.message || '').trim()

  if (!title || !message) {
    response.status(400).json({ error: 'Notice title ani message required aahe.' })
    return
  }

  const noticeId = String(notice.id || crypto.randomUUID()).trim()
  const timestamp = nowIso()
  const existing = db.prepare('select * from notices where id = ?').get(noticeId)

  if (existing) {
    db.prepare(
      `
        update notices
        set substation_id = ?,
            title = ?,
            message = ?,
            priority = ?,
            status = ?,
            publish_from = ?,
            publish_to = ?,
            updated_at = ?
        where id = ?
      `,
    ).run(
      String(notice.substationId || '').trim(),
      title,
      message,
      String(notice.priority || 'normal').trim(),
      String(notice.status || 'active').trim(),
      String(notice.publishFrom || '').trim(),
      String(notice.publishTo || '').trim(),
      timestamp,
      existing.id,
    )
  } else {
    db.prepare(
      `
        insert into notices (
          id,
          owner_user_id,
          substation_id,
          title,
          message,
          priority,
          status,
          publish_from,
          publish_to,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      noticeId,
      request.user.id,
      String(notice.substationId || '').trim(),
      title,
      message,
      String(notice.priority || 'normal').trim(),
      String(notice.status || 'active').trim(),
      String(notice.publishFrom || '').trim(),
      String(notice.publishTo || '').trim(),
      timestamp,
      timestamp,
    )
  }

  appAudit(existing ? 'notice_updated' : 'notice_created', request.user, {
    noticeId,
    title,
  })

  response.status(existing ? 200 : 201).json({
    notice: mapNoticeRow(
      db
        .prepare(
          `
            select *
            from notices
            where id = ?
          `,
        )
        .get(noticeId),
    ),
  })
})

app.delete('/api/notices/:noticeId', authenticate, requireMainAdmin, (request, response) => {
  const existing = db.prepare('select * from notices where id = ?').get(request.params.noticeId)

  if (!existing) {
    response.status(404).json({ error: 'Notice sapadla nahi.' })
    return
  }

  db.prepare('delete from notices where id = ?').run(existing.id)

  appAudit('notice_deleted', request.user, {
    noticeId: existing.id,
    title: existing.title,
  })

  response.json({ ok: true })
})

app.get('/api/feedback', authenticate, (request, response) => {
  const moduleName = String(request.query.moduleName || '').trim()
  const status = String(request.query.status || '').trim()
  const adminUser = canAccessAllSubstations(request.user.role)

  const feedbackEntries = db
    .prepare(
      `
        select *
        from feedback_entries
        order by updated_at desc, created_at desc
      `,
    )
    .all()
    .map(mapFeedbackRow)
    .filter((entry) => adminUser || entry.ownerUserId === request.user.id)
    .filter((entry) => !moduleName || entry.moduleName === moduleName)
    .filter((entry) => !status || entry.status === status)

  response.json({ feedbackEntries })
})

app.post('/api/feedback', authenticate, (request, response) => {
  const entry = request.body || {}
  const subject = String(entry.subject || '').trim()
  const message = String(entry.message || '').trim()
  const substationId = String(entry.substationId || '').trim()

  if (!subject || !message) {
    response.status(400).json({ error: 'Feedback subject ani message required aahe.' })
    return
  }

  if (!hasModulePermission(request.user, 'feedback', 'create', substationId)) {
    response.status(403).json({ error: 'Ya substation sathi feedback submit access nahi.' })
    return
  }

  const entryId = crypto.randomUUID()
  const timestamp = nowIso()

  db.prepare(
    `
      insert into feedback_entries (
        id,
        owner_user_id,
        substation_id,
        module_name,
        category,
        priority,
        status,
        subject,
        message,
        resolution_note,
        created_at,
        updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    entryId,
    request.user.id,
    substationId,
    String(entry.moduleName || '').trim(),
    String(entry.category || '').trim(),
    String(entry.priority || 'medium').trim(),
    'open',
    subject,
    message,
    '',
    timestamp,
    timestamp,
  )

  appAudit('feedback_created', request.user, {
    feedbackId: entryId,
    moduleName: String(entry.moduleName || '').trim(),
  })

  response.status(201).json({
    feedbackEntry: mapFeedbackRow(
      db
        .prepare(
          `
            select *
            from feedback_entries
            where id = ?
          `,
        )
        .get(entryId),
    ),
  })
})

app.put('/api/feedback/:feedbackId', authenticate, (request, response) => {
  const existing = db
    .prepare(
      `
        select *
        from feedback_entries
        where id = ?
      `,
    )
    .get(request.params.feedbackId)

  if (!existing) {
    response.status(404).json({ error: 'Feedback entry sapadli nahi.' })
    return
  }

  const adminUser = canAccessAllSubstations(request.user.role)
  const ownerUser = existing.owner_user_id === request.user.id

  if (!adminUser && !ownerUser) {
    response.status(403).json({ error: 'Ha feedback edit karaycha access nahi.' })
    return
  }

  if (!adminUser && !hasModulePermission(request.user, 'feedback', 'update', existing.substation_id)) {
    response.status(403).json({ error: 'Ha feedback edit karaycha access nahi.' })
    return
  }

  const nextStatus = adminUser
    ? String(request.body.status || existing.status || 'open').trim()
    : existing.status
  const nextResolutionNote = adminUser
    ? String(request.body.resolutionNote || existing.resolution_note || '').trim()
    : existing.resolution_note
  const nextSubject = ownerUser
    ? String(request.body.subject || existing.subject || '').trim()
    : existing.subject
  const nextMessage = ownerUser
    ? String(request.body.message || existing.message || '').trim()
    : existing.message

  db.prepare(
    `
      update feedback_entries
      set module_name = ?,
          category = ?,
          priority = ?,
          status = ?,
          subject = ?,
          message = ?,
          resolution_note = ?,
          updated_at = ?
      where id = ?
    `,
  ).run(
    String(request.body.moduleName || existing.module_name || '').trim(),
    String(request.body.category || existing.category || '').trim(),
    String(request.body.priority || existing.priority || 'medium').trim(),
    nextStatus,
    nextSubject,
    nextMessage,
    nextResolutionNote,
    nowIso(),
    existing.id,
  )

  appAudit('feedback_updated', request.user, {
    feedbackId: existing.id,
    status: nextStatus,
  })

  response.json({
    feedbackEntry: mapFeedbackRow(
      db
        .prepare(
          `
            select *
            from feedback_entries
            where id = ?
          `,
        )
        .get(existing.id),
    ),
  })
})

app.get('/api/admin/workspace-backup', authenticate, requireMainAdmin, (_, response) => {
  const settingsRow = db
    .prepare(
      `
        select *
        from app_settings
        where key = 'workspace_settings'
      `,
    )
    .get()

  response.json({
    snapshot: {
      exportedAt: nowIso(),
      substations: db.prepare('select * from substations order by name collate nocase asc').all().map(mapSubstationRow),
      employees: db.prepare('select * from employees order by updated_at desc, created_at desc').all().map(mapEmployeeRow),
      masters: Object.fromEntries(
        Array.from(allowedMasterTypes).map((type) => [
          type,
          db
            .prepare(
              `
                select *
                from master_records
                where type = ?
                order by updated_at desc, created_at desc
              `,
            )
            .all(type)
            .map(mapMasterRecordRow),
        ]),
      ),
      settings: parseJson(settingsRow?.value_json, {}),
      userSubstationMappings: db
        .prepare(
          `
            select id, user_id, substation_id, created_at, updated_at
            from user_substation_mappings
            order by updated_at desc, created_at desc
          `,
        )
        .all()
        .map((row) => ({
          id: row.id,
          userId: row.user_id,
          substationId: row.substation_id,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
      attendanceDocuments: db
        .prepare('select * from attendance_sheets order by updated_at desc, created_at desc')
        .all()
        .map(mapAttendanceSheetRow),
      dlrRecords: db
        .prepare('select * from dlr_records order by updated_at desc, created_at desc')
        .all()
        .map(mapDlrRecordRow),
      reportSnapshots: db
        .prepare('select * from report_snapshots order by updated_at desc, created_at desc')
        .all()
        .map(mapReportSnapshotRow),
      notices: db
        .prepare('select * from notices order by updated_at desc, created_at desc')
        .all()
        .map(mapNoticeRow),
      feedbackEntries: db
        .prepare('select * from feedback_entries order by updated_at desc, created_at desc')
        .all()
        .map(mapFeedbackRow),
      auditEvents: db
        .prepare('select * from app_audit_events order by created_at desc')
        .all()
        .map(mapAppAuditEventRow),
    },
  })
})

app.post('/api/admin/workspace-backup/import', authenticate, requireMainAdmin, (request, response) => {
  const snapshot = request.body?.snapshot

  if (!snapshot || typeof snapshot !== 'object') {
    response.status(400).json({ error: 'Backup snapshot valid nahi.' })
    return
  }

  const substations = Array.isArray(snapshot.substations)
    ? snapshot.substations
    : snapshot.referenceCache?.substations || []
  const employees = Array.isArray(snapshot.employees)
    ? snapshot.employees
    : snapshot.referenceCache?.employees || []
  const masters = snapshot.masters && typeof snapshot.masters === 'object'
    ? snapshot.masters
    : {}
  const settings = snapshot.settings && typeof snapshot.settings === 'object'
    ? snapshot.settings
    : {}
  const mappings = Array.isArray(snapshot.userSubstationMappings)
    ? snapshot.userSubstationMappings
    : []
  const attendanceDocuments = Array.isArray(snapshot.attendanceDocuments)
    ? snapshot.attendanceDocuments
    : []
  const dlrRecords = Array.isArray(snapshot.dlrRecords)
    ? snapshot.dlrRecords
    : []
  const reportSnapshots = Array.isArray(snapshot.reportSnapshots)
    ? snapshot.reportSnapshots
    : []
  const notices = Array.isArray(snapshot.notices)
    ? snapshot.notices
    : []
  const feedbackEntries = Array.isArray(snapshot.feedbackEntries)
    ? snapshot.feedbackEntries
    : []
  const auditEvents = Array.isArray(snapshot.auditEvents)
    ? snapshot.auditEvents
    : []

  db.exec(`
    delete from user_substation_mappings;
    delete from attendance_sheets;
    delete from dlr_records;
    delete from report_snapshots;
    delete from notices;
    delete from feedback_entries;
    delete from app_audit_events;
    delete from employees;
    delete from substations;
    delete from master_records;
    delete from app_settings;
  `)

  for (const substation of substations) {
    db.prepare(
      `
        insert into substations (
          id,
          code,
          name,
          district,
          circle,
          metadata_json,
          is_active,
          created_by,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      String(substation.id || crypto.randomUUID()),
      String(substation.code || ''),
      String(substation.name || '').trim(),
      String(substation.district || ''),
      String(substation.circle || ''),
      JSON.stringify({
        omName: String(substation.omName || ''),
        subDivisionName: String(substation.subDivisionName || ''),
        divisionName: String(substation.divisionName || ''),
        sectionName: String(substation.sectionName || ''),
      }),
      substation.is_active === false ? 0 : 1,
      String(substation.created_by || substation.createdBy || ''),
      String(substation.created_at || substation.createdAt || nowIso()),
      String(substation.updated_at || substation.updatedAt || nowIso()),
    )
  }

  for (const employee of employees) {
    db.prepare(
      `
        insert into employees (
          id,
          owner_user_id,
          substation_id,
          employee_code,
          full_name,
          designation,
          phone,
          metadata_json,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      String(employee.id || crypto.randomUUID()),
      String(employee.owner_user_id || employee.ownerUserId || request.user.id),
      String(employee.substation_id || employee.substationId || ''),
      String(employee.employee_code || employee.employeeCode || ''),
      String(employee.full_name || employee.fullName || '').trim(),
      String(employee.designation || ''),
      String(employee.phone || ''),
      JSON.stringify({
        srNo: employee.srNo ?? null,
        employeeType: employee.employeeType || '',
        cpfNo: employee.cpfNo || '',
        joiningDate: employee.joiningDate || '',
        workingPlace: employee.workingPlace || '',
        weeklyOffDay: employee.weeklyOffDay ?? '',
        isGeneralDutyOperator: Boolean(employee.isGeneralDutyOperator),
        isVacant: Boolean(employee.isVacant),
        isActive: employee.isActive === false ? false : true,
      }),
      String(employee.created_at || employee.createdAt || nowIso()),
      String(employee.updated_at || employee.updatedAt || nowIso()),
    )
  }

  for (const type of allowedMasterTypes) {
    for (const record of masters[type] || []) {
      db.prepare(
        `
          insert into master_records (
            id,
            type,
            created_by,
            payload_json,
            created_at,
            updated_at
          ) values (?, ?, ?, ?, ?, ?)
        `,
      ).run(
        String(record.id || crypto.randomUUID()),
        type,
        String(record.createdBy || ''),
        JSON.stringify(record),
        String(record.createdAt || nowIso()),
        String(record.updatedAt || nowIso()),
      )
    }
  }

  db.prepare(
    `
      insert into app_settings (
        key,
        value_json,
        updated_by,
        updated_at
      ) values (?, ?, ?, ?)
    `,
  ).run(
    'workspace_settings',
    JSON.stringify(settings),
    request.user.id,
    nowIso(),
  )

  for (const mapping of mappings) {
    db.prepare(
      `
        insert into user_substation_mappings (
          id,
          user_id,
          substation_id,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?)
      `,
    ).run(
      String(mapping.id || crypto.randomUUID()),
      String(mapping.userId || ''),
      String(mapping.substationId || ''),
      String(mapping.createdAt || nowIso()),
      String(mapping.updatedAt || nowIso()),
    )
  }

  for (const document of attendanceDocuments) {
    db.prepare(
      `
        insert into attendance_sheets (
          id,
          owner_user_id,
          substation_id,
          sheet_type,
          month_key,
          employee_scope,
          payload_json,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      String(document.id || crypto.randomUUID()),
      String(document.ownerUserId || request.user.id),
      String(document.substationId || ''),
      String(document.sheetType || ''),
      String(document.monthKey || ''),
      String(document.employeeScope || ''),
      JSON.stringify(document),
      String(document.createdAt || nowIso()),
      String(document.updatedAt || nowIso()),
    )
  }

  for (const record of dlrRecords) {
    db.prepare(
      `
        insert into dlr_records (
          id,
          owner_user_id,
          substation_id,
          module_name,
          record_key,
          operational_date,
          payload_json,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      String(record.id || crypto.randomUUID()),
      String(record.ownerUserId || request.user.id),
      String(record.substationId || ''),
      String(record.moduleName || ''),
      String(record.recordKey || record.id || crypto.randomUUID()),
      String(record.operationalDate || ''),
      JSON.stringify(record),
      String(record.createdAt || nowIso()),
      String(record.updatedAt || nowIso()),
    )
  }

  for (const snapshotRow of reportSnapshots) {
    db.prepare(
      `
        insert into report_snapshots (
          id,
          owner_user_id,
          report_type,
          filename_base,
          export_type,
          orientation,
          title,
          substation_id,
          substation_label,
          month_label,
          metadata_json,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      String(snapshotRow.id || crypto.randomUUID()),
      String(snapshotRow.ownerUserId || request.user.id),
      String(snapshotRow.reportType || ''),
      String(snapshotRow.filenameBase || ''),
      String(snapshotRow.exportType || ''),
      String(snapshotRow.orientation || ''),
      String(snapshotRow.title || ''),
      String(snapshotRow.substationId || ''),
      String(snapshotRow.substationLabel || ''),
      String(snapshotRow.monthLabel || ''),
      JSON.stringify({ metadata: snapshotRow.metadata || [] }),
      String(snapshotRow.createdAt || nowIso()),
      String(snapshotRow.updatedAt || nowIso()),
    )
  }

  for (const notice of notices) {
    db.prepare(
      `
        insert into notices (
          id,
          owner_user_id,
          substation_id,
          title,
          message,
          priority,
          status,
          publish_from,
          publish_to,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      String(notice.id || crypto.randomUUID()),
      String(notice.ownerUserId || request.user.id),
      String(notice.substationId || ''),
      String(notice.title || ''),
      String(notice.message || ''),
      String(notice.priority || 'normal'),
      String(notice.status || 'active'),
      String(notice.publishFrom || ''),
      String(notice.publishTo || ''),
      String(notice.createdAt || nowIso()),
      String(notice.updatedAt || nowIso()),
    )
  }

  for (const entry of feedbackEntries) {
    db.prepare(
      `
        insert into feedback_entries (
          id,
          owner_user_id,
          substation_id,
          module_name,
          category,
          priority,
          status,
          subject,
          message,
          resolution_note,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      String(entry.id || crypto.randomUUID()),
      String(entry.ownerUserId || request.user.id),
      String(entry.substationId || ''),
      String(entry.moduleName || ''),
      String(entry.category || ''),
      String(entry.priority || 'medium'),
      String(entry.status || 'open'),
      String(entry.subject || ''),
      String(entry.message || ''),
      String(entry.resolutionNote || ''),
      String(entry.createdAt || nowIso()),
      String(entry.updatedAt || nowIso()),
    )
  }

  for (const event of auditEvents) {
    db.prepare(
      `
        insert into app_audit_events (
          id,
          action,
          actor_id,
          actor_email,
          context_json,
          created_at
        ) values (?, ?, ?, ?, ?, ?)
      `,
    ).run(
      String(event.id || crypto.randomUUID()),
      String(event.action || 'imported_event'),
      String(event.actorId || ''),
      String(event.actorEmail || ''),
      JSON.stringify(event.context || {}),
      String(event.createdAt || nowIso()),
    )
  }

  appAudit('workspace_backup_imported_server', request.user, {
    exportedAt: snapshot.exportedAt || '',
  })

  response.json({
    ok: true,
  })
})

app.listen(port, () => {
  console.log(`Unified local SQL API running on http://localhost:${port}`)
  console.log(`SQLite file: ${dbPath}`)
})
