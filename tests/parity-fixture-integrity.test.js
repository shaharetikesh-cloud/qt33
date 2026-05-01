import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const fixtureDir = path.resolve('tests/parity-fixtures')

const requiredFixtureFiles = [
  'daily-log-hourly.fixture.json',
  'ls-slot-mapping.fixture.json',
  'interruption-handling.fixture.json',
  'maintenance-history-linking.fixture.json',
  'feeder-account-summary.fixture.json',
  'asset-account-summary.fixture.json',
  'report-totals.fixture.json',
  'pdf-values.fixture.json',
  'expected-snapshots.json',
]

const protectedFiles = [
  'src/lib/dailyLog.js',
  'src/lib/interruptionSlots.js',
  'src/lib/reportData.js',
  'src/lib/reportPdf.js',
]

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, file), 'utf-8'))
}

test('phase0 parity fixtures exist and are valid json', () => {
  for (const file of requiredFixtureFiles) {
    const fullPath = path.join(fixtureDir, file)
    assert.equal(fs.existsSync(fullPath), true, `${file} missing`)
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(fullPath, 'utf-8')), `${file} invalid`)
  }
})

test('ls slot mapping fixture keeps mandatory parity cases', () => {
  const fixture = readJson('ls-slot-mapping.fixture.json')
  const caseIds = new Set((fixture.cases || []).map((item) => item.id))

  assert.equal(caseIds.has('case-0600-1000-exclude-start'), true)
  assert.equal(caseIds.has('case-0600-1000-include-start'), true)
  assert.equal(caseIds.has('case-2200-2400-exclude-start'), true)
})

test('maintenance linking fixture preserves feeder-asset link assumptions', () => {
  const fixture = readJson('maintenance-history-linking.fixture.json')
  assert.deepEqual(fixture.expected.feederAccountContainsEntryIds, ['MNT-001'])
  assert.deepEqual(fixture.expected.assetAccountContainsEntryIds, ['MNT-001'])
  assert.equal(fixture.expected.resolvedFeederIdForAssetEntry, 'FD-01')
})

test('phase0 protected logic files and parity doc exist', () => {
  for (const file of protectedFiles) {
    assert.equal(fs.existsSync(path.resolve(file)), true, `${file} missing`)
  }
  assert.equal(fs.existsSync(path.resolve('docs/PHASE0_PARITY_LOCK.md')), true)
})
