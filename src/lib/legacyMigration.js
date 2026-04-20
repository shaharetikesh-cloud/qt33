import { idbPutRecord, idbQueueUpsert } from './indexedDb'

const LEGACY_PREFIX = 'umsw.v1.'
const MIGRATION_FLAG = 'umsw.v2.legacy-migrated'

const scopeMap = {
  masters: 'workspace-masters',
  settings: 'workspace-settings',
  'user-substation-mappings': 'user-substation-mappings',
  'attendance-documents': 'attendance-sheets',
  'dlr-records': 'dlr-records',
  'audit-events': 'audit-events',
  'report-snapshots': 'report-snapshots',
  'notice-board': 'notices',
  'feedback-entries': 'feedback',
}

function getStorage() {
  if (typeof window === 'undefined') {
    return null
  }
  return window.localStorage
}

function normalizeLegacyRows(key, value) {
  if (Array.isArray(value)) {
    return value.map((item) => ({
      id: item?.id || crypto.randomUUID(),
      payload: item || {},
      updated_at: item?.updated_at || item?.updatedAt || new Date().toISOString(),
      sync_status: 'pending',
    }))
  }

  return [
    {
      id: `legacy-${key}`,
      payload: value || {},
      updated_at: new Date().toISOString(),
      sync_status: 'pending',
    },
  ]
}

export async function migrateLegacyLocalScopesToIndexedDb() {
  const storage = getStorage()
  if (!storage) {
    return
  }

  if (storage.getItem(MIGRATION_FLAG) === '1') {
    return
  }

  for (const [legacyScope, newScope] of Object.entries(scopeMap)) {
    const raw = storage.getItem(`${LEGACY_PREFIX}${legacyScope}`)
    if (!raw) {
      continue
    }

    try {
      const parsed = JSON.parse(raw)
      const rows = normalizeLegacyRows(legacyScope, parsed)

      for (const row of rows) {
        await idbPutRecord(newScope, row)
        await idbQueueUpsert(newScope, row)
      }
    } catch {
      // Invalid legacy payloads are ignored intentionally.
    }
  }

  storage.setItem(MIGRATION_FLAG, '1')
}
