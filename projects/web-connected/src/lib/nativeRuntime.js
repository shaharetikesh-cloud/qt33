import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Network } from '@capacitor/network'
import { Toast } from '@capacitor/toast'
import { emitSyncStateSnapshot, scheduleSync, setOnlineState } from './syncEngine'

const ROOT_ROUTES = new Set(['', '#', '#/', '#/login', '/login', '/'])
const BACK_EXIT_GUARD_MS = 2000
let lastBackPressAt = 0

function isNative() {
  return Capacitor.isNativePlatform()
}

async function showConnectivityToast(isOnline) {
  if (!isNative()) {
    return
  }
  await Toast.show({
    text: isOnline ? 'Back online. Sync resumed.' : 'Offline mode enabled.',
    duration: 'short',
  })
}

export async function initializeNativeRuntime() {
  if (!isNative()) {
    return () => {}
  }

  const networkStatus = await Network.getStatus()
  setOnlineState(Boolean(networkStatus.connected))
  emitSyncStateSnapshot()

  const handles = []

  handles.push(
    await Network.addListener('networkStatusChange', (status) => {
      const connected = Boolean(status.connected)
      setOnlineState(connected)
      emitSyncStateSnapshot()
      void showConnectivityToast(connected)
      if (connected) {
        scheduleSync(60)
      }
    }),
  )

  handles.push(
    await App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        return
      }
      // Trigger quick catch-up sync after the app resumes.
      scheduleSync(60)
    }),
  )

  handles.push(
    await App.addListener('backButton', ({ canGoBack }) => {
      const currentHash = typeof window !== 'undefined' ? window.location.hash : '#/'
      const onRootRoute = ROOT_ROUTES.has(currentHash)

      // Prefer normal in-app navigation behavior on non-root screens.
      if (canGoBack && !onRootRoute) {
        window.history.back()
        return
      }

      const now = Date.now()
      if (now - lastBackPressAt < BACK_EXIT_GUARD_MS) {
        App.exitApp()
        return
      }

      lastBackPressAt = now
      void Toast.show({
        text: 'Press back again to exit.',
        duration: 'short',
      })
    }),
  )

  return () => {
    for (const handle of handles) {
      handle.remove()
    }
  }
}
