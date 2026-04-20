import { Component, useEffect, useState } from 'react'

const CRASH_STORAGE_KEY = 'offline-app-last-crash'

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

function CrashScreen({ crash, onReload }) {
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
      return <CrashScreen crash={this.state.crash} onReload={this.props.onReload} />
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

      reportCrash(event.error || event.message, 'runtime')
    }

    function handleUnhandledRejection(event) {
      reportCrash(event.reason || 'Unhandled promise rejection', 'promise')
    }

    window.addEventListener('error', handleWindowError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    return () => {
      window.removeEventListener('error', handleWindowError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [])

  function handleReload() {
    window.location.reload()
  }

  if (runtimeCrash) {
    return <CrashScreen crash={runtimeCrash} onReload={handleReload} />
  }

  return <ReactCrashBoundary onReload={handleReload}>{children}</ReactCrashBoundary>
}
