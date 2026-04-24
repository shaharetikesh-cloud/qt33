import { createClient } from '@supabase/supabase-js'
import { buildMissingEnvError, getMissingEnvKeys } from './envConfig'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const missingSupabaseEnv = getMissingEnvKeys('supabase')

let accessTokenProvider = null

export function setSupabaseAccessTokenProvider(provider) {
  accessTokenProvider = provider
}

export const supabaseConfigError =
  missingSupabaseEnv.length > 0
    ? buildMissingEnvError('supabase', 'Supabase')
    : null

export const supabase =
  !supabaseConfigError
    ? createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        fetch: async (url, options = {}) => {
          const token = accessTokenProvider ? await accessTokenProvider() : ''
          const headers = new Headers(options.headers || {})
          // Keep Supabase's default Authorization/apikey behavior.
          // Firebase token is passed in a custom header for optional server-side bridging.
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
