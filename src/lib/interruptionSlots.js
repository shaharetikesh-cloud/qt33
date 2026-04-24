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
}) {
  const fromMinutes = parseTimeToMinutes(fromTime)
  const toMinutes = parseTimeToMinutes(toTime)

  if (fromMinutes === null || toMinutes === null || toMinutes < fromMinutes) {
    return []
  }

  const startHourIndex = Math.floor(fromMinutes / 60)
  const endHourIndex = Math.floor(toMinutes / 60)
  const clampedStart = Math.max(0, Math.min(24, excludeStartHourSlot ? startHourIndex + 1 : startHourIndex))
  const clampedEnd = Math.max(0, Math.min(24, endHourIndex))

  if (clampedEnd < clampedStart) {
    return []
  }

  const slots = []
  for (let hourIndex = clampedStart; hourIndex <= clampedEnd; hourIndex += 1) {
    slots.push(hourIndex)
  }
  return slots
}
