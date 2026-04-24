const DEVICE_KEY = 'umsw.device.id'

function getStorage() {
  if (typeof window === 'undefined') {
    return null
  }
  return window.localStorage
}

export function getDeviceId() {
  const storage = getStorage()
  if (!storage) {
    return 'server-device'
  }
  let deviceId = storage.getItem(DEVICE_KEY)
  if (!deviceId) {
    deviceId = crypto.randomUUID()
    storage.setItem(DEVICE_KEY, deviceId)
  }
  return deviceId
}
