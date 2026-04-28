import { DAILY_LOG_HOURS, DAILY_LOG_EVENT_TYPES } from './dailyLog'
import {
  getDurationBetweenTimes,
  parseTwentyFourHourTime,
} from './timeRange'

function text(value) {
  return String(value || '').trim()
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function numeric(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function validateAttendanceDocumentInput({ sheetType, substationId }) {
  ensure(text(sheetType), 'Attendance sheet type required aahe.')
  ensure(text(substationId), 'Attendance sathi substation required aahe.')
}

export function validateDailyLogInput(form) {
  ensure(text(form.substationId), 'Daily log sathi substation select kara.')
  ensure(text(form.operationalDate), 'Daily log date required aahe.')
  ensure((form.rows || []).length === DAILY_LOG_HOURS.length, 'Daily log madhye 00:00 te 24:00 paryant sagle rows havet.')

  ;(form.rows || []).forEach((row, index) => {
    ensure(row.hour === DAILY_LOG_HOURS[index], `${DAILY_LOG_HOURS[index]} row mismatch aahe.`)
  })

  ;(form.interruptions || []).forEach((interruption, index) => {
    const fromMinutes = parseTwentyFourHourTime(interruption.from_time)
    const toMinutes = parseTwentyFourHourTime(interruption.to_time, {
      allowTwentyFour: true,
    })

    ensure(
      text(interruption.feederId || interruption.feeder_id),
      `Interruption ${index + 1}: feeder required aahe.`,
    )
    ensure(text(interruption.from_time), `Interruption ${index + 1}: from time required aahe.`)
    ensure(text(interruption.to_time), `Interruption ${index + 1}: to time required aahe.`)
    ensure(
      fromMinutes !== null,
      `Interruption ${index + 1}: from time HH:MM 24-hour format madhye hava.`,
    )
    ensure(
      toMinutes !== null,
      `Interruption ${index + 1}: to time HH:MM 24-hour format madhye hava.`,
    )
    ensure(
      DAILY_LOG_EVENT_TYPES.includes(interruption.event_type),
      `Interruption ${index + 1}: event type valid hava.`,
    )
    ensure(
      toMinutes >= fromMinutes,
      `Interruption ${index + 1}: to time from time peksha kami nasava.`,
    )
  })

  ;(form.meterChangeEvents || []).forEach((event, index) => {
    ensure(
      text(event.feederId || event.feeder_id),
      `Meter change ${index + 1}: feeder required aahe.`,
    )
    ensure(
      text(event.effective_time || event.effectiveTime),
      `Meter change ${index + 1}: effective time required aahe.`,
    )
    ensure(
      parseTwentyFourHourTime(event.effective_time || event.effectiveTime) !== null,
      `Meter change ${index + 1}: effective time HH:MM 24-hour format madhye hava.`,
    )
    ensure(
      text(event.oldMeterLastReading),
      `Meter change ${index + 1}: old meter final reading required aahe.`,
    )
    ensure(
      text(event.newMeterStartReading),
      `Meter change ${index + 1}: new meter start reading required aahe.`,
    )
  })
}

export function validateBatteryInput(form, batterySet) {
  ensure(text(form.substationId), 'Battery record sathi substation required aahe.')
  ensure(text(form.batterySetId), 'Battery set select kara.')
  ensure(text(form.operationalDate), 'Battery date required aahe.')
  ensure((form.cells || []).length > 0, 'Battery cells required aahet.')

  const expectedCellCount = Number(batterySet?.cellCount || 0)

  if (expectedCellCount > 0) {
    ensure(
      form.cells.length === expectedCellCount,
      `Battery set nusar ${expectedCellCount} cells havet.`,
    )
  }

  form.cells.forEach((cell, index) => {
    const gravity = numeric(cell.specificGravity, NaN)
    const voltage = numeric(cell.voltage, NaN)
    ensure(Number.isFinite(gravity), `Cell ${index + 1}: specific gravity required aahe.`)
    ensure(Number.isFinite(voltage), `Cell ${index + 1}: voltage required aahe.`)
  })
}

export function validateFaultInput(form) {
  const fromTime = text(form.fromTime || form.from_time || form.time)
  const toTime = text(form.toTime || form.to_time)
  const durationMinutes = form.durationMinutes ?? form.duration_minutes

  ensure(text(form.substationId), 'Fault sathi substation required aahe.')
  ensure(text(form.operationalDate), 'Fault date required aahe.')
  ensure(fromTime, 'Fault from time required aahe.')
  ensure(toTime, 'Fault to time required aahe.')
  ensure(
    parseTwentyFourHourTime(fromTime) !== null,
    'Fault from time HH:MM 24-hour format madhye hava.',
  )
  ensure(
    parseTwentyFourHourTime(toTime) !== null,
    'Fault to time HH:MM 24-hour format madhye hava.',
  )
  ensure(
    getDurationBetweenTimes(fromTime, toTime) !== null,
    'Fault time range valid hava. To time ha from time nantar hava.',
  )
  ensure(text(form.feederId), 'Fault feeder required aahe.')
  ensure(text(form.faultType), 'Fault type required aahe.')
  ensure(numeric(durationMinutes, NaN) >= 0, 'Fault duration valid hava.')
}

export function validateMaintenanceInput(form) {
  const fromTime = text(form.fromTime || form.from_time || form.time)
  const toTime = text(form.toTime || form.to_time)
  const durationMinutes = form.durationMinutes ?? form.duration_minutes

  ensure(text(form.substationId), 'Maintenance sathi substation required aahe.')
  ensure(text(form.operationalDate), 'Maintenance date required aahe.')
  ensure(fromTime, 'Maintenance from time required aahe.')
  ensure(toTime, 'Maintenance to time required aahe.')
  ensure(
    parseTwentyFourHourTime(fromTime) !== null,
    'Maintenance from time HH:MM 24-hour format madhye hava.',
  )
  ensure(
    parseTwentyFourHourTime(toTime) !== null,
    'Maintenance to time HH:MM 24-hour format madhye hava.',
  )
  ensure(
    getDurationBetweenTimes(fromTime, toTime) !== null,
    'Maintenance time range valid hava. To time ha from time nantar hava.',
  )
  ensure(text(form.feederId), 'Maintenance feeder select kara.')
  ensure(text(form.maintenanceType), 'Maintenance type required aahe.')
  ensure(numeric(durationMinutes, NaN) >= 0, 'Maintenance duration valid hava.')
  ensure(text(form.workDetail), 'Work detail required aahe.')
}

export function validateChargeHandoverInput(form) {
  ensure(text(form.substationId), 'Charge handover sathi substation required aahe.')
  ensure(text(form.operationalDate), 'Charge handover date required aahe.')
  ensure(text(form.shift), 'Shift required aahe.')
  ensure(text(form.outgoingOperator), 'Outgoing operator required aahe.')
  ensure(text(form.incomingOperator), 'Incoming operator required aahe.')
  ensure(text(form.chargeDetails), 'Charge details required aahet.')
}
