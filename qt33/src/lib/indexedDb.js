import { Preferences } from '@capacitor/preferences'

const DB_NAME = 'umsw-offline-db'
const DB_VERSION = 2
const RECORD_STORE = 'records'
const SCOPE_INDEX = 'by_scope'
const RECORD_UPDATED_INDEX = 'by_scope_updated'
const OUTBOX_STORE = 'outbox'
const OUTBOX_STATUS_INDEX = 'by_status'
const OUTBOX_RETRY_INDEX = 'by_retry_at'
const OUTBOX_KEY_INDEX = 'by_queue_key'
const META_STORE = 'meta'
const PREFERENCES_KEY = 'umsw.offline.store.v1'

let dbPromise = null
let forcePreferencesFallback = false
let preferencesSnapshot = null

function createEmptyPreferencesSnapshot() {
  return {
    records: [],
    outbox: [],
    meta: [],
  }
}

async function readPreferencesSnapshot() {
  if (preferencesSnapshot) {
    return preferencesSnapshot
  }
  const { value } = await Preferences.get({ key: PREFERENCES_KEY })
  if (!value) {
    preferencesSnapshot = createEmptyPreferencesSnapshot()
    return preferencesSnapshot
  }
  try {
    const parsed = JSON.parse(value)
    preferencesSnapshot = {
      records: Array.isArray(parsed?.records) ? parsed.records : [],
      outbox: Array.isArray(parsed?.outbox) ? parsed.outbox : [],
      meta: Array.isArray(parsed?.meta) ? parsed.meta : [],
    }
  } catch {
    preferencesSnapshot = createEmptyPreferencesSnapshot()
  }
  return preferencesSnapshot
}

async function writePreferencesSnapshot(snapshot) {
  preferencesSnapshot = snapshot
  await Preferences.set({
    key: PREFERENCES_KEY,
    value: JSON.stringify(snapshot),
  })
}

function hasIndexedDb() {
  return (
    !forcePreferencesFallback &&
    typeof globalThis !== 'undefined' &&
    typeof globalThis.indexedDB !== 'undefined'
  )
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'))
  })
}

async function openDb() {
  if (!hasIndexedDb()) {
    return null
  }
  if (dbPromise) {
    return dbPromise
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(RECORD_STORE)) {
        const store = db.createObjectStore(RECORD_STORE, { keyPath: 'key' })
        store.createIndex(SCOPE_INDEX, 'scope', { unique: false })
        store.createIndex(RECORD_UPDATED_INDEX, ['scope', 'updated_at'], { unique: false })
      }

      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        const outbox = db.createObjectStore(OUTBOX_STORE, { keyPath: 'queue_id' })
        outbox.createIndex(OUTBOX_STATUS_INDEX, 'sync_status', { unique: false })
        outbox.createIndex(OUTBOX_RETRY_INDEX, 'next_retry_at', { unique: false })
        outbox.createIndex(OUTBOX_KEY_INDEX, 'queue_key', { unique: true })
      }

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' })
      }

      // Backward compatibility for DB v1
      if (db.objectStoreNames.contains(RECORD_STORE)) {
        const store = request.transaction?.objectStore(RECORD_STORE)
        if (store && !store.indexNames.contains(RECORD_UPDATED_INDEX)) {
          store.createIndex(RECORD_UPDATED_INDEX, ['scope', 'updated_at'], { unique: false })
        }
      }
      if (db.objectStoreNames.contains(OUTBOX_STORE)) {
        const outbox = request.transaction?.objectStore(OUTBOX_STORE)
        if (outbox && !outbox.indexNames.contains(OUTBOX_RETRY_INDEX)) {
          outbox.createIndex(OUTBOX_RETRY_INDEX, 'next_retry_at', { unique: false })
        }
        if (outbox && !outbox.indexNames.contains(OUTBOX_KEY_INDEX)) {
          outbox.createIndex(OUTBOX_KEY_INDEX, 'queue_key', { unique: true })
        }
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'))
  }).catch((error) => {
    forcePreferencesFallback = true
    dbPromise = null
    console.warn('IndexedDB unavailable, switching to Preferences fallback.', error)
    return null
  })

  return dbPromise
}

function toRecordKey(scope, id) {
  return `${scope}:${id}`
}

async function runTransaction(stores, mode, executor) {
  const db = await openDb()
  if (!db) {
    throw new Error('IndexedDB transaction unavailable')
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'))
    executor(tx)
  })
}

export async function idbPutRecord(scope, record) {
  const item = {
    key: toRecordKey(scope, record.id),
    scope,
    id: record.id,
    payload: record.payload || {},
    sync_status: record.sync_status || 'pending',
    updated_at: record.updated_at || new Date().toISOString(),
    client_updated_at: record.client_updated_at || record.updated_at || new Date().toISOString(),
    server_received_at: record.server_received_at || '',
    updated_by: record.updated_by || '',
    device_id: record.device_id || '',
    version: Number(record.version || 1),
    deleted: Boolean(record.deleted),
  }

  const db = await openDb()
  if (!db) {
    const snapshot = await readPreferencesSnapshot()
    const next = snapshot.records.filter((row) => row.key !== item.key)
    next.push(item)
    await writePreferencesSnapshot({
      ...snapshot,
      records: next,
    })
    return
  }
  await runTransaction([RECORD_STORE], 'readwrite', (tx) => {
    tx.objectStore(RECORD_STORE).put(item)
  })
}

export async function idbDeleteRecord(scope, id) {
  const db = await openDb()
  if (!db) {
    const snapshot = await readPreferencesSnapshot()
    const key = toRecordKey(scope, id)
    const next = snapshot.records.filter((row) => row.key !== key)
    next.push({
      key,
      scope,
      id,
      payload: {},
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
      client_updated_at: new Date().toISOString(),
      deleted: true,
    })
    await writePreferencesSnapshot({
      ...snapshot,
      records: next,
    })
    return
  }
  await runTransaction([RECORD_STORE], 'readwrite', (tx) => {
    tx.objectStore(RECORD_STORE).put({
      key: toRecordKey(scope, id),
      scope,
      id,
      payload: {},
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
      client_updated_at: new Date().toISOString(),
      deleted: true,
    })
  })
}

export async function idbListRecords(scope) {
  const db = await openDb()
  if (!db) {
    const snapshot = await readPreferencesSnapshot()
    return snapshot.records
      .filter((row) => row.scope === scope)
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
  }
  const tx = db.transaction([RECORD_STORE], 'readonly')
  const index = tx.objectStore(RECORD_STORE).index(SCOPE_INDEX)
  const request = index.getAll(scope)
  const rows = await requestToPromise(request)
  return (rows || []).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
}

export async function idbQueueUpsert(scope, record) {
  const queueKey = `${scope}:${record.id}:${record.device_id || ''}`
  const queueItem = {
    queue_id: crypto.randomUUID(),
    queue_key: queueKey,
    id: record.id,
    entity_type: scope,
    operation_type: record.operation_type || 'update',
    payload: record.payload || {},
    device_id: record.device_id || '',
    updated_by: record.updated_by || '',
    client_updated_at: record.client_updated_at || record.updated_at || new Date().toISOString(),
    base_server_updated_at: record.base_server_updated_at || '',
    sync_status: 'pending',
    retry_count: 0,
    last_error: '',
    next_retry_at: Date.now(),
    updated_at: record.updated_at || new Date().toISOString(),
  }
  const db = await openDb()
  if (!db) {
    const snapshot = await readPreferencesSnapshot()
    const existing = snapshot.outbox.find((item) => item.queue_key === queueKey)
    const replacement = existing
      ? {
        ...existing,
        ...queueItem,
        queue_id: existing.queue_id,
        retry_count: 0,
        next_retry_at: Date.now(),
        sync_status: 'pending',
        last_error: '',
      }
      : queueItem
    const next = snapshot.outbox.filter((item) => item.queue_key !== queueKey)
    next.push(replacement)
    await writePreferencesSnapshot({
      ...snapshot,
      outbox: next,
    })
    return
  }
  await runTransaction([OUTBOX_STORE], 'readwrite', (tx) => {
    const store = tx.objectStore(OUTBOX_STORE)
    const index = store.index(OUTBOX_KEY_INDEX)
    const getReq = index.get(queueKey)
    getReq.onsuccess = () => {
      const existing = getReq.result
      if (existing) {
        store.put({
          ...existing,
          ...queueItem,
          queue_id: existing.queue_id,
          retry_count: 0,
          next_retry_at: Date.now(),
          sync_status: 'pending',
          last_error: '',
        })
      } else {
        store.put(queueItem)
      }
    }
  })
}

export async function idbQueueDelete(scope, id, updatedAt, deviceId = '', updatedBy = '') {
  const queueKey = `${scope}:${id}:delete`
  const queueItem = {
    queue_id: crypto.randomUUID(),
    queue_key: queueKey,
    entity_type: scope,
    operation_type: 'delete',
    id,
    payload: {},
    device_id: deviceId,
    updated_by: updatedBy,
    client_updated_at: updatedAt || new Date().toISOString(),
    base_server_updated_at: '',
    sync_status: 'pending',
    retry_count: 0,
    last_error: '',
    next_retry_at: Date.now(),
    updated_at: updatedAt || new Date().toISOString(),
  }
  const db = await openDb()
  if (!db) {
    const snapshot = await readPreferencesSnapshot()
    const existing = snapshot.outbox.find((item) => item.queue_key === queueKey)
    const replacement = existing
      ? {
        ...existing,
        ...queueItem,
        queue_id: existing.queue_id,
        retry_count: 0,
        next_retry_at: Date.now(),
        sync_status: 'pending',
        last_error: '',
      }
      : queueItem
    const next = snapshot.outbox.filter((item) => item.queue_key !== queueKey)
    next.push(replacement)
    await writePreferencesSnapshot({
      ...snapshot,
      outbox: next,
    })
    return
  }
  await runTransaction([OUTBOX_STORE], 'readwrite', (tx) => {
    const store = tx.objectStore(OUTBOX_STORE)
    const index = store.index(OUTBOX_KEY_INDEX)
    const getReq = index.get(queueKey)
    getReq.onsuccess = () => {
      const existing = getReq.result
      if (existing) {
        store.put({
          ...existing,
          ...queueItem,
          queue_id: existing.queue_id,
          retry_count: 0,
          next_retry_at: Date.now(),
          sync_status: 'pending',
          last_error: '',
        })
      } else {
        store.put(queueItem)
      }
    }
  })
}

export async function idbListPendingOutbox(limit = 100) {
  const db = await openDb()
  if (!db) {
    const snapshot = await readPreferencesSnapshot()
    const now = Date.now()
    return (snapshot.outbox || [])
      .filter((row) => row.sync_status === 'pending' && (row.next_retry_at || 0) <= now)
      .sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)))
      .slice(0, limit)
  }
  const tx = db.transaction([OUTBOX_STORE], 'readonly')
  const index = tx.objectStore(OUTBOX_STORE).index(OUTBOX_STATUS_INDEX)
  const request = index.getAll('pending')
  const rows = await requestToPromise(request)
  const now = Date.now()
  return (rows || [])
    .filter((row) => (row.next_retry_at || 0) <= now)
    .sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)))
    .slice(0, limit)
}

export async function idbRequeueFailedOutbox() {
  const now = Date.now()
  const db = await openDb()
  if (!db) {
    const snapshot = await readPreferencesSnapshot()
    let changed = 0
    const next = (snapshot.outbox || []).map((row) => {
      if (row.sync_status !== 'failed') {
        return row
      }
      changed += 1
      return {
        ...row,
        sync_status: 'pending',
        retry_count: 0,
        next_retry_at: now,
        last_error: '',
      }
    })
    if (changed > 0) {
      await writePreferencesSnapshot({
        ...snapshot,
        outbox: next,
      })
    }
    return changed
  }

  const tx = db.transaction([OUTBOX_STORE], 'readwrite')
  const store = tx.objectStore(OUTBOX_STORE)
  const rows = await requestToPromise(store.getAll())
  let changed = 0
  for (const row of rows || []) {
    if (row.sync_status !== 'failed') {
      continue
    }
    changed += 1
    store.put({
      ...row,
      sync_status: 'pending',
      retry_count: 0,
      next_retry_at: now,
      last_error: '',
    })
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  return changed
}

export async function idbUpdateOutboxStatus(queueId, status, patch = {}) {
  const db = await openDb()
  if (!db) {
    const snapshot = await readPreferencesSnapshot()
    const index = snapshot.outbox.findIndex((item) => item.queue_id === queueId)
    if (index < 0) return
    const row = {
      ...snapshot.outbox[index],
      ...patch,
      sync_status: status,
    }
    const next = [...snapshot.outbox]
    next[index] = row
    await writePreferencesSnapshot({
      ...snapshot,
      outbox: next,
    })
    return
  }
  const tx = db.transaction([OUTBOX_STORE], 'readwrite')
  const store = tx.objectStore(OUTBOX_STORE)
  const row = await requestToPromise(store.get(queueId))
  if (!row) return
  row.sync_status = status
  Object.assign(row, patch)
  store.put(row)
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

export async function idbGetSyncCounts() {
  const db = await openDb()
  if (!db) {
    const snapshot = await readPreferencesSnapshot()
    return (snapshot.outbox || []).reduce(
      (acc, row) => {
        if (row.sync_status === 'pending') acc.pending += 1
        if (row.sync_status === 'failed') acc.failed += 1
        if (row.sync_status === 'synced') acc.synced += 1
        return acc
      },
      { pending: 0, failed: 0, synced: 0 },
    )
  }
  const tx = db.transaction([OUTBOX_STORE], 'readonly')
  const store = tx.objectStore(OUTBOX_STORE)
  const rows = await requestToPromise(store.getAll())
  return (rows || []).reduce(
    (acc, row) => {
      if (row.sync_status === 'pending') acc.pending += 1
      if (row.sync_status === 'failed') acc.failed += 1
      if (row.sync_status === 'synced') acc.synced += 1
      return acc
    },
    { pending: 0, failed: 0, synced: 0 },
  )
}

export async function idbDeleteOutboxItem(queueId) {
  const db = await openDb()
  if (!db) {
    const snapshot = await readPreferencesSnapshot()
    await writePreferencesSnapshot({
      ...snapshot,
      outbox: snapshot.outbox.filter((item) => item.queue_id !== queueId),
    })
    return
  }
  await runTransaction([OUTBOX_STORE], 'readwrite', (tx) => {
    tx.objectStore(OUTBOX_STORE).delete(queueId)
  })
}

export async function idbGetMeta(key, fallback = null) {
  const db = await openDb()
  if (!db) {
    const snapshot = await readPreferencesSnapshot()
    const row = snapshot.meta.find((item) => item.key === key)
    return row?.value ?? fallback
  }
  const tx = db.transaction([META_STORE], 'readonly')
  const row = await requestToPromise(tx.objectStore(META_STORE).get(key))
  return row?.value ?? fallback
}

export async function idbSetMeta(key, value) {
  const db = await openDb()
  if (!db) {
    const snapshot = await readPreferencesSnapshot()
    const next = snapshot.meta.filter((item) => item.key !== key)
    next.push({ key, value })
    await writePreferencesSnapshot({
      ...snapshot,
      meta: next,
    })
    return
  }
  await runTransaction([META_STORE], 'readwrite', (tx) => {
    tx.objectStore(META_STORE).put({ key, value })
  })
}
