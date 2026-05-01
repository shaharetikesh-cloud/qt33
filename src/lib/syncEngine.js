import {
  idbCleanupSyncedOutbox,
  idbGetMeta,
  idbRequeueFailedOutbox,
  idbRequeueOutboxByStatus,
  idbGetSyncCounts,
  idbListOutbox,
  idbListPendingOutbox,
  idbPutRecord,
  idbSetMeta,
  idbUpdateOutboxStatus,
} from './indexedDb'
import {
  getSupabaseAccessToken,
  getSupabaseAuthDiagnostics,
  supabase,
} from './supabase'
import { firebaseAuth } from './firebase'

const listeners = new Set()
let syncInFlight = false
let syncTimer = null
let cloudSyncAvailable = null
let cloudProbeInFlight = null
let cloudProbeAuthBackoffUntil = 0
let cloudProbeAuthFailureCount = 0
let realtimeChannels = []
let realtimeFlushTimer = null
const realtimeChangedScopes = new Set()
const REALTIME_FLUSH_DEBOUNCE_MS = 450
const REALTIME_BATCH_LIMIT = 12
const SYNCED_OUTBOX_RETENTION_MS = 24 * 60 * 60 * 1000

const syncState = {
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  pending: 0,
  failed: 0,
  authErrors: 0,
  synced: 0,
  syncing: false,
  conflicts: 0,
  lastSyncAt: '',
  runTotal: 0,
  runProcessed: 0,
  runPulled: 0,
  runPushed: 0,
  health: 'healthy',
  firebaseJwtAccepted: null,
  realtimeConnected: false,
  lastError: '',
  lastConflictAt: '',
}

function normalizeSyncCursor(cursorValue) {
  const fallback = '1970-01-01T00:00:00.000Z'
  const parsed = Date.parse(String(cursorValue || ''))
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  // Guard against device clock drift that writes cursor into future and blocks pulls.
  if (parsed > Date.now() + 5 * 60 * 1000) {
    return fallback
  }
  return new Date(parsed).toISOString()
}

function isMissingErpRecordsError(error) {
  const status = Number(error?.status || error?.statusCode || 0)
  const code = String(error?.code || '').toUpperCase()
  const message = String(error?.message || '').toLowerCase()
  return (
    status === 404 ||
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes("could not find the table 'public.erp_records'") ||
    (message.includes('relation') &&
      message.includes('erp_records') &&
      message.includes('does not exist'))
  )
}

function isAuthorizationSyncError(error) {
  const status = Number(error?.status || error?.statusCode || 0)
  const code = String(error?.code || '').toUpperCase()
  return status === 401 || status === 403 || code === '42501'
}

async function canRunCloudSync() {
  const auth = getSupabaseAuthDiagnostics()
  let hasFirebaseToken = false
  if (firebaseAuth?.currentUser) {
    try {
      hasFirebaseToken = Boolean(await firebaseAuth.currentUser.getIdToken())
    } catch {
      hasFirebaseToken = false
    }
  }
  const hasToken = Boolean(await getSupabaseAccessToken())
  return {
    ...auth,
    hasFirebaseToken,
    hasToken,
    ready: auth.hasFirebaseUser && hasFirebaseToken && hasToken,
  }
}

async function ensureCloudSyncAvailability() {
  if (!supabase) {
    return false
  }
  const now = Date.now()
  if (cloudProbeAuthBackoffUntil > now) {
    return false
  }
  if (cloudSyncAvailable !== null) {
    return cloudSyncAvailable
  }
  const authStatus = await canRunCloudSync()
  if (!authStatus.ready) {
    return false
  }
  if (cloudProbeInFlight) {
    return cloudProbeInFlight
  }
  cloudProbeInFlight = (async () => {
    const { error } = await supabase.from('erp_records').select('id', { head: true, count: 'exact' })
    if (error) {
      if (isAuthorizationSyncError(error)) {
        syncState.firebaseJwtAccepted = false
        cloudProbeAuthFailureCount += 1
        const backoffMs = Math.min(30_000 * (2 ** (cloudProbeAuthFailureCount - 1)), 5 * 60 * 1000)
        cloudProbeAuthBackoffUntil = Date.now() + backoffMs
        emitSyncState()
        console.info('[sync] firebase-jwt-rejected', {
          status: Number(error?.status || error?.statusCode || 0),
          backoffMs,
        })
      }
      cloudSyncAvailable = !isMissingErpRecordsError(error)
      return cloudSyncAvailable
    }
    syncState.firebaseJwtAccepted = true
    cloudProbeAuthFailureCount = 0
    cloudProbeAuthBackoffUntil = 0
    cloudSyncAvailable = true
    return true
  })()
  try {
    return await cloudProbeInFlight
  } finally {
    cloudProbeInFlight = null
  }
}

function emitSyncState() {
  for (const listener of listeners) {
    listener({ ...syncState })
  }
}

export function emitSyncStateSnapshot() {
  emitSyncState()
}

export function setOnlineState(nextOnline) {
  syncState.online = Boolean(nextOnline)
}

async function refreshCounters() {
  const counts = await idbGetSyncCounts()
  syncState.pending = counts.pending
  syncState.failed = counts.failed
  syncState.authErrors = counts.auth_errors || 0
  syncState.synced = counts.synced
  syncState.conflicts = counts.conflicts || 0
  syncState.health = syncState.authErrors > 0
    ? 'auth_error'
    : syncState.failed > 0
      ? 'degraded'
      : syncState.pending > 0
        ? 'pending'
        : 'healthy'
  emitSyncState()
}

function listChangedFields(current = {}, incoming = {}) {
  const fields = new Set([...Object.keys(current), ...Object.keys(incoming)])
  return [...fields].filter((field) => JSON.stringify(current[field]) !== JSON.stringify(incoming[field]))
}

async function detectAndMergeConflict(existing, operation) {
  const existingPayload = existing?.payload || {}
  const incomingPayload = operation.payload || {}
  const changedFields = listChangedFields(existingPayload, incomingPayload)
  if (!existing) {
    return { conflict: false, mergedPayload: incomingPayload, mergedVersion: 1 }
  }

  const staleByServerTime =
    operation.base_server_updated_at &&
    existing.updated_at &&
    new Date(existing.updated_at).getTime() > new Date(operation.base_server_updated_at).getTime()

  if (!staleByServerTime) {
    return {
      conflict: false,
      mergedPayload: { ...existingPayload, ...incomingPayload },
      mergedVersion: Number(existing.version || 0) + 1,
    }
  }

  const serverMeta = existingPayload.__sync_meta || {}
  const serverDevice = serverMeta.device_id || existing.device_id || ''
  const overlap = changedFields.filter((field) => field !== '__sync_meta')

  if (!overlap.length || serverDevice === operation.device_id) {
    return {
      conflict: false,
      mergedPayload: { ...existingPayload, ...incomingPayload },
      mergedVersion: Number(existing.version || 0) + 1,
    }
  }

  return { conflict: true, mergedPayload: null, mergedVersion: Number(existing.version || 1) }
}

async function applyUpsert(operation) {
  const scope = operation.entity_type || operation.scope
  const { data: existing } = await supabase
    .from('erp_records')
    .select('id, payload, updated_at, version, device_id')
    .eq('id', operation.id)
    .maybeSingle()

  const mergeResult = await detectAndMergeConflict(existing, operation)
  if (mergeResult.conflict) {
    syncState.lastConflictAt = new Date().toISOString()
    await idbUpdateOutboxStatus(operation.queue_id, 'conflict', {
      retry_count: operation.retry_count || 0,
      last_error: 'Conflict detected: newer server write exists on overlapping fields.',
      next_retry_at: Date.now() + 5 * 60 * 1000,
    })
    return { applied: false, conflict: true }
  }

  const payload = {
    ...mergeResult.mergedPayload,
    __sync_meta: {
      ...(mergeResult.mergedPayload?.__sync_meta || {}),
      updated_by: operation.updated_by || '',
      device_id: operation.device_id || '',
      client_updated_at: operation.client_updated_at || operation.updated_at,
      base_server_updated_at: operation.base_server_updated_at || '',
      operation_type: operation.operation_type,
    },
  }
  const row = {
    id: operation.id,
    scope,
    payload,
    // Use DB server time ordering to avoid cross-device clock skew.
    updated_at: new Date().toISOString(),
    client_updated_at: operation.client_updated_at || operation.updated_at,
    updated_by: operation.updated_by || null,
    device_id: operation.device_id || null,
    substation_id: payload.substationId || payload.substation_id || null,
    owner_user_id: payload.ownerUserId || payload.owner_user_id || null,
    version: mergeResult.mergedVersion,
    deleted: false,
  }
  const { data, error } = await supabase
    .from('erp_records')
    .upsert(row, { onConflict: 'id' })
    .select('updated_at,client_updated_at,updated_by,device_id,version')
    .single()
  if (error) throw error
  return { applied: true, conflict: false, serverRow: data || null }
}

async function applyDelete(operation) {
  const scope = operation.entity_type || operation.scope
  const { data, error } = await supabase
    .from('erp_records')
    .upsert(
      {
        id: operation.id,
        scope,
        payload: {},
        updated_at: new Date().toISOString(),
        client_updated_at: operation.client_updated_at || operation.updated_at,
        updated_by: operation.updated_by || null,
        device_id: operation.device_id || null,
        deleted: true,
      },
      { onConflict: 'id' },
    )
    .select('updated_at,client_updated_at,updated_by,device_id,version')
    .single()
  if (error) throw error
  return { serverRow: data || null }
}

function nextBackoffDelayMs(retryCount) {
  const base = 1000
  const max = 2 * 60 * 1000
  return Math.min(base * (2 ** retryCount), max)
}

export function scheduleSync(delayMs = 350) {
  if (syncTimer) {
    clearTimeout(syncTimer)
  }
  syncTimer = setTimeout(() => {
    syncTimer = null
    void triggerSync()
  }, delayMs)
}

export async function triggerSync() {
  if (!supabase || syncInFlight || !syncState.online) {
    return
  }
  const authStatus = await canRunCloudSync()
  if (!authStatus.ready) {
    await idbRequeueOutboxByStatus(['syncing'])
    syncState.lastError = authStatus.hasFirebaseUser ? '' : 'Login required for cloud sync.'
    await refreshCounters()
    emitSyncState()
    if (!authStatus.hasFirebaseUser) {
      console.info('[sync] paused-login-required', {
        userId: authStatus.userId || '',
        hasFirebaseUser: authStatus.hasFirebaseUser,
        hasFirebaseToken: authStatus.hasFirebaseToken,
        pending: syncState.pending,
        lastError: syncState.lastError,
      })
    }
    return
  }
  if (!(await ensureCloudSyncAvailability())) {
    return
  }
  await idbRequeueOutboxByStatus(['auth_error'])

  syncInFlight = true
  syncState.syncing = true
  syncState.runTotal = 0
  syncState.runProcessed = 0
  syncState.runPulled = 0
  syncState.runPushed = 0
  emitSyncState()
  try {
    const operations = await idbListPendingOutbox(120)
    syncState.runTotal = operations.length
    emitSyncState()
    for (const operation of operations) {
      try {
        await idbUpdateOutboxStatus(operation.queue_id, 'syncing', {
          sync_attempted_at: new Date().toISOString(),
        })
        if (operation.operation_type === 'delete') {
          await applyDelete(operation)
          syncState.runPushed += 1
        } else {
          const result = await applyUpsert(operation)
          if (result.conflict) {
            syncState.runProcessed += 1
            emitSyncState()
            continue
          }
          await idbPutRecord(operation.entity_type || operation.scope, {
            id: operation.id,
            payload: operation.payload,
            sync_status: 'synced',
            updated_at: result.serverRow?.updated_at || operation.updated_at,
            client_updated_at:
              result.serverRow?.client_updated_at || operation.client_updated_at,
            updated_by: result.serverRow?.updated_by || operation.updated_by,
            device_id: result.serverRow?.device_id || operation.device_id,
            version: Number(result.serverRow?.version || 1),
            deleted: false,
          })
          syncState.runPushed += 1
        }
        await idbUpdateOutboxStatus(operation.queue_id, 'synced', {
          synced_at: new Date().toISOString(),
          last_error: '',
          next_retry_at: Date.now(),
        })
      } catch (error) {
        if (isMissingErpRecordsError(error)) {
          cloudSyncAvailable = false
          return
        }
        if (isAuthorizationSyncError(error)) {
          const refreshedToken = await getSupabaseAccessToken({ forceRefresh: true })
          if (refreshedToken) {
            try {
              if (operation.operation_type === 'delete') {
                await applyDelete(operation)
                syncState.runPushed += 1
              } else {
                const retryResult = await applyUpsert(operation)
                if (!retryResult.conflict) {
                  await idbPutRecord(operation.entity_type || operation.scope, {
                    id: operation.id,
                    payload: operation.payload,
                    sync_status: 'synced',
                    updated_at: retryResult.serverRow?.updated_at || operation.updated_at,
                    client_updated_at:
                      retryResult.serverRow?.client_updated_at || operation.client_updated_at,
                    updated_by: retryResult.serverRow?.updated_by || operation.updated_by,
                    device_id: retryResult.serverRow?.device_id || operation.device_id,
                    version: Number(retryResult.serverRow?.version || 1),
                    deleted: false,
                  })
                  syncState.runPushed += 1
                }
              }
              await idbUpdateOutboxStatus(operation.queue_id, 'synced', {
                synced_at: new Date().toISOString(),
                last_error: '',
                next_retry_at: Date.now(),
              })
              continue
            } catch (retryError) {
              await idbUpdateOutboxStatus(operation.queue_id, 'auth_error', {
                retry_count: operation.retry_count || 0,
                next_retry_at: Date.now() + 30 * 1000,
                last_error: retryError instanceof Error ? retryError.message : 'Auth error',
              })
              syncState.lastError =
                retryError instanceof Error ? retryError.message : 'Auth error'
              break
            }
          }
          let refreshedFirebaseToken = false
          if (firebaseAuth?.currentUser) {
            try {
              refreshedFirebaseToken = Boolean(await firebaseAuth.currentUser.getIdToken())
            } catch {
              refreshedFirebaseToken = false
            }
          }
          await idbUpdateOutboxStatus(operation.queue_id, 'auth_error', {
            retry_count: operation.retry_count || 0,
            next_retry_at: Date.now() + 30 * 1000,
            last_error: error instanceof Error ? error.message : 'Auth error',
          })
          syncState.lastError = error instanceof Error ? error.message : 'Auth error'
          console.info('[sync] auth-error', {
            hasFirebaseUser: Boolean(firebaseAuth?.currentUser),
            hasFirebaseToken: refreshedFirebaseToken,
            firebaseJwtAccepted: syncState.firebaseJwtAccepted,
          })
          break
        }
        const retryCount = (operation.retry_count || 0) + 1
        const delay = nextBackoffDelayMs(retryCount)
        await idbUpdateOutboxStatus(
          operation.queue_id,
          retryCount >= 8 ? 'failed' : 'pending',
          {
            retry_count: retryCount,
            next_retry_at: Date.now() + delay,
            last_error: error instanceof Error ? error.message : 'Sync failed',
          },
        )
        syncState.lastError = error instanceof Error ? error.message : 'Sync failed'
      } finally {
        syncState.runProcessed += 1
        emitSyncState()
      }
    }

    const pulledCount = await pullServerUpdatesIncremental()
    syncState.runPulled = pulledCount
    syncState.lastSyncAt = new Date().toISOString()
    if (syncState.runPushed > 0 || pulledCount > 0) {
      syncState.lastError = ''
      syncState.firebaseJwtAccepted = true
    }
    await idbCleanupSyncedOutbox(SYNCED_OUTBOX_RETENTION_MS)
  } finally {
    syncInFlight = false
    syncState.syncing = false
    await refreshCounters()
  }
}

async function pullServerUpdatesIncremental() {
  if (!supabase || !syncState.online) {
    return 0
  }
  if (!(await ensureCloudSyncAvailability())) {
    return 0
  }
  let pulledRows = 0
  const scopes = [
    'attendance-sheets',
    'dlr-records',
    'feedback',
    'notices',
    'report-snapshots',
    'employees',
    'user-substation-mappings',
    'workspace-masters',
    'workspace-settings',
    'masters:divisions',
    'masters:feeders',
    'masters:batterySets',
    'masters:transformers',
    'substations',
    'audit-events',
    'asset-master',
    'asset-history',
  ]

  for (const scope of scopes) {
    let cursor = normalizeSyncCursor(
      await idbGetMeta(`sync_cursor:${scope}`, '1970-01-01T00:00:00.000Z'),
    )
    let keepFetching = true
    while (keepFetching) {
      const { data, error } = await supabase
        .from('erp_records')
        .select('id, scope, payload, deleted, updated_at, client_updated_at, updated_by, device_id, version')
        .eq('scope', scope)
        .gt('updated_at', cursor)
        .order('updated_at', { ascending: true })
        .limit(300)
      if (error) {
        if (isMissingErpRecordsError(error)) {
          cloudSyncAvailable = false
        }
        keepFetching = false
        continue
      }
      if (!data?.length) {
        keepFetching = false
        continue
      }

      for (const row of data) {
        await idbPutRecord(scope, {
          id: row.id,
          payload: row.payload || {},
          sync_status: 'synced',
          updated_at: row.updated_at,
          client_updated_at: row.client_updated_at || row.updated_at,
          server_received_at: row.updated_at,
          updated_by: row.updated_by || '',
          device_id: row.device_id || '',
          version: row.version || 1,
          deleted: Boolean(row.deleted),
        })
        pulledRows += 1
      }

      cursor = data[data.length - 1].updated_at
      await idbSetMeta(`sync_cursor:${scope}`, cursor)
      keepFetching = data.length === 300
    }
  }
  return pulledRows
}

export async function runManualSyncNow() {
  await idbRequeueFailedOutbox()
  await triggerSync()
  return { ...syncState }
}

export async function runForceSyncNow() {
  await idbRequeueOutboxByStatus(['failed', 'conflict'])
  await triggerSync()
  return { ...syncState }
}

export async function getSyncDiagnostics(limit = 250) {
  const [counts, outboxRows] = await Promise.all([idbGetSyncCounts(), idbListOutbox(limit)])
  return {
    counts,
    outboxRows,
    state: { ...syncState },
  }
}

export async function retryOutboxStatuses(statuses = ['failed', 'conflict']) {
  const changed = await idbRequeueOutboxByStatus(statuses)
  if (changed > 0) {
    scheduleSync(80)
  }
  await refreshCounters()
  return changed
}

export async function syncScope(scope) {
  if (!supabase || !syncState.online) {
    return
  }
  if (!(await ensureCloudSyncAvailability())) {
    return
  }
  let cursor = normalizeSyncCursor(
    await idbGetMeta(`sync_cursor:${scope}`, '1970-01-01T00:00:00.000Z'),
  )
  let keepFetching = true
  while (keepFetching) {
    const { data, error } = await supabase
      .from('erp_records')
      .select('id, scope, payload, deleted, updated_at, client_updated_at, updated_by, device_id, version')
      .eq('scope', scope)
      .gt('updated_at', cursor)
      .order('updated_at', { ascending: true })
      .limit(300)
    if (error) {
      if (isMissingErpRecordsError(error)) {
        cloudSyncAvailable = false
      }
      return
    }
    for (const row of data || []) {
      await idbPutRecord(scope, {
        id: row.id,
        payload: row.payload || {},
        sync_status: 'synced',
        updated_at: row.updated_at,
        client_updated_at: row.client_updated_at || row.updated_at,
        server_received_at: row.updated_at,
        updated_by: row.updated_by || '',
        device_id: row.device_id || '',
        version: row.version || 1,
        deleted: Boolean(row.deleted),
      })
    }
    if (data?.length) {
      cursor = data[data.length - 1].updated_at
      await idbSetMeta(`sync_cursor:${scope}`, cursor)
    }
    keepFetching = Boolean(data?.length === 300)
  }
}

export function subscribeSyncState(listener) {
  listeners.add(listener)
  listener({ ...syncState })
  return () => listeners.delete(listener)
}

function clearRealtimeChannels() {
  for (const channel of realtimeChannels) {
    try {
      supabase?.removeChannel(channel)
    } catch {
      // best effort
    }
  }
  realtimeChannels = []
  syncState.realtimeConnected = false
}

function scheduleRealtimeFlush() {
  if (realtimeFlushTimer) {
    clearTimeout(realtimeFlushTimer)
  }
  realtimeFlushTimer = setTimeout(() => {
    realtimeFlushTimer = null
    const scopes = [...realtimeChangedScopes]
    realtimeChangedScopes.clear()
    if (!scopes.length) {
      return
    }
    void (async () => {
      const limited = scopes.slice(0, REALTIME_BATCH_LIMIT)
      for (const scope of limited) {
        await syncScope(scope)
      }
      if (scopes.length > REALTIME_BATCH_LIMIT) {
        scheduleSync(120)
      } else {
        emitSyncState()
      }
    })()
  }, REALTIME_FLUSH_DEBOUNCE_MS)
}

function onRealtimeErpRecord(payload) {
  const nextScope =
    payload?.new?.scope ||
    payload?.old?.scope ||
    ''
  if (!nextScope) {
    return
  }
  realtimeChangedScopes.add(nextScope)
  scheduleRealtimeFlush()
}

export function configureRealtimeSync({ profile, allowedSubstationIds = [], isMainAdmin = false } = {}) {
  if (!supabase || !profile) {
    clearRealtimeChannels()
    emitSyncState()
    return
  }
  clearRealtimeChannels()
  const channelSpecs = []
  if (isMainAdmin) {
    channelSpecs.push({ name: 'erp_records_all', filter: null })
  } else {
    for (const substationId of allowedSubstationIds || []) {
      if (!substationId) continue
      channelSpecs.push({
        name: `erp_records_substation_${substationId}`,
        filter: `substation_id=eq.${substationId}`,
      })
    }
  }
  if (!channelSpecs.length) {
    emitSyncState()
    return
  }
  realtimeChannels = channelSpecs.map((spec) => {
    const channel = supabase.channel(spec.name)
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'erp_records',
        ...(spec.filter ? { filter: spec.filter } : {}),
      },
      onRealtimeErpRecord,
    )
    channel.subscribe((status) => {
      syncState.realtimeConnected = status === 'SUBSCRIBED'
      emitSyncState()
    })
    return channel
  })
  scheduleSync(30)
}

export async function initializeSyncEngine() {
  syncState.online = typeof navigator !== 'undefined' ? navigator.onLine : true
  await refreshCounters()
  if (typeof window === 'undefined') {
    return
  }
  window.addEventListener('online', () => {
    syncState.online = true
    emitSyncState()
    scheduleSync(50)
  })
  window.addEventListener('offline', () => {
    syncState.online = false
    emitSyncState()
  })
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      scheduleSync(80)
    }
  })
  if (syncState.online) {
    scheduleSync(50)
  }
  console.info('[sync] startup', {
    userId: getSupabaseAuthDiagnostics().userId || '',
    hasFirebaseUser: getSupabaseAuthDiagnostics().hasFirebaseUser,
    pending: syncState.pending,
    lastError: syncState.lastError || '',
  })
  window.setInterval(() => {
    void idbCleanupSyncedOutbox(SYNCED_OUTBOX_RETENTION_MS).catch(() => {})
  }, 10 * 60 * 1000)
}
