import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { getInterruptionOverlayHourIndexes } from '../src/lib/interruptionSlots.js'

test('06:00 to 10:00 with 06:00 reading shifts start and keeps 4 slots', () => {
  const overlayHours = getInterruptionOverlayHourIndexes({
    fromTime: '06:00',
    toTime: '10:00',
    excludeStartHourSlot: true,
    preserveDurationWhenShifted: true,
  })
  assert.deepEqual(overlayHours, [7, 8, 9, 10])
  assert.equal(overlayHours.length, 4)
})

test('06:00 to 10:00 without 06:00 reading does not shift start', () => {
  const overlayHours = getInterruptionOverlayHourIndexes({
    fromTime: '06:00',
    toTime: '10:00',
    excludeStartHourSlot: false,
    preserveDurationWhenShifted: true,
  })
  assert.deepEqual(overlayHours, [6, 7, 8, 9])
  assert.equal(overlayHours.length, 4)
})

test('22:00 final anchor yields auto LS on 23:00 and 24:00', () => {
  const overlayHours = getInterruptionOverlayHourIndexes({
    fromTime: '22:00',
    toTime: '24:00',
    excludeStartHourSlot: true,
    preserveDurationWhenShifted: true,
  })
  assert.deepEqual(overlayHours, [23, 24])
  assert.equal(overlayHours.length, 2)
})

test('shifted-start interruption preserves LS slot count', () => {
  const shifted = getInterruptionOverlayHourIndexes({
    fromTime: '06:00',
    toTime: '10:00',
    excludeStartHourSlot: true,
    preserveDurationWhenShifted: true,
  })
  assert.equal(shifted.length, 4)
  assert.deepEqual(shifted, [7, 8, 9, 10])

  const shiftedAtEnd = getInterruptionOverlayHourIndexes({
    fromTime: '22:00',
    toTime: '24:00',
    excludeStartHourSlot: true,
    preserveDurationWhenShifted: true,
  })
  assert.deepEqual(shiftedAtEnd, [23, 24])
})

test('23:00 to 24:00 handles with and without start-hour reading', () => {
  const withStartReading = getInterruptionOverlayHourIndexes({
    fromTime: '23:00',
    toTime: '24:00',
    excludeStartHourSlot: true,
    preserveDurationWhenShifted: true,
  })
  const withoutStartReading = getInterruptionOverlayHourIndexes({
    fromTime: '23:00',
    toTime: '24:00',
    excludeStartHourSlot: false,
    preserveDurationWhenShifted: true,
  })

  assert.deepEqual(withStartReading, [24])
  assert.deepEqual(withoutStartReading, [23])
})

test('overlap explicit LS and auto LS does not duplicate slot keys', () => {
  const explicit = getInterruptionOverlayHourIndexes({
    fromTime: '06:00',
    toTime: '10:00',
    excludeStartHourSlot: true,
    preserveDurationWhenShifted: true,
  }).map((hour) => `F1:${hour}`)
  const auto = [8, 9, 10, 11].map((hour) => `F1:${hour}`)
  const merged = new Map()

  auto.forEach((key) => merged.set(key, { source: 'auto', code: 'LS' }))
  explicit.forEach((key) => merged.set(key, { source: 'explicit', code: 'LS' }))

  const uniqueKeys = new Set([...explicit, ...auto])
  assert.equal(merged.size, uniqueKeys.size)
  assert.equal(merged.get('F1:8')?.source, 'explicit')
})

test('multi-feeder isolation keeps LS mapping per feeder', () => {
  const feederOne = getInterruptionOverlayHourIndexes({
    fromTime: '06:00',
    toTime: '10:00',
    excludeStartHourSlot: true,
    preserveDurationWhenShifted: true,
  }).map((hour) => `F1:${hour}`)
  const feederTwo = getInterruptionOverlayHourIndexes({
    fromTime: '06:00',
    toTime: '10:00',
    excludeStartHourSlot: false,
    preserveDurationWhenShifted: true,
  }).map((hour) => `F2:${hour}`)

  const combined = new Set([...feederOne, ...feederTwo])
  assert.equal(combined.has('F1:7'), true)
  assert.equal(combined.has('F2:7'), true)
  assert.equal(combined.has('F1:6'), false)
  assert.equal(combined.has('F2:6'), true)
})

test('grid/report/print pipeline uses same derived LS source', () => {
  const dailyLogLib = fs.readFileSync(new URL('../src/lib/dailyLog.js', import.meta.url), 'utf-8')
  const reportLayouts = fs.readFileSync(
    new URL('../src/components/reporting/ReportLayouts.jsx', import.meta.url),
    'utf-8',
  )

  assert.match(dailyLogLib, /const derivedState = deriveDailyLogState\(/)
  assert.match(dailyLogLib, /tableRows:\s*derivedState\.tableRows/)
  assert.match(dailyLogLib, /exportRows:\s*derivedState\.exportRows/)
  assert.match(dailyLogLib, /interruptionRows:\s*derivedState\.interruptionRows/)
  assert.match(reportLayouts, /tableRows/)
})
