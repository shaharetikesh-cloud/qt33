import { parseMonthKey } from './dateUtils'

export const attendanceWorkflowItems = [
  {
    key: 'operator',
    routeSegment: 'operator-attendance',
    sheetType: 'operator',
    title: 'Operator Attendance',
    shortTitle: 'Operator',
    description: 'Rotation logic, general duty planning, and office print pack for operators.',
    icon: '01',
    chipCodes: ['I', 'II', 'III', 'G', 'OFF', 'CL', 'SL', 'EL', 'A', 'OD'],
  },
  {
    key: 'advance_shift',
    routeSegment: 'advance-shift-chart',
    sheetType: 'advance_shift',
    title: 'Advance Shift Chart',
    shortTitle: 'Shift Chart',
    description: 'Separate planning chart for I / II / III / G duty rotation.',
    icon: '02',
    chipCodes: ['I', 'II', 'III', 'G', 'OFF', 'WO', '-'],
  },
  {
    key: 'technician',
    routeSegment: 'tech-engineer-attendance',
    sheetType: 'technician',
    title: 'Tech / Engineer Attendance',
    shortTitle: 'Tech',
    description: 'Simple attendance workflow for technicians, engineers, and helpers.',
    icon: '03',
    chipCodes: ['P', 'A', 'CL', 'SL', 'EL', 'WO', '-', 'OD'],
  },
  {
    key: 'apprentice',
    routeSegment: 'apprentice-attendance',
    sheetType: 'apprentice',
    title: 'Apprentice Attendance',
    shortTitle: 'Apprentice',
    description: 'Compact monthly attendance flow for apprentice staff.',
    icon: '04',
    chipCodes: ['P', 'A', 'CL', 'SL', 'EL', 'WO', '-', 'OD'],
  },
  {
    key: 'outsource',
    routeSegment: 'outsource-attendance',
    sheetType: 'outsource',
    title: 'Outsource Attendance',
    shortTitle: 'Outsource',
    description: 'Fast attendance entry for outsource and contract manpower.',
    icon: '05',
    chipCodes: ['P', 'A', 'CL', 'SL', 'EL', 'WO', '-', 'OD'],
  },
  {
    key: 'night_allowance',
    routeSegment: 'night-allowance',
    sheetType: 'night_allowance',
    title: 'Night Allowance',
    shortTitle: 'Night',
    description: 'Allowance summary derived from saved operator attendance and shift data.',
    icon: '06',
    chipCodes: [],
  },
  {
    key: 'summary',
    routeSegment: 'monthly-summary',
    sheetType: 'summary',
    title: 'Monthly Summary',
    shortTitle: 'Summary',
    description: 'Single monthly summary across attendance workflows for the selected substation.',
    icon: '07',
    chipCodes: [],
  },
]

export const attendanceWorkflowMap = Object.fromEntries(
  attendanceWorkflowItems.flatMap((item) => [
    [item.key, item],
    [item.routeSegment, item],
    [item.sheetType, item],
  ]),
)

export const operatorRegularPattern = ['OFF', 'II', 'III', 'I', 'II', 'III', 'I']
export const operatorGeneralDutyPattern = ['OFF', 'II', 'III', 'I', 'G', 'G', 'G']

export const attendanceQuickCodeOptions = [
  'P',
  'A',
  'CL',
  'SL',
  'EL',
  'I',
  'II',
  'III',
  'G',
  'OFF',
  'WO',
  '-',
  'OD',
]

const LEAVE_CODES = new Set(['CL', 'SL', 'Medical', 'EL', 'HCL', 'A', 'C-OFF', 'OD'])
const PRESENT_ATTENDANCE_CODES = new Set(['P', '-', 'OD'])

function isInactiveEmployee(employee) {
  return employee?.isActive === false || employee?.is_active === false
}

function isOperatorEmployee(employee) {
  return String(employee?.employeeType || '').toLowerCase() === 'operator'
}

export function resolveAttendanceWorkflow(workflowSegment) {
  return attendanceWorkflowMap[workflowSegment] || attendanceWorkflowItems[0]
}

export function getAttendanceWorkflowPath(workflowSegment) {
  const workflow = resolveAttendanceWorkflow(workflowSegment)
  return `/attendance/${workflow.routeSegment}`
}

export function getPreviousMonthKey(monthKey) {
  const { year, monthIndex } = parseMonthKey(monthKey)
  const previous = new Date(year, monthIndex - 1, 1)
  const previousYear = previous.getFullYear()
  const previousMonth = String(previous.getMonth() + 1).padStart(2, '0')
  return `${previousYear}-${previousMonth}`
}

export function getDefaultGeneralDutyEmployeeId(employees = []) {
  const generalDutyEmployees = employees.filter(
    (employee) => isOperatorEmployee(employee) && employee?.isGeneralDutyOperator && !isInactiveEmployee(employee),
  )

  return generalDutyEmployees.length === 1 ? generalDutyEmployees[0].id : ''
}

function normalizeOffsetValue(value, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function normalizeWeeklyOffDay(value) {
  if (value === '' || value === null || value === undefined) {
    return null
  }

  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 6 ? numeric : null
}

function normalizeModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor
}

function getWeeklyOffDerivedOffset(days = [], weeklyOffDay, anchorDay = 1, fallback = 0) {
  const normalizedWeeklyOffDay = normalizeWeeklyOffDay(weeklyOffDay)

  if (normalizedWeeklyOffDay === null || !days.length) {
    return normalizeOffsetValue(fallback, 0)
  }

  const matchingDay = days.find((day) => day.weekdayIndex === normalizedWeeklyOffDay)

  if (!matchingDay) {
    return normalizeOffsetValue(fallback, 0)
  }

  return normalizeModulo(Number(anchorDay || 1) - Number(matchingDay.dayNumber || 1), 7)
}

function getDefaultOperatorOffset(employee, index, days = [], anchorDay = 1) {
  const srNoFallback = Number(employee?.logicOffset ?? employee?.srNo ?? index + 1) - 1
  return getWeeklyOffDerivedOffset(days, employee?.weeklyOffDay, anchorDay, srNoFallback)
}

export function createOperatorLogicConfig(employees = [], currentConfig = {}, options = {}) {
  const anchorDay = normalizeOffsetValue(currentConfig.anchorDay, 1) || 1
  const days = Array.isArray(options?.days) ? options.days : []
  const baseOffsets = employees.reduce((accumulator, employee, index) => {
    accumulator[employee.id] = normalizeOffsetValue(
      currentConfig.offsetsByEmployeeId?.[employee.id],
      getDefaultOperatorOffset(employee, index, days, anchorDay),
    )
    return accumulator
  }, {})

  return {
    anchorDay,
    generalDutyEmployeeId:
      currentConfig.generalDutyEmployeeId || getDefaultGeneralDutyEmployeeId(employees),
    offsetsByEmployeeId: baseOffsets,
    preserveLeaves: currentConfig.preserveLeaves !== false,
    preserveManualShiftCodes: currentConfig.preserveManualShiftCodes !== false,
  }
}

export function normalizeOperatorShiftCode(code) {
  const value = String(code || '').trim().toUpperCase()

  if (!value) {
    return ''
  }

  if (value === 'WO' || value === 'R') {
    return 'OFF'
  }

  if (value === 'GD') {
    return 'G'
  }

  if (value === 'M') {
    return 'II'
  }

  if (value === 'E') {
    return 'III'
  }

  if (value === 'N') {
    return 'I'
  }

  return value
}

export function getOperatorPatternValue({
  dayNumber,
  offset = 0,
  anchorDay = 1,
  generalDutyEmployee = false,
}) {
  const pattern = generalDutyEmployee ? operatorGeneralDutyPattern : operatorRegularPattern
  const patternIndex =
    ((Number(dayNumber) - Number(anchorDay) + Number(offset)) % pattern.length + pattern.length) %
    pattern.length

  return pattern[patternIndex]
}

export function buildOperatorShiftOverrides({
  employees = [],
  days = [],
  currentShiftOverrides = {},
  generalDutyEmployeeId = '',
  offsetsByEmployeeId = {},
  anchorDay = 1,
  preserveManualShiftCodes = false,
}) {
  return employees.reduce((employeeAccumulator, employee, index) => {
    if (!isOperatorEmployee(employee)) {
      return employeeAccumulator
    }

    const dayMap = days.reduce((dayAccumulator, day) => {
      if (employee?.isVacant) {
        dayAccumulator[day.isoDate] = 'VAC'
        return dayAccumulator
      }

      if (isInactiveEmployee(employee)) {
        dayAccumulator[day.isoDate] = 'OFF'
        return dayAccumulator
      }

      const currentValue = normalizeOperatorShiftCode(currentShiftOverrides?.[employee.id]?.[day.isoDate])
      if (preserveManualShiftCodes && currentValue) {
        dayAccumulator[day.isoDate] = currentValue
        return dayAccumulator
      }

      dayAccumulator[day.isoDate] = getOperatorPatternValue({
        dayNumber: day.dayNumber,
        offset: normalizeOffsetValue(offsetsByEmployeeId?.[employee.id], index),
        anchorDay,
        generalDutyEmployee: employee.id === generalDutyEmployeeId,
      })

      return dayAccumulator
    }, {})

    employeeAccumulator[employee.id] = dayMap
    return employeeAccumulator
  }, {})
}

export function buildOperatorRowBadges(employee, generalDutyEmployeeId = '') {
  const badges = []

  if (employee?.id === generalDutyEmployeeId) {
    badges.push('GD')
  }

  if (employee?.isVacant) {
    badges.push('Vacant')
  }

  if (isInactiveEmployee(employee)) {
    badges.push('Inactive')
  }

  return badges
}

function buildDailyCounter(days = []) {
  return days.map((day) => ({
    dayNumber: day.dayNumber,
    isoDate: day.isoDate,
    I: 0,
    II: 0,
    III: 0,
    G: 0,
    OFF: 0,
    Leave: 0,
  }))
}

function isAttendanceLeaveCode(code) {
  return LEAVE_CODES.has(String(code || '').trim())
}

function isPresentAttendanceCode(code) {
  return PRESENT_ATTENDANCE_CODES.has(String(code || '').trim())
}

export function buildOperatorValidationSummary({
  rows = [],
  days = [],
  generalDutyEmployeeId = '',
  offsetsByEmployeeId = {},
  anchorDay = 1,
}) {
  const errors = []
  const warnings = []
  const dailySummary = buildDailyCounter(days)
  const activeOperatorRows = rows.filter((row) => !row.employee?.isVacant && !isInactiveEmployee(row.employee))
  const defaultGeneralDutyRows = activeOperatorRows.filter((row) => row.employee?.isGeneralDutyOperator)

  if (!generalDutyEmployeeId) {
    if (defaultGeneralDutyRows.length > 1) {
      errors.push('Multiple active employees are marked as General Duty. Select exactly one GD operator for this month.')
    } else {
      errors.push('General Duty operator is not selected. Select exactly one active operator before auto-generate.')
    }
  } else {
    const selectedCount = activeOperatorRows.filter((row) => row.employee?.id === generalDutyEmployeeId).length

    if (selectedCount !== 1) {
      errors.push('Selected General Duty operator is missing from active operator rows. Choose exactly one valid operator.')
    }
  }

  rows.forEach((row, rowIndex) => {
    const employeeId = row.employee?.id || `row-${rowIndex}`
    const rowName = row.displayName || row.employee?.full_name || row.employee?.fullName || `Row ${rowIndex + 1}`
    const offset = normalizeOffsetValue(offsetsByEmployeeId?.[employeeId], rowIndex)
    const rowIsGeneralDuty = employeeId === generalDutyEmployeeId

    row.shiftCodes.forEach((shiftCode, dayIndex) => {
      const normalizedShift = normalizeOperatorShiftCode(shiftCode)
      const attendanceCode = row.attendanceCodes?.[dayIndex] || ''
      const dailyCounters = dailySummary[dayIndex]

      if (dailyCounters) {
        if (normalizedShift === 'I' || normalizedShift === 'II' || normalizedShift === 'III' || normalizedShift === 'G') {
          dailyCounters[normalizedShift] += 1
        } else if (normalizedShift === 'OFF') {
          dailyCounters.OFF += 1
        }

        if (isAttendanceLeaveCode(attendanceCode)) {
          dailyCounters.Leave += 1
        }
      }

      if (!normalizedShift || normalizedShift === 'VAC' || employeeId === '' || row.employee?.isVacant || isInactiveEmployee(row.employee)) {
        return
      }

      if (isAttendanceLeaveCode(attendanceCode) && normalizedShift === 'OFF') {
        warnings.push(`${rowName} day ${days[dayIndex]?.dayNumber || dayIndex + 1}: leave override sits on OFF pattern. Verify roster manually.`)
        return
      }

      const expectedValue = getOperatorPatternValue({
        dayNumber: days[dayIndex]?.dayNumber || dayIndex + 1,
        offset,
        anchorDay,
        generalDutyEmployee: rowIsGeneralDuty,
      })

      if (normalizedShift !== expectedValue) {
        if (normalizedShift === 'G' || expectedValue === 'G') {
          errors.push(`${rowName} day ${days[dayIndex]?.dayNumber || dayIndex + 1}: wrong G placement. Expected ${expectedValue}, found ${normalizedShift}.`)
          return
        }

        errors.push(`${rowName} day ${days[dayIndex]?.dayNumber || dayIndex + 1}: invalid manual override. Expected ${expectedValue}, found ${normalizedShift}.`)
      }
    })
  })

  dailySummary.forEach((summary) => {
    if (summary.I === 0) {
      errors.push(`Day ${summary.dayNumber}: missing I shift.`)
    }

    if (summary.II === 0) {
      errors.push(`Day ${summary.dayNumber}: missing II shift.`)
    }

    if (summary.III === 0) {
      errors.push(`Day ${summary.dayNumber}: missing III shift.`)
    }
  })

  const headlineCounts = {
    I: dailySummary.reduce((total, item) => total + item.I, 0),
    II: dailySummary.reduce((total, item) => total + item.II, 0),
    III: dailySummary.reduce((total, item) => total + item.III, 0),
    G: dailySummary.reduce((total, item) => total + item.G, 0),
    OFF: dailySummary.reduce((total, item) => total + item.OFF, 0),
    Leave: dailySummary.reduce((total, item) => total + item.Leave, 0),
    Present: rows.reduce(
      (total, row) =>
        total +
        row.attendanceCodes.reduce(
          (rowTotal, code) => rowTotal + (isPresentAttendanceCode(code) ? 1 : 0),
          0,
        ),
      0,
    ),
  }

  return {
    errors,
    warnings,
    dailySummary,
    headlineCounts,
  }
}
