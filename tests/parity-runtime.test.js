import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  buildDailyLogConfiguration,
  deriveDailyLogState,
} from '../src/lib/dailyLog.js'
import { getInterruptionOverlayHourIndexes } from '../src/lib/interruptionSlots.js'
import {
  normalizeMaintenanceRows,
  summarizeMaintenanceRows,
} from '../src/lib/maintenanceLinking.js'
import { buildBatteryReport } from '../src/lib/reportData.js'

const fixtureDir = path.resolve('tests/parity-fixtures')

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, file), 'utf-8'))
}

function mismatchMessage(label, expected, actual) {
  return `${label} mismatch | expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`
}

test('runtime parity: daily log derive output matches snapshot baseline', () => {
  const snapshots = readJson('expected-snapshots.json')
  const fixture = readJson(snapshots.snapshots.dailyLogHourly.fixtureFile)

  const feeder = {
    id: fixture.feeders[0].id,
    name: fixture.feeders[0].name,
    substationId: fixture.substationId,
    includeInTotal: true,
    isMainIncoming: true,
    feederType: 'main_incoming',
    voltageLevel: '11',
  }

  const config = buildDailyLogConfiguration({
    substationId: fixture.substationId,
    feeders: [feeder],
    batterySets: [],
    transformers: [],
  })

  const form = {
    dayStatus: 'draft',
    rows: fixture.rows.map((row) => ({
      hour: row.hour,
      feederReadings: row.feederReadings,
      batteryVoltages: {},
      transformerTaps: {},
      transformerTemperatures: {},
      remark: '',
    })),
    interruptions: [],
    meterChangeEvents: [],
  }

  const derived = deriveDailyLogState(form, config)
  assert.equal(
    derived.tableRows.length,
    snapshots.snapshots.dailyLogHourly.expectedRowsCount,
    mismatchMessage(
      'dailyLog.tableRows.length',
      snapshots.snapshots.dailyLogHourly.expectedRowsCount,
      derived.tableRows.length,
    ),
  )
  assert.equal(
    derived.tableRows[0]?.hour,
    snapshots.snapshots.dailyLogHourly.expectedFirstHour,
    mismatchMessage(
      'dailyLog.firstHour',
      snapshots.snapshots.dailyLogHourly.expectedFirstHour,
      derived.tableRows[0]?.hour,
    ),
  )
  assert.equal(
    derived.tableRows[derived.tableRows.length - 1]?.hour,
    snapshots.snapshots.dailyLogHourly.expectedLastHour,
    mismatchMessage(
      'dailyLog.lastHour',
      snapshots.snapshots.dailyLogHourly.expectedLastHour,
      derived.tableRows[derived.tableRows.length - 1]?.hour,
    ),
  )
})

test('runtime parity: LS slot mapping cases match snapshot baseline', () => {
  const snapshots = readJson('expected-snapshots.json')
  const fixture = readJson(snapshots.snapshots.lsSlotMapping.fixtureFile)

  assert.equal(
    fixture.cases.length,
    snapshots.snapshots.lsSlotMapping.expectedCaseCount,
    mismatchMessage(
      'lsSlot.caseCount',
      snapshots.snapshots.lsSlotMapping.expectedCaseCount,
      fixture.cases.length,
    ),
  )

  fixture.cases.forEach((entry) => {
    const actual = getInterruptionOverlayHourIndexes(entry.input)
    assert.deepEqual(
      actual,
      entry.expectedOverlayHours,
      mismatchMessage(`lsSlot.${entry.id}`, entry.expectedOverlayHours, actual),
    )
  })
})

test('runtime parity: interruption handling merge precedence stays stable', () => {
  const snapshots = readJson('expected-snapshots.json')
  const fixture = readJson(snapshots.snapshots.interruptionHandling.fixtureFile)
  const expected = snapshots.snapshots.interruptionHandling

  const merged = new Map()
  fixture.scenario.autoLsOverlayHours.forEach((hour) => {
    merged.set(`${fixture.scenario.feederId}:${hour}`, { source: 'auto' })
  })
  fixture.scenario.explicitLsOverlayHours.forEach((hour) => {
    merged.set(`${fixture.scenario.feederId}:${hour}`, { source: 'explicit' })
  })

  assert.equal(
    merged.size,
    expected.expectedMergedUniqueCount,
    mismatchMessage('interruption.uniqueMergedCount', expected.expectedMergedUniqueCount, merged.size),
  )
  assert.equal(
    merged.get(expected.expectedPriorityAtKey.key)?.source,
    expected.expectedPriorityAtKey.source,
    mismatchMessage(
      'interruption.priorityAtKey',
      expected.expectedPriorityAtKey.source,
      merged.get(expected.expectedPriorityAtKey.key)?.source,
    ),
  )
})

test('runtime parity: maintenance-history linking matches fixture baseline', () => {
  const snapshots = readJson('expected-snapshots.json')
  const fixture = readJson(snapshots.snapshots.maintenanceLinking.fixtureFile)

  const rows = normalizeMaintenanceRows({
    records: fixture.maintenanceEntries,
    assets: fixture.masters.assets,
    feeders: fixture.masters.feeders,
  })

  const feederLinked = rows.filter((row) => row.feederId === 'FD-01').map((row) => row.id)
  const assetLinked = rows.filter((row) => row.assetId === 'AS-01').map((row) => row.id)

  assert.equal(
    feederLinked.length,
    snapshots.snapshots.maintenanceLinking.expectedFeederEntryCount,
    mismatchMessage(
      'maintenance.feederEntryCount',
      snapshots.snapshots.maintenanceLinking.expectedFeederEntryCount,
      feederLinked.length,
    ),
  )
  assert.equal(
    assetLinked.length,
    snapshots.snapshots.maintenanceLinking.expectedAssetEntryCount,
    mismatchMessage(
      'maintenance.assetEntryCount',
      snapshots.snapshots.maintenanceLinking.expectedAssetEntryCount,
      assetLinked.length,
    ),
  )
})

test('runtime parity: feeder and asset account summaries match snapshots', () => {
  const snapshots = readJson('expected-snapshots.json')
  const feederFixture = readJson(snapshots.snapshots.feederAccountSummary.fixtureFile)
  const assetFixture = readJson(snapshots.snapshots.assetAccountSummary.fixtureFile)

  const feederSummary = summarizeMaintenanceRows(
    feederFixture.rows.map((row) => ({
      operationalDate: row.operationalDate,
      durationMinutes: row.durationMinutes,
      partChanged: false,
    })),
  )
  const assetSummary = summarizeMaintenanceRows(
    assetFixture.rows.map((row) => ({
      operationalDate: row.operationalDate,
      durationMinutes: row.durationMinutes,
      partChanged: row.partChanged,
    })),
  )

  assert.equal(
    feederSummary.totalCount,
    snapshots.snapshots.feederAccountSummary.expectedMaintenanceCount,
    mismatchMessage(
      'feederSummary.totalCount',
      snapshots.snapshots.feederAccountSummary.expectedMaintenanceCount,
      feederSummary.totalCount,
    ),
  )
  assert.equal(
    feederSummary.totalDurationMinutes,
    snapshots.snapshots.feederAccountSummary.expectedTotalDurationMinutes,
    mismatchMessage(
      'feederSummary.totalDurationMinutes',
      snapshots.snapshots.feederAccountSummary.expectedTotalDurationMinutes,
      feederSummary.totalDurationMinutes,
    ),
  )
  assert.equal(
    assetSummary.totalCount,
    snapshots.snapshots.assetAccountSummary.expectedMaintenanceCount,
    mismatchMessage(
      'assetSummary.totalCount',
      snapshots.snapshots.assetAccountSummary.expectedMaintenanceCount,
      assetSummary.totalCount,
    ),
  )
  assert.equal(
    assetSummary.partChangeCount,
    snapshots.snapshots.assetAccountSummary.expectedPartChangeCount,
    mismatchMessage(
      'assetSummary.partChangeCount',
      snapshots.snapshots.assetAccountSummary.expectedPartChangeCount,
      assetSummary.partChangeCount,
    ),
  )
})

test('runtime parity: report totals and PDF source values match fixtures', () => {
  const snapshots = readJson('expected-snapshots.json')
  const reportFixture = readJson(snapshots.snapshots.reportTotals.fixtureFile)
  const pdfFixture = readJson(snapshots.snapshots.pdfValues.fixtureFile)

  const report = buildBatteryReport({
    companyProfile: { companyName: 'Maharashtra State Electricity Distribution Co. Ltd.' },
    substation: { name: pdfFixture.expectedRenderValues.substationName },
    batterySet: { name: pdfFixture.expectedRenderValues.batterySetName },
    division: { name: pdfFixture.expectedRenderValues.division },
    record: {
      operationalDate: reportFixture.reportInputs.operationalDate,
      payload: {
        cells: reportFixture.reportInputs.cells,
        operatorName: pdfFixture.expectedRenderValues.operatorName,
        inChargeName: pdfFixture.expectedRenderValues.inChargeName,
        remark: pdfFixture.expectedRenderValues.remark,
        checklist: {},
      },
    },
  })

  assert.equal(
    Math.abs(Number(report.analysis.totalVoltage) - snapshots.snapshots.reportTotals.expectedTotalVoltage) <
      0.000001,
    true,
    mismatchMessage(
      'report.totalVoltage',
      snapshots.snapshots.reportTotals.expectedTotalVoltage,
      report.analysis.totalVoltage,
    ),
  )
  assert.equal(
    report.analysis.overallCondition,
    snapshots.snapshots.reportTotals.expectedOverallCondition,
    mismatchMessage(
      'report.overallCondition',
      snapshots.snapshots.reportTotals.expectedOverallCondition,
      report.analysis.overallCondition,
    ),
  )

  snapshots.snapshots.pdfValues.requiredKeys.forEach((key) => {
    let actualValue = ''
    if (key === 'operatorName') actualValue = report.signatures.operator
    else if (key === 'inChargeName') actualValue = report.signatures.inCharge
    else if (key === 'totalVoltage') actualValue = report.analysis.totalVoltage
    else if (key === 'overallCondition') actualValue = report.analysis.overallCondition
    else if (key === 'remark') actualValue = report.remark
    else actualValue = Object.fromEntries(report.metadata)[key === 'substationName' ? 'Substation' : key === 'batterySetName' ? 'Battery Set' : key === 'weekLabel' ? 'Week Label' : 'Division']

    assert.notEqual(
      actualValue === undefined || actualValue === null || actualValue === '',
      true,
      `pdfValues.${key} missing in runtime report source`,
    )
  })
})

