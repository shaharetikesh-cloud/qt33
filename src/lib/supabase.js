import { createClient } from '@supabase/supabase-js'
import { buildMissingEnvError, getMissingEnvKeys } from './envConfig'
import { firebaseAuth } from './firebase'
import { isOfflineLocalSingleUserProfile } from './runtimeConfig'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const missingSupabaseEnv = getMissingEnvKeys('supabase')

let accessTokenProvider = null
let resolvingAccessToken = false

export function setSupabaseAccessTokenProvider(provider) {
  accessTokenProvider = provider
}

export async function getSupabaseAccessToken({ forceRefresh = false } = {}) {
  if (!accessTokenProvider) {
    return ''
  }
  if (resolvingAccessToken) {
    return ''
  }
  try {
    resolvingAccessToken = true
    return (await accessTokenProvider({ forceRefresh })) || ''
  } catch {
    return ''
  } finally {
    resolvingAccessToken = false
  }
}

export function getSupabaseAuthDiagnostics() {
  const user = firebaseAuth?.currentUser
  return {
    hasFirebaseUser: Boolean(user),
    userId: user?.uid || '',
  }
}

export async function getSupabaseSessionDiagnostics() {
  if (!supabase) {
    return {
      hasSupabaseSession: false,
      supabaseUserId: '',
    }
  }
  const { data } = await supabase.auth.getSession()
  const session = data?.session || null
  return {
    hasSupabaseSession: Boolean(session?.access_token),
    supabaseUserId: session?.user?.id || '',
  }
}

export const supabaseConfigError =
  missingSupabaseEnv.length > 0
    ? buildMissingEnvError('supabase', 'Supabase')
    : null

export const supabase =
  !supabaseConfigError && !isOfflineLocalSingleUserProfile
    ? createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        fetch: async (url, options = {}) => {
          const urlText = String(url || '')
          const isAuthEndpoint = urlText.includes('/auth/v1/')
          const token = isAuthEndpoint ? '' : await getSupabaseAccessToken()
          const headers = new Headers(options.headers || {})
          // Keep Supabase apikey behavior and attach runtime auth when available.
          if (token && !headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${token}`)
          }
          if (token && !headers.has('x-firebase-auth')) {
            headers.set('x-firebase-auth', token)
          }
          return fetch(url, { ...options, headers })
        },
      },
    })
    : null

if (import.meta.env.DEV) {
  if (supabaseConfigError) {
    console.warn('[Config] Supabase not initialized. Missing env:', missingSupabaseEnv)
  } else {
    console.info('[Config] Supabase client initialized successfully.')
  }
}
