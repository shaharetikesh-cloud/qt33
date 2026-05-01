import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const sqlitePath = path.join(rootDir, 'local-data', 'unified-msedcl-local.sqlite')
const publicDir = path.join(rootDir, 'public')
const tempSeedPath = path.join(publicDir, 'offline-seed.json')
const androidDir = path.join(rootDir, 'android')
const defaultApkPath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
const offlineApkPath = path.join(
  androidDir,
  'app',
  'build',
  'outputs',
  'apk',
  'debug',
  'unified-msedcl-offline-debug.apk',
)
const allowedMasterTypes = ['divisions', 'feeders', 'batterySets', 'transformers']
const javaCompatibilityFiles = []

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function run(command, args, options = {}) {
  const result =
    process.platform === 'win32'
      ? spawnSync(
          'cmd.exe',
          [
            '/d',
            '/s',
            '/c',
            [command, ...args]
              .map((part) => {
                const value = String(part)
                return /[\s"]/u.test(value)
                  ? `"${value.replace(/"/g, '\\"')}"`
                  : value
              })
              .join(' '),
          ],
          {
            stdio: 'inherit',
            shell: false,
            ...options,
          },
        )
      : spawnSync(command, args, {
          stdio: 'inherit',
          shell: false,
          ...options,
        })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

function getCommand(base) {
  return process.platform === 'win32' ? `${base}.cmd` : base
}

function mapUserRow(db, row) {
  const substation = row.substation_id
    ? db.prepare('select name from substations where id = ?').get(row.substation_id)
    : null
  const creator = row.created_by
    ? db.prepare('select full_name from users where id = ?').get(row.created_by)
    : null
  const allowedSubstationIds = row.substation_id
    ? [row.substation_id]
    : db
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

  return {
    id: row.id,
    auth_user_id: row.id,
    username: row.username || '',
    email: row.email || '',
    full_name: row.full_name || '',
    mobile: row.phone || '',
    phone: row.phone || '',
    role: row.role || '',
    is_active: Boolean(row.is_active),
    approval_status: row.approval_status || '',
    substation_id: row.substation_id || '',
    substationId: row.substation_id || '',
    substation_name: substation?.name || '',
    substationName: substation?.name || '',
    allowed_substation_ids: allowedSubstationIds,
    created_by: row.created_by || '',
    created_by_name: creator?.full_name || '',
    updated_by: row.updated_by || '',
    disabled_at: row.disabled_at || '',
    disabled_by: row.disabled_by || '',
    deleted_at: row.deleted_at || '',
    deleted_by: row.deleted_by || '',
    must_change_password: Boolean(row.must_change_password),
    module_permissions: parseJson(row.module_permissions_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
    passwordHash: row.password_hash || '',
  }
}

function mapSubstationRow(row) {
  const metadata = parseJson(row.metadata_json, {})

  return {
    id: row.id,
    code: row.code || '',
    name: row.name || '',
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
  const metadata = parseJson(row.metadata_json, {})

  return {
    id: row.id,
    owner_user_id: row.owner_user_id || '',
    substation_id: row.substation_id || '',
    employee_code: row.employee_code || '',
    full_name: row.full_name || '',
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
  return {
    ...parseJson(row.payload_json, {}),
    id: row.id,
    createdBy: row.created_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapAttendanceSheetRow(row) {
  const payload = parseJson(row.payload_json, {})

  return {
    ...payload,
    id: row.id,
    ownerUserId: row.owner_user_id || '',
    substationId: row.substation_id || '',
    sheetType: row.sheet_type || '',
    monthKey: row.month_key || '',
    employeeScope: row.employee_scope || payload.employeeScope || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapDlrRecordRow(row) {
  const payload = parseJson(row.payload_json, {})

  return {
    ...payload,
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
  const metadata = parseJson(row.metadata_json, {})

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
    metadata: metadata.metadata || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapNoticeRow(row) {
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

function mapAuditEventRow(row) {
  return {
    id: row.id,
    action: row.action || '',
    actorId: row.actor_id || '',
    actorEmail: row.actor_email || '',
    context: parseJson(row.context_json, {}),
    createdAt: row.created_at,
  }
}

function mapLoginAuditRow(row) {
  return {
    id: row.id,
    userId: row.user_id || '',
    username: row.username || '',
    email: row.email || '',
    action: row.action || '',
    context: parseJson(row.context_json, {}),
    createdAt: row.created_at,
  }
}

function buildSeedSnapshot() {
  if (!fs.existsSync(sqlitePath)) {
    return {
      exportedAt: new Date().toISOString(),
      users: [],
      loginAudit: [],
      substations: [],
      employees: [],
      masters: Object.fromEntries(allowedMasterTypes.map((type) => [type, []])),
      settings: {},
      userSubstationMappings: [],
      attendanceDocuments: [],
      dlrRecords: [],
      reportSnapshots: [],
      notices: [],
      feedbackEntries: [],
      auditEvents: [],
    }
  }

  const db = new DatabaseSync(sqlitePath)
  const settingsRow = db
    .prepare(
      `
        select *
        from app_settings
        where key = 'workspace_settings'
      `,
    )
    .get()

  return {
    exportedAt: new Date().toISOString(),
    users: db
      .prepare(
        `
          select *
          from users
          where deleted_at is null
          order by created_at desc
        `,
      )
      .all()
      .map((row) => mapUserRow(db, row)),
    loginAudit: db
      .prepare(
        `
          select *
          from login_audit
          order by created_at desc
        `,
      )
      .all()
      .map(mapLoginAuditRow),
    substations: db
      .prepare('select * from substations order by name collate nocase asc')
      .all()
      .map(mapSubstationRow),
    employees: db
      .prepare('select * from employees order by updated_at desc, created_at desc')
      .all()
      .map(mapEmployeeRow),
    masters: Object.fromEntries(
      allowedMasterTypes.map((type) => [
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
          select *
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
      .map(mapAuditEventRow),
  }
}

function writeTemporarySeedFile() {
  const snapshot = buildSeedSnapshot()
  fs.mkdirSync(publicDir, { recursive: true })
  fs.writeFileSync(
    tempSeedPath,
    JSON.stringify(
      {
        snapshot,
      },
      null,
      2,
    ),
    'utf8',
  )
}

function cleanupTemporarySeedFile() {
  if (fs.existsSync(tempSeedPath)) {
    fs.unlinkSync(tempSeedPath)
  }
}

function copyOfflineApk() {
  if (!fs.existsSync(defaultApkPath)) {
    throw new Error(`APK output sapadla nahi: ${defaultApkPath}`)
  }

  fs.copyFileSync(defaultApkPath, offlineApkPath)
}

function applyJava17CompatibilityPatches() {
  const backups = []

  for (const filePath of javaCompatibilityFiles) {
    if (!fs.existsSync(filePath)) {
      continue
    }

    const original = fs.readFileSync(filePath, 'utf8')
    const patched = original.replaceAll('JavaVersion.VERSION_21', 'JavaVersion.VERSION_17')

    if (patched !== original) {
      backups.push({ filePath, original })
      fs.writeFileSync(filePath, patched, 'utf8')
    }
  }

  return backups
}

function restorePatchedFiles(backups) {
  for (const entry of backups) {
    fs.writeFileSync(entry.filePath, entry.original, 'utf8')
  }
}

let patchedFiles = []

try {
  writeTemporarySeedFile()
  run(getCommand('npm'), ['run', 'build:offline'], { cwd: rootDir })
  run(getCommand('npm'), ['run', 'android:sync'], { cwd: rootDir })
  patchedFiles = applyJava17CompatibilityPatches()
  run(
    process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
    [
      'assembleDebug',
      '-PofflineBuild=true',
    ],
    { cwd: androidDir },
  )
  copyOfflineApk()
  console.log(`Offline APK ready: ${offlineApkPath}`)
} finally {
  restorePatchedFiles(patchedFiles)
  cleanupTemporarySeedFile()
}
