/**
 * Test-only ESM loader to resolve extensionless relative imports like "./dateUtils"
 * to "./dateUtils.js" for Node test runner execution.
 *
 * This is parity-harness infrastructure only; no business logic is changed.
 */
export async function resolve(specifier, context, defaultResolve) {
  const isRelativeOrAbsolute =
    specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')
  const hasKnownExtension = /\.[a-z0-9]+$/i.test(specifier)

  if (isRelativeOrAbsolute && !hasKnownExtension) {
    try {
      return await defaultResolve(`${specifier}.js`, context, defaultResolve)
    } catch {
      // Fall through to Node default behavior below.
    }
  }

  return defaultResolve(specifier, context, defaultResolve)
}

