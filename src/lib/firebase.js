import { initializeApp } from 'firebase/app'
import {
  getAuth,
  connectAuthEmulator,
} from 'firebase/auth'
import { buildMissingEnvError, getMissingEnvKeys } from './envConfig'

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

export const firebaseApp = firebaseConfigMissing ? null : initializeApp(firebaseConfig)
export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null

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
