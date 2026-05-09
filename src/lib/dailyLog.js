import { compareByDate, formatDate, getDayName } from './dateUtils'
import { formatInteger, formatNumber, safeText } from './reportFormats'
import {
  getInterruptionOverlayHourIndexes,
  parseTimeToMinutes,
  timeToHourIndex,
} from './interruptionSlots'

export const DAILY_LOG_HOURS = Array.from({ length: 25 }, (_, index) =>
  `${String(index).padStart(2, '0')}:00`,
)

export const DAILY_LOG_EVENT_TYPES = [
  'LS',
  'BD',
  'SD',
  'OC',
  'EF',
  'SF',
  '33 KV Supply Fail',
]

export const DAILY_LOG_EVENT_SCOPE_OPTIONS = [
  { value: 'single_feeder', label: 'Selected Feeder' },
  { value: 'selected_feeders', label: 'Selected Feeders' },
  { value: 'all_11kv_only', label: 'All 11 KV Feeders' },
  { value: 'full_substation', label: 'Full Substation' },
]

const FEEDER_TYPES = {
  MAIN_INCOMING: 'main_incoming',
  CHILD: 'child_feeder',
  NORMAL: 'normal',
  EXPRESS: 'express_feeder',
  INCOMING_33: 'incoming_33kv',
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value))
}

function numericOrNull(value) {
  if (value === '' || value === null || value === undefined) {
    return null
  }

  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : null
}

function numericOrZero(value) {
  return numericOrNull(value) ?? 0
}

function hasFilledValue(value) {
  if (value === null || value === undefined) {
    return false
  }

  if (typeof value === 'string') {
    return value.trim() !== ''
  }

  return true
}

function textValue(value) {
  return String(value || '').trim()
}

function normalizeVoltageLevel(value, fallback = '11') {
  const text = String(value || fallback).replace(/[^0-9]/g, '')
  return text === '33' ? '33' : '11'
}

function getDisplayOrder(record, fallback) {
  const value = Number(record?.displayOrder)
  return Number.isFinite(value) ? value : fallback
}

function getCreatedAtValue(record, fallback) {
  const rawValue = record?.createdAt || record?.created_at || ''
  const timestamp = Date.parse(rawValue)
  return Number.isFinite(timestamp) ? timestamp : fallback
}

function getFeederType(feeder) {
  if (feeder?.feederType) {
    return feeder.feederType
  }

  if (feeder?.isMainIncoming) {
    return FEEDER_TYPES.MAIN_INCOMING
  }

  return FEEDER_TYPES.NORMAL
}

function sortConfiguredList(list) {
  return [...list].sort((left, right) => {
    const leftOrder = getDisplayOrder(left, Number.MAX_SAFE_INTEGER)
    const rightOrder = getDisplayOrder(right, Number.MAX_SAFE_INTEGER)

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder
    }

    const leftCreatedAt = getCreatedAtValue(left, Number.MAX_SAFE_INTEGER)
    const rightCreatedAt = getCreatedAtValue(right, Number.MAX_SAFE_INTEGER)

    if (leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt - rightCreatedAt
    }

    return safeText(left.name || left.code, '').localeCompare(
      safeText(right.name || right.code, ''),
    )
  })
}

function sortFeedersByAddSequence(list) {
  return [...list].sort((left, right) => {
    const leftOrder = getDisplayOrder(left, Number.MAX_SAFE_INTEGER)
    const rightOrder = getDisplayOrder(right, Number.MAX_SAFE_INTEGER)
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder
    }

    const leftCreatedAt = getCreatedAtValue(left, left._sourceIndex ?? Number.MAX_SAFE_INTEGER)
    const rightCreatedAt = getCreatedAtValue(
      right,
      right._sourceIndex ?? Number.MAX_SAFE_INTEGER,
    )

    if (leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt - rightCreatedAt
    }

    const leftIncomingSequence = getIncomingSequenceValue(left)
    const rightIncomingSequence = getIncomingSequenceValue(right)

    if (
      left.feederType === FEEDER_TYPES.MAIN_INCOMING &&
      right.feederType === FEEDER_TYPES.MAIN_INCOMING &&
      leftIncomingSequence !== rightIncomingSequence
    ) {
      return leftIncomingSequence - rightIncomingSequence
    }

    return (left._sourceIndex ?? 0) - (right._sourceIndex ?? 0)
  })
}

function getIncomingSequenceValue(feeder) {
  const explicitValue = Number(feeder?.incomingSequence)

  if (Number.isFinite(explicitValue) && explicitValue > 0) {
    return explicitValue
  }

  const sourceTexts = [
    safeText(feeder?.printGroupLabel, ''),
    safeText(feeder?.name, ''),
    safeText(feeder?.code, ''),
  ]

  for (const sourceText of sourceTexts) {
    const matchedIncoming = sourceText.match(/\binc(?:oming|omer)?\s*[-/]?\s*(\d+)\b/i)

    if (matchedIncoming) {
      return Number(matchedIncoming[1])
    }
  }

  return Number.MAX_SAFE_INTEGER
}

function sortMainIncomingFeeders(feeders = []) {
  return sortFeedersByAddSequence(feeders)
}

function getFeederMetrics(feeder) {
  const voltageLevel = normalizeVoltageLevel(
    feeder?.voltageLevel,
    feeder?.isMainIncoming ? '33' : '11',
  )

  if (getFeederType(feeder) === FEEDER_TYPES.MAIN_INCOMING) {
    return ['amp', 'kv', 'kwh']
  }

  if (getFeederType(feeder) === FEEDER_TYPES.INCOMING_33) {
    return ['amp', 'kv', 'kwh']
  }

  if (getFeederType(feeder) === FEEDER_TYPES.EXPRESS) {
    return voltageLevel === '33' ? ['amp', 'kv', 'kwh'] : ['amp', 'kwh']
  }

  return voltageLevel === '33' ? ['amp', 'kv', 'kwh'] : ['amp', 'kwh']
}

function buildFlatColumns(groups) {
  return groups.flatMap((group) =>
    group.items.flatMap((item) =>
      item.metrics.map((metric) => ({
        key: `${item.kind}-${item.id}-${metric}`,
        kind: item.kind,
        id: item.id,
        label: item.label,
        metric,
        metricLabel:
          metric === 'amp'
            ? 'Amp'
            : metric === 'kv'
              ? 'KV'
              : metric === 'kwh'
                ? 'KWH'
                : metric === 'tap'
                  ? 'Tap Position'
                  : metric === 'temperature'
                    ? 'Temperature'
                    : 'Voltage',
      })),
    ),
  )
}

function buildChildMap(feeders) {
  return feeders.reduce((map, feeder) => {
    if (!feeder.parentFeederId) {
      return map
    }

    map[feeder.parentFeederId] = map[feeder.parentFeederId] || []
    map[feeder.parentFeederId].push(feeder)
    return map
  }, {})
}

function isAutoAmpFeeder(feeder, config) {
  return (
    getFeederType(feeder) === FEEDER_TYPES.MAIN_INCOMING &&
    Array.isArray(config.childMap?.[feeder.id]) &&
    config.childMap[feeder.id].length > 0
  )
}

function getEffectiveAmpState(row, feeder, config, memo = {}, trail = {}) {
  if (memo[feeder.id]) {
    return memo[feeder.id]
  }

  if (trail[feeder.id]) {
    return { text: '', number: 0, hasValue: false }
  }

  const nextTrail = {
    ...trail,
    [feeder.id]: true,
  }

  if (isAutoAmpFeeder(feeder, config)) {
    const childFeeders = config.childMap?.[feeder.id] || []
    let total = 0
    let hasValue = false

    childFeeders.forEach((childFeeder) => {
      const state = getEffectiveAmpState(row, childFeeder, config, memo, nextTrail)
      if (state.hasValue) {
        total += state.number
        hasValue = true
      }
    })

    memo[feeder.id] = hasValue
      ? {
          text: total.toFixed(2),
          number: Number(total.toFixed(2)),
          hasValue: true,
        }
      : { text: '', number: 0, hasValue: false }

    return memo[feeder.id]
  }

  const rawAmp = numericOrNull(row?.feederReadings?.[feeder.id]?.amp)

  memo[feeder.id] =
    rawAmp === null
      ? { text: '', number: 0, hasValue: false }
      : {
          text: String(row.feederReadings[feeder.id].amp),
          number: rawAmp,
          hasValue: true,
        }

  return memo[feeder.id]
}

function createBlankFeederReading() {
  return {
    amp: '',
    kv: '',
    kwh: '',
    metadata: {
      entryMode: '',
      source: '',
      sourceType: '',
      ampSourceType: '',
      kvSourceType: '',
      eventCode: '',
      eventOrigin: '',
      interruptionLinkId: '',
      isOverridden: false,
      pendingGap: false,
      validationState: 'valid',
      validationMessage: '',
      meterSegmentId: '',
      eventBlocked: false,
      lsBlocked: false,
    },
  }
}

function createEmptyRow(config, hour) {
  return {
    hour,
    feederReadings: Object.fromEntries(
      config.feeders.map((feeder) => [feeder.id, createBlankFeederReading()]),
    ),
    batteryVoltages: config.batterySets.map(() => ''),
    transformerTaps: config.transformers.map(() => ''),
    transformerTemperatures: config.transformers.map(() => ''),
    remark: '',
  }
}

function normalizeReading(reading) {
  const fallbackSourceType =
    numericOrNull(reading?.kwh) !== null
      ? reading?.metadata?.entryMode === 'carry_forward'
        ? 'carry_forward'
        : reading?.metadata?.entryMode === 'estimated'
          ? 'auto_gap_fill'
          : 'manual'
      : ''

  return {
    amp: reading?.amp ?? '',
    kv: reading?.kv ?? '',
    kwh: reading?.kwh ?? '',
    metadata: {
      entryMode:
        reading?.metadata?.entryMode ||
        (numericOrNull(reading?.kwh) !== null ? 'actual' : ''),
      source:
        reading?.metadata?.source ||
        (numericOrNull(reading?.kwh) !== null ? 'manual' : ''),
      sourceType: reading?.metadata?.sourceType || fallbackSourceType,
      ampSourceType:
        reading?.metadata?.ampSourceType ||
        (numericOrNull(reading?.amp) !== null ? 'manual' : ''),
      kvSourceType:
        reading?.metadata?.kvSourceType ||
        (numericOrNull(reading?.kv) !== null ? 'manual' : ''),
      eventCode: reading?.metadata?.eventCode || '',
      eventOrigin: reading?.metadata?.eventOrigin || '',
      interruptionLinkId: reading?.metadata?.interruptionLinkId || '',
      isOverridden: Boolean(reading?.metadata?.isOverridden),
      pendingGap: Boolean(reading?.metadata?.pendingGap),
      validationState: reading?.metadata?.validationState || 'valid',
      validationMessage: reading?.metadata?.validationMessage || '',
      meterSegmentId: reading?.metadata?.meterSegmentId || '',
      eventBlocked: Boolean(reading?.metadata?.eventBlocked),
      lsBlocked: Boolean(reading?.metadata?.lsBlocked),
    },
  }
}

function isAutoGapFillReading(reading) {
  const metadata = reading?.metadata || {}

  return (
    metadata.sourceType === 'auto_gap_fill' ||
    metadata.entryMode === 'estimated' ||
    String(metadata.source || '').startsWith('distributed:')
  )
}

function sanitizeReadingForManualState(reading) {
  const normalized = normalizeReading(reading)

  if (!isAutoGapFillReading(normalized)) {
    return {
      ...normalized,
      metadata: {
        ...normalized.metadata,
        pendingGap: false,
        eventCode: '',
        eventOrigin: '',
        interruptionLinkId: '',
      },
    }
  }

  return {
    amp:
      normalized.metadata.ampSourceType === 'auto_gap_fill'
        ? ''
        : normalized.amp,
    kv:
      normalized.metadata.kvSourceType === 'auto_gap_fill'
        ? ''
        : normalized.kv,
    kwh: '',
    metadata: {
      ...createBlankFeederReading().metadata,
      ampSourceType:
        normalized.metadata.ampSourceType === 'auto_gap_fill'
          ? ''
          : normalized.metadata.ampSourceType,
      kvSourceType:
        normalized.metadata.kvSourceType === 'auto_gap_fill'
          ? ''
          : normalized.metadata.kvSourceType,
      sourceType: '',
    },
  }
}

function normalizeRow(row, config, hour) {
  const feederReadings = Object.fromEntries(
    config.feeders.map((feeder) => [
      feeder.id,
      normalizeReading(row?.feederReadings?.[feeder.id]),
    ]),
  )

  return {
    hour,
    feederReadings,
    batteryVoltages: config.batterySets.map(
      (_, index) => row?.batteryVoltages?.[index] ?? '',
    ),
    transformerTaps: config.transformers.map(
      (_, index) => row?.transformerTaps?.[index] ?? '',
    ),
    transformerTemperatures: config.transformers.map(
      (_, index) => row?.transformerTemperatures?.[index] ?? '',
    ),
    remark: row?.remark || '',
  }
}

function applyCarryForwardAutofill(rows, config, seed = null, suppressedCells = {}) {
  const nextRows = rows.map((row) => ({
    ...row,
    feederReadings: { ...(row.feederReadings || {}) },
    batteryVoltages: [...(row.batteryVoltages || [])],
    transformerTaps: [...(row.transformerTaps || [])],
    transformerTemperatures: [...(row.transformerTemperatures || [])],
  }))

  const feederCarryState = Object.fromEntries(
    config.feeders.map((feeder) => [
      feeder.id,
      {
        amp: hasFilledValue(seed?.feederMetricById?.[feeder.id]?.amp)
          ? String(seed.feederMetricById[feeder.id].amp)
          : '',
        kv: hasFilledValue(seed?.feederMetricById?.[feeder.id]?.kv)
          ? String(seed.feederMetricById[feeder.id].kv)
          : '',
      },
    ]),
  )
  const batteryCarryState = config.batterySets.map((_, index) =>
    hasFilledValue(seed?.batteryVoltages?.[index]) ? String(seed.batteryVoltages[index]) : '',
  )
  const tapCarryState = config.transformers.map((_, index) =>
    hasFilledValue(seed?.transformerTaps?.[index]) ? String(seed.transformerTaps[index]) : '',
  )
  const tempCarryState = config.transformers.map((_, index) =>
    hasFilledValue(seed?.transformerTemperatures?.[index])
      ? String(seed.transformerTemperatures[index])
      : '',
  )

  nextRows.forEach((row) => {
    config.feeders.forEach((feeder) => {
      const reading = row.feederReadings?.[feeder.id] || createBlankFeederReading()
      const metadata = reading.metadata || {}
      const hasKwhForRow = hasFilledValue(reading.kwh)
      const ampSuppressed = Boolean(suppressedCells[`f:${row.hour}:${feeder.id}:amp`])
      const kvSuppressed = Boolean(suppressedCells[`f:${row.hour}:${feeder.id}:kv`])

      const ampCurrent = hasFilledValue(reading.amp) ? String(reading.amp) : ''
      if (ampCurrent) {
        feederCarryState[feeder.id].amp = ampCurrent
      } else if (
        !ampSuppressed &&
        hasKwhForRow &&
        hasFilledValue(feederCarryState[feeder.id].amp)
      ) {
        reading.amp = feederCarryState[feeder.id].amp
        reading.metadata = {
          ...metadata,
          ampSourceType: 'carry_forward',
        }
      } else if (
        (ampSuppressed || !hasKwhForRow) &&
        metadata.ampSourceType === 'carry_forward'
      ) {
        reading.amp = ''
        reading.metadata = {
          ...metadata,
          ampSourceType: '',
        }
      }

      const kvCurrent = hasFilledValue(reading.kv) ? String(reading.kv) : ''
      if (kvCurrent) {
        feederCarryState[feeder.id].kv = kvCurrent
      } else if (
        !kvSuppressed &&
        hasKwhForRow &&
        hasFilledValue(feederCarryState[feeder.id].kv)
      ) {
        reading.kv = feederCarryState[feeder.id].kv
        reading.metadata = {
          ...reading.metadata,
          kvSourceType: 'carry_forward',
        }
      } else if (
        (kvSuppressed || !hasKwhForRow) &&
        (reading.metadata?.kvSourceType || '') === 'carry_forward'
      ) {
        reading.kv = ''
        reading.metadata = {
          ...reading.metadata,
          kvSourceType: '',
        }
      }

      row.feederReadings[feeder.id] = reading
    })

    row.batteryVoltages = row.batteryVoltages.map((value, index) => {
      const suppressed = Boolean(suppressedCells[`b:${row.hour}:${index}:voltage`])
      if (hasFilledValue(value)) {
        batteryCarryState[index] = String(value)
        return value
      }

      if (suppressed) {
        return ''
      }

      return hasFilledValue(batteryCarryState[index]) ? batteryCarryState[index] : ''
    })

    row.transformerTaps = row.transformerTaps.map((value, index) => {
      const suppressed = Boolean(suppressedCells[`t:${row.hour}:${index}:tap`])
      if (hasFilledValue(value)) {
        tapCarryState[index] = String(value)
        return value
      }

      if (suppressed) {
        return ''
      }

      return hasFilledValue(tapCarryState[index]) ? tapCarryState[index] : ''
    })

    row.transformerTemperatures = row.transformerTemperatures.map((value, index) => {
      const suppressed = Boolean(suppressedCells[`t:${row.hour}:${index}:temperature`])
      if (hasFilledValue(value)) {
        tempCarryState[index] = String(value)
        return value
      }

      if (suppressed) {
        return ''
      }

      return hasFilledValue(tempCarryState[index]) ? tempCarryState[index] : ''
    })
  })

  return nextRows
}

function applyAmpKvCarryForwardByEffectiveKwh(rows, config, seed = null, suppressedCells = {}) {
  const nextRows = rows.map((row) => ({
    ...row,
    feederReadings: { ...(row.feederReadings || {}) },
  }))

  const feederCarryState = Object.fromEntries(
    config.feeders.map((feeder) => [
      feeder.id,
      {
        amp: hasFilledValue(seed?.feederMetricById?.[feeder.id]?.amp)
          ? String(seed.feederMetricById[feeder.id].amp)
          : '',
        kv: hasFilledValue(seed?.feederMetricById?.[feeder.id]?.kv)
          ? String(seed.feederMetricById[feeder.id].kv)
          : '',
      },
    ]),
  )

  nextRows.forEach((row) => {
    config.feeders.forEach((feeder) => {
      const reading = row.feederReadings?.[feeder.id] || createBlankFeederReading()
      const metadata = reading.metadata || {}
      const hasEffectiveKwhForRow = hasFilledValue(reading.kwh)
      const ampSuppressed = Boolean(suppressedCells[`f:${row.hour}:${feeder.id}:amp`])
      const kvSuppressed = Boolean(suppressedCells[`f:${row.hour}:${feeder.id}:kv`])

      const ampCurrent = hasFilledValue(reading.amp) ? String(reading.amp) : ''
      if (ampCurrent) {
        feederCarryState[feeder.id].amp = ampCurrent
      } else if (
        !ampSuppressed &&
        hasEffectiveKwhForRow &&
        hasFilledValue(feederCarryState[feeder.id].amp)
      ) {
        reading.amp = feederCarryState[feeder.id].amp
        reading.metadata = {
          ...metadata,
          ampSourceType: 'carry_forward',
        }
      } else if (
        (ampSuppressed || !hasEffectiveKwhForRow) &&
        metadata.ampSourceType === 'carry_forward'
      ) {
        reading.amp = ''
        reading.metadata = {
          ...metadata,
          ampSourceType: '',
        }
      }

      const kvCurrent = hasFilledValue(reading.kv) ? String(reading.kv) : ''
      if (kvCurrent) {
        feederCarryState[feeder.id].kv = kvCurrent
      } else if (
        !kvSuppressed &&
        hasEffectiveKwhForRow &&
        hasFilledValue(feederCarryState[feeder.id].kv)
      ) {
        reading.kv = feederCarryState[feeder.id].kv
        reading.metadata = {
          ...reading.metadata,
          kvSourceType: 'carry_forward',
        }
      } else if (
        (kvSuppressed || !hasEffectiveKwhForRow) &&
        (reading.metadata?.kvSourceType || '') === 'carry_forward'
      ) {
        reading.kv = ''
        reading.metadata = {
          ...reading.metadata,
          kvSourceType: '',
        }
      }

      row.feederReadings[feeder.id] = reading
    })
  })

  return nextRows
}

function stripDerivedRows(rows = [], config) {
  return DAILY_LOG_HOURS.map((hour, rowIndex) => ({
    hour,
    feederReadings: Object.fromEntries(
      config.feeders.map((feeder) => [
        feeder.id,
        sanitizeReadingForManualState(rows[rowIndex]?.feederReadings?.[feeder.id]),
      ]),
    ),
    batteryVoltages: config.batterySets.map(
      (_, index) => rows[rowIndex]?.batteryVoltages?.[index] ?? '',
    ),
    transformerTaps: config.transformers.map(
      (_, index) => rows[rowIndex]?.transformerTaps?.[index] ?? '',
    ),
    transformerTemperatures: config.transformers.map(
      (_, index) => rows[rowIndex]?.transformerTemperatures?.[index] ?? '',
    ),
    remark: rows[rowIndex]?.remark || '',
  }))
}

function compareHourValues(left, right) {
  return timeToHourIndex(left) - timeToHourIndex(right)
}

function minutesToDurationLabel(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function countDecimalPlaces(value) {
  const matched = String(value ?? '')
    .trim()
    .match(/\.(\d+)$/)

  if (!matched) {
    return 0
  }

  return Math.min(2, matched[1].length)
}

function formatKwhValue(value, precision = 2) {
  if (!Number.isFinite(value)) {
    return ''
  }

  const rounded = Number(value.toFixed(precision))

  if (Number.isInteger(rounded)) {
    return String(rounded)
  }

  return rounded.toFixed(precision).replace(/\.?0+$/, '')
}

function formatAmpValue(value) {
  if (!Number.isFinite(value)) {
    return ''
  }

  return String(Math.round(value))
}

function buildDistributedCumulativeValues(startValue, endValue, intervalCount, precision = 2) {
  if (
    !Number.isFinite(startValue) ||
    !Number.isFinite(endValue) ||
    !Number.isInteger(intervalCount) ||
    intervalCount <= 0
  ) {
    return []
  }

  const scale = 10 ** precision
  const startScaled = Math.round(startValue * scale)
  const endScaled = Math.round(endValue * scale)
  const deltaScaled = endScaled - startScaled

  if (deltaScaled < 0) {
    return []
  }

  const baseIncrement = Math.floor(deltaScaled / intervalCount)
  const remainder = deltaScaled - baseIncrement * intervalCount
  const values = []
  let runningValue = startScaled

  for (let stepIndex = 0; stepIndex < intervalCount; stepIndex += 1) {
    const extraUnit = stepIndex >= intervalCount - remainder ? 1 : 0
    runningValue += baseIncrement + extraUnit
    values.push(runningValue / scale)
  }

  return values
}

function buildSoftAmpValues(previousAmp, nextAmp, intervalCount) {
  if (!Number.isFinite(previousAmp) || !Number.isInteger(intervalCount) || intervalCount <= 0) {
    return []
  }

  if (!Number.isFinite(nextAmp)) {
    return Array.from({ length: intervalCount }, () => previousAmp)
  }

  const step = (nextAmp - previousAmp) / intervalCount

  return Array.from({ length: intervalCount }, (_, stepIndex) =>
    previousAmp + step * (stepIndex + 1),
  )
}

function isActualAnchor(reading) {
  const kwh = numericOrNull(reading?.kwh)
  const entryMode = reading?.metadata?.entryMode || ''

  if (kwh === null) {
    return false
  }

  return entryMode !== 'estimated'
}

function buildExplicitOverlayMap(interruptions) {
  const overlayMap = new Map()

  interruptions.forEach((interruption) => {
    ;(interruption.affectedFeederIds || [interruption.feeder_id]).forEach((feederId) => {
      // Final business rule:
      // Always exclude start-hour slot and include end-hour slot for LS overlay.
      const overlayHours = getInterruptionOverlayHourIndexes({
        fromTime: interruption.from_time,
        toTime: interruption.to_time,
        excludeStartHourSlot: true,
      })
      if (!overlayHours.length) return

      for (const hourIndex of overlayHours) {
        overlayMap.set(`${feederId}:${hourIndex}`, {
          code: interruption.event_type,
          source: interruption.source || 'explicit',
          interruptionId: interruption.id,
        })
      }
    })
  })

  return overlayMap
}

function findPreviousActualAnchorIndex(rows, feederId, currentRowIndex) {
  for (let rowIndex = currentRowIndex - 1; rowIndex >= 0; rowIndex -= 1) {
    const reading = rows[rowIndex]?.feederReadings?.[feederId]

    if (numericOrNull(reading?.kwh) === null) {
      continue
    }

    if ((reading?.metadata?.entryMode || '') === 'estimated') {
      continue
    }

    return rowIndex
  }

  return -1
}

function getEstimatableGapIndexes(rows, feederId, previousAnchorIndex, currentRowIndex, explicitOverlayMap) {
  const gapIndexes = []

  for (let rowIndex = previousAnchorIndex + 1; rowIndex < currentRowIndex; rowIndex += 1) {
    if (explicitOverlayMap.has(`${feederId}:${rowIndex}`)) {
      return null
    }

    const reading = rows[rowIndex]?.feederReadings?.[feederId]
    const hasKwhValue = numericOrNull(reading?.kwh) !== null
    const entryMode = reading?.metadata?.entryMode || ''

    if (!hasKwhValue || entryMode === 'estimated') {
      gapIndexes.push(rowIndex)
      continue
    }

    return null
  }

  return gapIndexes.length ? gapIndexes : null
}

function groupContiguousIndexes(indexes) {
  if (!indexes.length) {
    return []
  }

  const groups = []
  let currentGroup = [indexes[0]]

  for (let index = 1; index < indexes.length; index += 1) {
    if (indexes[index] === indexes[index - 1] + 1) {
      currentGroup.push(indexes[index])
      continue
    }

    groups.push(currentGroup)
    currentGroup = [indexes[index]]
  }

  groups.push(currentGroup)
  return groups
}

function createAutoLsInterruptionsForGroups(feeder, groups) {
  return groups.map((group, groupIndex) => ({
    id: `auto-${feeder.id}-${group[0]}-${group[group.length - 1]}-${groupIndex}`,
    feeder_id: feeder.id,
    feeder_name: feeder.name,
    from_time: DAILY_LOG_HOURS[group[0]],
    to_time: DAILY_LOG_HOURS[Math.min(group[group.length - 1] + 1, 24)],
    duration_minutes: group.length * 60,
    duration_hours: Number(group.length.toFixed(2)),
    event_type: 'LS',
    source: 'auto',
    is_auto: true,
    generated_reason: 'unresolved_kwh_gap',
    linked_auto_rule: 'unresolved_kwh_gap_finalize',
    remark: 'Auto-generated from unresolved KWH gap.',
    overlayHours: [...group],
  }))
}

function getInterruptionsForFeeder(interruptions = [], feederId) {
  return interruptions.filter((interruption) => {
    const affectedFeederIds = interruption.affectedFeederIds || [interruption.feeder_id]
    return affectedFeederIds.includes(feederId)
  })
}

function getManualMetricNumber(reading, metric) {
  const metadata = reading?.metadata || {}

  if (metric === 'amp' && metadata.ampSourceType === 'auto_gap_fill') {
    return null
  }

  if (metric === 'kv' && metadata.kvSourceType === 'auto_gap_fill') {
    return null
  }

  return numericOrNull(reading?.[metric])
}

function applyDistributedAmpFill(rows, feederId, previousAnchorIndex, currentRowIndex, gapIndexes) {
  const previousReading = rows[previousAnchorIndex]?.feederReadings?.[feederId]
  const currentReading = rows[currentRowIndex]?.feederReadings?.[feederId]
  const previousAmp = getManualMetricNumber(previousReading, 'amp')
  const currentAmp = getManualMetricNumber(currentReading, 'amp')
  const intervalCount = currentRowIndex - previousAnchorIndex

  if (previousAmp === null || !Number.isInteger(intervalCount) || intervalCount <= 0) {
    return rows
  }

  const distributedAmpValues = buildSoftAmpValues(previousAmp, currentAmp, intervalCount)

  return rows.map((row, rowIndex) => {
    if (!gapIndexes.includes(rowIndex)) {
      return row
    }

    const reading = row.feederReadings?.[feederId] || createBlankFeederReading()

    if (reading?.metadata?.ampSourceType === 'manual') {
      return row
    }

    const distributedAmp = distributedAmpValues[rowIndex - previousAnchorIndex - 1]

    if (!Number.isFinite(distributedAmp)) {
      return row
    }

    return {
      ...row,
      feederReadings: {
        ...row.feederReadings,
        [feederId]: {
          ...reading,
          amp: formatAmpValue(distributedAmp),
          metadata: {
            ...reading.metadata,
            ampSourceType: 'auto_gap_fill',
          },
        },
      },
    }
  })
}

function buildAutoLsState(rows, config, explicitOverlayMap, mode = 'draft') {
  const autoOverlayMap = new Map()
  const autoInterruptions = []
  const estimationCandidates = []
  const pendingGapMap = new Map()
  let resolvedRows = rows.map((row) => ({
    ...row,
    feederReadings: Object.fromEntries(
      Object.entries(row.feederReadings || {}).map(([feederId, reading]) => [
        feederId,
        {
          ...reading,
          metadata: {
            ...createBlankFeederReading().metadata,
            ...reading.metadata,
            pendingGap: false,
            eventCode: '',
            eventOrigin: '',
            interruptionLinkId: '',
            eventBlocked: false,
            lsBlocked: false,
          },
        },
      ]),
    ),
  }))

  config.feeders.forEach((feeder) => {
    const actualAnchorIndexes = resolvedRows
      .map((row, rowIndex) => ({
        rowIndex,
        reading: row.feederReadings?.[feeder.id],
      }))
      .filter((item) => isActualAnchor(item.reading))
      .map((item) => item.rowIndex)

    if (!actualAnchorIndexes.length) {
      return
    }

    for (let anchorIndex = 0; anchorIndex < actualAnchorIndexes.length - 1; anchorIndex += 1) {
      const leftAnchorIndex = actualAnchorIndexes[anchorIndex]
      const rightAnchorIndex = actualAnchorIndexes[anchorIndex + 1]

      if (rightAnchorIndex - leftAnchorIndex <= 1) {
        continue
      }

      const missingIndexes = getEstimatableGapIndexes(
        resolvedRows,
        feeder.id,
        leftAnchorIndex,
        rightAnchorIndex,
        explicitOverlayMap,
      )

      if (!missingIndexes?.length) {
        continue
      }

      const startReading = resolvedRows[leftAnchorIndex].feederReadings?.[feeder.id]
      const endReading = resolvedRows[rightAnchorIndex].feederReadings?.[feeder.id]
      const startValue = numericOrZero(startReading?.kwh)
      const endValue = numericOrZero(endReading?.kwh)

      if (endValue < startValue) {
        continue
      }

      const precision = Math.max(
        countDecimalPlaces(startReading?.kwh),
        countDecimalPlaces(endReading?.kwh),
      )
      const distributedValues = buildDistributedCumulativeValues(
        startValue,
        endValue,
        rightAnchorIndex - leftAnchorIndex,
        precision,
      )

      if (!distributedValues.length) {
        continue
      }

      resolvedRows = resolvedRows.map((row, rowIndex) => {
        if (!missingIndexes.includes(rowIndex)) {
          return row
        }

        const reading = row.feederReadings?.[feeder.id] || createBlankFeederReading()
        const distributedValue = distributedValues[rowIndex - leftAnchorIndex - 1]

        return {
          ...row,
          feederReadings: {
            ...row.feederReadings,
            [feeder.id]: {
              ...reading,
              kwh: formatKwhValue(distributedValue, precision),
              metadata: {
                ...reading.metadata,
                entryMode: 'estimated',
                source: `distributed:${DAILY_LOG_HOURS[leftAnchorIndex]}-${DAILY_LOG_HOURS[rightAnchorIndex]}`,
                sourceType: 'auto_gap_fill',
                eventCode: '',
                eventOrigin: '',
                interruptionLinkId: '',
                pendingGap: false,
                eventBlocked: false,
                lsBlocked: false,
              },
            },
          },
        }
      })

      resolvedRows = applyDistributedAmpFill(
        resolvedRows,
        feeder.id,
        leftAnchorIndex,
        rightAnchorIndex,
        missingIndexes,
      )

      estimationCandidates.push({
        feederId: feeder.id,
        feederName: feeder.name,
        startHour: DAILY_LOG_HOURS[leftAnchorIndex],
        endHour: DAILY_LOG_HOURS[rightAnchorIndex],
        startHourIndex: leftAnchorIndex,
        endHourIndex: rightAnchorIndex,
        startValue,
        endValue,
        missingIndexes,
        intervalCount: rightAnchorIndex - leftAnchorIndex,
        totalUnits: Number((endValue - startValue).toFixed(2)),
      })
    }

    const lastAnchorIndex = actualAnchorIndexes[actualAnchorIndexes.length - 1]
    const trailingIndexes = []

    for (let rowIndex = lastAnchorIndex + 1; rowIndex < DAILY_LOG_HOURS.length; rowIndex += 1) {
      const reading = resolvedRows[rowIndex].feederReadings?.[feeder.id]

      if (numericOrNull(reading?.kwh) !== null) {
        continue
      }

      if (explicitOverlayMap.has(`${feeder.id}:${rowIndex}`)) {
        continue
      }

      trailingIndexes.push(rowIndex)
    }

    if (!trailingIndexes.length) {
      return
    }

    if (mode === 'finalized') {
      const autoLsRows = createAutoLsInterruptionsForGroups(
        feeder,
        groupContiguousIndexes(trailingIndexes),
      )

      autoInterruptions.push(...autoLsRows)
      autoLsRows.forEach((interruption) => {
        interruption.overlayHours.forEach((hourIndex) => {
          autoOverlayMap.set(`${feeder.id}:${hourIndex}`, {
            code: 'LS',
            source: 'auto',
            interruptionId: interruption.id,
          })
        })
      })

      return
    }

    trailingIndexes.forEach((hourIndex) => {
      pendingGapMap.set(`${feeder.id}:${hourIndex}`, {
        code: 'PENDING',
        source: 'pending',
      })

      resolvedRows[hourIndex] = {
        ...resolvedRows[hourIndex],
        feederReadings: {
          ...resolvedRows[hourIndex].feederReadings,
          [feeder.id]: {
            ...resolvedRows[hourIndex].feederReadings[feeder.id],
            metadata: {
              ...resolvedRows[hourIndex].feederReadings[feeder.id]?.metadata,
              pendingGap: true,
              sourceType: '',
              eventCode: '',
              eventOrigin: '',
            },
          },
        },
      }
    })
  })

  return {
    resolvedRows,
    autoOverlayMap,
    autoInterruptions,
    estimationCandidates,
    pendingGapMap,
  }
}

export function applyAutomaticKwhGapFill(rows, feederId, currentRowIndex, interruptions = []) {
  const currentReading = rows[currentRowIndex]?.feederReadings?.[feederId]
  const currentValue = numericOrNull(currentReading?.kwh)

  if (currentValue === null) {
    return {
      rows,
      applied: false,
    }
  }

  const previousAnchorIndex = findPreviousActualAnchorIndex(rows, feederId, currentRowIndex)

  if (previousAnchorIndex < 0) {
    return {
      rows,
      applied: false,
    }
  }

  const previousReading = rows[previousAnchorIndex]?.feederReadings?.[feederId]
  const previousValue = numericOrNull(previousReading?.kwh)

  if (previousValue === null || currentValue < previousValue) {
    return {
      rows,
      applied: false,
    }
  }

  const explicitOverlayMap = buildExplicitOverlayMap(interruptions)
  const gapIndexes = getEstimatableGapIndexes(
    rows,
    feederId,
    previousAnchorIndex,
    currentRowIndex,
    explicitOverlayMap,
  )

  if (!gapIndexes?.length) {
    return {
      rows,
      applied: false,
    }
  }

  const precision = Math.max(
    countDecimalPlaces(previousReading?.kwh),
    countDecimalPlaces(currentReading?.kwh),
  )
  const distributedValues = buildDistributedCumulativeValues(
    previousValue,
    currentValue,
    currentRowIndex - previousAnchorIndex,
    precision,
  )

  if (!distributedValues.length) {
    return {
      rows,
      applied: false,
    }
  }

  const nextRows = rows.map((row, rowIndex) => {
    if (!gapIndexes.includes(rowIndex)) {
      return row
    }

    const reading = row.feederReadings?.[feederId] || createBlankFeederReading()
    const distributedValue = distributedValues[rowIndex - previousAnchorIndex - 1]

    return {
      ...row,
      feederReadings: {
        ...row.feederReadings,
        [feederId]: {
          ...reading,
          kwh: formatKwhValue(distributedValue, precision),
          metadata: {
            ...reading.metadata,
            entryMode: 'estimated',
            source: `distributed:${rows[previousAnchorIndex]?.hour}-${rows[currentRowIndex]?.hour}`,
            eventBlocked: false,
            lsBlocked: false,
          },
        },
      },
    }
  })

  return {
    rows: nextRows,
    applied: true,
    summary: {
      previousHour: rows[previousAnchorIndex]?.hour,
      currentHour: rows[currentRowIndex]?.hour,
      estimatedHours: gapIndexes.map((index) => rows[index]?.hour),
      startValue: previousValue,
      endValue: currentValue,
    },
  }
}

function getFeederIdsForScope(config, scopeType, baseFeederId, selectedFeederIds = [], eventType = '') {
  if (scopeType === 'selected_feeders') {
    return selectedFeederIds.filter((feederId) =>
      config.feeders.some((feeder) => feeder.id === feederId),
    )
  }

  if (scopeType === 'all_11kv_only') {
    return config.feeders
      .filter((feeder) => normalizeVoltageLevel(feeder.voltageLevel, '11') === '11')
      .map((feeder) => feeder.id)
  }

  if (scopeType === 'full_substation') {
    return config.feeders.map((feeder) => feeder.id)
  }

  if (String(eventType).toUpperCase() === 'SF') {
    return config.feeders
      .filter((feeder) => getFeederType(feeder) !== FEEDER_TYPES.EXPRESS)
      .map((feeder) => feeder.id)
  }

  return baseFeederId ? [baseFeederId] : []
}

function normalizeMeterChangeEvent(event, config) {
  const feederId = textValue(event?.feederId || event?.feeder_id)
  const feeder =
    config.feeders.find((item) => item.id === feederId) ||
    config.feeders.find((item) => item.name === textValue(event?.feederName || event?.feeder_name))

  return {
    id: textValue(event?.id) || `mtr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    feederId: feeder?.id || feederId,
    feederName: feeder?.name || textValue(event?.feederName || event?.feeder_name),
    effective_time: textValue(event?.effective_time || event?.effectiveTime),
    oldMeterLastReading: textValue(event?.oldMeterLastReading),
    newMeterStartReading: textValue(event?.newMeterStartReading),
    remark: textValue(event?.remark),
  }
}

function buildMeterChangeLookup(meterChangeEvents) {
  return meterChangeEvents.reduce((lookup, event) => {
    lookup[`${event.feederId}:${event.effective_time}`] = event
    return lookup
  }, {})
}

function listFeederMeterChanges(meterChangeEvents, feederId) {
  return meterChangeEvents
    .filter((event) => event.feederId === feederId && event.effective_time)
    .sort((left, right) => compareHourValues(left.effective_time, right.effective_time))
}

function getMeterSegmentId(feederId, hour, meterChangeEvents) {
  const relevantEvent = listFeederMeterChanges(meterChangeEvents, feederId).reduce(
    (latest, event) =>
      compareHourValues(event.effective_time, hour) <= 0 ? event : latest,
    null,
  )

  return relevantEvent ? `${feederId}:${relevantEvent.effective_time}` : `${feederId}:base`
}

function findPreviousComparableKwh(rows, feederId, rowIndex, meterChangeEvents) {
  const currentHour = rows[rowIndex]?.hour

  if (!currentHour) {
    return null
  }

  const currentSegmentId = getMeterSegmentId(feederId, currentHour, meterChangeEvents)

  for (let previousIndex = rowIndex - 1; previousIndex >= 0; previousIndex -= 1) {
    const previousReading = rows[previousIndex]?.feederReadings?.[feederId]
    const previousValue = numericOrNull(previousReading?.kwh)

    if (previousValue === null || isAutoGapFillReading(previousReading)) {
      continue
    }

    const previousSegmentId = getMeterSegmentId(
      feederId,
      rows[previousIndex]?.hour,
      meterChangeEvents,
    )

    if (previousSegmentId !== currentSegmentId) {
      continue
    }

    return {
      rowIndex: previousIndex,
      hour: rows[previousIndex]?.hour,
      value: previousValue,
      segmentId: previousSegmentId,
    }
  }

  return null
}

function validateKwhSequence(rows, feederId, rowIndex, meterChangeEvents) {
  const reading = rows[rowIndex]?.feederReadings?.[feederId]
  const currentValue = numericOrNull(reading?.kwh)

  if (currentValue === null || isAutoGapFillReading(reading)) {
    return {
      validationState: 'valid',
      validationMessage: '',
      previousComparable: null,
      meterSegmentId: rows[rowIndex]?.hour
        ? getMeterSegmentId(feederId, rows[rowIndex].hour, meterChangeEvents)
        : '',
    }
  }

  const previousComparable = findPreviousComparableKwh(rows, feederId, rowIndex, meterChangeEvents)
  const meterSegmentId = rows[rowIndex]?.hour
    ? getMeterSegmentId(feederId, rows[rowIndex].hour, meterChangeEvents)
    : ''

  if (!previousComparable || currentValue >= previousComparable.value) {
    return {
      validationState: 'valid',
      validationMessage: '',
      previousComparable,
      meterSegmentId,
    }
  }

  return {
    validationState: 'invalid_decrease',
    validationMessage: `Previous KWH = ${formatKwhValue(previousComparable.value)} at ${previousComparable.hour}. New KWH cannot be lower unless meter change is recorded.`,
    previousComparable,
    meterSegmentId,
  }
}

function applyDailyLogValidation(rows, config, meterChangeEvents) {
  return rows.map((row, rowIndex) => ({
    ...row,
    feederReadings: Object.fromEntries(
      config.feeders.map((feeder) => {
        const reading = row.feederReadings?.[feeder.id] || createBlankFeederReading()
        const kwhValidation = validateKwhSequence(rows, feeder.id, rowIndex, meterChangeEvents)

        return [
          feeder.id,
          {
            ...reading,
            metadata: {
              ...reading.metadata,
              validationState: kwhValidation.validationState,
              validationMessage: kwhValidation.validationMessage,
              meterSegmentId: kwhValidation.meterSegmentId,
            },
          },
        ]
      }),
    ),
  }))
}

function getFeederKwhAnchors(rows, feederId) {
  return rows
    .map((row) => ({
      hour: row.hour,
      value: numericOrNull(row.feederReadings?.[feederId]?.kwh),
      metadata: row.feederReadings?.[feederId]?.metadata || {},
    }))
    .filter((item) => item.value !== null)
    .sort((left, right) => compareHourValues(left.hour, right.hour))
}

function computeMeterAwareConsumption(rows, feederId, meterChangeEvents) {
  const anchors = getFeederKwhAnchors(rows, feederId)

  if (!anchors.length) {
    return {
      openingKwh: 0,
      closingKwh: 0,
      units: 0,
      meterChangeConsidered: false,
    }
  }

  const relevantEvents = meterChangeEvents
    .filter((event) => event.feederId === feederId && event.effective_time)
    .sort((left, right) => compareHourValues(left.effective_time, right.effective_time))

  if (!relevantEvents.length) {
    return {
      openingKwh: anchors[0].value,
      closingKwh: anchors[anchors.length - 1].value,
      units: Math.max(0, anchors[anchors.length - 1].value - anchors[0].value),
      meterChangeConsidered: false,
    }
  }

  let units = 0
  let segmentStart = anchors[0].value

  relevantEvents.forEach((event) => {
    const oldReading = numericOrNull(event.oldMeterLastReading)
    const newReading = numericOrNull(event.newMeterStartReading)

    if (segmentStart !== null && oldReading !== null && oldReading >= segmentStart) {
      units += oldReading - segmentStart
    }

    if (newReading !== null) {
      segmentStart = newReading
    }
  })

  const closingKwh = anchors[anchors.length - 1].value

  if (segmentStart !== null && closingKwh !== null && closingKwh >= segmentStart) {
    units += closingKwh - segmentStart
  }

  return {
    openingKwh: anchors[0].value,
    closingKwh,
    units: Number(units.toFixed(2)),
    meterChangeConsidered: true,
  }
}

function summarizeFeeder(
  feeder,
  rows,
  overlayMap,
  config,
  meterChangeEvents = [],
  interruptions = [],
) {
  const visibleRows = rows.map((row, rowIndex) => ({
    row,
    rowIndex,
    reading: row.feederReadings?.[feeder.id] || createBlankFeederReading(),
    overlay: overlayMap.get(`${feeder.id}:${rowIndex}`),
  }))

  const validLoadRows = visibleRows.filter(
    (item) => !item.overlay && !item.reading?.metadata?.pendingGap,
  )

  const ampValues = validLoadRows
    .map((item) => ({
      hour: item.row.hour,
      value: getEffectiveAmpState(item.row, feeder, config).hasValue
        ? getEffectiveAmpState(item.row, feeder, config).number
        : null,
    }))
    .filter((item) => item.value !== null)

  const kvValues = validLoadRows
    .map((item) => ({
      hour: item.row.hour,
      value: numericOrNull(item.reading?.kv),
    }))
    .filter((item) => item.value !== null)

  const kwhRows = visibleRows
    .map((item) => ({
      hour: item.row.hour,
      rowIndex: item.rowIndex,
      value: numericOrNull(item.reading?.kwh),
      metadata: item.reading?.metadata || {},
    }))
    .filter((item) => item.value !== null)

  const consumptionMetrics = computeMeterAwareConsumption(rows, feeder.id, meterChangeEvents)
  const openingKwh = consumptionMetrics.openingKwh
  const closingKwh = consumptionMetrics.closingKwh
  const maxLoad = ampValues.length
    ? ampValues.reduce((best, item) => (item.value > best.value ? item : best), ampValues[0])
    : null
  const minLoad = ampValues.length
    ? ampValues.reduce((best, item) => (item.value < best.value ? item : best), ampValues[0])
    : null
  const maxKv = kvValues.length
    ? kvValues.reduce((best, item) => (item.value > best.value ? item : best), kvValues[0])
    : null
  const minKv = kvValues.length
    ? kvValues.reduce((best, item) => (item.value < best.value ? item : best), kvValues[0])
    : null
  const feederInterruptions = getInterruptionsForFeeder(interruptions, feeder.id)
  const outageHours = feederInterruptions.reduce(
    (total, interruption) => total + Number(interruption.duration_hours || 0),
    0,
  )
  const noOfInterruptions = feederInterruptions.length
  const autoLsHours = feederInterruptions
    .filter(
      (interruption) =>
        interruption.event_type === 'LS' &&
        (interruption.is_auto || interruption.source === 'auto'),
    )
    .reduce((total, interruption) => total + Number(interruption.duration_hours || 0), 0)
  const manualInterruptions = feederInterruptions.filter(
    (interruption) => !(interruption.is_auto || interruption.source === 'auto'),
  ).length

  return {
    feederId: feeder.id,
    feederName: feeder.name,
    feederType: getFeederType(feeder),
    voltageLevel: normalizeVoltageLevel(feeder.voltageLevel, '11'),
    openingKwh,
    closingKwh,
    units: consumptionMetrics.units,
    meterChangeConsidered: consumptionMetrics.meterChangeConsidered,
    maxLoad: maxLoad?.value ?? 0,
    maxLoadHour: maxLoad?.hour || '-',
    minLoad: minLoad?.value ?? 0,
    minLoadHour: minLoad?.hour || '-',
    maxKv: maxKv?.value ?? 0,
    minKv: minKv?.value ?? 0,
    loggedHours: kwhRows.length,
    outageHours: Number(outageHours.toFixed(2)),
    interruptionMinutes: Number((outageHours * 60).toFixed(0)),
    noOfInterruptions,
    explicitInterruptions: manualInterruptions,
    autoLsHours: Number(autoLsHours.toFixed(2)),
  }
}

function buildRowOverlayCells(row, rowIndex, config, overlayMap, ampStates = {}, pendingGapMap = new Map()) {
  return Object.fromEntries(
    config.flatColumns.map((column) => {
      if (column.kind === 'feeder') {
        const reading = row.feederReadings?.[column.id] || createBlankFeederReading()
        const feeder = config.feeders.find((item) => item.id === column.id)
        const overlay = overlayMap.get(`${column.id}:${rowIndex}`)
        const pendingGap = pendingGapMap.get(`${column.id}:${rowIndex}`)
        const metadata = reading.metadata || {}
        const value =
          overlay && column.metric !== 'kwh'
            ? ''
            : column.metric === 'amp'
              ? ampStates[column.id]?.text ?? reading.amp
              : column.metric === 'kv'
                ? reading.kv
                : reading.kwh
        const sourceType =
          column.metric === 'amp'
            ? metadata.ampSourceType || metadata.sourceType || ''
            : column.metric === 'kv'
              ? metadata.kvSourceType || metadata.sourceType || ''
              : metadata.sourceType || ''

        return [
          column.key,
          {
            overlayCode: column.metric === 'kwh' ? overlay?.code || '' : '',
            overlaySource: overlay?.source || '',
            pendingCode: pendingGap && column.metric === 'kwh' ? '...' : '',
            sourceType,
            isPending: Boolean(pendingGap) && column.metric === 'kwh',
            sourceBadge:
              column.metric === 'kwh' && sourceType === 'carry_forward'
                ? 'CF'
                : column.metric === 'kwh' && sourceType === 'auto_gap_fill'
                  ? 'A'
                  : '',
            validationState: metadata.validationState || 'valid',
            validationMessage: metadata.validationMessage || '',
            value: value ?? '',
            isAutoCalculated:
              column.metric === 'amp' && feeder ? isAutoAmpFeeder(feeder, config) : false,
          },
        ]
      }

      if (column.kind === 'battery') {
        return [
          column.key,
          {
            value: row.batteryVoltages?.[column.id] ?? '',
          },
        ]
      }

      if (column.kind === 'transformer') {
        const value =
          column.metric === 'tap'
            ? row.transformerTaps?.[column.id] ?? ''
            : row.transformerTemperatures?.[column.id] ?? ''

        return [
          column.key,
          {
            value,
          },
        ]
      }

      return [column.key, { value: '' }]
    }),
  )
}

export function buildDailyLogConfiguration({
  substationId,
  feeders = [],
  batterySets = [],
  transformers = [],
}) {
  const normalizedFeeders = sortFeedersByAddSequence(
    feeders
      .filter((item) => !substationId || item.substationId === substationId)
      .map((feeder, index) => ({
        ...feeder,
        _sourceIndex: index,
        feederType: getFeederType(feeder),
        voltageLevel: normalizeVoltageLevel(
          feeder.voltageLevel,
          feeder.isMainIncoming ? '33' : '11',
        ),
      })),
  )

  const mainIncomingFeeders = normalizedFeeders.filter(
    (feeder) => feeder.feederType === FEEDER_TYPES.MAIN_INCOMING,
  )
  const sortedMainIncomingFeeders = sortMainIncomingFeeders(mainIncomingFeeders)
  const elevenKvIncomingFeeders = sortedMainIncomingFeeders.filter(
    (feeder) => normalizeVoltageLevel(feeder.voltageLevel, '11') === '11',
  )
  const orderedIncomingGroups = elevenKvIncomingFeeders.length
    ? elevenKvIncomingFeeders
    : sortedMainIncomingFeeders

  const groupedFeederIds = new Set()
  const headerGroups = []

  orderedIncomingGroups.forEach((mainIncoming) => {
    const childFeeders = normalizedFeeders.filter(
      (feeder) =>
        feeder.parentFeederId === mainIncoming.id &&
        feeder.id !== mainIncoming.id,
    )

    const items = [mainIncoming, ...childFeeders].map((feeder) => {
      groupedFeederIds.add(feeder.id)
      return {
        kind: 'feeder',
        id: feeder.id,
        label: feeder.name,
        metrics: getFeederMetrics(feeder),
      }
    })

    headerGroups.push({
      key: mainIncoming.id,
      label: mainIncoming.name,
      items,
    })
  })

  const additional11KvFeeders = normalizedFeeders.filter(
    (feeder) =>
      !groupedFeederIds.has(feeder.id) &&
      normalizeVoltageLevel(feeder.voltageLevel, '11') === '11',
  )

  if (additional11KvFeeders.length) {
    headerGroups.push({
      key: 'additional-11kv',
      label: 'Additional 11 KV Feeders',
      items: additional11KvFeeders.map((feeder) => {
        groupedFeederIds.add(feeder.id)
        return {
          kind: 'feeder',
          id: feeder.id,
          label: feeder.name,
          metrics: getFeederMetrics(feeder),
        }
      }),
    })
  }

  const grouped33KvFeeders = normalizedFeeders.filter(
    (feeder) =>
      !groupedFeederIds.has(feeder.id) &&
      normalizeVoltageLevel(feeder.voltageLevel, '33') === '33',
  )

  if (grouped33KvFeeders.length) {
    headerGroups.push({
      key: 'feeders-33kv',
      label: '33 KV Feeders',
      items: grouped33KvFeeders.map((feeder) => {
        groupedFeederIds.add(feeder.id)
        return {
          kind: 'feeder',
          id: feeder.id,
          label: feeder.name,
          metrics: getFeederMetrics(feeder),
        }
      }),
    })
  }

  const orderedBatterySets = sortConfiguredList(
    batterySets.filter((item) => !substationId || item.substationId === substationId),
  )

  if (orderedBatterySets.length) {
    headerGroups.push({
      key: 'battery-voltage',
      label: 'Battery Voltage',
      items: orderedBatterySets.map((batterySet, index) => ({
        kind: 'battery',
        id: index,
        sourceId: batterySet.id,
        label: batterySet.name,
        metrics: ['voltage'],
      })),
    })
  }

  const orderedTransformers = sortConfiguredList(
    transformers.filter((item) => !substationId || item.substationId === substationId),
  )
  const fallbackTransformers = !orderedTransformers.length
    ? orderedIncomingGroups.map((incoming, index) => ({
        id: `derived-transformer-${incoming.id}`,
        sourceId: incoming.id,
        name: incoming.name || `Transformer ${index + 1}`,
        linkedIncomingFeederId: incoming.id,
        createdAt: incoming.createdAt || '',
      }))
    : []
  const effectiveTransformers = orderedTransformers.length
    ? orderedTransformers
    : fallbackTransformers

  if (effectiveTransformers.length) {
    headerGroups.push({
      key: 'transformers',
      label: 'Power Transformers',
      items: effectiveTransformers.map((transformer, index) => ({
        kind: 'transformer',
        id: index,
        sourceId: transformer.id,
        label: transformer.name || `Transformer ${index + 1}`,
        metrics: ['tap', 'temperature'],
      })),
    })
  }

  const includedFeeders = normalizedFeeders.filter((feeder) => feeder.includeInTotal).map(
    (feeder) => feeder.id,
  )
  const childMap = buildChildMap(normalizedFeeders)
  const mainIncomingIds = normalizedFeeders
    .filter((feeder) => feeder.feederType === FEEDER_TYPES.MAIN_INCOMING)
    .map((feeder) => feeder.id)
  const elevenKvIncomingIds = orderedIncomingGroups
    .filter((feeder) => normalizeVoltageLevel(feeder.voltageLevel, '11') === '11')
    .map((feeder) => feeder.id)

  return {
    feeders: normalizedFeeders,
    batterySets: orderedBatterySets,
    transformers: effectiveTransformers,
    childMap,
    mainIncomingIds,
    headerGroups,
    flatColumns: buildFlatColumns(headerGroups),
    totalColumnLabel: 'Total Amp',
    totalLoadFeederIds: elevenKvIncomingIds.length
      ? elevenKvIncomingIds
      : includedFeeders.length
        ? includedFeeders
        : mainIncomingIds.length
          ? mainIncomingIds
          : normalizedFeeders.filter((feeder) => !feeder.parentFeederId).map((feeder) => feeder.id),
  }
}

export function listDailyLogRecords(records = [], substationId) {
  const latestByDateKey = new Map()

  for (const record of records || []) {
    if (record?.moduleName !== 'daily_log') {
      continue
    }
    if (substationId && record?.substationId !== substationId) {
      continue
    }

    const dedupeKey = `${record.substationId || ''}::${record.operationalDate || ''}`
    const existing = latestByDateKey.get(dedupeKey)
    if (!existing) {
      latestByDateKey.set(dedupeKey, record)
      continue
    }

    const existingTime = new Date(
      existing.updatedAt || existing.updated_at || existing.client_updated_at || existing.createdAt || 0,
    ).getTime()
    const candidateTime = new Date(
      record.updatedAt || record.updated_at || record.client_updated_at || record.createdAt || 0,
    ).getTime()

    if (candidateTime >= existingTime) {
      latestByDateKey.set(dedupeKey, record)
    }
  }

  return Array.from(latestByDateKey.values())
    .sort((left, right) => compareByDate(right.operationalDate, left.operationalDate))
}

function normalizeFeederLookupToken(value) {
  return String(value || '').trim().toLowerCase()
}

function createFeederIdAliasMap(record, currentFeeders = []) {
  const aliasMap = new Map()

  currentFeeders.forEach((feeder) => {
    if (feeder?.id) {
      aliasMap.set(feeder.id, feeder.id)
    }
  })

  const currentByCode = new Map()
  const currentByName = new Map()
  currentFeeders.forEach((feeder) => {
    if (!feeder?.id) {
      return
    }

    const codeKey = normalizeFeederLookupToken(feeder.code)
    const nameKey = normalizeFeederLookupToken(feeder.name)

    if (codeKey && !currentByCode.has(codeKey)) {
      currentByCode.set(codeKey, feeder.id)
    }
    if (nameKey && !currentByName.has(nameKey)) {
      currentByName.set(nameKey, feeder.id)
    }
  })

  const snapshotFeeders = Array.isArray(record?.feederSnapshot)
    ? record.feederSnapshot
    : []

  snapshotFeeders.forEach((snapshotFeeder) => {
    const sourceId = String(snapshotFeeder?.id || '').trim()
    if (!sourceId || aliasMap.has(sourceId)) {
      return
    }

    const codeKey = normalizeFeederLookupToken(snapshotFeeder?.code)
    const nameKey = normalizeFeederLookupToken(snapshotFeeder?.name)
    const targetId =
      (codeKey && currentByCode.get(codeKey)) ||
      (nameKey && currentByName.get(nameKey)) ||
      ''

    if (targetId) {
      aliasMap.set(sourceId, targetId)
    }
  })

  return aliasMap
}

function remapRowFeederReadingsForCurrentConfig(rows = [], record, currentFeeders = []) {
  if (!rows.length || !currentFeeders.length) {
    return rows
  }

  const aliasMap = createFeederIdAliasMap(record, currentFeeders)

  return rows.map((row) => {
    const readings = row?.feederReadings || {}
    const nextFeederReadings = {}

    Object.entries(readings).forEach(([sourceFeederId, reading]) => {
      const targetFeederId = aliasMap.get(sourceFeederId) || sourceFeederId
      if (!targetFeederId || nextFeederReadings[targetFeederId]) {
        return
      }
      nextFeederReadings[targetFeederId] = reading
    })

    return {
      ...row,
      feederReadings: nextFeederReadings,
    }
  })
}

function remapFeederEventIds(events = [], record, currentFeeders = []) {
  if (!events.length || !currentFeeders.length) {
    return events
  }

  const aliasMap = createFeederIdAliasMap(record, currentFeeders)

  return events.map((event) => {
    const sourceFeederId = event?.feederId || event?.feeder_id || ''
    const targetFeederId = aliasMap.get(sourceFeederId) || sourceFeederId
    const selectedFeederIds = Array.isArray(event?.selectedFeederIds)
      ? event.selectedFeederIds.map((id) => aliasMap.get(id) || id).filter(Boolean)
      : []
    const affectedFeederIds = Array.isArray(event?.affectedFeederIds)
      ? event.affectedFeederIds.map((id) => aliasMap.get(id) || id).filter(Boolean)
      : []

    return {
      ...event,
      feederId: targetFeederId,
      feeder_id: targetFeederId,
      selectedFeederIds,
      affectedFeederIds,
    }
  })
}

export function findCarryForwardSnapshot(records, substationId, operationalDate, feeders = []) {
  const priorRecords = listDailyLogRecords(records, substationId).filter(
    (record) => record.operationalDate < operationalDate,
  )

  if (!priorRecords.length) {
    return {
      record: null,
      valuesByFeederId: {},
      feederMetricById: {},
      batteryVoltages: [],
      transformerTaps: [],
      transformerTemperatures: [],
    }
  }

  const previousDay = new Date(operationalDate)
  previousDay.setDate(previousDay.getDate() - 1)
  const previousDayLabel = previousDay.toISOString().slice(0, 10)
  const preferredRecord =
    priorRecords.find((record) => record.operationalDate === previousDayLabel) || priorRecords[0]

  const valuesByFeederId = {}
  const feederMetricById = {}
  const batteryVoltages = []
  const transformerTaps = []
  const transformerTemperatures = []
  const originalRows = preferredRecord?.payload?.manualRows || preferredRecord?.payload?.rows || []
  const rows = remapRowFeederReadingsForCurrentConfig(
    originalRows,
    preferredRecord,
    feeders,
  )

  for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const row = rows[rowIndex]

    Object.entries(row?.feederReadings || {}).forEach(([feederId, reading]) => {
      if (valuesByFeederId[feederId] || numericOrNull(reading?.kwh) === null) {
        // no-op
      } else {
        valuesByFeederId[feederId] = {
          kwh: String(reading.kwh),
          sourceDate: preferredRecord.operationalDate,
          sourceHour: row.hour || DAILY_LOG_HOURS[rowIndex],
        }
      }

      const feederMetrics = feederMetricById[feederId] || { amp: '', kv: '' }
      if (!hasFilledValue(feederMetrics.amp) && hasFilledValue(reading?.amp)) {
        feederMetrics.amp = String(reading.amp)
      }
      if (!hasFilledValue(feederMetrics.kv) && hasFilledValue(reading?.kv)) {
        feederMetrics.kv = String(reading.kv)
      }
      feederMetricById[feederId] = feederMetrics
    })

    ;(row?.batteryVoltages || []).forEach((value, index) => {
      if (!hasFilledValue(batteryVoltages[index]) && hasFilledValue(value)) {
        batteryVoltages[index] = String(value)
      }
    })

    ;(row?.transformerTaps || []).forEach((value, index) => {
      if (!hasFilledValue(transformerTaps[index]) && hasFilledValue(value)) {
        transformerTaps[index] = String(value)
      }
    })

    ;(row?.transformerTemperatures || []).forEach((value, index) => {
      if (!hasFilledValue(transformerTemperatures[index]) && hasFilledValue(value)) {
        transformerTemperatures[index] = String(value)
      }
    })
  }

  return {
    record: preferredRecord || null,
    valuesByFeederId,
    feederMetricById,
    batteryVoltages,
    transformerTaps,
    transformerTemperatures,
  }
}

export function createDailyLogFormState({
  substationId,
  operationalDate,
  existingRecord,
  records = [],
  feeders = [],
  batterySets = [],
  transformers = [],
}) {
  const config = buildDailyLogConfiguration({
    substationId,
    feeders,
    batterySets,
    transformers,
  })
  const carryForward = findCarryForwardSnapshot(
    records,
    substationId,
    operationalDate,
    config.feeders,
  )
  const rows = DAILY_LOG_HOURS.map((hour) => createEmptyRow(config, hour))

  const originalStoredRows =
    existingRecord?.payload?.manualRows ||
    stripDerivedRows(existingRecord?.payload?.rows || [], config)
  const storedRows = remapRowFeederReadingsForCurrentConfig(
    originalStoredRows,
    existingRecord,
    config.feeders,
  )
  const baseRows = rows.map((row, rowIndex) =>
    normalizeRow(storedRows?.[rowIndex], config, row.hour),
  )

  if (!existingRecord) {
    Object.entries(carryForward.valuesByFeederId).forEach(([feederId, snapshot]) => {
      if (!baseRows[0]?.feederReadings?.[feederId]) {
        return
      }

      baseRows[0].feederReadings[feederId] = {
        ...baseRows[0].feederReadings[feederId],
        kwh: snapshot.kwh,
        metadata: {
          entryMode: 'carry_forward',
          source: `carry_forward:${snapshot.sourceDate}:${snapshot.sourceHour}`,
          sourceType: 'carry_forward',
          ampSourceType: '',
          kvSourceType: '',
          eventCode: '',
          eventOrigin: '',
          interruptionLinkId: '',
          isOverridden: false,
          pendingGap: false,
          eventBlocked: false,
          lsBlocked: false,
        },
      }
    })
  }

  return {
    operationalDate,
    substationId,
    shift: existingRecord?.payload?.shift || 'General',
    operatorName: existingRecord?.payload?.operatorName || '',
    inChargeName: existingRecord?.payload?.inChargeName || '',
    approvalStatus: existingRecord?.payload?.approvalStatus || 'draft',
    dayStatus: existingRecord?.payload?.dayStatus || 'draft',
    rows: baseRows,
    interruptions: remapFeederEventIds(
      cloneValue(existingRecord?.payload?.interruptions || []),
      existingRecord,
      config.feeders,
    ),
    meterChangeEvents: remapFeederEventIds(
      cloneValue(existingRecord?.payload?.meterChangeEvents || []),
      existingRecord,
      config.feeders,
    ),
    carryForwardSource: carryForward.record
      ? {
          operationalDate: carryForward.record.operationalDate,
          recordId: carryForward.record.id,
        }
      : null,
    carryForwardAutoFillSeed: {
      feederMetricById: carryForward.feederMetricById,
      batteryVoltages: carryForward.batteryVoltages,
      transformerTaps: carryForward.transformerTaps,
      transformerTemperatures: carryForward.transformerTemperatures,
    },
    carryForwardWarning:
      !existingRecord && !carryForward.record
        ? 'Previous day closing KWH not found. Please enter opening reading manually.'
        : '',
  }
}

export function deriveDailyLogState(form, config) {
  const baseRows = applyCarryForwardAutofill(
    stripDerivedRows(form?.rows || [], config),
    config,
    form?.carryForwardAutoFillSeed,
    form?.carryForwardSuppressedCells || {},
  )
  const dayStatus = form?.dayStatus === 'finalized' ? 'finalized' : 'draft'
  const normalizedMeterChangeEvents = (form?.meterChangeEvents || [])
    .map((event) => normalizeMeterChangeEvent(event, config))
    .filter((event) => event.feederId && event.effective_time)
  const meterChangeLookup = buildMeterChangeLookup(normalizedMeterChangeEvents)
  const validatedBaseRows = applyDailyLogValidation(
    baseRows,
    config,
    normalizedMeterChangeEvents,
  )
  const normalizedInterruptions = (form?.interruptions || [])
    .filter((item) => item.source !== 'auto')
    .filter((item) => item.feederId || item.feeder_id)
    .map((interruption, index) => {
      const fromMinutes = parseTimeToMinutes(interruption.from_time)
      const toMinutes = parseTimeToMinutes(interruption.to_time)
      const durationMinutes =
        fromMinutes !== null && toMinutes !== null && toMinutes >= fromMinutes
          ? toMinutes - fromMinutes
          : 0

      return {
        ...interruption,
        id: interruption.id || `int-${index + 1}`,
        feeder_id: interruption.feeder_id || interruption.feederId,
        feeder_name:
          interruption.feeder_name ||
          interruption.feederName ||
          config.feeders.find(
            (feeder) => feeder.id === (interruption.feeder_id || interruption.feederId),
          )?.name ||
          '-',
        duration_minutes: durationMinutes,
        duration_hours: Number((durationMinutes / 60).toFixed(2)),
        source: interruption.source || 'explicit',
        is_auto: Boolean(interruption.is_auto || interruption.source === 'auto'),
        generated_reason:
          interruption.generated_reason || interruption.linked_auto_rule || '',
        linked_auto_rule: interruption.linked_auto_rule || '',
        scopeType: interruption.scopeType || interruption.scope_type || 'single_feeder',
        baseFeederId:
          interruption.baseFeederId ||
          interruption.base_feeder_id ||
          interruption.feeder_id ||
          interruption.feederId,
        affectedFeederIds: getFeederIdsForScope(
          config,
          interruption.scopeType || interruption.scope_type || 'single_feeder',
          interruption.baseFeederId ||
            interruption.base_feeder_id ||
            interruption.feeder_id ||
            interruption.feederId,
          interruption.affectedFeederIds || interruption.selectedFeederIds || [],
          interruption.event_type,
        ),
      }
    })

  const explicitOverlayMap = buildExplicitOverlayMap(normalizedInterruptions)
  const autoLsState = buildAutoLsState(validatedBaseRows, config, explicitOverlayMap, dayStatus)
  const resolvedRowsWithEffectiveAmpKv = applyAmpKvCarryForwardByEffectiveKwh(
    autoLsState.resolvedRows,
    config,
    form?.carryForwardAutoFillSeed,
    form?.carryForwardSuppressedCells || {},
  )
  const overlayMap = new Map([
    ...autoLsState.autoOverlayMap.entries(),
    ...explicitOverlayMap.entries(),
  ])

  const tableRows = resolvedRowsWithEffectiveAmpKv.map((row, rowIndex) => {
    const ampMemo = {}
    const ampStates = Object.fromEntries(
      config.feeders.map((feeder) => [
        feeder.id,
        getEffectiveAmpState(row, feeder, config, ampMemo, {}),
      ]),
    )
    const totalLoad = config.totalLoadFeederIds.reduce((total, feederId) => {
      const state = ampStates[feederId]
      return total + (state?.hasValue ? state.number : 0)
    }, 0)

    return {
      id: row.hour,
      hour: row.hour,
      totalLoad,
      remark: row.remark || '',
      ampStates,
      cells: buildRowOverlayCells(
        row,
        rowIndex,
        config,
        overlayMap,
        ampStates,
        autoLsState.pendingGapMap,
      ),
    }
  })

  const allInterruptions = [...normalizedInterruptions, ...autoLsState.autoInterruptions]
  const feederSummaries = config.feeders.map((feeder) =>
    summarizeFeeder(
      feeder,
      resolvedRowsWithEffectiveAmpKv,
      overlayMap,
      config,
      normalizedMeterChangeEvents,
      allInterruptions,
    ),
  )

  const totalLoadSummary = tableRows.reduce(
    (summary, row) => {
      if (row.totalLoad > summary.maxLoad) {
        summary.maxLoad = row.totalLoad
        summary.maxLoadHour = row.hour
      }

      if (row.totalLoad < summary.minLoad) {
        summary.minLoad = row.totalLoad
        summary.minLoadHour = row.hour
      }

      return summary
    },
    {
      maxLoad: 0,
      maxLoadHour: '-',
      minLoad: Number.POSITIVE_INFINITY,
      minLoadHour: '-',
    },
  )

  if (!Number.isFinite(totalLoadSummary.minLoad)) {
    totalLoadSummary.minLoad = 0
    totalLoadSummary.minLoadHour = '-'
  }

  const interruptionRows = allInterruptions.map((interruption, index) => ({
    srNo: index + 1,
    feederId: interruption.feeder_id,
    feederName: interruption.feeder_name,
    scopeType: interruption.scopeType,
    fromTime: interruption.from_time,
    toTime: interruption.to_time,
    durationMinutes: interruption.duration_minutes,
    durationHours: Number(interruption.duration_hours || interruption.duration_minutes / 60 || 0),
    durationLabel: minutesToDurationLabel(interruption.duration_minutes),
    eventType: interruption.event_type,
    source: interruption.source,
    isAuto: Boolean(interruption.is_auto || interruption.source === 'auto'),
    generatedReason: interruption.generated_reason || interruption.linked_auto_rule || '',
    remark: interruption.remark || '-',
  }))

  const meterChangeRows = normalizedMeterChangeEvents.map((event, index) => ({
    srNo: index + 1,
    feederName: event.feederName,
    effectiveTime: event.effective_time,
    oldMeterLastReading: event.oldMeterLastReading || '-',
    newMeterStartReading: event.newMeterStartReading || '-',
    remark: event.remark || '-',
  }))

  const exportRows = tableRows.map((row) => {
    const record = {
      Hour: row.hour,
      TotalAmp: formatNumber(row.totalLoad),
    }

    config.flatColumns.forEach((column) => {
      const cell = row.cells[column.key]
      record[`${column.label} ${column.metricLabel}`] = cell?.overlayCode || (cell?.value ?? '')
    })

    record.Remark = row.remark
    return record
  })

  const invalidReadings = validatedBaseRows.flatMap((row) =>
    config.feeders
      .map((feeder) => {
        const reading = row.feederReadings?.[feeder.id]
        const metadata = reading?.metadata || {}

        if (metadata.validationState !== 'invalid_decrease') {
          return null
        }

        return {
          feederId: feeder.id,
          feederName: feeder.name,
          hour: row.hour,
          message: metadata.validationMessage,
        }
      })
      .filter(Boolean),
  )

  return {
    config,
    dayStatus,
    baseRows: validatedBaseRows,
    resolvedRows: resolvedRowsWithEffectiveAmpKv,
    allInterruptions,
    explicitInterruptions: normalizedInterruptions,
    autoInterruptions: autoLsState.autoInterruptions,
    meterChangeEvents: normalizedMeterChangeEvents,
    meterChangeLookup,
    interruptionRows,
    meterChangeRows,
    tableRows,
    exportRows,
    feederSummaries,
    invalidReadings,
    summaryCards: [
      { label: 'Day Status', value: dayStatus === 'finalized' ? 'Finalized' : 'Live / Draft' },
      { label: 'Configured Feeders', value: formatInteger(config.feeders.length) },
      {
        label: 'Max Total Amp',
        value: `${formatNumber(totalLoadSummary.maxLoad)} @ ${totalLoadSummary.maxLoadHour}`,
      },
      {
        label: 'Min Total Amp',
        value: `${formatNumber(totalLoadSummary.minLoad)} @ ${totalLoadSummary.minLoadHour}`,
      },
      { label: 'Explicit Interruptions', value: formatInteger(normalizedInterruptions.length) },
      { label: 'Invalid KWH', value: formatInteger(invalidReadings.length) },
      { label: 'Pending Gaps', value: formatInteger(autoLsState.pendingGapMap.size) },
      { label: 'Auto LS Gaps', value: formatInteger(autoLsState.autoInterruptions.length) },
      { label: 'Meter Changes', value: formatInteger(normalizedMeterChangeEvents.length) },
      {
        label: 'Battery Sets / Transformers',
        value: `${formatInteger(config.batterySets.length)} / ${formatInteger(config.transformers.length)}`,
      },
    ],
    totalLoadSummary,
    estimationCandidates: autoLsState.estimationCandidates,
    overlayMap,
    pendingGapMap: autoLsState.pendingGapMap,
    derivedSummaries: {
      dayStatus,
      totalLoadSummary,
      feederSummaries,
      interruptionRows,
      meterChangeRows,
    },
  }
}

export function applyKwhInterpolation(rows, feederId, candidate) {
  const intervalCount = candidate.endHourIndex - candidate.startHourIndex

  if (intervalCount <= 0) {
    return rows
  }

  const precision = Math.max(
    countDecimalPlaces(candidate.startValue),
    countDecimalPlaces(candidate.endValue),
  )
  const distributedValues = buildDistributedCumulativeValues(
    Number(candidate.startValue),
    Number(candidate.endValue),
    intervalCount,
    precision,
  )

  if (!distributedValues.length) {
    return rows
  }

  return rows.map((row, rowIndex) => {
    if (!candidate.missingIndexes.includes(rowIndex)) {
      return row
    }

    const stepIndex = rowIndex - candidate.startHourIndex - 1
    const interpolatedValue = distributedValues[stepIndex]

    return {
      ...row,
      feederReadings: {
        ...row.feederReadings,
        [feederId]: {
          ...row.feederReadings[feederId],
          kwh: formatKwhValue(interpolatedValue, precision),
          metadata: {
            ...row.feederReadings[feederId]?.metadata,
            entryMode: 'estimated',
            source: `distributed:${candidate.startHour}-${candidate.endHour}`,
            eventBlocked: false,
            lsBlocked: false,
          },
        },
      },
    }
  })
}

export function buildManualLsInterruption(candidate) {
  if (!candidate || !candidate.missingIndexes?.length) {
    return null
  }

  const durationHours = candidate.missingIndexes.length

  return {
    feederId: candidate.feederId,
    feederName: candidate.feederName,
    from_time: DAILY_LOG_HOURS[candidate.missingIndexes[0]],
    to_time: DAILY_LOG_HOURS[Math.min(candidate.missingIndexes[candidate.missingIndexes.length - 1] + 1, 24)],
    duration_hours: Number(durationHours.toFixed(2)),
    event_type: 'LS',
    source: 'explicit',
    is_auto: false,
    generated_reason: '',
    linked_auto_rule: 'manual_gap_ls',
    remark: 'Marked from DLR gap',
  }
}

export function validateDailyLogMeterChanges(form, config) {
  const baseRows = stripDerivedRows(form?.rows || [], config)
  const normalizedMeterChangeEvents = (form?.meterChangeEvents || [])
    .map((event) => normalizeMeterChangeEvent(event, config))
    .filter((event) => event.feederId && event.effective_time)

  config.feeders.forEach((feeder) => {
    const anchors = getFeederKwhAnchors(baseRows, feeder.id)
    const feederMeterChanges = listFeederMeterChanges(normalizedMeterChangeEvents, feeder.id)

    for (let index = 1; index < anchors.length; index += 1) {
      const previous = anchors[index - 1]
      const current = anchors[index]

      if (current.value >= previous.value) {
        continue
      }

      const meterChangeEvent = feederMeterChanges.find(
        (event) =>
          compareHourValues(previous.hour, event.effective_time) < 0 &&
          compareHourValues(event.effective_time, current.hour) <= 0,
      )

      if (!meterChangeEvent) {
        throw new Error(
          `${feeder.name}: ${current.hour} la KWH previous reading peksha kami aahe. Meter change mark kara.`,
        )
      }
    }
  })
}

export function validateDailyLogKwhContinuity(form, config) {
  const baseRows = stripDerivedRows(form?.rows || [], config)
  const normalizedMeterChangeEvents = (form?.meterChangeEvents || [])
    .map((event) => normalizeMeterChangeEvent(event, config))
    .filter((event) => event.feederId && event.effective_time)
  const validatedRows = applyDailyLogValidation(baseRows, config, normalizedMeterChangeEvents)

  for (const row of validatedRows) {
    for (const feeder of config.feeders) {
      const metadata = row.feederReadings?.[feeder.id]?.metadata || {}

      if (metadata.validationState === 'invalid_decrease') {
        throw new Error(metadata.validationMessage)
      }
    }
  }
}

export function buildDailyLogRecordForSave({
  form,
  config,
  profile,
  substation,
}) {
  const derivedState = deriveDailyLogState(form, config)

  return {
    moduleName: 'daily_log',
    substationId: form.substationId,
    operationalDate: form.operationalDate,
    substationSnapshot: substation
      ? {
          id: substation.id,
          name: substation.name,
          district: substation.district || '',
        }
      : null,
    feederSnapshot: config.feeders.map((feeder) => ({
      id: feeder.id,
      code: feeder.code || '',
      name: feeder.name,
      feederType: feeder.feederType,
      voltageLevel: feeder.voltageLevel,
      parentFeederId: feeder.parentFeederId || '',
      includeInTotal: Boolean(feeder.includeInTotal),
      displayOrder: getDisplayOrder(feeder, 0),
    })),
    batterySetCount: config.batterySets.length,
    transformerCount: config.transformers.length,
    createdBy: profile?.auth_user_id || profile?.id || '',
    updatedBy: profile?.auth_user_id || profile?.id || '',
    payload: {
      shift: form.shift,
      operatorName: form.operatorName,
      inChargeName: form.inChargeName,
      approvalStatus: form.approvalStatus,
      dayStatus: derivedState.dayStatus,
      carryForwardSource: form.carryForwardSource,
      batterySnapshot: config.batterySets.map((item) => ({
        id: item.id,
        name: item.name,
      })),
      transformerSnapshot: config.transformers.map((item) => ({
        id: item.id,
        name: item.name,
      })),
      // Persist manual grid only — resolved `rows` duplicate hote ani payload motha hoto (HTTP 413).
      // Load / reports `manualRows` pasun derive kartat.
      manualRows: derivedState.baseRows,
      meterChangeEvents: derivedState.meterChangeEvents,
      interruptions: derivedState.explicitInterruptions.map((item) => ({
        ...item,
        feederId: item.feeder_id,
        feederName: item.feeder_name,
      })),
      autoInterruptions: derivedState.autoInterruptions,
    },
  }
}

export function getDailyLogDerivedSummaries(record, feeders = []) {
  const config = buildDailyLogConfiguration({
    substationId: record?.substationId,
    feeders,
  })

  if (record?.payload?.derivedSummaries?.feederSummaries?.length) {
    return record.payload.derivedSummaries
  }

  return deriveDailyLogState(
    {
      rows: record?.payload?.manualRows || record?.payload?.rows || [],
      interruptions: record?.payload?.interruptions || [],
      meterChangeEvents: record?.payload?.meterChangeEvents || [],
      dayStatus: record?.payload?.dayStatus || 'draft',
    },
    config,
  ).derivedSummaries
}

export function buildDailyLogReportData({
  companyProfile,
  substation,
  record,
  feeders = [],
  batterySets = [],
  transformers = [],
}) {
  const config = buildDailyLogConfiguration({
    substationId: record?.substationId,
    feeders,
    batterySets,
    transformers,
  })
  const derivedState = deriveDailyLogState(
    {
      rows: record?.payload?.manualRows || record?.payload?.rows || [],
      interruptions: record?.payload?.interruptions || [],
      meterChangeEvents: record?.payload?.meterChangeEvents || [],
      dayStatus: record?.payload?.dayStatus || 'draft',
    },
    config,
  )

  return {
    title: 'DLR Daily Log Report',
    orientation: 'landscape',
    pageSize: 'legal',
    companyName: companyProfile.companyName,
    metadata: [
      ['Company', companyProfile.companyName],
      ['Substation', substation?.name || record?.substationSnapshot?.name || '-'],
      ['Date', formatDate(record?.operationalDate)],
      ['Day', getDayName(record?.operationalDate)],
      ['Status', derivedState.dayStatus === 'finalized' ? 'Finalized' : 'Live / Draft'],
      ['Gap Engine', derivedState.dayStatus === 'finalized' ? 'Auto LS applied' : 'Pending gaps shown only'],
    ],
    totalColumnLabel: config.totalColumnLabel || 'Total Amp',
    headerGroups: config.headerGroups,
    tableRows: derivedState.tableRows,
    interruptionRows: derivedState.interruptionRows,
    meterChangeRows: derivedState.meterChangeRows,
    feederSummaries: derivedState.feederSummaries,
    summaryCards: derivedState.summaryCards,
    notes: [
      derivedState.dayStatus === 'finalized'
        ? 'Unresolved end-of-day gaps converted to auto LS and inserted into interruption register.'
        : 'Live mode shows pending gaps only. Unresolved gaps become auto LS only after day finalize.',
      ...(derivedState.meterChangeEvents.length
        ? ['Meter change considered in consumption calculation for marked feeders.']
        : []),
    ],
    exportRows: derivedState.exportRows,
    workbookSheets: [
      { name: 'Daily Log', rows: derivedState.exportRows },
      { name: 'Interruptions', rows: derivedState.interruptionRows },
      { name: 'Meter Changes', rows: derivedState.meterChangeRows },
      { name: 'Feeder Summary', rows: derivedState.feederSummaries },
    ],
    signatures: {
      operator: record?.payload?.operatorName || '',
      inCharge: record?.payload?.inChargeName || '',
    },
  }
}
