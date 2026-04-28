let navPendingCount = 0
let requestPendingCount = 0
let sequence = 0
let activeSinceMs = 0
const listeners = new Set()

function emit() {
  const isActive = navPendingCount > 0 || requestPendingCount > 0
  if (!isActive) {
    activeSinceMs = 0
  } else if (!activeSinceMs) {
    activeSinceMs = Date.now()
  }

  const snapshot = {
    isActive,
    navPendingCount,
    requestPendingCount,
    activeSinceMs,
    token: sequence,
  }
  for (const listener of listeners) {
    listener(snapshot)
  }
}

export function subscribePageLoading(listener) {
  listeners.add(listener)
  listener({
    isActive: navPendingCount > 0 || requestPendingCount > 0,
    navPendingCount,
    requestPendingCount,
    activeSinceMs,
    token: sequence,
  })
  return () => listeners.delete(listener)
}

export function startRouteLoading() {
  navPendingCount += 1
  sequence += 1
  emit()
}

export function stopRouteLoading() {
  navPendingCount = Math.max(0, navPendingCount - 1)
  sequence += 1
  emit()
}

export function startNetworkLoading() {
  requestPendingCount += 1
  sequence += 1
  emit()
}

export function stopNetworkLoading() {
  requestPendingCount = Math.max(0, requestPendingCount - 1)
  sequence += 1
  emit()
}

