const rawBackendMode = import.meta.env.VITE_BACKEND_MODE || 'cloud-sync'
const rawLocalApiDriver = import.meta.env.VITE_LOCAL_API_DRIVER || 'http'
const rawRuntimeProfile = import.meta.env.VITE_RUNTIME_PROFILE || 'standard'

export const backendMode = rawBackendMode.trim().toLowerCase()
export const isLocalSqlMode = backendMode === 'local-sql' || backendMode === 'cloud-sync'
export const isSupabaseMode = backendMode === 'supabase'
export const localApiDriver = rawLocalApiDriver.trim().toLowerCase()
export const isEmbeddedLocalApiDriver = localApiDriver === 'embedded'
export const runtimeProfile = rawRuntimeProfile.trim().toLowerCase()
export const isOfflineLocalSingleUserProfile = runtimeProfile === 'offline-local-single-user'
export const isConnectedLiveMultiUserProfile = runtimeProfile === 'connected-live-multi-user'
export const localApiBase = import.meta.env.VITE_LOCAL_API_BASE || '/api'
export const appName =
  import.meta.env.VITE_APP_NAME || 'Unified MSEDCL Workspace'

export const backendLabel = isLocalSqlMode
  ? 'Cloud Sync (Firebase + Supabase)'
  : 'Supabase'
