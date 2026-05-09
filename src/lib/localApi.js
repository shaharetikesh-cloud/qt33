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
  idbListPendingOutbox,
  idbListRecords,
  idbPutRecord,
  idbQueueDelete,
  idbQueueUpsert,
} from './indexedDb'
import { getDeviceId } from './clientIdentity'
import { supabase, supabaseConfigError } from './supabase'
import { scheduleSync, syncScope, triggerSync } from './syncEngine'
import { firebaseConfigError } from './firebase'
import {
  canAccessSubstationForUser,
  getAllowedSubstationIdsForUser,
  getAllowedSubstationsForUser,
  normalizeAccessRole,
} from './substationAccess'

const MASTER_COLLECTION_KEYS = ['divisions', 'feeders', 'batterySets', 'transformers']
const recentWriteFingerprintByScope = new Map()
const DUPLICATE_WRITE_WINDOW_MS = 1500

async function getAuthToken() {
  const user = firebaseAuth?.currentUser
  if (!user) return ''
  return user.getIdToken()
}

function isAdminFunctionsEnabled() {
  return String(import.meta.env.VITE_SUPABASE_ADMIN_FUNCTIONS || '').toLowerCase() === 'true'
}

function isBigintTypeMismatch(error) {
  const message = String(error?.message || '').toLowerCase()
  return (
    String(error?.code || '') === '22P02' &&
    message.includes('invalid input syntax for type bigint')
  )
}

function logColumnTypeMismatch(context, error, extra = {}) {
  console.warn('[schema:type-mismatch]', {
    context,
    code: String(error?.code || ''),
    message: String(error?.message || ''),
    ...extra,
  })
}

function isNumericId(value) {
  return /^\d+$/.test(String(value || '').trim())
}

function logWritePayload(table, operation, payload, watchedFields = []) {
  const entries = Object.entries(payload || {}).map(([field, value]) => ({
    field,
    value,
    typeof: typeof value,
  }))
  const filteredEntries = watchedFields.length
    ? entries.filter((item) => watchedFields.includes(item.field))
    : entries
  console.info('[db-write-payload]', {
    table,
    operation,
    fields: filteredEntries,
  })
}

function assertNumericSubstationIdOrThrow(value, context) {
  const normalized = String(value || '').trim()
  if (!normalized) {
    return
  }
  if (!isNumericId(normalized)) {
    throw new Error(
      `${context}: profiles.substation_id must be numeric bigint. Received "${normalized}".`,
    )
  }
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

async function getProfileByFirebaseUid(uid) {
  const byFirebase = await supabase
    .from('profiles')
    .select('*')
    .eq('firebase_uid', uid)
    .maybeSingle()
  if (byFirebase.error) {
    return byFirebase
  }
  if (byFirebase.data) {
    return byFirebase
  }
  const byAuthUser = await supabase
    .from('profiles')
    .select('*')
    .eq('auth_user_id', uid)
    .maybeSingle()
  if (isBigintTypeMismatch(byAuthUser.error)) {
    logColumnTypeMismatch('profiles.auth_user_id lookup', byAuthUser.error, {
      lookup: 'auth_user_id',
    })
    return { data: null, error: null }
  }
  return byAuthUser
}

function normalizeRole(role) {
  const normalized = String(role || '').trim().toLowerCase()
  if (normalized === 'super_admin' || normalized === 'substation_admin') {
    return normalized
  }
  return normalized || 'normal_user'
}

async function applyMonthlyAutoDisable(rows = []) {
  return rows
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
    .eq('email', String(email || '').trim().toLowerCase())
    .maybeSingle()
}

async function updateMustChangePasswordByUid(uid) {
  const nextPayload = { must_change_password: false }
  const byFirebase = await supabase
    .from('profiles')
    .update(nextPayload)
    .eq('firebase_uid', uid)
    .select('id')
  if (byFirebase.error) {
    throw byFirebase.error
  }
  if ((byFirebase.data || []).length > 0) {
    return
  }
  const byAuthUser = await supabase
    .from('profiles')
    .update(nextPayload)
    .eq('auth_user_id', uid)
    .select('id')
  if (isBigintTypeMismatch(byAuthUser.error)) {
    logColumnTypeMismatch('profiles.auth_user_id update', byAuthUser.error, {
      operation: 'update must_change_password',
    })
    return
  }
  if (byAuthUser.error) {
    throw byAuthUser.error
  }
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
      let { data: updatedByEmail, error: updateError } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', emailProfile.id)
        .select('*')
        .single()
      if (isBigintTypeMismatch(updateError)) {
        logColumnTypeMismatch('profiles.update(auth_user_id)', updateError, {
          profileId: emailProfile.id,
        })
        const fallbackPatch = { ...patch }
        delete fallbackPatch.auth_user_id
        const fallback = await supabase
          .from('profiles')
          .update(fallbackPatch)
          .eq('id', emailProfile.id)
          .select('*')
          .single()
        updatedByEmail = fallback.data
        updateError = fallback.error
      }
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
  let { data: inserted, error: insertError } = await supabase
    .from('profiles')
    .insert(insertRow)
    .select('*')
    .single()
  if (isBigintTypeMismatch(insertError)) {
    logColumnTypeMismatch('profiles.insert(auth_user_id)', insertError, {
      firebaseUid: user.uid,
    })
    const fallbackRow = { ...insertRow }
    delete fallbackRow.auth_user_id
    const fallback = await supabase
      .from('profiles')
      .insert(fallbackRow)
      .select('*')
      .single()
    inserted = fallback.data
    insertError = fallback.error
  }

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

  let profileSaveResult = existingProfile?.id
    ? await supabase.from('profiles').update(row).eq('id', existingProfile.id).select('*').single()
    : await supabase
      .from('profiles')
      .insert({
        ...row,
        created_at: createdAtIso,
      })
      .select('*')
      .single()

  if (isBigintTypeMismatch(profileSaveResult.error)) {
    logColumnTypeMismatch('profiles.signup(auth_user_id)', profileSaveResult.error, {
      email,
    })
    const fallbackRow = { ...row }
    delete fallbackRow.auth_user_id
    profileSaveResult = existingProfile?.id
      ? await supabase.from('profiles').update(fallbackRow).eq('id', existingProfile.id).select('*').single()
      : await supabase
        .from('profiles')
        .insert({
          ...fallbackRow,
          created_at: createdAtIso,
        })
        .select('*')
        .single()
  }

  const profileSaveError = profileSaveResult.error

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
    await updateMustChangePasswordByUid(user.uid)
  }
  return { message: 'Password updated.' }
}

export async function localListUsers(filters = {}) {
  if (!supabase) throw new Error('Supabase not configured.')
  const actor = filters.actor || null
  const role = normalizeAccessRole(actor?.role)
  const substationsForAccess = await localListSubstations({ actor: null })
  const mappingsForAccess = await localListUserSubstationMappings()
  const allowedSubstationIds = getAllowedSubstationIdsForUser({
    profile: actor,
    substations: substationsForAccess,
    mappings: mappingsForAccess,
  })

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
  let users = await applyMonthlyAutoDisable(data ?? [])

  if (actor && role !== 'super_admin') {
    const actorProfileId = String(actor?.id || '').trim()
    const actorAuthUserId = String(actor?.auth_user_id || actor?.firebase_uid || '').trim()
    const actorEmail = String(actor?.email || '').trim().toLowerCase()

    users = users.filter((user) => {
      if (role === 'substation_admin') {
        const creatorCandidates = [
          user?.created_by_profile_id,
          user?.createdByProfileId,
          user?.created_by_auth_user_id,
          user?.createdByAuthUserId,
          user?.parent_admin_id,
          user?.parentAdminId,
          user?.created_by,
          user?.createdBy,
          user?.created_by_email,
          user?.createdByEmail,
        ]
          .map((value) => String(value || '').trim().toLowerCase())
          .filter(Boolean)
        const matchesCreator =
          (actorProfileId && creatorCandidates.includes(actorProfileId.toLowerCase())) ||
          (actorAuthUserId && creatorCandidates.includes(actorAuthUserId.toLowerCase())) ||
          (actorEmail && creatorCandidates.includes(actorEmail))
        if (!matchesCreator) {
          return false
        }
      }

      const substationId = String(user?.substation_id || '').trim()
      if (!substationId) {
        return role === 'substation_admin' ? normalizeAccessRole(user?.role) !== 'super_admin' : true
      }
      return Array.isArray(allowedSubstationIds) ? allowedSubstationIds.includes(substationId) : false
    })
  }

  console.info('[access:listUsers]', {
    role,
    profileId: actor?.id || actor?.auth_user_id || '',
    allowedSubstationIds,
    queryFilters: {
      role: filters.role || '',
      status: filters.status || '',
      substationId: filters.substationId || '',
      search: filters.search ? '[set]' : '',
    },
  })
  return {
    users,
    pagination: { page, pageSize, total: count || 0, totalPages: Math.ceil((count || 0) / pageSize) || 1 },
  }
}

export async function localCreateUser(data, actor = null) {
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
  const substationsForAccess = await localListSubstations({ actor: null })
  const mappingsForAccess = await localListUserSubstationMappings()
  const allowedSubstationIds = getAllowedSubstationIdsForUser({
    profile: actor,
    substations: substationsForAccess,
    mappings: mappingsForAccess,
  })
  const targetSubstationId = String(data.substationId || '').trim()
  if (
    actor &&
    normalizeAccessRole(actor?.role) !== 'super_admin' &&
    targetSubstationId &&
    (!Array.isArray(allowedSubstationIds) || !allowedSubstationIds.includes(targetSubstationId))
  ) {
    console.warn('[access:block:createUser]', {
      role: normalizeAccessRole(actor?.role),
      profileId: actor?.id || actor?.auth_user_id,
      allowedSubstationIds,
      selectedSubstationId: targetSubstationId,
    })
    throw new Error('Selected substation access denied.')
  }

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
    substation_id: targetSubstationId || null,
    created_by_profile_id: actor?.id || null,
    parent_admin_id: normalizeAccessRole(actor?.role) === 'substation_admin' ? actor?.id || null : null,
  }
  assertNumericSubstationIdOrThrow(profileRow.substation_id, 'create user flow')
  logWritePayload('profiles', 'insert', profileRow, [
    'auth_user_id',
    'firebase_uid',
    'substation_id',
    'parent_admin_id',
    'created_by_profile_id',
  ])
  let { data: saved, error } = await supabase.from('profiles').insert(profileRow).select('*').single()
  if (isBigintTypeMismatch(error)) {
    logColumnTypeMismatch('profiles.insert(admin-create-user)', error, {
      actorId: actor?.id || '',
      role,
    })
    const fallbackRow = { ...profileRow }
    delete fallbackRow.auth_user_id
    const fallback = await supabase.from('profiles').insert(fallbackRow).select('*').single()
    saved = fallback.data
    error = fallback.error
  }
  if (error) throw error
  return {
    ...saved,
    username,
  }
}

export async function localUpdateUser(userId, data, actor = null) {
  const { data: existing, error: existingError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (existingError) throw existingError

  const substationsForAccess = await localListSubstations({ actor: null })
  const mappingsForAccess = await localListUserSubstationMappings()
  const allowedSubstationIds = getAllowedSubstationIdsForUser({
    profile: actor,
    substations: substationsForAccess,
    mappings: mappingsForAccess,
  })
  const role = normalizeAccessRole(actor?.role)
  const currentTargetSubstationId = String(existing?.substation_id || '').trim()
  const nextTargetSubstationId = String(data.substationId || '').trim()
  const blockedCurrent =
    role !== 'super_admin' &&
    currentTargetSubstationId &&
    (!Array.isArray(allowedSubstationIds) || !allowedSubstationIds.includes(currentTargetSubstationId))
  const blockedNext =
    role !== 'super_admin' &&
    nextTargetSubstationId &&
    (!Array.isArray(allowedSubstationIds) || !allowedSubstationIds.includes(nextTargetSubstationId))
  if (blockedCurrent || blockedNext) {
    console.warn('[access:block:updateUser]', {
      role,
      profileId: actor?.id || actor?.auth_user_id,
      allowedSubstationIds,
      selectedSubstationId: nextTargetSubstationId || currentTargetSubstationId,
    })
    throw new Error('User update access denied for selected substation.')
  }

  const patch = {
    username: data.username,
    full_name: data.fullName,
    mobile: data.mobile,
    role: data.role,
    is_active: Boolean(data.isActive),
    substation_id: data.substationId || null,
    module_permissions: { modules: { employees: { delete: Boolean(data.allowDelete) } } },
  }
  assertNumericSubstationIdOrThrow(patch.substation_id, 'update user flow')
  logWritePayload('profiles', 'update', {
    id: userId,
    ...patch,
  }, [
    'id',
    'substation_id',
    'role',
    'is_active',
  ])
  const { data: saved, error } = await supabase.from('profiles').update(patch).eq('id', userId).select('*').single()
  if (error) throw error
  return saved
}

export async function localDeleteUser(userId, actor = null) {
  const { data: existing, error: existingError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (existingError) throw existingError
  const substationsForAccess = await localListSubstations({ actor: null })
  const mappingsForAccess = await localListUserSubstationMappings()
  const allowedSubstationIds = getAllowedSubstationIdsForUser({
    profile: actor,
    substations: substationsForAccess,
    mappings: mappingsForAccess,
  })
  const role = normalizeAccessRole(actor?.role)
  const targetSubstationId = String(existing?.substation_id || '').trim()
  if (
    actor &&
    role !== 'super_admin' &&
    targetSubstationId &&
    (!Array.isArray(allowedSubstationIds) || !allowedSubstationIds.includes(targetSubstationId))
  ) {
    console.warn('[access:block:deleteUser]', {
      role,
      profileId: actor?.id || actor?.auth_user_id,
      allowedSubstationIds,
      selectedSubstationId: targetSubstationId,
    })
    throw new Error('User delete access denied for selected substation.')
  }

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

export async function localGetDashboardSummary(actor = null) {
  const [substations, employees, notices, feedback] = await Promise.all([
    localListSubstations({ actor }),
    localListEmployees({ actor }),
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
    await updateMustChangePasswordByUid(user.uid)
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
  logWritePayload('user_substation_mappings', 'upsert(local-scope)', data, [
    'userId',
    'user_id',
    'substationId',
    'substation_id',
    'parent_admin_id',
  ])
  return localSaveByScope('user-substation-mappings', data)
}

export async function localDeleteUserSubstationMapping(mappingId) {
  await localDeleteByScope('user-substation-mappings', mappingId)
}

export async function localListSubstations({ actor = null } = {}) {
  const scopedRows = await localListByScope('substations')
  const mappings = actor ? await localListUserSubstationMappings() : []
  const visibleRows = actor
    ? getAllowedSubstationsForUser({
        profile: actor,
        substations: scopedRows,
        mappings,
      })
    : scopedRows
  const sortedRows = [...visibleRows].sort((left, right) =>
    String(left?.name || '').localeCompare(String(right?.name || '')),
  )
  if (actor) {
    console.info('[access:listSubstations]', {
      role: normalizeAccessRole(actor?.role),
      profileId: actor?.id || actor?.auth_user_id,
      allowedSubstationIds: getAllowedSubstationIdsForUser({
        profile: actor,
        substations: scopedRows,
        mappings,
      }),
    })
  }
  return sortedRows
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
  const actorProfileId = String(actor?.id || actor?.profile_id || '').trim()
  const actorAuthUserId = String(
    actor?.auth_user_id ||
      actor?.authUserId ||
      actor?.firebase_uid ||
      firebaseAuth?.currentUser?.uid ||
      actor?.id ||
      '',
  ).trim()
  const actorEmail = String(actor?.email || '').trim().toLowerCase()
  const payload = {
    ...data,
    created_by: actorAuthUserId || actorProfileId || '',
    createdBy: actorAuthUserId || actorProfileId || '',
    created_by_profile_id: actorProfileId || null,
    created_by_auth_user_id: actorAuthUserId,
    created_by_email: actorEmail || '',
    parent_admin_id:
      normalizeAccessRole(actor?.role) === 'substation_admin'
        ? actorProfileId || actorAuthUserId || null
        : null,
  }
  logWritePayload('substations', 'insert(local-scope)', payload, [
    'id',
    'parent_admin_id',
    'created_by_profile_id',
    'created_by_auth_user_id',
    'created_by',
  ])
  const savedRow = await localSaveByScope('substations', payload)
  const row = null

  const actorRole = normalizeAccessRole(actor?.role)
  const actorSubstationId = String(actor?.substation_id || actor?.substationId || '').trim()
  const effectiveSubstationId = row?.id || savedRow?.id
  const resolvedSubstationIdForProfile = isNumericId(row?.id)
    ? String(row.id)
    : isNumericId(savedRow?.substation_id)
      ? String(savedRow.substation_id)
      : ''

  if (effectiveSubstationId && !resolvedSubstationIdForProfile) {
    console.warn('[schema:type-mismatch]', {
      context: 'substation-create-profile-link',
      message:
        'Substation saved with non-numeric local id; skipping profiles.substation_id update to avoid bigint cast failure.',
      substationIdCandidate: String(effectiveSubstationId),
      parent_admin_id: String(savedRow?.parent_admin_id || ''),
      parent_admin_typeof: typeof savedRow?.parent_admin_id,
    })
  }
  if (actorRole === 'substation_admin' && !actorSubstationId && effectiveSubstationId) {
    const actorUserId = actorAuthUserId
    let updateResult = null

    if (actorUserId && resolvedSubstationIdForProfile) {
      assertNumericSubstationIdOrThrow(resolvedSubstationIdForProfile, 'substation create flow')
      logWritePayload(
        'profiles',
        'update(substation_id by auth_user_id)',
        {
          auth_user_id: actorUserId,
          substation_id: resolvedSubstationIdForProfile,
          parent_admin_id: savedRow?.parent_admin_id || null,
        },
        ['auth_user_id', 'substation_id', 'parent_admin_id'],
      )
      updateResult = await supabase
        .from('profiles')
        .update({ substation_id: resolvedSubstationIdForProfile })
        .eq('auth_user_id', actorUserId)
        .select('id')
    }

    if ((!updateResult?.data || !updateResult.data.length) && actorEmail && resolvedSubstationIdForProfile) {
      assertNumericSubstationIdOrThrow(resolvedSubstationIdForProfile, 'substation create flow')
      logWritePayload(
        'profiles',
        'update(substation_id by email)',
        {
          email: actorEmail,
          substation_id: resolvedSubstationIdForProfile,
          parent_admin_id: savedRow?.parent_admin_id || null,
        },
        ['email', 'substation_id', 'parent_admin_id'],
      )
      updateResult = await supabase
        .from('profiles')
        .update({ substation_id: resolvedSubstationIdForProfile })
        .ilike('email', actorEmail)
        .select('id')
    }

    if (updateResult?.error) {
      throw updateResult.error
    }
  }

  if (supabase && navigator.onLine && effectiveSubstationId) {
    try {
      await triggerSync()
      const pendingOutbox = await idbListPendingOutbox(300)
      const stillPending = pendingOutbox.find(
        (item) =>
          (item.entity_type || item.scope) === 'substations' &&
          item.id === effectiveSubstationId &&
          item.operation_type !== 'delete',
      )
      if (stillPending) {
        console.warn('[sync:substation:create:pending]', {
          substationId: effectiveSubstationId,
          retryCount: stillPending.retry_count || 0,
          lastError: stillPending.last_error || '',
        })
        throw new Error(
          'Substation local save zala, pan cloud sync pending aahe. Network/Supabase access check kara.',
        )
      }
    } catch (syncError) {
      if (syncError instanceof Error) {
        throw syncError
      }
      throw new Error('Substation save zala, pan immediate cloud sync verify hou shakla nahi.')
    }
  }

  return row || savedRow
}

export async function localUpdateSubstation(substationId, data, actor = null) {
  const targetId = String(substationId || data?.id || '').trim()
  if (!targetId) {
    throw new Error('Substation id required aahe.')
  }

  const actorProfileId = String(actor?.id || actor?.profile_id || '').trim()
  const actorAuthUserId = String(
    actor?.auth_user_id ||
      actor?.authUserId ||
      actor?.firebase_uid ||
      firebaseAuth?.currentUser?.uid ||
      actor?.id ||
      '',
  ).trim()

  const payload = {
    ...data,
    id: targetId,
    updated_by: actorAuthUserId || actorProfileId || '',
    updatedBy: actorAuthUserId || actorProfileId || '',
  }
  logWritePayload('substations', 'update(local-scope)', payload, [
    'id',
    'updated_by',
    'updatedBy',
    'parent_admin_id',
  ])
  return localSaveByScope('substations', payload)
}

export async function localDeleteSubstation(substationId, actor = null) {
  const targetId = String(substationId || '').trim()
  if (!targetId) {
    throw new Error('Substation id required aahe.')
  }
  if (actor) {
    const role = normalizeAccessRole(actor?.role)
    if (role !== 'super_admin' && role !== 'substation_admin') {
      throw new Error('Substation delete access denied.')
    }
    if (role !== 'super_admin') {
      const substationsForAccess = await localListSubstations({ actor: null })
      const mappingsForAccess = await localListUserSubstationMappings()
      const hasAccess = canAccessSubstationForUser({
        profile: actor,
        substationId: targetId,
        substations: substationsForAccess,
        mappings: mappingsForAccess,
      })
      if (!hasAccess) {
        throw new Error('Substation delete access denied for selected substation.')
      }
    }
  }
  await localDeleteByScope('substations', targetId)
  return { ok: true }
}

export async function localListEmployees(filters = {}) {
  let rows = await localListByScope('employees')
  if (filters.actor) {
    const substations = await localListSubstations({ actor: null })
    const mappings = await localListUserSubstationMappings()
    const allowedSubstationIds = getAllowedSubstationIdsForUser({
      profile: filters.actor,
      substations,
      mappings,
    })
    if (Array.isArray(allowedSubstationIds)) {
      rows = rows.filter((item) => allowedSubstationIds.includes(String(item.substation_id || '').trim()))
    }
    console.info('[access:listEmployees]', {
      role: normalizeAccessRole(filters.actor?.role),
      profileId: filters.actor?.id || filters.actor?.auth_user_id || '',
      allowedSubstationIds,
      queryFilters: {
        substationId: filters.substationId || '',
        employeeType: filters.employeeType || '',
      },
    })
  }
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

export async function localGetScopeSnapshot(scope) {
  const normalizedScope = String(scope || '').trim()
  if (!normalizedScope) {
    return []
  }
  const rows = await localListByScope(normalizedScope)
  const snapshotId = `${normalizedScope}-snapshot`
  const snapshot =
    rows.find((row) => row.id === snapshotId) ||
    rows[0]
  if (!snapshot) {
    return []
  }
  return Array.isArray(snapshot.items) ? snapshot.items : []
}

export async function localSaveScopeSnapshot(scope, items) {
  const normalizedScope = String(scope || '').trim()
  if (!normalizedScope) {
    throw new Error('Scope is required.')
  }
  return localSaveByScope(normalizedScope, {
    id: `${normalizedScope}-snapshot`,
    items: Array.isArray(items) ? items : [],
  })
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

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function shouldSuppressDuplicateScopeWrite(scope, data, existing) {
  const fingerprint = `${scope}:${data?.id || ''}:${stableStringify(data)}`
  const now = Date.now()
  const previous = recentWriteFingerprintByScope.get(scope)
  recentWriteFingerprintByScope.set(scope, { fingerprint, at: now })
  if (!existing || !previous) {
    return false
  }
  return previous.fingerprint === fingerprint && now - previous.at < DUPLICATE_WRITE_WINDOW_MS
}

async function localSaveByScope(scope, data) {
  const existingRows = await idbListRecords(scope)
  const existing = existingRows.find((item) => item.id === (data.id || ''))
  if (shouldSuppressDuplicateScopeWrite(scope, data, existing)) {
    return {
      ...data,
      id: data.id,
      updatedAt: existing?.updated_at || new Date().toISOString(),
      updated_at: existing?.updated_at || new Date().toISOString(),
      duplicateSuppressed: true,
    }
  }
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
