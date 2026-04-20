const STORAGE_PREFIX = 'umsw.v1'

function getStorage() {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage
}

function getKey(scope) {
  return `${STORAGE_PREFIX}.${scope}`
}

export function readScope(scope, fallback) {
  const storage = getStorage()

  if (!storage) {
    return fallback
  }

  try {
    const raw = storage.getItem(getKey(scope))
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function writeScope(scope, value) {
  const storage = getStorage()

  if (!storage) {
    return
  }

  storage.setItem(getKey(scope), JSON.stringify(value))
}

export function createLocalId(prefix = 'rec') {
  const random =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`

  return `${prefix}-${random}`
}

export function getNowIso() {
  return new Date().toISOString()
}

