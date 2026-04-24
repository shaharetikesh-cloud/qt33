import {
  buildDailyLogConfiguration,
  buildDailyLogReportData,
  deriveDailyLogState,
  getDailyLogDerivedSummaries,
} from './dailyLog'
import {
  formatDate,
  getDayName,
  getMonthDays,
  getMonthLabel,
  getWeekLabel,
} from './dateUtils'
import {
  formatInteger,
  formatNumber,
  getEmployeePrintLines,
  safeText,
} from './reportFormats'
import { resolveTimeRange } from './timeRange'
import {
  buildOperatorRowBadges,
  buildOperatorShiftOverrides,
  buildOperatorValidationSummary,
  createOperatorLogicConfig,
} from './attendanceWorkflows'

/**
 * MSEDCL Attendance Code Options
 *
 * Shift codes (operator rotation):  I = 1st shift, II = 2nd shift, III = 3rd shift
 * General duty operator:             G
 * Weekly off:                        WO
 * Leave / other codes appended below.
 *
 * NOTE: Old codes M/E/N/GD/R are retained as legacy aliases so that
 * any previously-saved overrides still render rather than break.
 */
export const attendanceCodeOptions = [
  { value: 'P', label: 'Present' },
  { value: 'A', label: 'Absent' },
  { value: 'WO', label: 'Weekly Off' },
  { value: 'CL', label: 'Casual Leave' },
  { value: 'EL', label: 'Earned Leave' },
  { value: 'SL', label: 'Sick Leave' },
  { value: 'Medical', label: 'Medical Leave' },
  { value: 'HCL', label: 'Half CL' },
  { value: 'OD', label: 'On Duty' },
  { value: 'C-OFF', label: 'Compensatory Off' },
  { value: '-', label: '-' },
  { value: 'VAC', label: 'Vacant' },
]

export const attendanceShiftOptions = [
  { value: 'OFF', label: 'OFF' },
  { value: 'II', label: 'II (08:00 - 16:00)' },
  { value: 'III', label: 'III (16:00 - 24:00)' },
  { value: 'I', label: 'I (00:00 - 08:00)' },
  { value: 'G', label: 'G' },
  { value: 'VAC', label: 'VAC' },
]

const ATTENDANCE_LEGACY_CODE_ALIASES = {
  GD: 'P',
  SL: 'Medical',
  M: 'P',
  E: 'P',
  N: 'P',
  R: 'WO',
}

const SHIFT_LEGACY_CODE_ALIASES = {
  M: 'II',
  E: 'III',
  N: 'I',
  GD: 'G',
  R: 'WO',
  off: 'WO',
}
// Codes where employee is "on duty" in some form (present at work)
const PRESENT_CODES = new Set(['P', 'OD', '-'])

// Legacy attendance suite counts III shift as eligible night shift.
const NIGHT_CODES = new Set(['III'])
const NIGHT_ALLOWANCE_CODES = new Set(['P', 'OD'])

// Codes treated as leave
const LEAVE_CODES = new Set(['CL', 'EL', 'SL', 'Medical', 'HCL'])

// Codes that generate leave remarks
const REMARK_CODES = new Set(['CL', 'EL', 'Medical', 'HCL', 'A', 'C-OFF', 'OD'])
const SHIFT_CODES = new Set(attendanceShiftOptions.map((item) => item.value))
const ATTENDANCE_CODES = new Set(attendanceCodeOptions.map((item) => item.value))

function groupBy(list, getKey) {
  return list.reduce((groups, item) => {
    const key = getKey(item)
    groups[key] = groups[key] || []
    groups[key].push(item)
    return groups
  }, {})
}

function getNumericValue(value) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : 0
}

function getNonNegativeOverrideValue(overrides = {}, key) {
  const numericValue = Number(overrides?.[key])
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : null
}

function sum(list, getValue) {
  return list.reduce((total, item) => total + getNumericValue(getValue(item)), 0)
}

function average(list, getValue) {
  if (!list.length) {
    return 0
  }

  return sum(list, getValue) / list.length
}

function getAttendanceEmployeeMatch(sheetType, employee) {
  const employeeType = String(employee?.employeeType || '').toLowerCase()

  if (sheetType === 'technician') {
    return employeeType === 'technician' || employeeType === 'helper'
  }

  if (sheetType === 'apprentice') {
    return employeeType === 'apprentice'
  }

  if (sheetType === 'outsource') {
    return employeeType === 'outsource'
  }

  return employeeType === 'operator'
}

export function validateAttendanceCode(code) {
  return ATTENDANCE_CODES.has(code) || Boolean(ATTENDANCE_LEGACY_CODE_ALIASES[code])
}

export function validateAttendanceShiftCode(code) {
  return SHIFT_CODES.has(code) || Boolean(SHIFT_LEGACY_CODE_ALIASES[code])
}

export function normalizeAttendanceCode(code, { operatorSheet = false } = {}) {
  const value = String(code || '').trim()

  if (!value) {
    return ''
  }

  if (ATTENDANCE_CODES.has(value)) {
    return value
  }

  if (operatorSheet && (SHIFT_CODES.has(value) || SHIFT_LEGACY_CODE_ALIASES[value])) {
    return 'P'
  }

  return ATTENDANCE_LEGACY_CODE_ALIASES[value] || value
}

export function normalizeAttendanceShiftCode(code) {
  const value = String(code || '').trim()

  if (!value) {
    return ''
  }

  if (value === 'WO') {
    return 'OFF'
  }

  if (SHIFT_CODES.has(value)) {
    return value
  }

  return SHIFT_LEGACY_CODE_ALIASES[value] || value
}

function getWeeklyOffDay(employee, attendanceRules) {
  return employee?.weeklyOffDay === 0 || employee?.weeklyOffDay
    ? Number(employee.weeklyOffDay)
    : Number(attendanceRules.defaultWeeklyOffDay || 0)
}

function isWeeklyOffDay(employee, day, attendanceRules) {
  return getWeeklyOffDay(employee, attendanceRules) === day.weekdayIndex
}

function getWeeklyOffShiftCode(attendanceRules) {
  return normalizeAttendanceShiftCode(attendanceRules.weeklyOffShiftCode || attendanceRules.weeklyOffCode) || 'OFF'
}

function getDefaultAttendanceCode(employee, day, attendanceRules) {
  if (employee?.isVacant) {
    return 'VAC'
  }

  if (isWeeklyOffDay(employee, day, attendanceRules)) {
    return attendanceRules.weeklyOffCode || 'WO'
  }

  return attendanceRules.presentCode || 'P'
}

function mapShiftCodeToAttendanceCode(shiftCode, employee, attendanceRules) {
  if (employee?.isVacant || shiftCode === 'VAC') {
    return 'VAC'
  }

  if (shiftCode === 'OFF' || shiftCode === 'WO') {
    return attendanceRules.weeklyOffCode || 'WO'
  }

  return attendanceRules.presentCode || 'P'
}

function getAttendanceDesignation(employee) {
  return safeText(
    employee?.designationShort ||
      employee?.designation_short ||
      employee?.designation ||
      employee?.employeeType ||
      '',
    '',
  )
}

function buildAttendanceRow(
  employee,
  days,
  overrides,
  shiftCodes,
  sheetType,
  attendanceRules,
  index,
  logicConfig = {},
) {
  const employeeOverrideMap = overrides?.[employee.id] || {}
  const { fullName, cpfLine } = getEmployeePrintLines(employee)
  const attendanceCodes = days.map((day, dayIndex) => {
    const overrideCode = normalizeAttendanceCode(employeeOverrideMap[day.isoDate], {
      operatorSheet: sheetType === 'operator',
    })

    if (overrideCode && validateAttendanceCode(overrideCode)) {
      return overrideCode
    }

    if (sheetType === 'operator' || sheetType === 'advance_shift') {
      return mapShiftCodeToAttendanceCode(shiftCodes[dayIndex], employee, attendanceRules)
    }

    return getDefaultAttendanceCode(employee, day, attendanceRules)
  })

  const totals = attendanceCodes.reduce(
    (summary, code, dayIndex) => {
      const shiftCode = shiftCodes[dayIndex]
      summary[code] = (summary[code] || 0) + 1

      if (PRESENT_CODES.has(code)) { summary.present += 1 }
      if (LEAVE_CODES.has(code))   { summary.leave += 1 }
      if (code === 'WO')           { summary.weeklyOff += 1 }
      if (NIGHT_CODES.has(shiftCode) && NIGHT_ALLOWANCE_CODES.has(code)) {
        summary.night += 1
      }
      if (code === 'A')            { summary.absent += 1 }
      if (code === '-')            { summary.outside += 1 }

      return summary
    },
    { present: 0, leave: 0, weeklyOff: 0, night: 0, absent: 0, outside: 0 },
  )

  return {
    employee,
    srNo: index + 1,
    displayName: fullName,
    cpfLine,
    cpfNo: employee?.cpfNo || employee?.cpf_no || '',
    designationShort: getAttendanceDesignation(employee),
    logicOffset: logicConfig.offsetsByEmployeeId?.[employee?.id] ?? index,
    badges: buildOperatorRowBadges(employee, logicConfig.generalDutyEmployeeId),
    dayCodes: attendanceCodes,
    attendanceCodes,
    shiftCodes,
    attendanceCells: days.map((day, dayIndex) => ({
      day: day.dayNumber,
      isoDate: day.isoDate,
      value: attendanceCodes[dayIndex],
    })),
    shiftCells: days.map((day, dayIndex) => ({
      day: day.dayNumber,
      isoDate: day.isoDate,
      value: shiftCodes[dayIndex],
    })),
    totals,
  }
}

function buildAttendanceRows({
  employees,
  days,
  overrides,
  shiftOverrides,
  sheetType,
  attendanceRules,
  logicConfig = {},
}) {
  const filteredEmployees = employees
    .filter((employee) => getAttendanceEmployeeMatch(sheetType, employee))
    .sort((left, right) => {
      const leftSr = Number.isInteger(left.srNo) ? left.srNo : Number.MAX_SAFE_INTEGER
      const rightSr = Number.isInteger(right.srNo) ? right.srNo : Number.MAX_SAFE_INTEGER

      if (leftSr !== rightSr) {
        return leftSr - rightSr
      }

      return safeText(left.full_name || left.fullName).localeCompare(
        safeText(right.full_name || right.fullName),
      )
    })

  const normalizedLogicConfig = createOperatorLogicConfig(filteredEmployees, logicConfig, {
    days,
  })
  const operatorLikeSheet = sheetType === 'operator' || sheetType === 'advance_shift'
  const generatedShiftOverrides = operatorLikeSheet
    ? buildOperatorShiftOverrides({
        employees: filteredEmployees,
        days,
        currentShiftOverrides: shiftOverrides,
        generalDutyEmployeeId: normalizedLogicConfig.generalDutyEmployeeId,
        offsetsByEmployeeId: normalizedLogicConfig.offsetsByEmployeeId,
        anchorDay: normalizedLogicConfig.anchorDay,
        preserveManualShiftCodes: true,
      })
    : {}

  const rows = filteredEmployees.map((employee, index) => {
    const employeeShiftOverrideMap = operatorLikeSheet
      ? generatedShiftOverrides?.[employee.id] || {}
      : shiftOverrides?.[employee.id] || {}

    const shiftCodes = days.map((day) => {
      const overrideCode = normalizeAttendanceShiftCode(employeeShiftOverrideMap[day.isoDate])

      if (overrideCode && validateAttendanceShiftCode(overrideCode)) {
        return overrideCode
      }

      if (!operatorLikeSheet) {
        return ''
      }

      if (employee?.isVacant) {
        return 'VAC'
      }

      return getWeeklyOffShiftCode(attendanceRules)
    })

    return buildAttendanceRow(
      employee,
      days,
      overrides,
      shiftCodes,
      sheetType,
      attendanceRules,
      index,
      normalizedLogicConfig,
    )
  })

  const operatorValidation = operatorLikeSheet
    ? buildOperatorValidationSummary({
        rows,
        days,
        generalDutyEmployeeId: normalizedLogicConfig.generalDutyEmployeeId,
        offsetsByEmployeeId: normalizedLogicConfig.offsetsByEmployeeId,
        anchorDay: normalizedLogicConfig.anchorDay,
      })
    : null

  return {
    rows,
    operatorValidation,
    logicConfig: normalizedLogicConfig,
  }
}

function splitReportTextLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function getAttendanceSignatureItems(sheetType) {
  if (sheetType === 'operator' || sheetType === 'advance_shift') {
    return [
      { label: 'Sub-Station Incharge' },
      { label: 'Dy. Engineer' },
    ]
  }

  return [
    { label: 'Assistant Engineer' },
    { label: 'Dy. Executive Engineer' },
  ]
}

export function buildAttendanceMonthlyReport({
  companyProfile,
  substation,
  monthKey,
  sheetType,
  employees,
  overrides,
  shiftOverrides = {},
  attendanceRules,
  certificateText = '',
  remark = '',
  nightRateOverrides = {},
  nightCountOverrides = {},
  logicConfig = {},
}) {
  const days = getMonthDays(monthKey)
  const { rows, operatorValidation, logicConfig: normalizedLogicConfig } = buildAttendanceRows({
    employees,
    days,
    overrides,
    shiftOverrides,
    sheetType,
    attendanceRules,
    logicConfig,
  })
  const leaveRemarks = buildLeaveRemarks(rows, days)

  const totals = rows.reduce(
    (summary, row) => {
      summary.present += row.totals.present
      summary.leave += row.totals.leave
      summary.weeklyOff += row.totals.weeklyOff
      summary.night += row.totals.night
      summary.absent += row.totals.absent
      return summary
    },
    {
      present: 0,
      leave: 0,
      weeklyOff: 0,
      night: 0,
      absent: 0,
    },
  )

  const nightAllowanceRows =
    sheetType === 'operator'
      ? rows.map((row, index) => {
          const manualNightCount = getNonNegativeOverrideValue(
            nightCountOverrides,
            row.employee?.id,
          )
          const rate =
            Number(nightRateOverrides[row.employee?.id]) ||
            Number(attendanceRules.nightAllowanceRate) ||
            150
          const nightCount = manualNightCount ?? row.totals.night ?? 0
          return {
            serialNo: index + 1,
            employeeId: row.employee?.id || '',
            displayName: row.displayName,
            cpfLine: row.cpfLine || '',
            nightCount,
            autoNightCount: row.totals.night || 0,
            rate,
            amount: nightCount * rate,
          }
        })
      : []

  const manualRemarkLines = splitReportTextLines(remark)
  const reportRemarkLines =
    sheetType === 'advance_shift'
      ? manualRemarkLines
      : [...leaveRemarks, ...manualRemarkLines]
  const titleMap = {
    operator: 'Attendance & Duty Chart',
    technician: 'Attendance',
    apprentice: 'Apprentice Attendance',
    outsource: 'Outsource Attendance',
    advance_shift: 'Advance Shift Chart',
  }

  return {
    title: titleMap[sheetType] || 'Attendance',
    orientation: 'landscape',
    sheetType,
    metadata: [
      ['Company', companyProfile.companyName],
      ['Office', companyProfile.officeName],
      ['Substation', substation?.name || '-'],
      ['Month', getMonthLabel(monthKey)],
      ['Record Count', formatInteger(rows.length)],
    ],
    substationObj: substation,
    monthLabel: getMonthLabel(monthKey).toUpperCase(),
    days,
    rows,
    totals,
    leaveRemarks,
    nightAllowanceRows,
    certificateText,
    remark,
    reportRemarkLines,
    signatureItems: getAttendanceSignatureItems(sheetType),
    legend: attendanceCodeOptions,
    logicConfig: normalizedLogicConfig,
    operatorValidation,
  }
}

export function buildAdvanceShiftChartReport(params) {
  const report = buildAttendanceMonthlyReport({
    ...params,
    sheetType: 'advance_shift',
  })

  return {
    ...report,
    title: 'Advance Shift Chart',
    sheetType: 'advance_shift',
  }
}

/**
 * Build auto English leave/absence remarks from attendance codes.
 * Detects continuous same-code date ranges and generates one readable sentence per range.
 *
 * Codes that generate remarks: CL, EL, Medical, HCL, A, -, C-OFF, OD
 * P, WO, shift codes (I/II/III/G) and vacant = no remark.
 */
export function buildLeaveRemarks(rows, days) {
  const remarks = []

  for (const row of rows) {
    if (row.employee?.isVacant) continue

    const name = row.displayName || 'Shri. Unknown'
    // Collect ranges of REMARK_CODES
    const codes = row.dayCodes
    let i = 0

    while (i < codes.length) {
      const code = codes[i]

      if (!REMARK_CODES.has(code)) {
        i++
        continue
      }

      // Find end of continuous same-code range
      let j = i
      while (j + 1 < codes.length && codes[j + 1] === code) j++

      const startDay = days[i]
      const endDay   = days[j]
      const count    = j - i + 1

      const fmtDate = (day) => {
        if (!day?.isoDate) return '-'
        const [y, m, d] = day.isoDate.split('-')
        return `${d}-${m}-${y}`
      }

      const from = fmtDate(startDay)
      const to   = fmtDate(endDay)

      let sentence = ''
      if (code === 'CL')      sentence = `${name} availed CL from ${from} to ${to} for ${count} day(s).`
      else if (code === 'EL') sentence = `${name} availed EL from ${from} to ${to} for ${count} day(s).`
      else if (code === 'Medical' || code === 'SL')
                              sentence = `${name} availed Medical leave from ${from} to ${to} for ${count} day(s).`
      else if (code === 'HCL') sentence = `${name} availed Half CL on ${from} for ${count} day(s).`
      else if (code === 'A')  sentence = `${name} was absent from ${from} to ${to} for ${count} day(s).`
      else if (code === '-')  sentence = `${name} was on outside duty / training from ${from} to ${to} for ${count} day(s).`
      else if (code === 'C-OFF') sentence = `${name} availed Compensatory Off from ${from} to ${to} for ${count} day(s).`
      else if (code === 'OD') sentence = `${name} was on official duty from ${from} to ${to} for ${count} day(s).`

      if (sentence) remarks.push(sentence)

      i = j + 1
    }
  }

  return remarks
}

export function buildNightAllowanceReport({
  companyProfile,
  substation,
  monthKey,
  employees,
  overrides,
  shiftOverrides = {},
  attendanceRules,
  nightRateOverrides = {},   // { [employeeId]: rate }
  nightCountOverrides = {},  // { [employeeId]: count }
}) {
  const report = buildAttendanceMonthlyReport({
    companyProfile,
    substation,
    monthKey,
    sheetType: 'operator',
    employees,
    overrides,
    shiftOverrides,
    attendanceRules,
    nightRateOverrides,
    nightCountOverrides,
  })

  const defaultRate = Number(attendanceRules.nightAllowanceRate) || 150

  const rows = report.rows.map((row, idx) => {
    const rate = Number(nightRateOverrides[row.employee?.id]) || defaultRate
    const autoNightShifts = row.totals.night || 0
    const manualNightShifts = getNonNegativeOverrideValue(nightCountOverrides, row.employee?.id)
    const nights = manualNightShifts ?? autoNightShifts
    return {
      srNo:         idx + 1,
      employeeName: row.displayName,
      cpfLine:      row.cpfLine || '',
      isVacant:     Boolean(row.employee?.isVacant),
      nightShifts:  nights,
      autoNightShifts,
      rate,
      amount:       nights * rate,
      employeeId:   row.employee?.id || '',
      designationShort: row.designationShort || '',
    }
  })

  return {
    title: 'Night Allowance Statement',
    orientation: 'portrait',
    metadata: [
      ['Company', companyProfile.companyName],
      ['Substation', substation?.name || '-'],
      ['Month', getMonthLabel(monthKey)],
      ['Rate Per Night', formatNumber(defaultRate)],
      ['Generated On', formatDate(new Date())],
    ],
    rows,
    totals: {
      totalNightShifts: sum(rows, (row) => row.nightShifts),
      totalAmount:      sum(rows, (row) => row.amount),
    },
    defaultRate,
    substationObj: substation,
    monthLabel: getMonthLabel(monthKey).toUpperCase(),
  }
}

export function buildAttendanceSummaryReport(params) {
  const sheetTypes = ['operator', 'technician', 'apprentice', 'outsource']
  const rows = sheetTypes.map((sheetType) => {
    const report = buildAttendanceMonthlyReport({
      ...params,
      sheetType,
      overrides: params.overridesBySheetType?.[sheetType] || {},
    })

    return {
      sheetType,
      employees: report.rows.length,
      present: report.totals.present,
      leave: report.totals.leave,
      weeklyOff: report.totals.weeklyOff,
      absent: report.totals.absent,
      night: report.totals.night,
    }
  })

  return {
    title: 'Monthly Attendance Summary',
    orientation: 'portrait',
    monthLabel: getMonthLabel(params.monthKey).toUpperCase(),
    substationObj: params.substation,
    metadata: [
      ['Company', params.companyProfile.companyName],
      ['Substation', params.substation?.name || '-'],
      ['Month', getMonthLabel(params.monthKey)],
      ['Generated On', formatDate(new Date())],
    ],
    rows,
  }
}

export function computeBatteryAnalysis(record) {
  const cells = record?.payload?.cells || []
  const gravityValues = cells.map((item) => getNumericValue(item.specificGravity)).filter(Boolean)
  const voltageValues = cells.map((item) => getNumericValue(item.voltage)).filter(Boolean)
  const totalVoltage = sum(cells, (item) => item.voltage)

  const gravityMax = gravityValues.length ? Math.max(...gravityValues) : 0
  const gravityMin = gravityValues.length ? Math.min(...gravityValues) : 0
  const voltageMax = voltageValues.length ? Math.max(...voltageValues) : 0
  const voltageMin = voltageValues.length ? Math.min(...voltageValues) : 0

  const weakCells = cells.filter(
    (item) =>
      getNumericValue(item.specificGravity) < 1.18 ||
      getNumericValue(item.voltage) < 1.95 ||
      String(item.condition || '').toLowerCase() === 'weak',
  )

  const overallCondition =
    weakCells.length === 0
      ? 'Good'
      : weakCells.length <= Math.ceil(cells.length * 0.15)
        ? 'Average'
        : 'Poor'

  const remark =
    weakCells.length === 0
      ? 'All cells are within the expected weekly maintenance range.'
      : `Check ${weakCells.length} weak cell(s) for topping up, terminal cleaning, and equalizing charge.`

  return {
    gravityMax,
    gravityMin,
    voltageMax,
    voltageMin,
    totalVoltage,
    weakCells,
    overallCondition,
    remark,
  }
}

export function buildBatteryReport({
  companyProfile,
  substation,
  batterySet,
  division,
  record,
}) {
  const analysis = computeBatteryAnalysis(record)

  return {
    title: 'Weekly Battery Maintenance Record',
    orientation: 'portrait',
    metadata: [
      ['Division', division?.name || '-'],
      ['Substation', substation?.name || '-'],
      ['Battery Set', batterySet?.name || '-'],
      ['Date', formatDate(record?.operationalDate)],
      ['Day', getDayName(record?.operationalDate)],
      ['Week Label', getWeekLabel(record?.operationalDate)],
    ],
    checklist: record?.payload?.checklist || {},
    cells: record?.payload?.cells || [],
    analysis,
    signatures: {
      operator: record?.payload?.operatorName || '',
      inCharge: record?.payload?.inChargeName || '',
    },
    companyName: companyProfile.companyName,
  }
}

export function buildDailyLogReport({
  companyProfile,
  substation,
  record,
  feeders,
  batterySets = [],
  transformers = [],
}) {
  return buildDailyLogReportData({
    companyProfile,
    substation,
    record,
    feeders,
    batterySets,
    transformers,
  })
}

const DAILY_ANALYTICS_FAULT_TYPES = ['SD', 'LS', 'BD', 'OC', 'EF']

function getFeederExpectedUnit(feeder) {
  const candidates = [
    feeder?.daily_expected_unit,
    feeder?.dailyExpectedUnit,
    feeder?.expected_unit,
    feeder?.expectedUnit,
    feeder?.benchmarkUnit,
    feeder?.targetUnit,
  ]

  for (const candidate of candidates) {
    if (candidate === '' || candidate === null || candidate === undefined) {
      continue
    }

    const numericValue = Number(candidate)

    if (Number.isFinite(numericValue)) {
      return numericValue
    }
  }

  return null
}

function formatSignedPercent(value) {
  if (!Number.isFinite(value)) {
    return '-'
  }

  if (value > 0) {
    return `+${formatNumber(value)}%`
  }

  if (value < 0) {
    return `-${formatNumber(Math.abs(value))}%`
  }

  return '0.00%'
}

function formatLossProfit(diffValue) {
  if (!Number.isFinite(diffValue)) {
    return '-'
  }

  if (diffValue < 0) {
    return `Loss ${formatNumber(Math.abs(diffValue))}`
  }

  return `Profit ${formatNumber(diffValue)}`
}

export function computeConsumption(diffUnit, mf) {
  return Number((getNumericValue(diffUnit) * getNumericValue(mf)).toFixed(2))
}

export function computeDifference(consumption, expectedUnit) {
  if (!Number.isFinite(Number(expectedUnit))) {
    return null
  }

  return Number((getNumericValue(consumption) - Number(expectedUnit)).toFixed(2))
}

export function computeLossProfit(difference) {
  return difference === null ? '-' : formatLossProfit(difference)
}

export function computePercentage(difference, expectedUnit) {
  const numericExpected = Number(expectedUnit)

  if (!Number.isFinite(numericExpected) || numericExpected === 0) {
    return null
  }

  return Number(((getNumericValue(difference) / numericExpected) * 100).toFixed(2))
}

function getScopedFeederSummary(feeder, feederSummaries = []) {
  return (
    feederSummaries.find((item) => item.feederId === feeder.id) ||
    feederSummaries.find((item) => item.feederName === feeder.name) ||
    {}
  )
}

export function buildInterruptionAnalytics(interruptionRows = [], feeders = []) {
  const finalizedInterruptionRows = interruptionRows.filter((row) =>
    DAILY_ANALYTICS_FAULT_TYPES.includes(row.eventType),
  )

  return feeders.map((feeder, index) => {
    const feederInterruptions = finalizedInterruptionRows.filter(
      (row) =>
        (row.feederId === feeder.id || row.feederName === feeder.name) &&
        DAILY_ANALYTICS_FAULT_TYPES.includes(row.eventType),
    )

    const summaryMap = DAILY_ANALYTICS_FAULT_TYPES.reduce((summary, faultType) => {
      const rowsByType = feederInterruptions.filter((row) => row.eventType === faultType)
      const count = rowsByType.length
      const hours = rowsByType.reduce(
        (total, row) => total + getNumericValue(row.durationHours),
        0,
      )

      summary[faultType] = {
        count,
        hours: Number(hours.toFixed(2)),
      }

      return summary
    }, {})

    const totalCount = DAILY_ANALYTICS_FAULT_TYPES.reduce(
      (total, faultType) => total + summaryMap[faultType].count,
      0,
    )
    const totalHours = DAILY_ANALYTICS_FAULT_TYPES.reduce(
      (total, faultType) => total + summaryMap[faultType].hours,
      0,
    )

    return {
      id: `interruption-summary-${feeder.id}`,
      srNo: index + 1,
      feederName: feeder.name,
      summaryMap,
      totalCount,
      totalHours: Number(totalHours.toFixed(2)),
    }
  })
}

export function buildUnitsAnalytics(feeders = [], feederSummaries = []) {
  return feeders.map((feeder, index) => {
    const summary = getScopedFeederSummary(feeder, feederSummaries)
    const mf = getFeederMultiplier(feeder)
    const expectedUnit = getFeederExpectedUnit(feeder)
    const openingUnit = summary.openingKwh ?? null
    const closingUnit = summary.closingKwh ?? null
    const diffUnit =
      openingUnit === null || closingUnit === null
        ? null
        : Number((getNumericValue(closingUnit) - getNumericValue(openingUnit)).toFixed(2))
    const consumption = computeConsumption(summary.units, mf)
    const difference = computeDifference(consumption, expectedUnit)
    const percentage = computePercentage(difference, expectedUnit)

    return {
      id: `unit-summary-${feeder.id}`,
      srNo: index + 1,
      feederName: feeder.name,
      openingUnit,
      closingUnit,
      diffUnit,
      mf,
      consumption,
      expectedUnit,
      difference,
      lossProfit: computeLossProfit(difference),
      percentage,
      percentageLabel: percentage === null ? '-' : formatSignedPercent(percentage),
    }
  })
}

export function buildLoadAnalytics(feeders = [], feederSummaries = []) {
  return feeders.map((feeder, index) => {
    const summary = getScopedFeederSummary(feeder, feederSummaries)

    return {
      id: `load-summary-${feeder.id}`,
      srNo: index + 1,
      feederName: feeder.name,
      maxLoad: summary.maxLoad ?? 0,
      maxLoadTime: summary.maxLoadHour || '-',
      minLoad: summary.minLoad ?? 0,
      minLoadTime: summary.minLoadHour || '-',
    }
  })
}

function buildInterruptionAnalyticsFootRows(interruptionRows = []) {
  if (!interruptionRows.length) {
    return []
  }

  const summaryMap = DAILY_ANALYTICS_FAULT_TYPES.reduce((summary, faultType) => {
    summary[faultType] = interruptionRows.reduce(
      (totals, row) => ({
        count: totals.count + getNumericValue(row.summaryMap?.[faultType]?.count),
        hours: Number(
          (totals.hours + getNumericValue(row.summaryMap?.[faultType]?.hours)).toFixed(2),
        ),
      }),
      { count: 0, hours: 0 },
    )

    return summary
  }, {})

  return [
    {
      id: 'interruption-summary-total',
      srNo: '',
      feederName: 'Total',
      summaryMap,
      totalCount: interruptionRows.reduce(
        (total, row) => total + getNumericValue(row.totalCount),
        0,
      ),
      totalHours: Number(
        interruptionRows
          .reduce((total, row) => total + getNumericValue(row.totalHours), 0)
          .toFixed(2),
      ),
    },
  ]
}

function buildDailyAnalyticsCsvRows({
  interruptionRows,
  interruptionFootRows = [],
  unitRows,
  loadRows,
}) {
  return [
    ...interruptionRows.map((row) => ({
      Section: 'Interruption Table',
      'Sr.No': row.srNo,
      'Feeder Name': row.feederName,
      'SD No': row.summaryMap.SD.count,
      'SD Time': row.summaryMap.SD.hours,
      'LS No': row.summaryMap.LS.count,
      'LS Time': row.summaryMap.LS.hours,
      'BD No': row.summaryMap.BD.count,
      'BD Time': row.summaryMap.BD.hours,
      'OC No': row.summaryMap.OC.count,
      'OC Time': row.summaryMap.OC.hours,
      'EF No': row.summaryMap.EF.count,
      'EF Time': row.summaryMap.EF.hours,
      'Total No': row.totalCount,
      'Total Time': row.totalHours,
    })),
    ...interruptionFootRows.map((row) => ({
      Section: 'Interruption Table',
      'Sr.No': row.srNo,
      'Feeder Name': row.feederName,
      'SD No': row.summaryMap.SD.count,
      'SD Time': row.summaryMap.SD.hours,
      'LS No': row.summaryMap.LS.count,
      'LS Time': row.summaryMap.LS.hours,
      'BD No': row.summaryMap.BD.count,
      'BD Time': row.summaryMap.BD.hours,
      'OC No': row.summaryMap.OC.count,
      'OC Time': row.summaryMap.OC.hours,
      'EF No': row.summaryMap.EF.count,
      'EF Time': row.summaryMap.EF.hours,
      'Total No': row.totalCount,
      'Total Time': row.totalHours,
    })),
    ...unitRows.map((row) => ({
      Section: 'Units / Consumption / Loss-Profit Table',
      'Sr.No': row.srNo,
      'Feeder Name': row.feederName,
      'Opening Unit': row.openingUnit,
      'Closing Unit': row.closingUnit,
      'Diff Unit': row.diffUnit,
      MF: row.mf,
      Consumption: row.consumption,
      'Expected Unit': row.expectedUnit,
      Difference: row.difference,
      'Loss / Profit': row.lossProfit,
      Percentage: row.percentageLabel,
    })),
    ...loadRows.map((row) => ({
      Section: 'Load Table',
      'Sr.No': row.srNo,
      'Feeder Name': row.feederName,
      'Max Load': row.maxLoad,
      Time: row.maxLoadTime,
      'Min Load': row.minLoad,
      'Min Time': row.minLoadTime,
    })),
  ]
}

export function buildDailyLogAnalyticsReport({
  companyProfile,
  substation,
  record,
  feeders,
  batterySets = [],
  transformers = [],
}) {
  const analyticsRecord = {
    ...record,
    payload: {
      ...(record?.payload || {}),
      dayStatus: 'finalized',
    },
  }
  const config = buildDailyLogConfiguration({
    substationId: analyticsRecord?.substationId,
    feeders,
    batterySets,
    transformers,
  })
  const derivedState = deriveDailyLogState(
    {
      rows: analyticsRecord?.payload?.manualRows || analyticsRecord?.payload?.rows || [],
      interruptions: analyticsRecord?.payload?.interruptions || [],
      meterChangeEvents: analyticsRecord?.payload?.meterChangeEvents || [],
      dayStatus: 'finalized',
    },
    config,
  )
  const scopedFeeders = feeders.filter(
    (feeder) => feeder.substationId === (substation?.id || analyticsRecord?.substationId),
  )
  const interruptionRows = buildInterruptionAnalytics(
    derivedState.interruptionRows,
    scopedFeeders,
  )
  const interruptionFootRows = buildInterruptionAnalyticsFootRows(interruptionRows)
  const unitRows = buildUnitsAnalytics(scopedFeeders, derivedState.feederSummaries)
  const loadRows = buildLoadAnalytics(scopedFeeders, derivedState.feederSummaries)

  return {
    title: 'Daily Feeder Analysis Report',
    orientation: 'landscape',
    pageSize: 'a4',
    companyName: companyProfile.companyName,
    metadata: [
      ['Company', companyProfile.companyName],
      ['Substation', substation?.name || analyticsRecord?.substationSnapshot?.name || '-'],
      ['Date', formatDate(analyticsRecord?.operationalDate)],
      ['Day', getDayName(analyticsRecord?.operationalDate)],
      ['Analytics Basis', 'Finalized daily state'],
      ['Fault Types', DAILY_ANALYTICS_FAULT_TYPES.join(', ')],
      ['Feeders', formatInteger(scopedFeeders.length)],
    ],
    interruptionFaultTypes: DAILY_ANALYTICS_FAULT_TYPES,
    interruptionRows,
    interruptionFootRows,
    unitRows,
    loadRows,
    notes: [
      'Pending gaps are excluded. Manual LS and auto LS are both included only after finalized-state consolidation.',
      'Diff Unit is direct opening-closing difference. Consumption is meter-segment aware and uses feeder MF.',
      'Percentage stays blank when daily expected unit is unavailable or zero.',
    ],
    csvRows: buildDailyAnalyticsCsvRows({
      interruptionRows,
      interruptionFootRows,
      unitRows,
      loadRows,
    }),
    workbookSheets: [
      {
        name: 'Interruptions',
        rows: [...interruptionRows, ...interruptionFootRows].map((row) => ({
          srNo: row.srNo,
          feederName: row.feederName,
          sdNo: row.summaryMap.SD.count,
          sdTime: row.summaryMap.SD.hours,
          lsNo: row.summaryMap.LS.count,
          lsTime: row.summaryMap.LS.hours,
          bdNo: row.summaryMap.BD.count,
          bdTime: row.summaryMap.BD.hours,
          ocNo: row.summaryMap.OC.count,
          ocTime: row.summaryMap.OC.hours,
          efNo: row.summaryMap.EF.count,
          efTime: row.summaryMap.EF.hours,
          totalNo: row.totalCount,
          totalTime: row.totalHours,
        })),
      },
      {
        name: 'Units',
        rows: unitRows.map((row) => ({
          srNo: row.srNo,
          feederName: row.feederName,
          openingUnit: row.openingUnit,
          closingUnit: row.closingUnit,
          diffUnit: row.diffUnit,
          mf: row.mf,
          consumption: row.consumption,
          expectedUnit: row.expectedUnit,
          difference: row.difference,
          lossProfit: row.lossProfit,
          percentage: row.percentageLabel,
        })),
      },
      { name: 'Load', rows: loadRows },
    ],
  }
}

export function buildFaultReport({
  companyProfile,
  substation,
  records,
  feeders,
  filterDate,
}) {
  const rows = records.map((record, index) => {
    const feeder = feeders.find((item) => item.id === record.payload?.feederId)
    const timeRange = resolveTimeRange(record.payload || {})

    return {
      srNo: index + 1,
      fromTime: timeRange.fromTime || '-',
      toTime: timeRange.toTime || '-',
      durationMinutes: timeRange.durationMinutes ?? 0,
      durationLabel: timeRange.durationLabel,
      feederName: feeder?.name || record.payload?.feederName || '-',
      faultType: record.payload?.faultType || '-',
      cause: record.payload?.cause || '-',
      remark: record.payload?.remark || '-',
      operationalDate: record.operationalDate,
    }
  })

  return {
    title: 'Daily Fault Report',
    orientation: 'landscape',
    metadata: [
      ['Company', companyProfile.companyName],
      ['Substation', substation?.name || '-'],
      ['Date', filterDate ? formatDate(filterDate) : '-'],
      ['Record Count', formatInteger(rows.length)],
      ['Generated On', formatDate(new Date())],
    ],
    rows,
  }
}

export function buildMaintenanceReport({
  companyProfile,
  substation,
  records,
  fromDate,
  toDate,
}) {
  const rows = records.map((record, index) => {
    const timeRange = resolveTimeRange(record.payload || {})

    return {
      srNo: index + 1,
      date: record.operationalDate,
      substationName: substation?.name || '-',
      fromTime: timeRange.fromTime || '-',
      toTime: timeRange.toTime || '-',
      durationMinutes: timeRange.durationMinutes ?? 0,
      durationLabel: timeRange.durationLabel,
      workDetail: record.payload?.workDetail || '-',
      remark: record.payload?.remark || '-',
    }
  })

  return {
    title: 'Maintenance Log Report',
    orientation: 'portrait',
    metadata: [
      ['Company', companyProfile.companyName],
      ['Division', safeText(substation?.divisionName || substation?.district, '-')],
      ['Substation', substation?.name || '-'],
      ['Date Range', `${formatDate(fromDate)} to ${formatDate(toDate)}`],
      ['Generated On', formatDate(new Date())],
      ['Record Count', formatInteger(rows.length)],
    ],
    rows,
  }
}

export function buildChargeHandoverReport({
  companyProfile,
  substation,
  record,
}) {
  return {
    title: 'Charge Handover Register',
    orientation: 'portrait',
    metadata: [
      ['Company', companyProfile.companyName],
      ['Substation', substation?.name || '-'],
      ['Date', formatDate(record?.operationalDate)],
      ['Shift', safeText(record?.payload?.shift, '-')],
      ['Outgoing Operator', safeText(record?.payload?.outgoingOperator, '-')],
      ['Incoming Operator', safeText(record?.payload?.incomingOperator, '-')],
    ],
    payload: record?.payload || {},
  }
}

function getFeederName(feeders, feederId, fallback = '-') {
  return feeders.find((item) => item.id === feederId)?.name || fallback
}

const HOURS_PER_DAILY_LOG = 25
const ENERGY_BALANCE_ALERT_PERCENT = 10
const ABNORMAL_LOW_PERCENT_OF_AVERAGE = 50
const ABNORMAL_HIGH_PERCENT_OF_AVERAGE = 150

function normalizeVoltageLevel(value, fallback = '11') {
  const text = String(value || fallback).replace(/[^0-9]/g, '')
  return text === '33' ? '33' : '11'
}

function isMainIncomingFeeder(feeder) {
  return feeder?.isMainIncoming || feeder?.feederType === 'main_incoming'
}

function is11KvOutgoingFeeder(feeder) {
  return !isMainIncomingFeeder(feeder) && normalizeVoltageLevel(feeder?.voltageLevel, '11') === '11'
}

function getFeederMultiplier(feeder) {
  const value = Number(feeder?.mf || feeder?.multiplierFactor || 1)
  return Number.isFinite(value) && value > 0 ? value : 1
}

function getMonthStartDate(monthKey) {
  return getMonthDays(monthKey)[0]?.isoDate || `${monthKey}-01`
}

function shiftMonthKey(monthKey, offset) {
  const [yearText, monthText] = String(monthKey || '').split('-')
  const year = Number(yearText)
  const month = Number(monthText)

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return monthKey
  }

  const shiftedDate = new Date(year, month - 1 + offset, 1)
  return `${shiftedDate.getFullYear()}-${String(shiftedDate.getMonth() + 1).padStart(2, '0')}`
}

function sortByOperationalDate(records = []) {
  return [...records].sort((left, right) =>
    String(left.operationalDate || '').localeCompare(String(right.operationalDate || '')),
  )
}

function extractRecordKwhSummary(record, feederId) {
  const rows = record?.payload?.manualRows || record?.payload?.rows || []
  const numericRows = rows
    .map((row) => {
      const rawValue = row?.feederReadings?.[feederId]?.kwh
      const numericValue = Number(rawValue)

      return rawValue === '' || rawValue === null || rawValue === undefined || !Number.isFinite(numericValue)
        ? null
        : numericValue
    })
    .filter((value) => value !== null)

  return {
    openingKwh: numericRows.length ? numericRows[0] : null,
    closingKwh: numericRows.length ? numericRows[numericRows.length - 1] : null,
    numericCount: numericRows.length,
  }
}

function buildMeterChangeMap(dailyLogRecords = []) {
  return dailyLogRecords.reduce((accumulator, record) => {
    ;(record?.payload?.meterChangeEvents || []).forEach((event) => {
      if (event?.feederId) {
        accumulator[event.feederId] = true
      }
    })
    return accumulator
  }, {})
}

function getMonthlyConsumptionStatus(rowState) {
  const units = Number(rowState.units)
  const hasUnits = Boolean(rowState.hasUnits)
  const meterChangeFlag = Boolean(rowState.meterChangeFlag)
  const missingOpening = Boolean(rowState.missingOpening)
  const prev = rowState.prev
  const curr = rowState.curr
  const epsilon = 0.000001

  if (missingOpening && !meterChangeFlag) {
    return 'Missing Opening'
  }

  if (missingOpening && meterChangeFlag) {
    return 'Missing Opening + Meter Change'
  }

  if ((hasUnits && units < 0) || (!hasUnits && prev !== null && curr !== null && curr < prev)) {
    return meterChangeFlag ? 'Negative Difference Error + Meter Change' : 'Negative Difference Error'
  }

  if (
    (hasUnits && Math.abs(units) < epsilon) ||
    (!hasUnits && prev !== null && curr !== null && Math.abs(curr - prev) < epsilon)
  ) {
    return meterChangeFlag ? 'Meter Change + Zero Consumption' : 'Zero Consumption'
  }

  if (meterChangeFlag) {
    return 'Meter Change Flag'
  }

  return 'Normal'
}

function buildDailyLogStatsByFeeder(dailyLogRecords, feeders) {
  const rows = dailyLogRecords.flatMap((record) => {
    const summaries = getDailyLogDerivedSummaries(record, feeders)

    return (summaries.feederSummaries || []).map((summary) => ({
      operationalDate: record.operationalDate,
      feederId: summary.feederId,
      feederName: summary.feederName || getFeederName(feeders, summary.feederId, '-'),
      units: getNumericValue(summary.units),
      minLoad: getNumericValue(summary.minLoad),
      maxLoad: getNumericValue(summary.maxLoad),
      minLoadHour: safeText(summary.minLoadHour, '-'),
      maxLoadHour: safeText(summary.maxLoadHour, '-'),
      minVoltage: getNumericValue(summary.minKv),
      maxVoltage: getNumericValue(summary.maxKv),
      meterChangeConsidered: Boolean(summary.meterChangeConsidered),
      openingKwh: summary.openingKwh ?? null,
      closingKwh: summary.closingKwh ?? null,
      loggedHours: getNumericValue(summary.loggedHours),
      outageHours: getNumericValue(summary.outageHours),
      interruptionMinutes: getNumericValue(summary.interruptionMinutes),
      noOfInterruptions: getNumericValue(summary.noOfInterruptions),
      explicitInterruptions: getNumericValue(summary.explicitInterruptions),
      autoLsHours: getNumericValue(summary.autoLsHours),
    }))
  })

  return groupBy(rows, (row) => row.feederId || row.feederName)
}

function buildDailyLogSummaryEntries(dailyLogRecords, feeders) {
  return sortByOperationalDate(dailyLogRecords).map((record) => {
    const summaries = getDailyLogDerivedSummaries(record, feeders)
    const summaryMap = (summaries.feederSummaries || []).reduce((accumulator, summary) => {
      accumulator[summary.feederId] = summary
      return accumulator
    }, {})

    return {
      record,
      summaryMap,
      summaries,
    }
  })
}

function buildMonthlyConsumptionAnalysisBase({
  monthKey,
  feeders,
  dailyLogRecords,
}) {
  const monthRecords = sortByOperationalDate(dailyLogRecords).filter((record) =>
    String(record.operationalDate || '').startsWith(monthKey),
  )
  const meterChangeMap = buildMeterChangeMap(monthRecords)
  const day1Record =
    monthRecords.find((record) => record.operationalDate === getMonthStartDate(monthKey)) || null
  const summaryEntries = buildDailyLogSummaryEntries(monthRecords, feeders)
  let totalOutgoingSentOut = 0

  const rows = feeders.map((feeder) => {
    const feederLabel = feeder.name || getFeederName(feeders, feeder.id, feeder.code || '-')
    const day1Snapshot = extractRecordKwhSummary(day1Record, feeder.id)
    const prevFromDay1 = day1Snapshot.openingKwh
    const missingOpening = prevFromDay1 === null

    let curr = null
    let totalUnits = 0
    let hasUnits = false
    let activeDays = 0
    let outageHours = 0
    let interruptionMinutes = 0
    let autoLsHours = 0

    summaryEntries.forEach((entry) => {
      const summary = entry.summaryMap[feeder.id]
      const snapshot = extractRecordKwhSummary(entry.record, feeder.id)
      const hasReading = snapshot.openingKwh !== null || snapshot.closingKwh !== null

      if (!summary && !hasReading) {
        return
      }

      activeDays += 1

      if (snapshot.closingKwh !== null) {
        curr = snapshot.closingKwh
      }

      if (summary) {
        const units = Number(summary.units)

        if (Number.isFinite(units)) {
          totalUnits += units
          hasUnits = true
        }

        outageHours += getNumericValue(summary.outageHours)
        interruptionMinutes += getNumericValue(summary.interruptionMinutes)
        autoLsHours += getNumericValue(summary.autoLsHours)
      }

      if (hasReading) {
        hasUnits = true
      }
    })

    const units = hasUnits ? Number(totalUnits.toFixed(2)) : null
    const mf = getFeederMultiplier(feeder)
    const sentOut = hasUnits && units !== null ? Number((units * mf).toFixed(2)) : null
    const meterChangeFlag = Boolean(meterChangeMap[feeder.id])

    if (is11KvOutgoingFeeder(feeder) && sentOut !== null) {
      totalOutgoingSentOut += sentOut
    }

    return {
      feederId: feeder.id,
      feederName: feederLabel,
      ctRatio: safeText(feeder.ctRatio, '-'),
      prev: prevFromDay1,
      curr,
      units,
      mf,
      sentOut,
      sharePercent: null,
      missingOpening,
      status: getMonthlyConsumptionStatus({
        units,
        hasUnits,
        meterChangeFlag,
        missingOpening,
        prev: prevFromDay1,
        curr,
      }),
      hasUnits,
      meterChangeFlag,
      feeder,
      activeDays,
      outageHours,
      interruptionMinutes,
      autoLsHours,
    }
  })

  rows.forEach((row) => {
    if (is11KvOutgoingFeeder(row.feeder) && row.sentOut !== null && totalOutgoingSentOut > 0) {
      row.sharePercent = Number(((row.sentOut / totalOutgoingSentOut) * 100).toFixed(2))
    }
  })

  return {
    rows,
    totalOutgoingSentOut: Number(totalOutgoingSentOut.toFixed(2)),
    note:
      'Prev comes strictly from the opening reading of Day 1 for each feeder. Monthly units are summed from validated daily log segments, and meter change flags are preserved.',
  }
}

function buildHistoricalMonthlyValueMap({
  monthKey,
  feeders,
  dailyLogHistoryRecords,
  monthCount = 6,
}) {
  const historyMap = {}

  for (let offset = 1; offset <= monthCount; offset += 1) {
    const shiftedMonthKey = shiftMonthKey(monthKey, -offset)
    const analysis = buildMonthlyConsumptionAnalysisBase({
      monthKey: shiftedMonthKey,
      feeders,
      dailyLogRecords: dailyLogHistoryRecords.filter((record) =>
        String(record.operationalDate || '').startsWith(shiftedMonthKey),
      ),
    })

    historyMap[shiftedMonthKey] = analysis.rows.reduce((accumulator, row) => {
      const baseValue = row.sentOut !== null ? row.sentOut : row.units

      if (baseValue !== null) {
        accumulator[row.feederId] = Number(baseValue)
      }

      return accumulator
    }, {})
  }

  return historyMap
}

function getHistoricalAverageForFeeder(historyMap, feederId, limit = 3) {
  const values = []

  Object.keys(historyMap)
    .sort()
    .reverse()
    .forEach((monthKey) => {
      const value = historyMap[monthKey]?.[feederId]

      if (values.length < limit && Number.isFinite(Number(value))) {
        values.push(Number(value))
      }
    })

  return values.length ? average(values, (value) => value) : null
}

function getAbnormalStatusDetails(row, recentAverage) {
  const prevMissing = row.prev === null
  const currMissing = row.curr === null
  const units = row.units
  const sentOut = row.sentOut
  const baseValue = sentOut !== null ? sentOut : units
  const sourceStatus = String(row.status || '')

  if (prevMissing || currMissing) {
    return {
      status: 'Missing Reading',
      remark: 'Opening or closing reading is missing for the selected month.',
      rowClass: 'report-row-warning',
    }
  }

  if (sourceStatus.includes('Negative Difference Error') || (units !== null && units < 0)) {
    return {
      status: 'Negative Difference',
      remark: 'Current reading is less than previous reading. Check meter, MF, or daily log continuity.',
      rowClass: 'report-row-error',
    }
  }

  if (
    sourceStatus.includes('Zero Consumption') ||
    (units !== null && Math.abs(units) < 0.000001) ||
    (sentOut !== null && Math.abs(sentOut) < 0.000001)
  ) {
    return {
      status: 'Zero Consumption',
      remark: 'No net monthly consumption was recorded for this feeder.',
      rowClass: 'report-row-warning',
    }
  }

  if (baseValue === null) {
    return {
      status: 'Missing Reading',
      remark: 'Validated monthly units could not be derived from daily log segments for this feeder.',
      rowClass: 'report-row-warning',
    }
  }

  if (recentAverage !== null) {
    const lowLimit = recentAverage * (ABNORMAL_LOW_PERCENT_OF_AVERAGE / 100)
    const highLimit = recentAverage * (ABNORMAL_HIGH_PERCENT_OF_AVERAGE / 100)

    if (baseValue < lowLimit) {
      return {
        status: 'Very Low Consumption',
        remark: `Current month is below ${formatNumber(
          ABNORMAL_LOW_PERCENT_OF_AVERAGE,
          0,
        )}% of recent average ${formatNumber(recentAverage, 2)}.`,
        rowClass: 'report-row-warning',
      }
    }

    if (baseValue > highLimit) {
      return {
        status: 'Very High Consumption',
        remark: `Current month is above ${formatNumber(
          ABNORMAL_HIGH_PERCENT_OF_AVERAGE,
          0,
        )}% of recent average ${formatNumber(recentAverage, 2)}.`,
        rowClass: 'report-row-error',
      }
    }
  }

  return {
    status: 'Normal',
    remark: sourceStatus.includes('Meter Change')
      ? 'Meter change exists in this month. Review manually if needed.'
      : 'No abnormality detected from current rules.',
    rowClass: '',
  }
}

function getCompletenessStatus(completenessPercent) {
  if (completenessPercent >= 95) {
    return { status: 'Complete', rowClass: '' }
  }

  if (completenessPercent >= 75) {
    return { status: 'Partial', rowClass: 'report-row-warning' }
  }

  return { status: 'Low Data', rowClass: 'report-row-error' }
}

function getReconciliationStatus(inputSentOut, childOutgoingTotal, differenceUnits, differencePercent) {
  if (inputSentOut === null || !Number.isFinite(Number(inputSentOut))) {
    return {
      status: 'Missing Data',
      remark: 'Main incomer input sent out is missing or unavailable for the selected month.',
      rowClass: 'report-row-warning',
    }
  }

  if (Math.abs(Number(inputSentOut)) < 0.000001) {
    return {
      status: 'Zero Input',
      remark: 'Main incomer input is zero for the selected month.',
      rowClass: 'report-row-warning',
    }
  }

  if (differenceUnits === null || !Number.isFinite(Number(differenceUnits))) {
    return {
      status: 'Missing Data',
      remark: 'Difference could not be calculated because one or more values are missing.',
      rowClass: 'report-row-warning',
    }
  }

  if (differenceUnits < 0) {
    return {
      status: 'Negative Difference / Data Mismatch',
      remark: 'Child outgoing total is greater than main incomer input. Check feeder mapping, MF, or readings.',
      rowClass: 'report-row-error',
    }
  }

  if (differencePercent !== null && differencePercent <= 2) {
    return {
      status: 'Balanced',
      remark: 'Difference is within balanced tolerance.',
      rowClass: '',
    }
  }

  if (differencePercent !== null && differencePercent <= 6) {
    return {
      status: 'Acceptable Loss',
      remark: 'Difference is above balanced tolerance but still within acceptable loss range.',
      rowClass: 'report-row-warning',
    }
  }

  if (differencePercent === null) {
    return {
      status: 'Missing Data',
      remark: 'Loss percentage could not be calculated.',
      rowClass: 'report-row-warning',
    }
  }

  return {
    status: 'High Loss',
    remark: 'Difference is above the acceptable loss threshold. Review feeder mapping and readings.',
    rowClass: 'report-row-error',
  }
}

function buildTable(title, columns, rows, options = {}) {
  return {
    title,
    columns,
    rows,
    className: options.className || 'report-table-compact',
    chunkSize: options.chunkSize || 22,
    footRows: options.footRows || [],
  }
}

export function buildMonthlyReports({
  monthKey,
  substation,
  companyProfile,
  feeders,
  dailyLogRecords,
  dailyLogHistoryRecords = dailyLogRecords,
  faultRecords,
  maintenanceRecords,
}) {
  const totalDays = getMonthDays(monthKey).length
  const monthDailyLogs = dailyLogRecords.filter((record) =>
    String(record.operationalDate || '').startsWith(monthKey),
  )
  const feederStats = buildDailyLogStatsByFeeder(monthDailyLogs, feeders)
  const summaryEntries = buildDailyLogSummaryEntries(monthDailyLogs, feeders)
  const consumptionAnalysis = buildMonthlyConsumptionAnalysisBase({
    monthKey,
    feeders,
    dailyLogRecords: monthDailyLogs,
  })
  const monthlyConsumptionRows = consumptionAnalysis.rows.map((row) => ({
    feederName: row.feederName,
    ctRatio: row.ctRatio,
    prev: row.prev,
    curr: row.curr,
    units: row.units,
    mf: row.mf,
    sentOut: row.sentOut,
    sharePercent: row.sharePercent,
    status: row.status,
  }))

  const dailyMinMaxRows = groupBy(
    monthDailyLogs.flatMap((record) => {
      const summaries = getDailyLogDerivedSummaries(record, feeders)

      return (summaries.feederSummaries || []).map((summary) => ({
        date: record.operationalDate,
        feederId: summary.feederId,
        feederName: summary.feederName,
        units: getNumericValue(summary.units),
        minLoad: getNumericValue(summary.minLoad),
        minLoadHour: safeText(summary.minLoadHour, '-'),
        maxLoad: getNumericValue(summary.maxLoad),
        maxLoadHour: safeText(summary.maxLoadHour, '-'),
        minVoltage: getNumericValue(summary.minKv),
        maxVoltage: getNumericValue(summary.maxKv),
      }))
    }),
    (row) => row.date,
  )

  const dailyMinMaxSummaryRows = Object.entries(dailyMinMaxRows).map(([date, rows]) => {
    const peakRow = rows.reduce((best, row) => (row.maxLoad > best.maxLoad ? row : best), rows[0])
    const lowRow = rows.reduce((best, row) => (row.minLoad < best.minLoad ? row : best), rows[0])

    return {
      date,
      totalUnits: sum(rows, (row) => row.units),
      peakLoad: peakRow.maxLoad,
      peakFeeder: peakRow.feederName,
      peakHour: peakRow.maxLoadHour,
      minLoad: lowRow.minLoad,
      lowFeeder: lowRow.feederName,
      lowHour: lowRow.minLoadHour,
      minVoltage: Math.min(...rows.map((row) => row.minVoltage), 0),
      maxVoltage: Math.max(...rows.map((row) => row.maxVoltage), 0),
    }
  })

  const monthlyMinMaxRows = Object.entries(feederStats).map(([feederKey, rows]) => {
    const maxRow = rows.reduce((best, row) => (row.maxLoad > best.maxLoad ? row : best), rows[0])
    const minRow = rows.reduce((best, row) => (row.minLoad < best.minLoad ? row : best), rows[0])

    return {
      feederName: rows[0]?.feederName || feederKey,
      minLoad: minRow.minLoad,
      minLoadDate: minRow.operationalDate,
      minLoadHour: minRow.minLoadHour,
      maxLoad: maxRow.maxLoad,
      maxLoadDate: maxRow.operationalDate,
      maxLoadHour: maxRow.maxLoadHour,
      minVoltage: Math.min(...rows.map((row) => row.minVoltage), 0),
      maxVoltage: Math.max(...rows.map((row) => row.maxVoltage), 0),
    }
  })

  const faultByFeeder = groupBy(
    faultRecords.map((record) => ({
      feederId: record.payload?.feederId,
      feederName: getFeederName(feeders, record.payload?.feederId, record.payload?.feederName || '-'),
      durationMinutes: getNumericValue(record.payload?.durationMinutes),
    })),
    (row) => row.feederId || row.feederName,
  )

  const derivedInterruptionRows = Object.entries(feederStats).map(([feederKey, rows]) => ({
    feeder: rows[0]?.feederName || feederKey,
    interruptions: sum(rows, (row) => row.noOfInterruptions),
    totalDurationHours: sum(rows, (row) => row.outageHours),
    totalDurationMinutes: sum(rows, (row) => row.interruptionMinutes),
    averageDurationMinutes: average(rows, (row) => row.interruptionMinutes),
  }))

  const monthlyInterruptionMap = new Map()

  ;[...Object.entries(faultByFeeder), ...derivedInterruptionRows.map((row) => [row.feeder, [row]])].forEach(
    ([key, rows]) => {
      const feederLabel = rows[0]?.feederName || rows[0]?.feeder || key
      const current = monthlyInterruptionMap.get(feederLabel) || {
        feeder: feederLabel,
        interruptions: 0,
        totalDurationHours: 0,
        totalDurationMinutes: 0,
        averageDurationMinutes: 0,
        averageDurationHours: 0,
        sourceStatus: [],
      }

      const nextInterruptions =
        current.interruptions +
        sum(rows, (row) => ('durationMinutes' in row ? 1 : row.interruptions))
      const nextDuration =
        current.totalDurationMinutes +
        sum(rows, (row) =>
          'durationMinutes' in row ? row.durationMinutes : row.totalDurationMinutes,
        )
      const nextDurationHours =
        current.totalDurationHours +
        sum(rows, (row) =>
          'durationMinutes' in row
            ? row.durationMinutes / 60
            : row.totalDurationHours,
        )

      monthlyInterruptionMap.set(feederLabel, {
        feeder: feederLabel,
        interruptions: nextInterruptions,
        totalDurationHours: nextDurationHours,
        totalDurationMinutes: nextDuration,
        averageDurationMinutes: nextInterruptions ? nextDuration / nextInterruptions : 0,
        averageDurationHours: nextInterruptions ? nextDurationHours / nextInterruptions : 0,
        sourceStatus: current.sourceStatus.concat('durationMinutes' in rows[0] ? 'Fault Register' : 'Daily Log Derived'),
      })
    },
  )

  const monthlyInterruptionRows = [...monthlyInterruptionMap.values()].map((row) => ({
    ...row,
    sourceStatus: [...new Set(row.sourceStatus)].join(', '),
  }))

  const energyBalanceRows = feeders
    .filter((feeder) => isMainIncomingFeeder(feeder))
    .map((feeder) => {
      const mainRow = consumptionAnalysis.rows.find((row) => row.feederId === feeder.id)
      const inputSentOut = mainRow?.sentOut ?? null
      let childHasPartialData = false
      let childOutgoingTotal = 0

      feeders
        .filter((item) => item.parentFeederId === feeder.id && is11KvOutgoingFeeder(item))
        .forEach((childFeeder) => {
          const childRow = consumptionAnalysis.rows.find((row) => row.feederId === childFeeder.id)

          if (childRow && childRow.sentOut !== null) {
            childOutgoingTotal += childRow.sentOut
          } else {
            childHasPartialData = true
          }
        })

      const lossUnits =
        inputSentOut !== null ? Number((inputSentOut - childOutgoingTotal).toFixed(2)) : null
      const lossPercent =
        inputSentOut && inputSentOut !== 0 && lossUnits !== null
          ? Number(((lossUnits / inputSentOut) * 100).toFixed(2))
          : null

      let remark = 'Normal'
      if (inputSentOut === null) {
        remark = 'No Incomer Data'
      } else if (childHasPartialData) {
        remark = 'Incomplete Child Data'
      } else if (lossUnits < 0) {
        remark = 'Negative / Check MF or mapping'
      } else if (lossPercent !== null && Math.abs(lossPercent) > ENERGY_BALANCE_ALERT_PERCENT) {
        remark = 'Abnormal / High Loss'
      }

      return {
        mainIncoming: feeder.name,
        inputSentOut,
        childOutgoingTotal: Number(childOutgoingTotal.toFixed(2)),
        lossUnits,
        lossPercent,
        childHasPartialData,
        remark,
      }
    })

  const feederLoadTrendRows = monthDailyLogs.flatMap((record) => {
    const summaries = getDailyLogDerivedSummaries(record, feeders)

    return (summaries.feederSummaries || []).map((summary) => ({
      date: record.operationalDate,
      feederName: summary.feederName || getFeederName(feeders, summary.feederId, '-'),
      maxLoad: getNumericValue(summary.maxLoad),
      maxLoadHour: safeText(summary.maxLoadHour, '-'),
      minLoad: getNumericValue(summary.minLoad),
      minLoadHour: safeText(summary.minLoadHour, '-'),
      averageLoad: average(
        [{ value: summary.minLoad }, { value: summary.maxLoad }],
        (item) => item.value,
      ),
      units: getNumericValue(summary.units),
      interruptionMinutes: getNumericValue(summary.interruptionMinutes),
    }))
  })

  const historicalMonthlyValueMap = buildHistoricalMonthlyValueMap({
    monthKey,
    feeders,
    dailyLogHistoryRecords,
  })
  const abnormalRows = consumptionAnalysis.rows.map((row) => {
    const recentAverage = getHistoricalAverageForFeeder(historicalMonthlyValueMap, row.feederId, 3)
    const abnormal = getAbnormalStatusDetails(row, recentAverage)

    return {
      feederName: row.feederName,
      prev: row.prev,
      curr: row.curr,
      units: row.units,
      mf: row.mf,
      sentOut: row.sentOut,
      recentAverage,
      status: abnormal.status,
      warningRemark: abnormal.remark,
      _rowClass: abnormal.rowClass,
    }
  })
  const abnormalSummary = abnormalRows.reduce(
    (summary, row) => {
      summary.total += 1
      if (row.status === 'Zero Consumption') {
        summary.zero += 1
      } else if (row.status === 'Negative Difference') {
        summary.negative += 1
      } else if (row.status === 'Very Low Consumption') {
        summary.low += 1
      } else if (row.status === 'Very High Consumption') {
        summary.high += 1
      } else if (row.status === 'Missing Reading') {
        summary.missing += 1
      }
      return summary
    },
    { total: 0, zero: 0, negative: 0, low: 0, high: 0, missing: 0 },
  )

  const maintenanceByDate = groupBy(
    maintenanceRecords.map((record) => ({
      date: record.operationalDate,
      workDetail: record.payload?.workDetail || '-',
    })),
    (row) => row.date,
  )

  const eventImpactRows = Object.keys({
    ...dailyMinMaxRows,
    ...maintenanceByDate,
  }).map((date) => {
    const dailyRows = dailyMinMaxRows[date] || []
    const interruptionMinutes = summaryEntries
      .filter((entry) => entry.record.operationalDate === date)
      .reduce(
        (total, entry) =>
          total + sum(Object.values(entry.summaryMap), (summary) => summary.interruptionMinutes),
        0,
      )

    return {
      date,
      faultCount: faultRecords.filter((record) => record.operationalDate === date).length,
      faultDurationMinutes: sum(
        faultRecords.filter((record) => record.operationalDate === date),
        (record) => record.payload?.durationMinutes,
      ),
      interruptionMinutes,
      maintenanceCount: (maintenanceByDate[date] || []).length,
      totalUnits: sum(dailyRows, (row) => row.units),
      notes: (maintenanceByDate[date] || []).map((item) => item.workDetail).join('; ') || '-',
    }
  })

  const completenessRows = feeders.map((feeder) => {
    const rows = feederStats[feeder.id] || []
    const numericRecords = sum(rows, (row) => row.loggedHours)
    const outageHours = sum(rows, (row) => row.outageHours)
    const expectedRecords = totalDays * HOURS_PER_DAILY_LOG
    const missingRecords = Math.max(0, expectedRecords - numericRecords - outageHours)
    const completenessPercent = expectedRecords
      ? ((numericRecords + outageHours) / expectedRecords) * 100
      : 0
    const numericPercent = expectedRecords ? (numericRecords / expectedRecords) * 100 : 0
    const eventPercent = expectedRecords ? (outageHours / expectedRecords) * 100 : 0
    const missingPercent = expectedRecords ? (missingRecords / expectedRecords) * 100 : 0
    const statusInfo = getCompletenessStatus(completenessPercent)

    return {
      feederName: feeder.name,
      expectedRecords,
      numericRecords,
      eventRecords: outageHours,
      missingRecords,
      completenessPercent,
      numericPercent,
      eventPercent,
      missingPercent,
      status: statusInfo.status,
      _rowClass: statusInfo.rowClass,
    }
  })

  const reconciliationDetailRows = []
  let totalInputSentOut = 0
  let totalChildOutgoing = 0

  const reconciliationRows = feeders
    .filter((feeder) => isMainIncomingFeeder(feeder))
    .map((feeder) => {
      const inputRow = consumptionAnalysis.rows.find((row) => row.feederId === feeder.id)
      const inputSentOut = inputRow?.sentOut ?? null
      const childFeeders = feeders.filter(
        (candidate) => candidate.parentFeederId === feeder.id && is11KvOutgoingFeeder(candidate),
      )
      const childDetails = childFeeders.map((childFeeder) => {
        const childRow = consumptionAnalysis.rows.find((row) => row.feederId === childFeeder.id)
        const childSentOut = childRow?.sentOut ?? null

        return {
          mainIncomerName: feeder.name,
          childFeederName: childFeeder.name,
          childSentOut,
          shareOfGroup:
            inputSentOut && childSentOut !== null
              ? Number(((childSentOut / inputSentOut) * 100).toFixed(2))
              : null,
          childStatus: childSentOut === null ? 'No Data' : 'Mapped',
        }
      })

      const childOutgoingTotal = childDetails.reduce(
        (current, item) => current + (item.childSentOut !== null ? item.childSentOut : 0),
        0,
      )
      const differenceUnits =
        inputSentOut !== null ? Number((inputSentOut - childOutgoingTotal).toFixed(2)) : null
      const differencePercent =
        inputSentOut && inputSentOut !== 0 && differenceUnits !== null
          ? Number(((differenceUnits / inputSentOut) * 100).toFixed(2))
          : null
      const statusInfo = getReconciliationStatus(
        inputSentOut,
        childOutgoingTotal,
        differenceUnits,
        differencePercent,
      )

      childDetails.forEach((detail) => {
        reconciliationDetailRows.push(detail)
      })

      totalInputSentOut += inputSentOut !== null ? inputSentOut : 0
      totalChildOutgoing += childOutgoingTotal

      return {
        mainIncomerName: feeder.name,
        inputSentOut,
        childFeedersCount: childFeeders.length,
        childOutgoingTotal: Number(childOutgoingTotal.toFixed(2)),
        differenceUnits,
        differencePercent,
        status: statusInfo.status,
        remark: statusInfo.remark,
        _rowClass: statusInfo.rowClass,
      }
    })

  const netDifference = Number((totalInputSentOut - totalChildOutgoing).toFixed(2))
  const netLossPercent =
    totalInputSentOut > 0 ? Number(((netDifference / totalInputSentOut) * 100).toFixed(2)) : null
  const highestMismatchRow =
    reconciliationRows
      .slice()
      .sort((left, right) => {
        const rightValue =
          right.differencePercent !== null
            ? Math.abs(right.differencePercent)
            : Math.abs(right.differenceUnits || 0)
        const leftValue =
          left.differencePercent !== null
            ? Math.abs(left.differencePercent)
            : Math.abs(left.differenceUnits || 0)
        return rightValue - leftValue
      })[0] || null

  function reportBase(title, rows, summaryCards = [], notes = [], tables = []) {
    return {
      title,
      subtitle: `${substation?.name || '-'} | ${getMonthLabel(monthKey)}`,
      metadata: [
        ['Company', companyProfile.companyName],
        ['Substation', substation?.name || '-'],
        ['Month', getMonthLabel(monthKey)],
        ['Generated On', formatDate(new Date())],
      ],
      summaryCards,
      rows,
      tables,
      notes,
      tags: [
        `Substation: ${substation?.name || '-'}`,
        `Month: ${getMonthLabel(monthKey)}`,
        'Feeder Group: All',
      ],
      orientation: 'landscape',
      pageSize: 'a4',
    }
  }

  return {
    monthlyConsumption: reportBase(
      'Monthly Consumption Report',
      monthlyConsumptionRows,
      [
        { label: 'Feeders', value: formatInteger(monthlyConsumptionRows.length) },
        { label: 'Total Units', value: formatNumber(sum(monthlyConsumptionRows, (row) => row.units)) },
        { label: 'Outgoing Sent Out', value: formatNumber(consumptionAnalysis.totalOutgoingSentOut) },
      ],
      [consumptionAnalysis.note],
      [
        buildTable('Monthly Consumption', [
          { key: 'feederName', label: 'Feeder' },
          { key: 'ctRatio', label: 'CT Ratio' },
          { key: 'prev', label: 'Prev', type: 'integer', align: 'right' },
          { key: 'curr', label: 'Curr', type: 'integer', align: 'right' },
          { key: 'units', label: 'Units', type: 'number', align: 'right' },
          { key: 'mf', label: 'MF', type: 'number', align: 'right' },
          { key: 'sentOut', label: 'Sent Out', type: 'number', align: 'right' },
          { key: 'sharePercent', label: 'Share %', type: 'percent', align: 'right' },
          { key: 'status', label: 'Status' },
        ], monthlyConsumptionRows),
      ],
    ),
    dailyMinMaxSummary: reportBase(
      'Daily Min/Max Summary',
      dailyMinMaxSummaryRows,
      [
        { label: 'Days With Logs', value: formatInteger(dailyMinMaxSummaryRows.length) },
        { label: 'Peak Load', value: formatNumber(Math.max(...dailyMinMaxSummaryRows.map((row) => row.peakLoad), 0)) },
      ],
      [],
      [
        buildTable('Daily Min/Max Summary', [
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'totalUnits', label: 'Total Units', type: 'number', align: 'right' },
          { key: 'peakLoad', label: 'Peak Load', type: 'number', align: 'right' },
          { key: 'peakFeeder', label: 'Peak Feeder' },
          { key: 'peakHour', label: 'Peak Hour', align: 'center' },
          { key: 'minLoad', label: 'Min Load', type: 'number', align: 'right' },
          { key: 'lowFeeder', label: 'Low Feeder' },
          { key: 'lowHour', label: 'Low Hour', align: 'center' },
          { key: 'minVoltage', label: 'Min KV', type: 'number', align: 'right' },
          { key: 'maxVoltage', label: 'Max KV', type: 'number', align: 'right' },
        ], dailyMinMaxSummaryRows),
      ],
    ),
    monthlyMinMax: reportBase(
      'Monthly Min/Max Report',
      monthlyMinMaxRows,
      [{ label: 'Feeders', value: formatInteger(monthlyMinMaxRows.length) }],
      [],
      [
        buildTable('Monthly Min/Max', [
          { key: 'feederName', label: 'Feeder' },
          { key: 'minLoad', label: 'Min Load', type: 'number', align: 'right' },
          { key: 'minLoadDate', label: 'Min Date', type: 'date' },
          { key: 'minLoadHour', label: 'Min Hour', align: 'center' },
          { key: 'maxLoad', label: 'Max Load', type: 'number', align: 'right' },
          { key: 'maxLoadDate', label: 'Max Date', type: 'date' },
          { key: 'maxLoadHour', label: 'Max Hour', align: 'center' },
          { key: 'minVoltage', label: 'Min KV', type: 'number', align: 'right' },
          { key: 'maxVoltage', label: 'Max KV', type: 'number', align: 'right' },
        ], monthlyMinMaxRows),
      ],
    ),
    monthlyInterruption: reportBase(
      'Monthly Interruption Report',
      monthlyInterruptionRows,
      [
        { label: 'Total Interruptions', value: formatInteger(sum(monthlyInterruptionRows, (row) => row.interruptions)) },
        { label: 'Outage Hours', value: formatNumber(sum(monthlyInterruptionRows, (row) => row.totalDurationHours)) },
      ],
      [],
      [
        buildTable('Monthly Interruption', [
          { key: 'feeder', label: 'Feeder' },
          { key: 'interruptions', label: 'Interruptions', type: 'integer', align: 'right' },
          { key: 'totalDurationHours', label: 'Total Duration (Hr)', type: 'number', align: 'right' },
          { key: 'averageDurationHours', label: 'Average Duration (Hr)', type: 'number', align: 'right' },
          { key: 'sourceStatus', label: 'Source' },
        ], monthlyInterruptionRows),
      ],
    ),
    monthlyEnergyBalance: reportBase(
      'Monthly Energy Balance / Loss Report',
      energyBalanceRows,
      [
        { label: 'Main Incoming Feeders', value: formatInteger(energyBalanceRows.length) },
        { label: 'Input Sent Out', value: formatNumber(sum(energyBalanceRows, (row) => row.inputSentOut || 0)) },
        { label: 'Child Outgoing', value: formatNumber(sum(energyBalanceRows, (row) => row.childOutgoingTotal || 0)) },
      ],
      [],
      [
        buildTable('Energy Balance / Loss', [
          { key: 'mainIncoming', label: 'Group / Incomer' },
          { key: 'inputSentOut', label: 'Input Sent Out', type: 'number', align: 'right' },
          { key: 'childOutgoingTotal', label: 'Child Outgoing Total', type: 'number', align: 'right' },
          { key: 'lossUnits', label: 'Loss Units', type: 'number', align: 'right' },
          { key: 'lossPercent', label: 'Loss %', type: 'percent', align: 'right' },
          { key: 'remark', label: 'Remark' },
        ], energyBalanceRows),
      ],
    ),
    feederLoadTrend: reportBase(
      'Feeder Load Trend Report',
      feederLoadTrendRows,
      [{ label: 'Trend Rows', value: formatInteger(feederLoadTrendRows.length) }],
      [],
      [
        buildTable('Feeder Load Trend', [
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'feederName', label: 'Feeder' },
          { key: 'maxLoad', label: 'Peak Load', type: 'number', align: 'right' },
          { key: 'maxLoadHour', label: 'Peak Hour', align: 'center' },
          { key: 'minLoad', label: 'Low Load', type: 'number', align: 'right' },
          { key: 'minLoadHour', label: 'Low Hour', align: 'center' },
          { key: 'averageLoad', label: 'Average Load', type: 'number', align: 'right' },
          { key: 'units', label: 'Units', type: 'number', align: 'right' },
          { key: 'interruptionMinutes', label: 'Interruption (Min)', type: 'integer', align: 'right' },
        ], feederLoadTrendRows),
      ],
    ),
    abnormalConsumption: reportBase(
      'Abnormal Consumption Report',
      abnormalRows,
      [
        { label: 'Rows', value: formatInteger(abnormalSummary.total) },
        { label: 'Zero', value: formatInteger(abnormalSummary.zero) },
        { label: 'Negative', value: formatInteger(abnormalSummary.negative) },
        { label: 'Low', value: formatInteger(abnormalSummary.low) },
        { label: 'High', value: formatInteger(abnormalSummary.high) },
        { label: 'Missing', value: formatInteger(abnormalSummary.missing) },
      ],
      ['Abnormal detection uses missing readings, negative values, zero consumption, and recent 3-month average where available.'],
      [
        buildTable('Abnormal Consumption', [
          { key: 'feederName', label: 'Feeder' },
          { key: 'prev', label: 'Prev', type: 'integer', align: 'right' },
          { key: 'curr', label: 'Curr', type: 'integer', align: 'right' },
          { key: 'units', label: 'Units', type: 'number', align: 'right' },
          { key: 'mf', label: 'MF', type: 'number', align: 'right' },
          { key: 'sentOut', label: 'Sent Out', type: 'number', align: 'right' },
          { key: 'recentAverage', label: 'Recent Avg', type: 'number', align: 'right' },
          { key: 'status', label: 'Status' },
          { key: 'warningRemark', label: 'Remark' },
        ], abnormalRows),
      ],
    ),
    eventImpact: reportBase(
      'Event Impact Report',
      eventImpactRows,
      [{ label: 'Event Dates', value: formatInteger(eventImpactRows.length) }],
      [],
      [
        buildTable('Event Impact', [
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'faultCount', label: 'Fault Count', type: 'integer', align: 'right' },
          { key: 'faultDurationMinutes', label: 'Fault Duration (Min)', type: 'integer', align: 'right' },
          { key: 'interruptionMinutes', label: 'Interruption (Min)', type: 'integer', align: 'right' },
          { key: 'maintenanceCount', label: 'Maintenance Count', type: 'integer', align: 'right' },
          { key: 'totalUnits', label: 'Total Units', type: 'number', align: 'right' },
          { key: 'notes', label: 'Notes' },
        ], eventImpactRows),
      ],
    ),
    dataCompleteness: reportBase(
      'Data Completeness Report',
      completenessRows,
      [
        { label: 'Expected Days', value: formatInteger(totalDays) },
        { label: 'Expected Hourly Slots', value: formatInteger(totalDays * HOURS_PER_DAILY_LOG) },
      ],
      [],
      [
        buildTable('Data Completeness', [
          { key: 'feederName', label: 'Feeder' },
          { key: 'expectedRecords', label: 'Expected', type: 'integer', align: 'right' },
          { key: 'numericRecords', label: 'Numeric', type: 'integer', align: 'right' },
          { key: 'eventRecords', label: 'Event', type: 'integer', align: 'right' },
          { key: 'missingRecords', label: 'Missing', type: 'integer', align: 'right' },
          { key: 'completenessPercent', label: 'Complete %', type: 'percent', align: 'right' },
          { key: 'numericPercent', label: 'Numeric %', type: 'percent', align: 'right' },
          { key: 'eventPercent', label: 'Event %', type: 'percent', align: 'right' },
          { key: 'missingPercent', label: 'Missing %', type: 'percent', align: 'right' },
          { key: 'status', label: 'Status' },
        ], completenessRows),
      ],
    ),
    mainIncReconciliation: reportBase(
      'Main INC vs Child Reconciliation Report',
      reconciliationRows,
      [
        { label: 'Total Groups Checked', value: formatInteger(reconciliationRows.length) },
        { label: 'Total Input Sent Out', value: formatNumber(totalInputSentOut) },
        { label: 'Total Child Outgoing', value: formatNumber(totalChildOutgoing) },
        { label: 'Net Difference', value: formatNumber(netDifference) },
        { label: 'Net Loss %', value: netLossPercent === null ? '-' : `${formatNumber(netLossPercent)}%` },
        {
          label: 'Highest Mismatch Group',
          value: highestMismatchRow
            ? `${highestMismatchRow.mainIncomerName} | ${
                highestMismatchRow.differencePercent === null
                  ? highestMismatchRow.status
                  : `${formatNumber(highestMismatchRow.differencePercent)}%`
              }`
            : '-',
        },
      ],
      ['Input sent out comes from the main incomer monthly sent out. Child outgoing total is the sum of mapped outgoing feeders under that incomer.'],
      [
        buildTable('Main Incomer Reconciliation', [
          { key: 'mainIncomerName', label: 'Main Incomer' },
          { key: 'inputSentOut', label: 'Input Sent Out', type: 'number', align: 'right' },
          { key: 'childFeedersCount', label: 'Child Feeders Count', type: 'integer', align: 'right' },
          { key: 'childOutgoingTotal', label: 'Child Outgoing Total', type: 'number', align: 'right' },
          { key: 'differenceUnits', label: 'Difference Units', type: 'number', align: 'right' },
          { key: 'differencePercent', label: 'Difference %', type: 'percent', align: 'right' },
          { key: 'status', label: 'Status' },
          { key: 'remark', label: 'Remark' },
        ], reconciliationRows),
        buildTable('Mapped Child Feeders', [
          { key: 'mainIncomerName', label: 'Main Incomer' },
          { key: 'childFeederName', label: 'Child Feeder' },
          { key: 'childSentOut', label: 'Child Sent Out', type: 'number', align: 'right' },
          { key: 'shareOfGroup', label: 'Share of Group %', type: 'percent', align: 'right' },
          { key: 'childStatus', label: 'Status' },
        ], reconciliationDetailRows),
      ],
    ),
  }
}

export function buildMonthEndPackSections(monthlyReports) {
  return [
    monthlyReports.monthlyConsumption,
    monthlyReports.dailyMinMaxSummary,
    monthlyReports.monthlyMinMax,
    monthlyReports.monthlyInterruption,
    monthlyReports.monthlyEnergyBalance,
    monthlyReports.feederLoadTrend,
    monthlyReports.abnormalConsumption,
    monthlyReports.eventImpact,
    monthlyReports.dataCompleteness,
    monthlyReports.mainIncReconciliation,
  ]
}


