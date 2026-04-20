import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const LEGACY_DIR = process.env.LEGACY_EXPORT_DIR || path.resolve(process.cwd(), 'local-data')

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const scopeMap = {
  'attendance-sheets.json': 'attendance-sheets',
  'dlr-records.json': 'dlr-records',
  'feedback.json': 'feedback',
  'notices.json': 'notices',
  'report-snapshots.json': 'report-snapshots',
  'employees.json': 'employees',
  'user-substation-mappings.json': 'user-substation-mappings',
}

function normalizeRows(raw) {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .filter((row) => row && typeof row === 'object')
    .map((row) => ({
      id: String(row.id || crypto.randomUUID()),
      payload: row,
      updated_at: row.updated_at || row.updatedAt || new Date().toISOString(),
      client_updated_at: row.updated_at || row.updatedAt || new Date().toISOString(),
      device_id: row.device_id || 'migration-script',
      updated_by: row.updated_by || row.ownerUserId || row.owner_user_id || 'migration-script',
      substation_id: row.substation_id || row.substationId || null,
      owner_user_id: row.owner_user_id || row.ownerUserId || null,
      version: Number(row.version || 1),
      deleted: Boolean(row.deleted),
    }))
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function run() {
  let total = 0
  for (const [filename, scope] of Object.entries(scopeMap)) {
    const filePath = path.join(LEGACY_DIR, filename)
    const parsed = await readJsonIfExists(filePath)
    if (!parsed) {
      continue
    }
    const rows = normalizeRows(parsed)
    if (!rows.length) {
      continue
    }

    const chunkSize = 500
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize).map((row) => ({
        ...row,
        scope,
      }))
      const { error } = await client
        .from('erp_records')
        .upsert(chunk, { onConflict: 'id' })
      if (error) {
        throw error
      }
      total += chunk.length
    }
    console.log(`Migrated ${rows.length} rows for ${scope}`)
  }

  console.log(`Migration complete. Total rows upserted: ${total}`)
}

run().catch((error) => {
  console.error('Migration failed:', error.message)
  process.exit(1)
})
