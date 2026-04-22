import {
  deleteApp,
  initializeApp,
} from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  fetchSignInMethodsForEmail,
  getAuth,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  reload,
} from 'firebase/auth'
import { firebaseAuth } from './firebase'
import { firebaseApp } from './firebase'
import {
  idbDeleteRecord,
  idbListRecords,
  idbPutRecord,
  idbQueueDelete,
  idbQueueUpsert,
} from './indexedDb'
import { getDeviceId } from './clientIdentity'
import { supabase, supabaseConfigError } from './supabase'
import { scheduleSync, syncScope, triggerSync } from './syncEngine'
import { firebaseConfigError } from './firebase'

const MASTER_COLLECTION_KEYS = ['divisions', 'feeders', 'batterySets', 'transformers']

async function getAuthToken() {
  const user = firebaseAuth?.currentUser
  if (!user) return ''
  return user.getIdToken()
}

function isAdminFunctionsEnabled() {
  return String(import.meta.env.VITE_SUPABASE_ADMIN_FUNCTIONS || '').toLowerCase() === 'true'
}

async function invokeAdminFunction(name, payload) {
  if (!supabase) {
    throw new Error('Supabase not configured.')
  }
  const { data, error } = await supabase.functions.invoke(name, {
    body: payload,
  })
  if (error) {
    throw error
  }
  return data || {}
}

function getProfileByFirebaseUid(uid) {
  return supabase
    .from('profiles')
    .select('*')
    .or(`firebase_uid.eq.${uid},auth_user_id.eq.${uid}`)
    .maybeSingle()
}

function normalizeRole(role) {
  const normalized = String(role || '').trim().toLowerCase()
  if (normalized === 'super_admin' || normalized === 'substation_admin') {
    return normalized
  }
  return normalized || 'normal_user'
}

function isMonthlyExemptRole(role) {
  const normalized = String(role || '').trim().toLowerCase()
  return ['super_admin', 'main_admin', 'owner', 'admin'].includes(normalized)
}

function getActivationStartIso(userRow) {
  return (
    userRow?.created_at ||
    userRow?.updated_at ||
    ''
  )
}

function isMonthlyExpired(userRow) {
  if (!userRow?.is_active || isMonthlyExemptRole(userRow?.role)) {
    return false
  }
  const baseIso = getActivationStartIso(userRow)
  const base = Date.parse(baseIso)
  if (!Number.isFinite(base)) {
    return false
  }
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
  return Date.now() - base >= THIRTY_DAYS_MS
}

async function applyMonthlyAutoDisable(rows = []) {
  if (!supabase || !rows.length) {
    return rows
  }
  const expiredRows = rows.filter((row) => isMonthlyExpired(row) && row.id)
  if (!expiredRows.length) {
    return rows
  }
  const nowIso = new Date().toISOString()
  for (const row of expiredRows) {
    await supabase
      .from('profiles')
      .update({
        is_active: false,
        updated_at: nowIso,
      })
      .eq('id', row.id)
  }
  return rows.map((row) =>
    expiredRows.some((expired) => expired.id === row.id)
      ? { ...row, is_active: false, updated_at: nowIso }
      : row,
  )
}

function buildPlaceholderEmail(username) {
  const normalized = String(username || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
  const safe = normalized || `user-${Date.now()}`
  return `${safe}@qt33.local`
}

async function getProfileByEmail(email) {
  return supabase
    .from('profiles')
    .select('*')
    .ilike('email', email)
    .maybeSingle()
}

function getFallbackFullName(user) {
  const raw = String(user?.displayName || user?.email || 'User').trim()
  if (!raw.includes('@')) {
    return raw || 'User'
  }
  return raw.split('@')[0] || 'User'
}

async function ensureProfileForFirebaseUser(user, options = {}) {
  if (!supabase || !user?.uid) {
    return null
  }

  const email = String(options.email || user.email || '').trim().toLowerCase()
  const fullName = String(options.fullName || getFallbackFullName(user)).trim()
  const role = String(options.role || 'normal_user').trim().toLowerCase()
  const isActive = options.isActive === undefined ? true : Boolean(options.isActive)

  const { data: uidProfile, error: uidProfileError } = await getProfileByFirebaseUid(user.uid)
  if (uidProfileError) {
    throw uidProfileError
  }

  if (uidProfile) {
    return uidProfile
  }

  if (email) {
    const { data: emailProfile, error: emailProfileError } = await getProfileByEmail(email)
    if (emailProfileError) {
      throw emailProfileError
    }

    if (emailProfile?.id) {
      const patch = {
        firebase_uid: user.uid,
        auth_user_id: user.uid,
        full_name: emailProfile.full_name || fullName,
        role: emailProfile.role || role,
        is_active: emailProfile.is_active ?? isActive,
      }
      const { data: updatedByEmail, error: updateError } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', emailProfile.id)
        .select('*')
        .single()
      if (updateError) {
        throw updateError
      }
      return updatedByEmail
    }
  }

  const insertRow = {
    email,
    firebase_uid: user.uid,
    auth_user_id: user.uid,
    full_name: fullName,
    role,
    is_active: isActive,
  }
  const { data: inserted, error: insertError } = await supabase
    .from('profiles')
    .insert(insertRow)
    .select('*')
    .single()

  if (insertError) {
    throw insertError
  }

  return inserted
}

export async function fetchLocalSession() {
  if (!firebaseAuth?.currentUser || !supabase) {
    return { session: null, profile: null }
  }
  const token = await getAuthToken()
  const profile = await ensureProfileForFirebaseUser(firebaseAuth.currentUser)
  return {
    session: { token, user: firebaseAuth.currentUser },
    profile: profile || null,
  }
}

export async function localSignIn(credentials) {
  if (!firebaseAuth || !supabase) {
    const issues = [firebaseConfigError, supabaseConfigError].filter(Boolean).join(' | ')
    throw new Error(issues || 'Firebase/Supabase configuration incomplete.')
  }
  const identifier = String(credentials.identifier || credentials.username || credentials.email || '').trim()
  if (!identifier) {
    throw new Error('Email kiwa username required aahe.')
  }

  let email = identifier
  if (!identifier.includes('@')) {
    const { data: matchedProfile, error: lookupError } = await supabase
      .from('profiles')
      .select('email')
      .ilike('username', identifier)
      .maybeSingle()

    if (lookupError) {
      throw lookupError
    }

    if (!matchedProfile?.email) {
      throw new Error('Ha username register zala nahi kiwa email map nahi.')
    }

    email = matchedProfile.email
  }

  const result = await signInWithEmailAndPassword(firebaseAuth, email, credentials.password)
  await reload(result.user)
  if (!result.user.emailVerified) {
    await signOut(firebaseAuth)
    throw new Error('Email verify kara. Login purvi verification required aahe.')
  }
  const token = await result.user.getIdToken()
  const profile = await ensureProfileForFirebaseUser(result.user, { emailVerified: true })
  if (profile && isMonthlyExpired(profile)) {
    await supabase
      .from('profiles')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', profile.id)
    await signOut(firebaseAuth)
    throw new Error('30-day access expired. Main Admin/Owner ne account पुन्हा active करावा.')
  }
  if (profile?.id) {
    await supabase
      .from('profiles')
      .update({
        email_verified: true,
        last_login_at: new Date().toISOString(),
      })
      .eq('id', profile.id)
  }
  return { session: { token, user: result.user }, profile: profile || null }
}

export async function localSignUp(payload) {
  if (!firebaseAuth || !supabase) {
    const issues = [firebaseConfigError, supabaseConfigError].filter(Boolean).join(' | ')
    throw new Error(issues || 'Firebase/Supabase configuration incomplete.')
  }

  const email = String(payload?.email || '').trim().toLowerCase()
  const password = String(payload?.password || '')
  const fullName = String(payload?.fullName || '').trim()
  const requestedRole = String(payload?.requestedRole || '').trim().toLowerCase()
  const allowedRoles = ['substation_admin']

  if (!email || !password || !fullName) {
    throw new Error('Full name, email, ani password required aahe.')
  }

  if (password.length < 8) {
    throw new Error('Password kamit kami 8 characters cha hava.')
  }

  if (!allowedRoles.includes(requestedRole)) {
    throw new Error('Public signup madhye fakta Substation Admin role allowed aahe.')
  }

  const signInMethods = await fetchSignInMethodsForEmail(firebaseAuth, email)
  if (Array.isArray(signInMethods) && signInMethods.length > 0) {
    throw new Error(
      'Ha email already register aahe. Krupaya Login kara kiwa Forgot Password vapra.',
    )
  }

  let authResult
  try {
    authResult = await createUserWithEmailAndPassword(firebaseAuth, email, password)
  } catch (error) {
    if (error?.code === 'auth/email-already-in-use') {
      throw new Error(
        'Ha email already register aahe. Krupaya Login kara kiwa Forgot Password vapra.',
      )
    }
    throw error
  }
  const createdAtIso = new Date().toISOString()

  const { data: existingProfile, error: existingProfileError } = await getProfileByEmail(email)
  if (existingProfileError) {
    await signOut(firebaseAuth)
    throw existingProfileError
  }

  const signupRole = 'substation_admin'
  const row = {
    email,
    full_name: fullName,
    role: signupRole,
    is_active: true,
    firebase_uid: authResult.user.uid,
    auth_user_id: authResult.user.uid,
    updated_at: createdAtIso,
  }

  const saveQuery = existingProfile?.id
    ? supabase.from('profiles').update(row).eq('id', existingProfile.id).select('*').single()
    : supabase
      .from('profiles')
      .insert({
        ...row,
        created_at: createdAtIso,
      })
      .select('*')
      .single()

  const { error: profileSaveError } = await saveQuery

  if (profileSaveError) {
    await signOut(firebaseAuth)
    throw profileSaveError
  }

  await sendEmailVerification(authResult.user)

  await signOut(firebaseAuth)
  return {
    message:
      'Signup zala. Verification email pathavla aahe. Email verify kelanantarach login karta yeil.',
  }
}

export async function localSignOut() {
  if (!firebaseAuth) return
  await signOut(firebaseAuth)
}

export async function localRequestPasswordReset(email) {
  if (!firebaseAuth) throw new Error('Firebase not configured.')
  await sendPasswordResetEmail(firebaseAuth, email)
  return { message: 'Password reset email sent successfully.' }
}

export async function localUpdatePassword(newPassword) {
  const user = firebaseAuth?.currentUser
  if (!user) throw new Error('Session expired.')
  await updatePassword(user, newPassword)
  if (supabase && user.uid) {
    await supabase
      .from('profiles')
      .update({ must_change_password: false })
      .or(`firebase_uid.eq.${user.uid},auth_user_id.eq.${user.uid}`)
  }
  return { message: 'Password updated.' }
}

export async function localListUsers(filters = {}) {
  if (!supabase) throw new Error('Supabase not configured.')
  let query = supabase.from('profiles').select('*', { count: 'exact' }).order('updated_at', { ascending: false })
  if (filters.role) query = query.eq('role', filters.role)
  if (filters.status) query = query.eq('is_active', filters.status === 'active')
  if (filters.substationId) query = query.eq('substation_id', filters.substationId)
  if (filters.search) query = query.or(`full_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%,username.ilike.%${filters.search}%`)
  const page = filters.page || 1
  const pageSize = filters.pageSize || 20
  query = query.range((page - 1) * pageSize, page * pageSize - 1)
  const { data, count, error } = await query
  if (error) throw error
  const users = await applyMonthlyAutoDisable(data ?? [])
  return {
    users,
    pagination: { page, pageSize, total: count || 0, totalPages: Math.ceil((count || 0) / pageSize) || 1 },
  }
}

export async function localCreateUser(data) {
  if (isAdminFunctionsEnabled()) {
    const payload = await invokeAdminFunction('admin-create-user', data)
    return payload.user || payload
  }

  if (!firebaseAuth || !supabase || !firebaseApp) {
    throw new Error('Firebase/Supabase not configured.')
  }

  const username = String(data.username || '').trim()
  const fullName = String(data.fullName || '').trim()
  const password = String(data.password || '').trim()
  const email = String(data.email || '').trim().toLowerCase() || buildPlaceholderEmail(username)
  const role = normalizeRole(data.role)
  const isActive = Boolean(data.isActive)

  if (!username || !fullName || !password) {
    throw new Error('Username, full name, ani password required aahe.')
  }

  if (password.length < 8) {
    throw new Error('Password kamit kami 8 characters cha hava.')
  }

  const secondaryApp = initializeApp(firebaseApp.options, `admin-create-${Date.now()}`)
  const secondaryAuth = getAuth(secondaryApp)
  let createdAuthUser = null

  try {
    const result = await createUserWithEmailAndPassword(secondaryAuth, email, password)
    createdAuthUser = result.user
  } finally {
    await deleteApp(secondaryApp)
  }

  if (!createdAuthUser?.uid) {
    throw new Error('Firebase user create hou shakla nahi.')
  }

  const profileRow = {
    firebase_uid: createdAuthUser.uid,
    auth_user_id: createdAuthUser.uid,
    email,
    full_name: fullName,
    role,
    is_active: isActive,
    substation_id: data.substationId || null,
  }
  const { data: saved, error } = await supabase.from('profiles').insert(profileRow).select('*').single()
  if (error) throw error
  return {
    ...saved,
    username,
  }
}

export async function localUpdateUser(userId, data) {
  const patch = {
    username: data.username,
    full_name: data.fullName,
    mobile: data.mobile,
    role: data.role,
    is_active: Boolean(data.isActive),
    substation_id: data.substationId || null,
    module_permissions: { modules: { employees: { delete: Boolean(data.allowDelete) } } },
  }
  const { data: saved, error } = await supabase.from('profiles').update(patch).eq('id', userId).select('*').single()
  if (error) throw error
  return saved
}

export async function localDeleteUser(userId) {
  if (isAdminFunctionsEnabled()) {
    return invokeAdminFunction('admin-disable-user', { userId })
  }

  const { error } = await supabase.from('profiles').update({ is_active: false }).eq('id', userId)
  if (error) throw error
  return { message: 'User deactivated.' }
}

export async function localResetUserPassword(userId, temporaryPassword) {
  if (isAdminFunctionsEnabled()) {
    return invokeAdminFunction('admin-reset-user-password', {
      userId,
      temporaryPassword,
    })
  }

  throw new Error(
    'Set VITE_SUPABASE_ADMIN_FUNCTIONS=true and deploy admin-reset-user-password edge function.',
  )
}

export async function localListLoginAudit() {
  return []
}

export async function localListAppAuditEvents() {
  return localListByScope('audit-events')
}

export async function localCreateAppAuditEvent(data) {
  return localSaveByScope('audit-events', data)
}

export async function localGetDashboardSummary() {
  const [substations, employees, notices, feedback] = await Promise.all([
    localListSubstations(),
    localListEmployees(),
    localListNotices({ status: 'active' }),
    localListFeedbackEntries({ status: 'open' }),
  ])
  return {
    substations: substations.length,
    employees: employees.length,
    activeNotices: notices.length,
    openFeedback: feedback.length,
  }
}

export async function localGetSessionActivity() {
  return { currentSession: null, activeSessions: [], recentLoginAudit: [], recentAppAudit: [] }
}

export async function localChangePassword(currentPassword, newPassword) {
  const user = firebaseAuth?.currentUser
  if (!user || !user.email) throw new Error('Session unavailable.')
  const credential = EmailAuthProvider.credential(user.email, currentPassword)
  await reauthenticateWithCredential(user, credential)
  await updatePassword(user, newPassword)
  if (supabase && user.uid) {
    await supabase
      .from('profiles')
      .update({ must_change_password: false })
      .or(`firebase_uid.eq.${user.uid},auth_user_id.eq.${user.uid}`)
  }
  return { message: 'Password updated.' }
}

export async function localResendVerificationEmail(email) {
  if (!firebaseAuth) throw new Error('Firebase not configured.')
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!normalizedEmail) {
    throw new Error('Email required aahe.')
  }
  const user = firebaseAuth.currentUser
  if (!user || String(user.email || '').trim().toLowerCase() !== normalizedEmail) {
    throw new Error('Login kelyanantarach resend verification available aahe.')
  }
  await sendEmailVerification(user)
  return { message: 'Verification email punha pathavla.' }
}

export async function localTrackVisitor() {
  if (!supabase) {
    return { totalVisitors: 0, todayVisitors: 0 }
  }
  const visitDay = new Date().toISOString().slice(0, 10)
  const visitorKeyStorage = 'qt33-visitor-key'
  let visitorKey = window.localStorage.getItem(visitorKeyStorage)
  if (!visitorKey) {
    visitorKey = crypto.randomUUID()
    window.localStorage.setItem(visitorKeyStorage, visitorKey)
  }

  await supabase
    .from('visitor_hits')
    .upsert(
      {
        visitor_key: visitorKey,
        visit_day: visitDay,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'visitor_key,visit_day' },
    )

  const [{ count: totalVisitors }, { count: todayVisitors }] = await Promise.all([
    supabase.from('visitor_hits').select('visitor_key', { count: 'exact', head: true }),
    supabase
      .from('visitor_hits')
      .select('visitor_key', { count: 'exact', head: true })
      .eq('visit_day', visitDay),
  ]).then((results) => results.map((item) => item || {}))

  return {
    totalVisitors: Number(totalVisitors || 0),
    todayVisitors: Number(todayVisitors || 0),
  }
}

export async function localListUserSubstationMappings() {
  return localListByScope('user-substation-mappings')
}

export async function localSaveUserSubstationMapping(data) {
  return localSaveByScope('user-substation-mappings', data)
}

export async function localDeleteUserSubstationMapping(mappingId) {
  await localDeleteByScope('user-substation-mappings', mappingId)
}

export async function localListSubstations() {
  const scopedRows = await localListByScope('substations')
  return [...scopedRows].sort((left, right) =>
    String(left?.name || '').localeCompare(String(right?.name || '')),
  )
}

export async function localGetWorkspaceConfig() {
  const [legacyMasters, settings, divisions, feeders, batterySets, transformers] =
    await Promise.all([
    localListByScope('workspace-masters'),
    localListByScope('workspace-settings'),
    localListByScope('masters:divisions'),
    localListByScope('masters:feeders'),
    localListByScope('masters:batterySets'),
    localListByScope('masters:transformers'),
    ])

  const typedMasters = {
    divisions: divisions || [],
    feeders: feeders || [],
    batterySets: batterySets || [],
    transformers: transformers || [],
  }
  const mergedMasters = {
    ...(legacyMasters[0]?.payload || {}),
    ...typedMasters,
  }
  return {
    masters: mergedMasters,
    settings: settings[0]?.payload || {},
    updatedAt: new Date().toISOString(),
  }
}

export async function localSaveMasterRecord(type, data) {
  const savedRecord = await localSaveByScope(`masters:${type}`, data)
  if (!MASTER_COLLECTION_KEYS.includes(type)) {
    return savedRecord
  }

  const config = await localGetWorkspaceConfig()
  const currentCollection = Array.isArray(config.masters?.[type]) ? config.masters[type] : []
  const existingIndex = currentCollection.findIndex((item) => item.id === savedRecord.id)
  const nextCollection = existingIndex >= 0
    ? currentCollection.map((item, index) => (index === existingIndex ? { ...item, ...savedRecord } : item))
    : [savedRecord, ...currentCollection]

  await localSaveByScope('workspace-masters', {
    id: 'default-masters',
    ...(config.masters || {}),
    [type]: nextCollection,
  })

  return savedRecord
}

export async function localDeleteMasterRecord(type, recordId) {
  await localDeleteByScope(`masters:${type}`, recordId)
  if (!MASTER_COLLECTION_KEYS.includes(type)) {
    return
  }

  const config = await localGetWorkspaceConfig()
  const currentCollection = Array.isArray(config.masters?.[type]) ? config.masters[type] : []
  await localSaveByScope('workspace-masters', {
    id: 'default-masters',
    ...(config.masters || {}),
    [type]: currentCollection.filter((item) => item.id !== recordId),
  })
}

export async function localSaveSettingsBundle(data) {
  const saved = await localSaveByScope('workspace-settings', { id: 'default-settings', ...data })
  return saved.payload || {}
}

export async function localCreateSubstation(data, actor = null) {
  const savedRow = await localSaveByScope('substations', data)
  const row = null

  const actorRole = String(actor?.role || '').trim().toLowerCase()
  const actorSubstationId = String(actor?.substation_id || actor?.substationId || '').trim()
  const effectiveSubstationId = row?.id || savedRow?.id
  if (actorRole === 'substation_admin' && !actorSubstationId && effectiveSubstationId) {
    const actorEmail = String(actor?.email || '').trim().toLowerCase()
    const actorUserId = String(actor?.auth_user_id || actor?.id || '').trim()
    let updateResult = null

    if (actorUserId) {
      updateResult = await supabase
        .from('profiles')
        .update({ substation_id: effectiveSubstationId })
        .eq('auth_user_id', actorUserId)
        .select('id')
    }

    if ((!updateResult?.data || !updateResult.data.length) && actorEmail) {
      updateResult = await supabase
        .from('profiles')
        .update({ substation_id: effectiveSubstationId })
        .ilike('email', actorEmail)
        .select('id')
    }

    if (updateResult?.error) {
      throw updateResult.error
    }
  }

  return row || savedRow
}

export async function localListEmployees(filters = {}) {
  let rows = await localListByScope('employees')
  if (filters.substationId) rows = rows.filter((item) => item.substation_id === filters.substationId)
  if (filters.employeeType) rows = rows.filter((item) => item.employee_type === filters.employeeType)
  if (filters.search) rows = rows.filter((item) => JSON.stringify(item).toLowerCase().includes(String(filters.search).toLowerCase()))
  return rows
}

export async function localCreateEmployee(data) {
  return localSaveByScope('employees', data)
}

export async function localUpdateEmployee(employeeId, data) {
  return localSaveByScope('employees', { ...data, id: employeeId })
}

export async function localDeleteEmployee(employeeId) {
  await localDeleteByScope('employees', employeeId)
}

export async function localListAttendanceSheets(filters = {}) {
  return filterByObject(await localListByScope('attendance-sheets'), filters)
}

export async function localSaveAttendanceSheet(data) {
  return localSaveByScope('attendance-sheets', data)
}

export async function localDeleteAttendanceSheet(documentId) {
  await localDeleteByScope('attendance-sheets', documentId)
}

export async function localListDlrRecords(filters = {}) {
  return filterByObject(await localListByScope('dlr-records'), filters)
}

export async function localSaveDlrRecord(data) {
  return localSaveByScope('dlr-records', data)
}

export async function localDeleteDlrRecord(recordId) {
  await localDeleteByScope('dlr-records', recordId)
}

export async function localListReportSnapshots(filters = {}) {
  return filterByObject(await localListByScope('report-snapshots'), filters)
}

export async function localSaveReportSnapshot(data) {
  return localSaveByScope('report-snapshots', data)
}

export async function localListNotices(filters = {}) {
  return filterByObject(await localListByScope('notices'), filters)
}

export async function localSaveNotice(data) {
  return localSaveByScope('notices', data)
}

export async function localDeleteNotice(noticeId) {
  await localDeleteByScope('notices', noticeId)
}

export async function localListFeedbackEntries(filters = {}) {
  return filterByObject(await localListByScope('feedback'), filters)
}

export async function localSaveFeedbackEntry(data) {
  return localSaveByScope('feedback', data)
}

export async function localUpdateFeedbackEntry(feedbackId, data) {
  return localSaveByScope('feedback', { ...data, id: feedbackId })
}

export async function localExportWorkspaceBackup() {
  const scopes = [
    'attendance-sheets', 'dlr-records', 'feedback', 'notices', 'report-snapshots',
    'employees', 'user-substation-mappings', 'audit-events', 'workspace-masters', 'workspace-settings',
  ]
  const snapshot = {}
  for (const scope of scopes) {
    snapshot[scope] = await idbListRecords(scope)
  }
  return snapshot
}

export async function localImportWorkspaceBackup(snapshot) {
  const entries = Object.entries(snapshot || {})
  for (const [scope, records] of entries) {
    for (const row of records || []) {
      await idbPutRecord(scope, row)
      await idbQueueUpsert(scope, row)
    }
  }
  await triggerSync()
  return { ok: true }
}

export function clearLocalSession() {
  // Firebase SDK session persistence handles sign-out state.
}

export function getLocalSessionToken() {
  return ''
}

export function hasLocalRecoveryToken() {
  return false
}

function normalizeRecord(data) {
  const id = data.id || crypto.randomUUID()
  const updated_at = data.updated_at || data.updatedAt || new Date().toISOString()
  const device_id = data.device_id || getDeviceId()
  const updated_by = data.updated_by || firebaseAuth?.currentUser?.uid || ''
  return {
    id,
    payload: data,
    entity_type: data.entity_type || '',
    operation_type: data.operation_type || (data.createdAt ? 'update' : 'create'),
    sync_status: 'pending',
    retry_count: 0,
    last_error: '',
    updated_at,
    client_updated_at: updated_at,
    base_server_updated_at: data.base_server_updated_at || data.server_received_at || '',
    device_id,
    updated_by,
  }
}

async function localSaveByScope(scope, data) {
  const existingRows = await idbListRecords(scope)
  const existing = existingRows.find((item) => item.id === (data.id || ''))
  const record = normalizeRecord({
    ...data,
    entity_type: scope,
    operation_type: existing ? 'update' : 'create',
    base_server_updated_at: existing?.server_received_at || existing?.updated_at || '',
  })
  await idbPutRecord(scope, record)
  await idbQueueUpsert(scope, record)
  scheduleSync()
  if (supabase && navigator.onLine) {
    try {
      await triggerSync()
    } catch {
      // Background retry already scheduled; avoid save-flow crash on transient sync errors.
    }
  }
  return { ...record.payload, id: record.id, updatedAt: record.updated_at, updated_at: record.updated_at }
}

async function localDeleteByScope(scope, id) {
  const updatedAt = new Date().toISOString()
  await idbDeleteRecord(scope, id)
  await idbQueueDelete(scope, id, updatedAt, getDeviceId(), firebaseAuth?.currentUser?.uid || '')
  scheduleSync()
  if (supabase && navigator.onLine) {
    try {
      await triggerSync()
    } catch {
      // Background retry already scheduled; avoid delete-flow crash on transient sync errors.
    }
  }
}

async function ensureLegacyRecordCloudMirror(scope, records) {
  if (!supabase || !navigator.onLine || !Array.isArray(records) || !records.length) {
    return
  }
  let enqueued = false
  for (const row of records) {
    if (
      row?.deleted ||
      row?.server_received_at ||
      !row?.id ||
      !row?.payload ||
      typeof row.payload !== 'object'
    ) {
      continue
    }
    await idbQueueUpsert(scope, {
      id: row.id,
      payload: row.payload,
      operation_type: 'update',
      updated_at: row.updated_at || new Date().toISOString(),
      client_updated_at: row.client_updated_at || row.updated_at || new Date().toISOString(),
      base_server_updated_at: '',
      device_id: row.device_id || getDeviceId(),
      updated_by: row.updated_by || firebaseAuth?.currentUser?.uid || '',
    })
    enqueued = true
  }
  if (enqueued) {
    scheduleSync(50)
  }
}

async function localListByScope(scope) {
  if (supabase && navigator.onLine) {
    await syncScope(scope)
  }
  const records = await idbListRecords(scope)
  await ensureLegacyRecordCloudMirror(scope, records)
  return records
    .filter((row) => !row.deleted)
    .map((row) => ({
      ...row.payload,
      id: row.id,
      updated_at: row.updated_at,
      updatedAt: row.updated_at,
      device_id: row.device_id || row.payload?.device_id || '',
      updated_by: row.updated_by || row.payload?.updated_by || '',
      client_updated_at: row.client_updated_at || row.updated_at,
      server_received_at: row.server_received_at || row.updated_at,
      version: row.version || 1,
    }))
}

function filterByObject(collection, filters) {
  return collection.filter((item) =>
    Object.entries(filters || {}).every(([key, value]) => {
      if (
        value === null ||
        value === undefined ||
        value === '' ||
        key === 'profile' ||
        typeof value === 'object'
      ) {
        return true
      }
      return (
        item[key] === value ||
        String(item[key] || '').startsWith(String(value))
      )
    }),
  )
}
