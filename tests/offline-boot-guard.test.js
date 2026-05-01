import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

function read(file) {
  return fs.readFileSync(path.resolve(file), 'utf-8')
}

function hasAny(content, patterns = []) {
  return patterns.some((pattern) => pattern.test(content))
}

test('offline boot guard: runtime profile marker exists', () => {
  const runtimeConfig = read('src/lib/runtimeConfig.js')
  const hasOfflineProfile = hasAny(runtimeConfig, [
    /offline-local-single-user/,
    /offline[_-]local[_-]single[_-]user/i,
  ])

  assert.equal(
    hasOfflineProfile,
    true,
    'Missing offline-local-single-user profile marker in runtime configuration.',
  )
})

test('offline boot guard: no-login startup bypass marker exists', () => {
  const authContext = read('src/context/AuthContext.jsx')
  const hasLoginBypass = hasAny(authContext, [
    /offline-local-single-user/,
    /skip.*login/i,
    /no.*login/i,
  ])

  assert.equal(
    hasLoginBypass,
    true,
    'Offline startup login bypass marker not found in AuthContext.',
  )
})

test('offline boot guard: no supabase profile fetch marker exists', () => {
  const authContext = read('src/context/AuthContext.jsx')
  const hasSupabaseBypassMarker = hasAny(authContext, [
    /offline-local-single-user/,
    /skip.*profile/i,
    /without.*supabase/i,
    /no.*supabase/i,
  ])

  assert.equal(
    hasSupabaseBypassMarker,
    true,
    'Offline startup Supabase profile-fetch bypass marker not found in AuthContext.',
  )
})

test('offline boot guard: direct local dashboard boot marker exists', () => {
  const mainFile = read('src/main.jsx')
  const hasLocalDashboardBoot = hasAny(mainFile, [
    /offline-local-single-user/,
    /local dashboard/i,
    /boot.*dashboard/i,
  ])

  assert.equal(
    hasLocalDashboardBoot,
    true,
    'Local dashboard direct boot marker not found in startup entrypoint.',
  )
})

test('offline boot guard: local persistence dependency exists', () => {
  const nativeRuntime = read('src/lib/nativeRuntime.js')
  const embeddedLocalApi = read('src/lib/embeddedLocalApi.js')
  const hasPersistenceMarker = hasAny(nativeRuntime + embeddedLocalApi, [
    /Filesystem/,
    /Preferences/,
    /IndexedDB/i,
    /local/i,
  ])

  assert.equal(
    hasPersistenceMarker,
    true,
    'No local persistence marker found across native runtime and embedded local API.',
  )
})

