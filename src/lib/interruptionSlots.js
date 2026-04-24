export function parseTimeToMinutes(value) {
  const matched = String(value || '')
    .trim()
    .match(/^(\d{2}):(\d{2})$/)

  if (!matched) {
    return null
  }

  const hours = Number(matched[1])
  const minutes = Number(matched[2])

  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
    return null
  }

  if (hours === 24) {
    return minutes === 0 ? 24 * 60 : null
  }

  if (hours < 0 || hours > 23) {
    return null
  }

  return hours * 60 + minutes
}

export function timeToHourIndex(value, preferEnd = false) {
  const minutes = parseTimeToMinutes(value)

  if (minutes === null) {
    return -1
  }

  const rawIndex = preferEnd ? Math.ceil(minutes / 60) : Math.floor(minutes / 60)
  return Math.max(0, Math.min(24, rawIndex))
}

export function getInterruptionOverlayHourIndexes({
  fromTime,
  toTime,
  excludeStartHourSlot = false,
  preserveDurationWhenShifted = false,
}) {
  const fromMinutes = parseTimeToMinutes(fromTime)
  const toMinutes = parseTimeToMinutes(toTime)

  if (fromMinutes === null || toMinutes === null || toMinutes < fromMinutes) {
    return []
  }

  const startHourIndex = Math.floor(fromMinutes / 60)
  const durationMinutes = toMinutes - fromMinutes
  const baseSlotCount = Math.ceil(durationMinutes / 60)
  const shiftedStartHourIndex = excludeStartHourSlot ? startHourIndex + 1 : startHourIndex
  const clampedStart = Math.max(0, Math.min(24, shiftedStartHourIndex))

  // Shifted-start rule:
  // If start-hour already has KWH reading, we skip LS on that hour.
  // Duration-preservation rule:
  // Keep LS slot count equal to interruption duration even after shifting.
  // Example: 22:00 -> 24:00 (2 hours), shifted start => 23:00 and 24:00.
  const shiftedCount = excludeStartHourSlot && preserveDurationWhenShifted
    ? baseSlotCount
    : Math.max(0, baseSlotCount - (excludeStartHourSlot ? 1 : 0))

  if (shiftedCount <= 0) {
    return []
  }

  const slots = []
  for (let offset = 0; offset < shiftedCount; offset += 1) {
    const hourIndex = clampedStart + offset
    if (hourIndex > 24) break
    slots.push(hourIndex)
  }
  return slots
}
