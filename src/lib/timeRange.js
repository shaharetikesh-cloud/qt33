function padTimePart(value) {
  return String(value).padStart(2, '0')
}

export function normalizeTimeValue(rawValue, { allowTwentyFour = false } = {}) {
  const value = String(rawValue || '').trim()

  if (!value) {
    return ''
  }

  const match = value.match(/^(\d{1,2}):(\d{2})$/)

  if (!match) {
    return ''
  }

  const hours = Number(match[1])
  const minutes = Number(match[2])

  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
    return ''
  }

  if (hours === 24) {
    return allowTwentyFour && minutes === 0 ? '24:00' : ''
  }

  if (hours < 0 || hours > 23) {
    return ''
  }

  return `${padTimePart(hours)}:${padTimePart(minutes)}`
}

export function parseTwentyFourHourTime(rawValue, { allowTwentyFour = false } = {}) {
  const normalized = normalizeTimeValue(rawValue, { allowTwentyFour })

  if (!normalized) {
    return null
  }

  const [hoursPart, minutesPart] = normalized.split(':')
  return Number(hoursPart) * 60 + Number(minutesPart)
}

export function formatDurationClock(totalMinutes) {
  const numericValue = Number(totalMinutes)

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return ''
  }

  const hours = Math.floor(numericValue / 60)
  const minutes = Math.round(numericValue % 60)
  return `${padTimePart(hours)}:${padTimePart(minutes)}`
}

export function getDurationBetweenTimes(
  fromTime,
  toTime,
  { allowTwentyFourEnd = false } = {},
) {
  const fromMinutes = parseTwentyFourHourTime(fromTime)
  const toMinutes = parseTwentyFourHourTime(toTime, {
    allowTwentyFour: allowTwentyFourEnd,
  })

  if (fromMinutes === null || toMinutes === null || toMinutes < fromMinutes) {
    return null
  }

  return toMinutes - fromMinutes
}

export function addMinutesToTime(rawValue, totalMinutes) {
  const baseMinutes = parseTwentyFourHourTime(rawValue)
  const numericDuration = Number(totalMinutes)

  if (baseMinutes === null || !Number.isFinite(numericDuration) || numericDuration < 0) {
    return ''
  }

  const nextMinutes = baseMinutes + numericDuration

  if (nextMinutes > 24 * 60) {
    return ''
  }

  if (nextMinutes === 24 * 60) {
    return '24:00'
  }

  const hours = Math.floor(nextMinutes / 60)
  const minutes = nextMinutes % 60
  return `${padTimePart(hours)}:${padTimePart(minutes)}`
}

export function resolveTimeRange(payload = {}) {
  const fromTime = normalizeTimeValue(
    payload.fromTime || payload.from_time || payload.time || '',
  )
  const durationValue = Number(payload.durationMinutes ?? payload.duration_minutes)
  const savedDurationMinutes =
    Number.isFinite(durationValue) && durationValue >= 0 ? durationValue : null

  let toTime = normalizeTimeValue(payload.toTime || payload.to_time || '', {
    allowTwentyFour: true,
  })

  if (!toTime && fromTime && savedDurationMinutes !== null) {
    toTime = addMinutesToTime(fromTime, savedDurationMinutes)
  }

  const computedDurationMinutes =
    fromTime && toTime
      ? getDurationBetweenTimes(fromTime, toTime, {
          allowTwentyFourEnd: true,
        })
      : null
  const durationMinutes = savedDurationMinutes ?? computedDurationMinutes

  return {
    fromTime,
    toTime,
    durationMinutes,
    durationLabel:
      durationMinutes === null ? '-' : formatDurationClock(durationMinutes) || '-',
  }
}
