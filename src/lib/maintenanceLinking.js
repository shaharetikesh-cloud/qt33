import { formatDurationClock, getDurationBetweenTimes, resolveTimeRange } from './timeRange'
import { readScope } from './storageAdapter'

export const ASSET_MASTER_SCOPE = 'asset-master'

export const MAINTENANCE_TYPES = [
  'Preventive',
  'Breakdown',
  'Inspection',
  'Other',
]

function text(value) {
  return String(value || '').trim()
}

function normalizePartChanged(value) {
  if (typeof value === 'boolean') {
    return value
  }
  const normalized = text(value).toLowerCase()
  return normalized === 'yes' || normalized === 'true' || normalized === '1'
}

function normalizeDurationMinutes(payload = {}) {
  const direct = Number(payload.durationMinutes)
  if (Number.isFinite(direct) && direct >= 0) {
    return direct
  }

  const computed = getDurationBetweenTimes(payload.fromTime || payload.time, payload.toTime)
  if (Number.isFinite(computed) && computed >= 0) {
    return computed
  }

  return null
}

export function readAssetMasterRecords() {
  const records = readScope(ASSET_MASTER_SCOPE, [])
  return Array.isArray(records) ? records : []
}

export function resolveFeederIdForMaintenanceLink({ payload = {}, assetsById = new Map() }) {
  const payloadFeederId = text(payload.feederId)
  const payloadAssetId = text(payload.assetId)
  const linkedAsset = payloadAssetId ? assetsById.get(payloadAssetId) : null
  const assetFeederId = text(linkedAsset?.feederId)
  return assetFeederId || payloadFeederId || ''
}

export function normalizeMaintenanceRows({
  records = [],
  assets = [],
  feeders = [],
}) {
  const assetsById = new Map(assets.map((asset) => [text(asset.id), asset]))
  const feedersById = new Map(feeders.map((feeder) => [text(feeder.id), feeder]))

  return records.map((record) => {
    const payload = record.payload || {}
    const assetId = text(payload.assetId)
    const feederId = resolveFeederIdForMaintenanceLink({ payload, assetsById })
    const linkedAsset = assetId ? assetsById.get(assetId) : null
    const linkedFeeder = feederId ? feedersById.get(feederId) : null
    const durationMinutes = normalizeDurationMinutes(payload)
    const timeRange = resolveTimeRange(payload)

    return {
      id: record.id,
      substationId: text(record.substationId),
      operationalDate: text(record.operationalDate),
      time: text(payload.fromTime || payload.time || timeRange.fromTime),
      maintenanceType: text(payload.maintenanceType || 'Other'),
      durationMinutes,
      durationLabel: durationMinutes === null ? timeRange.durationLabel : formatDurationClock(durationMinutes),
      partChanged: normalizePartChanged(payload.partChanged),
      partName: text(payload.partName),
      remark: text(payload.remark),
      workDetail: text(payload.workDetail),
      doneBy: text(payload.doneBy || record.ownerUserId || 'Not set'),
      feederId,
      feederName: text(linkedFeeder?.name || ''),
      assetId,
      assetName: text(linkedAsset?.name || ''),
      assetFeederId: text(linkedAsset?.feederId || ''),
    }
  })
}

export function applyMaintenanceHistoryFilters(rows = [], filters = {}) {
  return rows.filter((row) => {
    if (text(filters.fromDate) && row.operationalDate < filters.fromDate) {
      return false
    }
    if (text(filters.toDate) && row.operationalDate > filters.toDate) {
      return false
    }
    if (text(filters.feederId) && row.feederId !== filters.feederId) {
      return false
    }
    if (text(filters.assetId) && row.assetId !== filters.assetId) {
      return false
    }
    if (text(filters.maintenanceType) && row.maintenanceType !== filters.maintenanceType) {
      return false
    }
    return true
  })
}

export function summarizeMaintenanceRows(rows = []) {
  const sorted = [...rows].sort((a, b) => (a.operationalDate < b.operationalDate ? 1 : -1))
  const totalDurationMinutes = rows.reduce(
    (sum, row) => sum + (Number.isFinite(row.durationMinutes) ? row.durationMinutes : 0),
    0,
  )
  const partChangeCount = rows.filter((row) => row.partChanged).length

  return {
    totalCount: rows.length,
    totalDurationMinutes,
    totalDurationLabel: formatDurationClock(totalDurationMinutes),
    partChangeCount,
    lastMaintenanceDate: sorted[0]?.operationalDate || '-',
  }
}

