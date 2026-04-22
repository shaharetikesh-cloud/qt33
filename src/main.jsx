import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import './responsive-system.css'
import App from './App.jsx'
import AppCrashBoundary from './components/AppCrashBoundary.jsx'
import { migrateLegacyLocalScopesToIndexedDb } from './lib/legacyMigration'
import { initializeNativeRuntime } from './lib/nativeRuntime'
import { logRuntimeConfigurationStatus } from './lib/runtimeDiagnostics'
import { initializeSyncEngine } from './lib/syncEngine'

const rootElement = document.getElementById('root')
let appRoot = null

function mountIntoRoot(element) {
  if (!rootElement) {
    throw new Error('Root element sapadla nahi.')
  }

  if (!appRoot) {
    appRoot = createRoot(rootElement)
  }

  appRoot.render(element)
}

function renderBootstrapFailure(message) {
  return (
    <div className="app-crash-screen">
      <div className="loading-card app-crash-card">
        <p className="eyebrow">Startup issue</p>
        <h1>App start hou shakla nahi</h1>
        <p>{message}</p>
      </div>
    </div>
  )
}

async function prepareNativeShell() {
  if (!Capacitor.isNativePlatform() || !('serviceWorker' in navigator)) {
    return true
  }

  try {
    const cleanupKey = 'native-sw-cleanup-complete'
    const cleanupDone = window.localStorage.getItem(cleanupKey) === '1'
    if (cleanupDone) {
      return true
    }

    const registrations = await navigator.serviceWorker.getRegistrations()
    const hadRegistrations = registrations.length > 0

    await Promise.all(registrations.map((registration) => registration.unregister()))

    if ('caches' in window) {
      const cacheKeys = await caches.keys()
      await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)))
    }

    if (hadRegistrations) {
      // Mark cleanup done and continue bootstrap without forced reload
      // so current route continuity is preserved.
      window.localStorage.setItem(cleanupKey, '1')
    }
  } catch (error) {
    console.warn('Native shell cleanup failed', error)
  }

  return true
}

function registerWebServiceWorker() {
  if (
    Capacitor.isNativePlatform() ||
    !('serviceWorker' in navigator) ||
    !import.meta.env.PROD
  ) {
    return
  }

  const register = () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  }

  if (document.readyState === 'complete') {
    register()
    return
  }

  window.addEventListener('load', register, { once: true })
}

async function bootstrapApplication() {
  if (!rootElement) {
    throw new Error('Root element sapadla nahi.')
  }

  const shouldContinue = await prepareNativeShell()

  if (!shouldContinue) {
    return
  }

  logRuntimeConfigurationStatus()
  await migrateLegacyLocalScopesToIndexedDb()
  await initializeSyncEngine()
  await initializeNativeRuntime()

  mountIntoRoot(
    <StrictMode>
      <AppCrashBoundary>
        <App />
      </AppCrashBoundary>
    </StrictMode>,
  )

  registerWebServiceWorker()
}

void bootstrapApplication().catch((error) => {
  console.error(error)

  if (!rootElement) {
    return
  }

  try {
    mountIntoRoot(
      renderBootstrapFailure(error?.message || 'Unexpected startup error detected.'),
    )
  } catch (mountError) {
    console.error(mountError)
  }
})
