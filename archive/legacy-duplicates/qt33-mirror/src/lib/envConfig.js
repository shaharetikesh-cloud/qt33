const REQUIRED_ENV = {
  firebase: [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_APP_ID',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
  ],
  supabase: [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
  ],
}

function getEnvValue(key) {
  return String(import.meta.env[key] || '').trim()
}

export function getMissingEnvKeys(group) {
  const keys = REQUIRED_ENV[group] || []
  return keys.filter((key) => !getEnvValue(key))
}

export function buildMissingEnvError(group, productLabel) {
  const missing = getMissingEnvKeys(group)
  if (!missing.length) {
    return null
  }
  return `${productLabel} configuration missing: ${missing.join(', ')}. Add these in .env / Cloudflare Pages environment variables.`
}

export function getPublicConfigSnapshot() {
  return {
    backendMode: String(import.meta.env.VITE_BACKEND_MODE || 'cloud-sync'),
    firebaseConfigured: getMissingEnvKeys('firebase').length === 0,
    supabaseConfigured: getMissingEnvKeys('supabase').length === 0,
    adminFunctionsEnabled:
      String(import.meta.env.VITE_SUPABASE_ADMIN_FUNCTIONS || '').toLowerCase() === 'true',
  }
}
