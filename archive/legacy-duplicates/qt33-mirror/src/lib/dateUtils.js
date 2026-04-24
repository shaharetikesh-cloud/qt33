const MONTH_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  month: 'long',
  year: 'numeric',
})

const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_FULL_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

export function toMonthKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function parseMonthKey(monthKey) {
  const [yearValue, monthValue] = String(monthKey || '').split('-')
  const year = Number(yearValue)
  const month = Number(monthValue)

  if (!year || !month || month < 1 || month > 12) {
    const today = new Date()
    return {
      year: today.getFullYear(),
      month: today.getMonth() + 1,
      monthIndex: today.getMonth(),
    }
  }

  return {
    year,
    month,
    monthIndex: month - 1,
  }
}

export function getMonthLabel(monthKey) {
  const { year, monthIndex } = parseMonthKey(monthKey)
  return MONTH_FORMATTER.format(new Date(year, monthIndex, 1))
}

export function getDaysInMonth(monthKey) {
  const { year, monthIndex } = parseMonthKey(monthKey)
  const date = new Date(year, monthIndex + 1, 0)
  return date.getDate()
}

export function getMonthDays(monthKey) {
  const { year, monthIndex } = parseMonthKey(monthKey)
  const totalDays = getDaysInMonth(monthKey)

  return Array.from({ length: totalDays }, (_, index) => {
    const date = new Date(year, monthIndex, index + 1)
    const dayIndex = date.getDay()
    const isoDate = formatIsoDate(date)

    return {
      dayNumber: index + 1,
      date,
      isoDate,
      weekdayIndex: dayIndex,
      dayLabel: DAY_LABELS[dayIndex],
      dayFullLabel: DAY_FULL_LABELS[dayIndex],
    }
  })
}

export function formatDate(value) {
  if (!value) {
    return '-'
  }

  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '-'
  }

  return DATE_FORMATTER.format(date)
}

export function formatDateTime(value) {
  if (!value) {
    return '-'
  }

  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '-'
  }

  return DATE_TIME_FORMATTER.format(date)
}

export function formatIsoDate(value) {
  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getDayName(isoDate) {
  if (!isoDate) {
    return ''
  }

  const date = new Date(isoDate)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return DAY_FULL_LABELS[date.getDay()]
}

export function getWeekLabel(isoDate) {
  if (!isoDate) {
    return ''
  }

  const date = new Date(isoDate)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const start = new Date(date)
  start.setDate(date.getDate() - date.getDay())
  const end = new Date(start)
  end.setDate(start.getDate() + 6)

  return `${formatDate(start)} to ${formatDate(end)}`
}

export function compareByDate(left, right) {
  return new Date(left).getTime() - new Date(right).getTime()
}

