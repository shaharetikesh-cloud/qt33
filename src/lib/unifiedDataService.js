import {
  localCreateAppAuditEvent,
  localDeleteAttendanceSheet,
  localDeleteDlrRecord,
  localDeleteMasterRecord,
  localDeleteNotice,
  localGetSessionActivity,
  localListEmployees,
  localListAppAuditEvents,
  localListAttendanceSheets,
  localListDlrRecords,
  localListFeedbackEntries,
  localListNotices,
  localListReportSnapshots,
  localListSubstations,
  localGetWorkspaceConfig,
  localDeleteUserSubstationMapping,
  localListUserSubstationMappings,
  localExportWorkspaceBackup,
  localImportWorkspaceBackup,
  localSaveAttendanceSheet,
  localSaveDlrRecord,
  localSaveFeedbackEntry,
  localSaveMasterRecord,
  localSaveNotice,
  localSaveReportSnapshot,
  localSaveSettingsBundle,
  localSaveUserSubstationMapping,
  localUpdateFeedbackEntry,
} from './localApi'
import { isLocalSqlMode } from './runtimeConfig'
import {
  createLocalId,
  getNowIso,
  readScope,
  writeScope,
} from './storageAdapter'

const MASTERS_SCOPE = 'masters'
const SETTINGS_SCOPE = 'settings'
const MAPPINGS_SCOPE = 'user-substation-mappings'
const ATTENDANCE_SCOPE = 'attendance-documents'
const DLR_SCOPE = 'dlr-records'
const AUDIT_SCOPE = 'audit-events'
const CACHE_SCOPE = 'reference-cache'
const REPORT_SNAPSHOT_SCOPE = 'report-snapshots'
const NOTICE_SCOPE = 'notice-board'
const FEEDBACK_SCOPE = 'feedback-entries'

const defaultMasterCollections = {
  divisions: [],
  feeders: [],
  batterySets: [],
  transformers: [],
}

const defaultSettings = {
  companyProfile: {
    companyName: 'Maharashtra State Electricity Distribution Co. Ltd.',
    officeName: 'Unified MSEDCL Office',
    address: '',
    contactNumber: '',
    reportFooter: 'QT - Unified Substation ERP Software',
  },
  printSettings: {
    compactTables: true,
    defaultOrientation: 'portrait',
    fontScale: 1,
  },
  attendanceRules: {
    operatorShiftCycle: ['OFF', 'II', 'III', 'I', 'II', 'III', 'I'],
    operatorGeneralDutyPattern: ['OFF', 'II', 'III', 'I', 'G', 'G', 'G'],
    generalDutyCode: 'G',
    weeklyOffCode: 'WO',
    weeklyOffShiftCode: 'OFF',
    presentCode: 'P',
    defaultWeeklyOffDay: 0,
    nightAllowanceRate: 150,
    abnormalConsumptionThresholdPercent: 20,
  },
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value))
}

function readMasters() {
  return {
    ...cloneValue(defaultMasterCollections),
    ...(readScope(MASTERS_SCOPE, cloneValue(defaultMasterCollections)) || {}),
  }
}

function writeMasters(value) {
  writeScope(MASTERS_SCOPE, value)
}

function readSettings() {
  const storedSettings = readScope(SETTINGS_SCOPE, cloneValue(defaultSettings))

  return {
    companyProfile: {
      ...defaultSettings.companyProfile,
      ...(storedSettings?.companyProfile || {}),
    },
    printSettings: {
      ...defaultSettings.printSettings,
      ...(storedSettings?.printSettings || {}),
    },
    attendanceRules: {
      ...defaultSettings.attendanceRules,
      ...(storedSettings?.attendanceRules || {}),
    },
  }
}

function writeSettings(value) {
  writeScope(SETTINGS_SCOPE, value)
}

function readMappings() {
  return readScope(MAPPINGS_SCOPE, [])
}

function writeMappings(value) {
  writeScope(MAPPINGS_SCOPE, value)
}

function readAttendanceDocuments() {
  return readScope(ATTENDANCE_SCOPE, [])
}

function writeAttendanceDocuments(value) {
  writeScope(ATTENDANCE_SCOPE, value)
}

function readDlrRecords() {
  return readScope(DLR_SCOPE, [])
}

function writeDlrRecords(value) {
  writeScope(DLR_SCOPE, value)
}

function readAuditEvents() {
  return readScope(AUDIT_SCOPE, [])
}

function writeAuditEvents(value) {
  writeScope(AUDIT_SCOPE, value)
}

function readReferenceCache() {
  return readScope(CACHE_SCOPE, {
    substations: [],
    employees: [],
    updatedAt: '',
  })
}

function writeReferenceCache(value) {
  writeScope(CACHE_SCOPE, value)
}

function readReportSnapshots() {
  return readScope(REPORT_SNAPSHOT_SCOPE, [])
}

function writeReportSnapshots(value) {
  writeScope(REPORT_SNAPSHOT_SCOPE, value)
}

function readNotices() {
  return readScope(NOTICE_SCOPE, [])
}

function writeNotices(value) {
  writeScope(NOTICE_SCOPE, value)
}

function readFeedbackEntries() {
  return readScope(FEEDBACK_SCOPE, [])
}

function writeFeedbackEntries(value) {
  writeScope(FEEDBACK_SCOPE, value)
}

function upsertCollectionRecord(collection, incomingRecord, prefix) {
  const now = getNowIso()
  const record = {
    ...incomingRecord,
    id: incomingRecord.id || createLocalId(prefix),
    updatedAt: now,
  }

  if (!incomingRecord.id) {
    record.createdAt = now
  }

  const nextCollection = [...collection]
  const index = nextCollection.findIndex((item) => item.id === record.id)

  if (index >= 0) {
    nextCollection[index] = {
      ...nextCollection[index],
      ...record,
    }
  } else {
    nextCollection.unshift(record)
  }

  return {
    record,
    nextCollection,
  }
}

function sortRecordsByUpdatedDate(collection = []) {
  return [...collection].sort((left, right) => {
    const leftTime = new Date(left.updatedAt || left.updated_at || left.createdAt || left.created_at || 0).getTime()
    const rightTime = new Date(right.updatedAt || right.updated_at || right.createdAt || right.created_at || 0).getTime()
    return rightTime - leftTime
  })
}

function mergeCollectionRecords(collection = [], incomingCollection = []) {
  const merged = new Map(collection.map((item) => [item.id, item]))

  for (const item of incomingCollection) {
    if (!item?.id) {
      continue
    }

    merged.set(item.id, {
      ...(merged.get(item.id) || {}),
      ...item,
    })
  }

  return sortRecordsByUpdatedDate(Array.from(merged.values()))
}

export function isAdminRole(role) {
  const normalizedRole = normalizeUserRole(role)
  return normalizedRole === 'super_admin' || normalizedRole === 'substation_admin'
}

export function normalizeUserRole(role) {
  const normalized = String(role || '').trim().toLowerCase()

  if (normalized === 'user' || normalized === 'substation_user' || normalized === 'normal_user') {
    return 'substation_user'
  }

  if (normalized === 'owner' || normalized === 'main_admin' || normalized === 'admin') {
    return 'super_admin'
  }

  return normalized || 'substation_user'
}

export function listMasterRecords(type) {
  const masters = readMasters()
  return masters[type] || []
}

export async function loadWorkspaceConfiguration(actor) {
  if (isLocalSqlMode && (actor?.auth_user_id || actor?.id)) {
    try {
      const config = await localGetWorkspaceConfig()
      writeMasters({
        ...cloneValue(defaultMasterCollections),
        ...(config.masters || {}),
      })
      writeSettings({
        ...cloneValue(defaultSettings),
        ...(config.settings || {}),
      })
      return {
        masters: readMasters(),
        settings: readSettings(),
      }
    } catch {
      return {
        masters: readMasters(),
        settings: readSettings(),
      }
    }
  }

  return {
    masters: readMasters(),
    settings: readSettings(),
  }
}

export async function saveMasterRecord(type, record, actor) {
  if (isLocalSqlMode && isAdminRole(normalizeUserRole(actor?.role))) {
    const savedRecord = await localSaveMasterRecord(type, {
      ...record,
      createdBy: record.createdBy || actor?.auth_user_id || actor?.id || '',
    })

    const masters = readMasters()
    const collection = masters[type] || []
    const nextCollection = upsertCollectionRecord(collection, savedRecord, type.slice(0, 3)).nextCollection

    writeMasters({
      ...masters,
      [type]: nextCollection,
    })

    recordAuditEvent('master_saved', actor, {
      type,
      recordId: savedRecord.id,
    })

    return savedRecord
  }

  const masters = readMasters()
  const collection = masters[type] || []
  const { record: savedRecord, nextCollection } = upsertCollectionRecord(
    collection,
    {
      ...record,
      createdBy: record.createdBy || actor?.auth_user_id || actor?.id || '',
    },
    type.slice(0, 3),
  )

  writeMasters({
    ...masters,
    [type]: nextCollection,
  })

  recordAuditEvent('master_saved', actor, {
    type,
    recordId: savedRecord.id,
  })

  return savedRecord
}

export async function deleteMasterRecord(type, recordId, actor) {
  if (isLocalSqlMode && isAdminRole(normalizeUserRole(actor?.role))) {
    await localDeleteMasterRecord(type, recordId)
  }

  const masters = readMasters()
  const collection = masters[type] || []

  writeMasters({
    ...masters,
    [type]: collection.filter((item) => item.id !== recordId),
  })

  recordAuditEvent('master_deleted', actor, {
    type,
    recordId,
  })
}

export function getSettingsBundle() {
  return readSettings()
}

export async function saveSettingsBundle(nextSettings, actor) {
  if (isLocalSqlMode && isAdminRole(normalizeUserRole(actor?.role))) {
    const savedSettings = await localSaveSettingsBundle(nextSettings)
    writeSettings({
      ...cloneValue(defaultSettings),
      ...(savedSettings || {}),
    })

    recordAuditEvent('settings_saved', actor, {
      keys: Object.keys(savedSettings || {}),
    })
    return
  }

  writeSettings(nextSettings)

  recordAuditEvent('settings_saved', actor, {
    keys: Object.keys(nextSettings || {}),
  })
}

export function listUserSubstationMappings() {
  return readMappings()
}

export async function loadUserSubstationMappings(actor) {
  if (isLocalSqlMode && isAdminRole(normalizeUserRole(actor?.role))) {
    try {
      const mappings = await localListUserSubstationMappings()
      writeMappings(mappings)
      return mappings
    } catch {
      return readMappings()
    }
  }

  return readMappings()
}

export async function saveUserSubstationMapping(mapping, actor) {
  if (isLocalSqlMode && isAdminRole(normalizeUserRole(actor?.role))) {
    const savedMapping = await localSaveUserSubstationMapping(mapping)
    const nextCollection = upsertCollectionRecord(readMappings(), savedMapping, 'map').nextCollection
    writeMappings(nextCollection)

    recordAuditEvent('user_mapping_saved', actor, {
      mappingId: savedMapping.id,
      userId: savedMapping.userId,
      substationId: savedMapping.substationId,
    })

    return savedMapping
  }

  const { record, nextCollection } = upsertCollectionRecord(
    readMappings(),
    mapping,
    'map',
  )

  writeMappings(nextCollection)

  recordAuditEvent('user_mapping_saved', actor, {
    mappingId: record.id,
    userId: record.userId,
    substationId: record.substationId,
  })

  return record
}

export async function deleteUserSubstationMapping(mappingId, actor) {
  if (isLocalSqlMode && isAdminRole(normalizeUserRole(actor?.role))) {
    await localDeleteUserSubstationMapping(mappingId)
    writeMappings(readMappings().filter((item) => item.id !== mappingId))

    recordAuditEvent('user_mapping_deleted', actor, {
      mappingId,
    })

    return
  }

  writeMappings(readMappings().filter((item) => item.id !== mappingId))

  recordAuditEvent('user_mapping_deleted', actor, {
    mappingId,
  })
}

export function getAllowedSubstationIds(profile) {
  const role = normalizeUserRole(profile?.role)

  if (!profile) {
    return null
  }

  if (role === 'super_admin') {
    return null
  }

  if (role === 'substation_admin') {
    const scopedSubstationId = String(profile?.substation_id || profile?.substationId || '').trim()
    return scopedSubstationId ? [scopedSubstationId] : []
  }

  if (Array.isArray(profile.allowed_substation_ids)) {
    return profile.allowed_substation_ids
  }

  return listUserSubstationMappings()
    .filter((item) => item.userId === profile.auth_user_id || item.userId === profile.id)
    .map((item) => item.substationId)
}

export function assertSubstationAccess(profile, substationId) {
  const role = normalizeUserRole(profile?.role)

  if (!substationId || !profile || role === 'super_admin') {
    return
  }

  const allowedSubstationIds = getAllowedSubstationIds(profile)

  if (allowedSubstationIds && !allowedSubstationIds.includes(substationId)) {
    throw new Error('Ya substation sathi access available nahi.')
  }
}

function isNoticeVisibleForProfile(notice, profile) {
  if (!notice) {
    return false
  }

  if (isAdminRole(normalizeUserRole(profile?.role))) {
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

  const allowedSubstationIds = getAllowedSubstationIds(profile)
  return !allowedSubstationIds || !notice.substationId || allowedSubstationIds.includes(notice.substationId)
}

export async function loadReferenceData(profile) {
  const cached = readReferenceCache()
  let substations = cached.substations || []
  let employees = cached.employees || []

  if (isLocalSqlMode) {
    try {
      const [substationRows, employeeRows, config] = await Promise.all([
        localListSubstations(),
        localListEmployees(),
        localGetWorkspaceConfig(),
      ])

      substations = substationRows
      employees = employeeRows
      writeMasters({
        ...cloneValue(defaultMasterCollections),
        ...(config.masters || {}),
      })
      writeSettings({
        ...cloneValue(defaultSettings),
        ...(config.settings || {}),
      })
      writeReferenceCache({
        substations,
        employees,
        updatedAt: getNowIso(),
      })
    } catch {
      // Cache fallback is deliberate so reports stay usable when API access is unavailable.
    }
  }

  const allowedSubstationIds = getAllowedSubstationIds(profile)

  const visibleSubstations = allowedSubstationIds
    ? substations.filter((item) => allowedSubstationIds.includes(item.id))
    : substations

  const visibleEmployees = allowedSubstationIds
    ? employees.filter((item) => allowedSubstationIds.includes(item.substation_id))
    : employees

  return {
    substations: visibleSubstations,
    employees: visibleEmployees,
    cachedAt: cached.updatedAt,
  }
}

export function listAttendanceDocuments(filters = {}) {
  const allowedSubstationIds = filters.profile
    ? getAllowedSubstationIds(filters.profile)
    : null

  return readAttendanceDocuments()
    .filter((item) => !filters.sheetType || item.sheetType === filters.sheetType)
    .filter((item) => !filters.monthKey || item.monthKey === filters.monthKey)
    .filter((item) => !filters.substationId || item.substationId === filters.substationId)
    .filter((item) => !filters.ownerUserId || item.ownerUserId === filters.ownerUserId)
    .filter(
      (item) =>
        !allowedSubstationIds ||
        !item.substationId ||
        allowedSubstationIds.includes(item.substationId),
    )
}

export async function loadAttendanceDocuments(filters = {}) {
  if (isLocalSqlMode) {
    try {
      const documents = await localListAttendanceSheets(filters)
      writeAttendanceDocuments(mergeCollectionRecords(readAttendanceDocuments(), documents))
      return listAttendanceDocuments(filters)
    } catch {
      return listAttendanceDocuments(filters)
    }
  }

  return listAttendanceDocuments(filters)
}

export async function saveAttendanceDocument(document, actor) {
  assertSubstationAccess(actor, document.substationId)

  if (isLocalSqlMode) {
    const savedRecord = await localSaveAttendanceSheet({
      ...document,
      ownerUserId:
        document.ownerUserId || actor?.auth_user_id || actor?.id || 'local-user',
    })

    writeAttendanceDocuments(
      mergeCollectionRecords(readAttendanceDocuments(), [savedRecord]),
    )

    recordAuditEvent('attendance_saved', actor, {
      documentId: savedRecord.id,
      sheetType: savedRecord.sheetType,
      monthKey: savedRecord.monthKey,
    })

    return savedRecord
  }

  const { record, nextCollection } = upsertCollectionRecord(
    readAttendanceDocuments(),
    {
      ...document,
      ownerUserId:
        document.ownerUserId || actor?.auth_user_id || actor?.id || 'local-user',
    },
    'att',
  )

  writeAttendanceDocuments(nextCollection)

  recordAuditEvent('attendance_saved', actor, {
    documentId: record.id,
    sheetType: record.sheetType,
    monthKey: record.monthKey,
  })

  return record
}

export async function deleteAttendanceDocument(documentId, actor) {
  const existing = readAttendanceDocuments().find((item) => item.id === documentId)

  if (existing) {
    assertSubstationAccess(actor, existing.substationId)
  }

  if (isLocalSqlMode) {
    await localDeleteAttendanceSheet(documentId)
  }

  writeAttendanceDocuments(
    readAttendanceDocuments().filter((item) => item.id !== documentId),
  )

  recordAuditEvent('attendance_deleted', actor, {
    documentId,
  })
}

export function listDlrRecords(filters = {}) {
  const allowedSubstationIds = filters.profile
    ? getAllowedSubstationIds(filters.profile)
    : null

  return readDlrRecords()
    .filter((item) => !filters.moduleName || item.moduleName === filters.moduleName)
    .filter((item) => !filters.substationId || item.substationId === filters.substationId)
    .filter((item) => !filters.ownerUserId || item.ownerUserId === filters.ownerUserId)
    .filter((item) => !filters.operationalDate || item.operationalDate === filters.operationalDate)
    .filter((item) => !filters.monthKey || String(item.operationalDate || '').startsWith(filters.monthKey))
    .filter(
      (item) =>
        !allowedSubstationIds ||
        !item.substationId ||
        allowedSubstationIds.includes(item.substationId),
    )
}

export async function loadDlrRecords(filters = {}) {
  if (isLocalSqlMode) {
    try {
      const records = await localListDlrRecords(filters)
      writeDlrRecords(mergeCollectionRecords(readDlrRecords(), records))
      return listDlrRecords(filters)
    } catch {
      return listDlrRecords(filters)
    }
  }

  return listDlrRecords(filters)
}

export async function saveDlrRecord(record, actor) {
  assertSubstationAccess(actor, record.substationId)

  if (isLocalSqlMode) {
    const savedRecord = await localSaveDlrRecord({
      ...record,
      ownerUserId:
        record.ownerUserId || actor?.auth_user_id || actor?.id || 'local-user',
    })

    writeDlrRecords(
      mergeCollectionRecords(readDlrRecords(), [savedRecord]),
    )

    recordAuditEvent('dlr_saved', actor, {
      recordId: savedRecord.id,
      moduleName: savedRecord.moduleName,
      operationalDate: savedRecord.operationalDate,
    })

    return savedRecord
  }

  const { record: savedRecord, nextCollection } = upsertCollectionRecord(
    readDlrRecords(),
    {
      ...record,
      ownerUserId:
        record.ownerUserId || actor?.auth_user_id || actor?.id || 'local-user',
    },
    'dlr',
  )

  writeDlrRecords(nextCollection)

  recordAuditEvent('dlr_saved', actor, {
    recordId: savedRecord.id,
    moduleName: savedRecord.moduleName,
    operationalDate: savedRecord.operationalDate,
  })

  return savedRecord
}

export async function deleteDlrRecord(recordId, actor) {
  const existing = readDlrRecords().find((item) => item.id === recordId)

  if (existing) {
    assertSubstationAccess(actor, existing.substationId)
  }

  if (isLocalSqlMode) {
    await localDeleteDlrRecord(recordId)
  }

  writeDlrRecords(readDlrRecords().filter((item) => item.id !== recordId))

  recordAuditEvent('dlr_deleted', actor, {
    recordId,
  })
}

export function listHistoryRegisterEntries(filters = {}) {
  return listDlrRecords(filters)
    .map((item) => ({
      id: item.id,
      moduleName: item.moduleName,
      substationId: item.substationId,
      operationalDate: item.operationalDate,
      title:
        item.title ||
        item.payload?.title ||
        item.payload?.workDetail ||
        item.payload?.remarks ||
        item.moduleName,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      payload: item.payload || {},
    }))
    .sort((left, right) => {
      const dateDifference =
        new Date(right.operationalDate || 0).getTime() -
        new Date(left.operationalDate || 0).getTime()

      if (dateDifference !== 0) {
        return dateDifference
      }

      return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime()
    })
}

export function recordAuditEvent(action, actor, context = {}) {
  const events = readAuditEvents()
  const event = {
    id: createLocalId('aud'),
    action,
    actorId: actor?.auth_user_id || actor?.id || '',
    actorEmail: actor?.email || '',
    context,
    createdAt: getNowIso(),
  }

  events.unshift(event)
  writeAuditEvents(events.slice(0, 300))

  if (isLocalSqlMode && (actor?.auth_user_id || actor?.id)) {
    void localCreateAppAuditEvent(event).catch(() => {})
  }

  return event
}

export function listAuditEvents() {
  return readAuditEvents()
}

export async function loadAuditEvents(actor) {
  if (isLocalSqlMode && isAdminRole(normalizeUserRole(actor?.role))) {
    try {
      const events = await localListAppAuditEvents()
      writeAuditEvents(events)
      return events
    } catch {
      return readAuditEvents()
    }
  }

  return readAuditEvents()
}

export function listReportSnapshots(filters = {}) {
  const allowedSubstationIds = filters.profile
    ? getAllowedSubstationIds(filters.profile)
    : null
  const adminUser = isAdminRole(normalizeUserRole(filters.profile?.role))
  const visibleOwnerId = filters.profile?.auth_user_id || filters.profile?.id

  return readReportSnapshots()
    .filter((item) => !filters.reportType || item.reportType === filters.reportType)
    .filter((item) => !filters.filenameBase || item.filenameBase === filters.filenameBase)
    .filter((item) => adminUser || !visibleOwnerId || item.ownerUserId === visibleOwnerId)
    .filter(
      (item) =>
        !allowedSubstationIds ||
        !item.substationId ||
        allowedSubstationIds.includes(item.substationId),
    )
}

export async function loadReportSnapshots(filters = {}) {
  if (isLocalSqlMode && (filters.profile?.auth_user_id || filters.profile?.id)) {
    try {
      const snapshots = await localListReportSnapshots(filters)
      writeReportSnapshots(mergeCollectionRecords(readReportSnapshots(), snapshots).slice(0, 150))
      return listReportSnapshots(filters)
    } catch {
      return listReportSnapshots(filters)
    }
  }

  return listReportSnapshots(filters)
}

export async function saveReportSnapshot(snapshot, actor) {
  if (isLocalSqlMode && (actor?.auth_user_id || actor?.id)) {
    const savedSnapshot = await localSaveReportSnapshot({
      ...snapshot,
      ownerUserId: actor?.auth_user_id || actor?.id || '',
    })

    writeReportSnapshots(
      mergeCollectionRecords(readReportSnapshots(), [savedSnapshot]).slice(0, 150),
    )
    recordAuditEvent('report_snapshot_saved', actor, {
      reportType: savedSnapshot.reportType,
      filenameBase: savedSnapshot.filenameBase,
      exportType: savedSnapshot.exportType,
    })
    return savedSnapshot
  }

  const { record, nextCollection } = upsertCollectionRecord(
    readReportSnapshots(),
    {
      ...snapshot,
      ownerUserId: actor?.auth_user_id || actor?.id || '',
    },
    'rpt',
  )

  writeReportSnapshots(nextCollection.slice(0, 150))
  recordAuditEvent('report_snapshot_saved', actor, {
    reportType: record.reportType,
    filenameBase: record.filenameBase,
    exportType: record.exportType,
  })
  return record
}

export function listNotices(filters = {}) {
  return readNotices()
    .filter((item) => !filters.status || item.status === filters.status)
    .filter((item) => !filters.substationId || item.substationId === filters.substationId)
    .filter((item) => !filters.profile || isNoticeVisibleForProfile(item, filters.profile))
}

export async function loadNotices(filters = {}) {
  if (isLocalSqlMode && filters.profile?.auth_user_id) {
    try {
      const notices = await localListNotices(filters)
      writeNotices(mergeCollectionRecords(readNotices(), notices))
      return listNotices(filters)
    } catch {
      return listNotices(filters)
    }
  }

  return listNotices(filters)
}

export async function saveNotice(notice, actor) {
  if (isLocalSqlMode && isAdminRole(normalizeUserRole(actor?.role))) {
    const savedNotice = await localSaveNotice(notice)
    writeNotices(mergeCollectionRecords(readNotices(), [savedNotice]))
    recordAuditEvent('notice_saved', actor, {
      noticeId: savedNotice.id,
      title: savedNotice.title,
    })
    return savedNotice
  }

  const { record, nextCollection } = upsertCollectionRecord(
    readNotices(),
    {
      ...notice,
      ownerUserId: notice.ownerUserId || actor?.auth_user_id || actor?.id || '',
    },
    'ntc',
  )
  writeNotices(nextCollection)
  recordAuditEvent('notice_saved', actor, {
    noticeId: record.id,
    title: record.title,
  })
  return record
}

export async function deleteNotice(noticeId, actor) {
  if (isLocalSqlMode && isAdminRole(normalizeUserRole(actor?.role))) {
    await localDeleteNotice(noticeId)
  }

  writeNotices(readNotices().filter((item) => item.id !== noticeId))
  recordAuditEvent('notice_deleted', actor, {
    noticeId,
  })
}

export function listFeedbackEntries(filters = {}) {
  const adminUser = isAdminRole(normalizeUserRole(filters.profile?.role))
  const actorId = filters.profile?.auth_user_id || filters.profile?.id

  return readFeedbackEntries()
    .filter((item) => !filters.moduleName || item.moduleName === filters.moduleName)
    .filter((item) => !filters.status || item.status === filters.status)
    .filter((item) => adminUser || !actorId || item.ownerUserId === actorId)
}

export async function loadFeedbackEntries(filters = {}) {
  if (isLocalSqlMode && filters.profile?.auth_user_id) {
    try {
      const entries = await localListFeedbackEntries(filters)
      writeFeedbackEntries(mergeCollectionRecords(readFeedbackEntries(), entries))
      return listFeedbackEntries(filters)
    } catch {
      return listFeedbackEntries(filters)
    }
  }

  return listFeedbackEntries(filters)
}

export async function saveFeedbackEntry(entry, actor) {
  if (isLocalSqlMode && actor?.auth_user_id) {
    const savedEntry = await localSaveFeedbackEntry({
      ...entry,
      ownerUserId: actor?.auth_user_id || actor?.id || '',
    })
    writeFeedbackEntries(mergeCollectionRecords(readFeedbackEntries(), [savedEntry]))
    recordAuditEvent('feedback_saved', actor, {
      feedbackId: savedEntry.id,
      moduleName: savedEntry.moduleName,
    })
    return savedEntry
  }

  const { record, nextCollection } = upsertCollectionRecord(
    readFeedbackEntries(),
    {
      ...entry,
      ownerUserId: entry.ownerUserId || actor?.auth_user_id || actor?.id || '',
    },
    'fdb',
  )
  writeFeedbackEntries(nextCollection)
  recordAuditEvent('feedback_saved', actor, {
    feedbackId: record.id,
    moduleName: record.moduleName,
  })
  return record
}

export async function updateFeedbackEntry(entryId, patch, actor) {
  if (isLocalSqlMode && actor?.auth_user_id) {
    const savedEntry = await localUpdateFeedbackEntry(entryId, patch)
    writeFeedbackEntries(mergeCollectionRecords(readFeedbackEntries(), [savedEntry]))
    recordAuditEvent('feedback_updated', actor, {
      feedbackId: savedEntry.id,
      status: savedEntry.status,
    })
    return savedEntry
  }

  const collection = readFeedbackEntries()
  const existing = collection.find((item) => item.id === entryId)

  if (!existing) {
    throw new Error('Feedback entry sapadli nahi.')
  }

  const { record, nextCollection } = upsertCollectionRecord(
    collection,
    {
      ...existing,
      ...patch,
      id: entryId,
    },
    'fdb',
  )
  writeFeedbackEntries(nextCollection)
  recordAuditEvent('feedback_updated', actor, {
    feedbackId: record.id,
    status: record.status,
  })
  return record
}

export async function loadSessionActivity(actor) {
  if (isLocalSqlMode && actor?.auth_user_id) {
    return localGetSessionActivity()
  }

  return {
    currentSession: null,
    activeSessions: [],
    recentLoginAudit: [],
    recentAppAudit: [],
  }
}

export async function buildBackupSnapshot(actor) {
  if (isLocalSqlMode && isAdminRole(normalizeUserRole(actor?.role))) {
    return localExportWorkspaceBackup()
  }

  return {
    exportedAt: getNowIso(),
    masters: readMasters(),
    settings: readSettings(),
    userSubstationMappings: readMappings(),
    attendanceDocuments: readAttendanceDocuments(),
    dlrRecords: readDlrRecords(),
    reportSnapshots: readReportSnapshots(),
    notices: readNotices(),
    feedbackEntries: readFeedbackEntries(),
    auditEvents: readAuditEvents(),
    referenceCache: readReferenceCache(),
  }
}

export async function importBackupSnapshot(snapshot, actor) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Backup file valid nahi.')
  }

  if (isLocalSqlMode && isAdminRole(normalizeUserRole(actor?.role))) {
    await localImportWorkspaceBackup(snapshot)
    await loadWorkspaceConfiguration(actor)
    const referenceData = await loadReferenceData(actor)
    writeReferenceCache({
      substations: referenceData.substations,
      employees: referenceData.employees,
      updatedAt: getNowIso(),
    })
    writeMappings(snapshot.userSubstationMappings || [])
    writeAttendanceDocuments(snapshot.attendanceDocuments || [])
    writeDlrRecords(snapshot.dlrRecords || [])
    writeReportSnapshots(snapshot.reportSnapshots || [])
    writeNotices(snapshot.notices || [])
    writeFeedbackEntries(snapshot.feedbackEntries || [])
    writeAuditEvents(snapshot.auditEvents || [])
    recordAuditEvent('backup_imported', actor, {
      exportedAt: snapshot.exportedAt || '',
    })
    return
  }

  writeMasters({
    ...cloneValue(defaultMasterCollections),
    ...(snapshot.masters || {}),
  })
  writeSettings({
    ...cloneValue(defaultSettings),
    ...(snapshot.settings || {}),
  })
  writeMappings(snapshot.userSubstationMappings || [])
  writeAttendanceDocuments(snapshot.attendanceDocuments || [])
  writeDlrRecords(snapshot.dlrRecords || [])
  writeReportSnapshots(snapshot.reportSnapshots || [])
  writeNotices(snapshot.notices || [])
  writeFeedbackEntries(snapshot.feedbackEntries || [])
  writeAuditEvents(snapshot.auditEvents || [])
  writeReferenceCache(snapshot.referenceCache || {
    substations: [],
    employees: [],
    updatedAt: '',
  })

  recordAuditEvent('backup_imported', actor, {
    exportedAt: snapshot.exportedAt || '',
  })
}
