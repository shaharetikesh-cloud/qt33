import { Component, useEffect, useState } from 'react'

const CRASH_STORAGE_KEY = 'offline-app-last-crash'
const CRASH_RELOAD_GUARD_KEY = 'offline-app-crash-reload-guard'

function normalizeCrashMessage(errorLike) {
  if (!errorLike) {
    return 'Unexpected runtime error detected.'
  }

  if (typeof errorLike === 'string') {
    return errorLike
  }

  if (errorLike instanceof Error) {
    return errorLike.message || errorLike.name || 'Unexpected runtime error detected.'
  }

  if (typeof errorLike === 'object' && 'message' in errorLike) {
    return String(errorLike.message || 'Unexpected runtime error detected.')
  }

  return String(errorLike)
}

function buildCrashPayload(errorLike, source) {
  const error =
    errorLike instanceof Error
      ? errorLike
      : new Error(normalizeCrashMessage(errorLike))

  return {
    source,
    message: normalizeCrashMessage(errorLike),
    stack: error.stack || '',
    capturedAt: new Date().toISOString(),
  }
}

function persistCrash(payload) {
  try {
    window.localStorage.setItem(CRASH_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Best-effort only.
  }
}

function CrashScreen({ crash, onReload, onContinueWithoutReload }) {
  return (
    <div className="app-crash-screen">
      <div className="loading-card app-crash-card">
        <p className="eyebrow">Recovery mode</p>
        <h1>App restart required</h1>
        <p>
          Screen blank hou naye mhanun app ne crash capture kela aahe. Reload kele ki
          latest fixed shell punha start hoil.
        </p>
        <div className="app-crash-meta">
          <strong>{crash.message}</strong>
          <span>
            Source: {crash.source} | Time: {new Date(crash.capturedAt).toLocaleString()}
          </span>
        </div>
        {crash.stack ? <pre className="app-crash-detail">{crash.stack}</pre> : null}
        <div className="app-crash-actions">
          <button type="button" className="primary-button" onClick={onReload}>
            Reload App
          </button>
          <button type="button" className="ghost-light-button" onClick={onContinueWithoutReload}>
            Continue Without Reload
          </button>
        </div>
      </div>
    </div>
  )
}

class ReactCrashBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = {
      crash: null,
    }
  }

  static getDerivedStateFromError(error) {
    return {
      crash: buildCrashPayload(error, 'react'),
    }
  }

  componentDidCatch(error) {
    persistCrash(buildCrashPayload(error, 'react'))
  }

  render() {
    if (this.state.crash) {
      return (
        <CrashScreen
          crash={this.state.crash}
          onReload={this.props.onReload}
          onContinueWithoutReload={this.props.onContinueWithoutReload}
        />
      )
    }

    return this.props.children
  }
}

export default function AppCrashBoundary({ children }) {
  const [runtimeCrash, setRuntimeCrash] = useState(null)

  useEffect(() => {
    function reportCrash(errorLike, source) {
      const nextCrash = buildCrashPayload(errorLike, source)
      persistCrash(nextCrash)
      setRuntimeCrash((current) => current || nextCrash)
    }

    function handleWindowError(event) {
      const message = normalizeCrashMessage(event.error || event.message)

      if (message.includes('ResizeObserver loop')) {
        return
      }
      // Ignore script/resource load noise that does not provide a runtime Error object.
      if (!event.error && event.filename) {
        return
      }

      reportCrash(event.error || event.message, 'runtime')
    }

    function handleUnhandledRejection(event) {
      const reason = event.reason || 'Unhandled promise rejection'
      const reasonMessage = normalizeCrashMessage(reason)
      if (
        reasonMessage.includes('AbortError') ||
        reasonMessage.includes('aborted a request') ||
        reasonMessage.includes('Load failed')
      ) {
        return
      }
      reportCrash(reason, 'promise')
    }

    window.addEventListener('error', handleWindowError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    return () => {
      window.removeEventListener('error', handleWindowError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [])

  function handleReload() {
    const now = Date.now()
    let guardState = { count: 0, startedAt: now }
    try {
      guardState = JSON.parse(window.sessionStorage.getItem(CRASH_RELOAD_GUARD_KEY) || '') || guardState
    } catch {
      // Keep default guard state.
    }

    if (now - Number(guardState.startedAt || now) > 30_000) {
      guardState = { count: 0, startedAt: now }
    }

    guardState.count += 1
    window.sessionStorage.setItem(CRASH_RELOAD_GUARD_KEY, JSON.stringify(guardState))

    if (guardState.count > 3) {
      setRuntimeCrash((current) =>
        current
          ? {
              ...current,
              message:
                'Multiple rapid reload attempts detected. Continue without reload and report this crash.',
            }
          : current,
      )
      return
    }

    window.location.reload()
  }

  function handleContinueWithoutReload() {
    setRuntimeCrash(null)
  }

  if (runtimeCrash) {
    return (
      <CrashScreen
        crash={runtimeCrash}
        onReload={handleReload}
        onContinueWithoutReload={handleContinueWithoutReload}
      />
    )
  }

  return (
    <ReactCrashBoundary
      onReload={handleReload}
      onContinueWithoutReload={handleContinueWithoutReload}
    >
      {children}
    </ReactCrashBoundary>
  )
}
