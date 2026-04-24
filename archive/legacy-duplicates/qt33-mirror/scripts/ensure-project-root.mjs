import fs from 'node:fs'
import path from 'node:path'

const expectedProjectId = process.argv[2]

if (!expectedProjectId) {
  console.error('[project-guard] Missing expected project id argument.')
  process.exit(1)
}

const markerPath = path.resolve(process.cwd(), '.project-root.json')

if (!fs.existsSync(markerPath)) {
  console.error(`[project-guard] Marker file missing: ${markerPath}`)
  process.exit(1)
}

let marker
try {
  marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
} catch (error) {
  console.error('[project-guard] Failed to parse marker file:', error?.message || error)
  process.exit(1)
}

if (marker.projectId !== expectedProjectId) {
  console.error(
    `[project-guard] Wrong project root. Expected "${expectedProjectId}" but found "${marker.projectId || 'unknown'}".`,
  )
  process.exit(1)
}

if (marker.deployAllowed === false) {
  console.error(
    `[project-guard] Deploy/build commands blocked for "${marker.projectId}". Use canonical web root.`,
  )
  process.exit(1)
}

console.log(`[project-guard] OK: ${marker.projectName || marker.projectId}`)
