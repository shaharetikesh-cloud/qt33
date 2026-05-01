import { initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  getAuth,
  connectAuthEmulator,
  setPersistence,
} from 'firebase/auth'
import { buildMissingEnvError, getMissingEnvKeys } from './envConfig'
import { isOfflineLocalSingleUserProfile } from './runtimeConfig'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
}

const missingFirebaseEnv = getMissingEnvKeys('firebase')
const firebaseConfigMissing = missingFirebaseEnv.length > 0

export const firebaseConfigError = firebaseConfigMissing
  ? buildMissingEnvError('firebase', 'Firebase')
  : null

export const firebaseApp = firebaseConfigMissing || isOfflineLocalSingleUserProfile
  ? null
  : initializeApp(firebaseConfig)
export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null

if (firebaseAuth) {
  void setPersistence(firebaseAuth, browserLocalPersistence).catch((error) => {
    if (import.meta.env.DEV) {
      console.warn('[Config] Firebase persistence set failed:', error?.message || error)
    }
  })
}

if (import.meta.env.DEV) {
  if (firebaseConfigMissing) {
    console.warn('[Config] Firebase not initialized. Missing env:', missingFirebaseEnv)
  } else {
    console.info('[Config] Firebase initialized successfully.')
  }
}

if (firebaseAuth && import.meta.env.DEV && import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL) {
  connectAuthEmulator(firebaseAuth, import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL, {
    disableWarnings: true,
  })
}
