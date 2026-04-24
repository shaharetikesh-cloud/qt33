const rawBackendMode = import.meta.env.VITE_BACKEND_MODE || 'cloud-sync'
const rawLocalApiDriver = import.meta.env.VITE_LOCAL_API_DRIVER || 'http'

export const backendMode = rawBackendMode.trim().toLowerCase()
export const isLocalSqlMode = backendMode === 'local-sql' || backendMode === 'cloud-sync'
export const isSupabaseMode = backendMode === 'supabase'
export const localApiDriver = rawLocalApiDriver.trim().toLowerCase()
export const isEmbeddedLocalApiDriver = localApiDriver === 'embedded'
export const localApiBase = import.meta.env.VITE_LOCAL_API_BASE || '/api'
export const appName =
  import.meta.env.VITE_APP_NAME || 'QT33'

export const backendLabel = isLocalSqlMode
  ? 'Cloud Sync (Firebase + Supabase)'
  : 'Supabase'
