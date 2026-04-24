import { getPublicConfigSnapshot } from './envConfig'
import { firebaseConfigError } from './firebase'
import { supabaseConfigError } from './supabase'

export function logRuntimeConfigurationStatus() {
  if (!import.meta.env.DEV) {
    return
  }

  const snapshot = getPublicConfigSnapshot()
  console.info('[Config] Runtime snapshot:', snapshot)

  if (firebaseConfigError) {
    console.error('[Config] Firebase error:', firebaseConfigError)
  } else {
    console.info('[Config] Firebase status: ready')
  }

  if (supabaseConfigError) {
    console.error('[Config] Supabase error:', supabaseConfigError)
  } else {
    console.info('[Config] Supabase status: ready')
  }
}
