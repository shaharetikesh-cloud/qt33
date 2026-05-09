import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import DailyLogEntryTable from '../components/dailyLog/DailyLogEntryTable'
import ReportActions from '../components/reporting/ReportActions'
import {
  DailyLogAnalyticsReportView,
  DailyLogReportView,
} from '../components/reporting/ReportLayouts'
import { useAuth } from '../context/AuthContext'
import {
  buildDailyLogConfiguration,
  buildManualLsInterruption,
  buildDailyLogRecordForSave,
  createDailyLogFormState,
  DAILY_LOG_EVENT_SCOPE_OPTIONS,
  deriveDailyLogState,
  findCarryForwardSnapshot,
  listDailyLogRecords,
  DAILY_LOG_EVENT_TYPES,
  validateDailyLogKwhContinuity,
  validateDailyLogMeterChanges,
} from '../lib/dailyLog'
import { formatIsoDate } from '../lib/dateUtils'
import { alertDetailSaved } from '../lib/detailSavedAlert'
import { validateDailyLogInput } from '../lib/domainValidation'
import {
  buildDailyLogAnalyticsReport,
  buildDailyLogReport,
} from '../lib/reportData'
import {
  getDailyLogKpiVisible,
  resolvePreferredSubstationId,
  setDailyLogKpiVisible,
} from '../lib/uiPreferences'
import {
  deleteDlrRecord,
  getSettingsBundle,
  listDlrRecords,
  listMasterRecords,
  loadDlrRecords,
  loadReferenceData,
  saveDlrRecord,
} from '../lib/unifiedDataService'

const emptyInterruptionForm = {
  feederId: '',
  scopeType: 'single_feeder',
  selectedFeederIds: [],
  from_time: '',
  to_time: '',
  event_type: 'LS',
  remark: '',
}

const emptyMeterChangeForm = {
  feederId: '',
  effective_time: '',
  oldMeterLastReading: '',
  newMeterStartReading: '',
  remark: '',
}

function getDailyLogContext(profile) {
  return {
    feeders: listMasterRecords('feeders'),
    batterySets: listMasterRecords('batterySets'),
    transformers: listMasterRecords('transformers'),
    records: listDailyLogRecords(listDlrRecords({ moduleName: 'daily_log', profile })),
  }
}

function shiftIsoDate(isoDate, offsetDays) {
  const baseDate = new Date(`${isoDate}T00:00:00`)
  baseDate.setDate(baseDate.getDate() + offsetDays)
  return formatIsoDate(baseDate)
}

function formatTimeInputForEditing(rawValue) {
  const value = String(rawValue || '')
  const digits = value.replace(/\D/g, '').slice(0, 4)

  if (!digits) {
    return ''
  }

  if (value.includes(':')) {
    const [hoursPart, minutesPart = ''] = value.split(':')
    const hoursDigits = hoursPart.replace(/\D/g, '').slice(0, 2)
    const minutesDigits = minutesPart.replace(/\D/g, '').slice(0, 2)
    return minutesPart !== '' ? `${hoursDigits}:${minutesDigits}` : `${hoursDigits}:`
  }

  if (digits.length <= 2) {
    return digits
  }

  if (digits.length === 3) {
    return `${digits.slice(0, 2)}:${digits.slice(2)}`
  }

  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

function normalizeTimeInput(rawValue, { allowTwentyFour = false } = {}) {
  const value = String(rawValue || '').trim()

  if (!value) {
    return ''
  }

  let hoursDigits = ''
  let minutesDigits = ''

  if (value.includes(':')) {
    const [hoursPart, minutesPart = ''] = value.split(':')
    hoursDigits = hoursPart.replace(/\D/g, '').slice(0, 2)
    minutesDigits = minutesPart.replace(/\D/g, '').slice(0, 2)
  } else {
    const digits = value.replace(/\D/g, '').slice(0, 4)

    if (digits.length <= 2) {
      hoursDigits = digits
      minutesDigits = '00'
    } else if (digits.length === 3) {
      hoursDigits = digits.slice(0, 2)
      minutesDigits = digits.slice(2)
    } else {
      hoursDigits = digits.slice(0, 2)
      minutesDigits = digits.slice(2, 4)
    }
  }

  if (!hoursDigits) {
    return ''
  }

  const hours = Number(hoursDigits)
  const minutes = Number((minutesDigits || '0').padEnd(2, '0').slice(0, 2))

  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
    return ''
  }

  if (hours === 24) {
    return allowTwentyFour && minutes === 0 ? '24:00' : ''
  }

  if (hours < 0 || hours > 23) {
    return ''
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function parseTwentyFourHourTime(rawValue, options) {
  const normalized = normalizeTimeInput(rawValue, options)

  if (!normalized) {
    return null
  }

  const [hoursPart, minutesPart] = normalized.split(':')
  return Number(hoursPart) * 60 + Number(minutesPart)
}

function formatDurationClock(totalMinutes) {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) {
    return ''
  }

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function getDurationBetweenTimes(fromTime, toTime) {
  const fromMinutes = parseTwentyFourHourTime(fromTime)
  const toMinutes = parseTwentyFourHourTime(toTime, { allowTwentyFour: true })

  if (fromMinutes === null || toMinutes === null || toMinutes < fromMinutes) {
    return null
  }

  return toMinutes - fromMinutes
}

function buildDailyLogFingerprint(records = []) {
  return records
    .map((item) => `${item.id}:${item.updatedAt || item.updated_at || ''}`)
    .sort()
    .join('|')
}

export default function DailyLogPage() {
  const { profile, canCreateModule, canEditModule, canDeleteModule } = useAuth()
  const documentRef = useRef(null)
  const analyticsDocumentRef = useRef(null)
  const [settings, setSettings] = useState(getSettingsBundle())
  const [referenceData, setReferenceData] = useState({
    substations: [],
    employees: [],
  })
  const [feeders, setFeeders] = useState(listMasterRecords('feeders'))
  const [batterySets, setBatterySets] = useState(listMasterRecords('batterySets'))
  const [transformers, setTransformers] = useState(listMasterRecords('transformers'))
  const [records, setRecords] = useState([])
  const [form, setForm] = useState({
    operationalDate: formatIsoDate(new Date()),
    substationId: '',
    shift: 'General',
    operatorName: '',
    inChargeName: '',
    approvalStatus: 'draft',
    rows: [],
    interruptions: [],
    meterChangeEvents: [],
    carryForwardSource: null,
    carryForwardAutoFillSeed: null,
    carryForwardSuppressedCells: {},
    carryForwardWarning: '',
    dayStatus: 'draft',
  })
  const [selectedRecordId, setSelectedRecordId] = useState('')
  const canCreateDailyLog = canCreateModule('daily_log')
  const canEditDailyLog = canEditModule('daily_log')
  const canDeleteDailyLog = canDeleteModule('daily_log')
  const canWriteCurrentRecord = selectedRecordId ? canEditDailyLog : canCreateDailyLog
  const [interruptionForm, setInterruptionForm] = useState(emptyInterruptionForm)
  const [meterChangeForm, setMeterChangeForm] = useState(emptyMeterChangeForm)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [currentTime, setCurrentTime] = useState(() => new Date())
  const [showDailyLogGuide, setShowDailyLogGuide] = useState(false)
  const [showDailyLogKpis, setShowDailyLogKpis] = useState(() => getDailyLogKpiVisible(true))
  const [isDirty, setIsDirty] = useState(false)
  const [syncNotice, setSyncNotice] = useState('')
  const [sideDrawerOpen, setSideDrawerOpen] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 1100px)').matches : true,
  )
  const [sideDrawerTab, setSideDrawerTab] = useState('interruptions')
  const dailyLogPrintActionsRef = useRef(null)

  const syncCollections = useCallback(() => {
    const context = getDailyLogContext(profile)
    setFeeders(context.feeders)
    setBatterySets(context.batterySets)
    setTransformers(context.transformers)
    setRecords(context.records)
    setSettings(getSettingsBundle())
    return context
  }, [profile])

  const syncCollectionsAsync = useCallback(async () => {
    await loadDlrRecords({ moduleName: 'daily_log', profile })
    return syncCollections()
  }, [profile, syncCollections])

  const loadDraft = useCallback((nextSubstationId, nextOperationalDate, options = {}) => {
    const context = options.context || syncCollections()
    const existingRecord =
      options.recordId && options.recordId !== 'new'
        ? context.records.find((record) => record.id === options.recordId)
        : options.recordId === 'new'
          ? null
          : context.records.find(
              (record) =>
                record.substationId === nextSubstationId &&
                record.operationalDate === nextOperationalDate,
            ) || null

    const nextForm = createDailyLogFormState({
      substationId: nextSubstationId,
      operationalDate: nextOperationalDate,
      existingRecord,
      records: context.records,
      feeders: context.feeders,
      batterySets: context.batterySets,
      transformers: context.transformers,
    })

    setForm(nextForm)
    setSelectedRecordId(existingRecord?.id || '')
    setIsDirty(false)
    setSyncNotice('')
    setInterruptionForm((current) => ({
      ...emptyInterruptionForm,
      feederId:
        current.feederId &&
        context.feeders.some(
          (item) => item.substationId === nextSubstationId && item.id === current.feederId,
        )
          ? current.feederId
          : context.feeders.find((item) => item.substationId === nextSubstationId)?.id || '',
    }))
    setMeterChangeForm((current) => ({
      ...emptyMeterChangeForm,
      feederId:
        current.feederId &&
        context.feeders.some(
          (item) => item.substationId === nextSubstationId && item.id === current.feederId,
        )
          ? current.feederId
          : context.feeders.find((item) => item.substationId === nextSubstationId)?.id || '',
    }))
  }, [syncCollections])

  useEffect(() => {
    let active = true

    async function bootstrap() {
      const bundle = await loadReferenceData(profile)
      await loadDlrRecords({ moduleName: 'daily_log', profile })

      if (!active) {
        return
      }

      setReferenceData(bundle)
      const context = getDailyLogContext(profile)
      setFeeders(context.feeders)
      setBatterySets(context.batterySets)
      setTransformers(context.transformers)
      setRecords(context.records)
      setSettings(getSettingsBundle())
      const initialSubstationId = resolvePreferredSubstationId(bundle.substations)
      const initialDate = formatIsoDate(new Date())
      const existingRecord = context.records.find(
        (record) =>
          record.substationId === initialSubstationId &&
          record.operationalDate === initialDate,
      )
      const nextForm = createDailyLogFormState({
        substationId: initialSubstationId,
        operationalDate: initialDate,
        existingRecord,
        records: context.records,
        feeders: context.feeders,
        batterySets: context.batterySets,
        transformers: context.transformers,
      })

      setForm(nextForm)
      setSelectedRecordId(existingRecord?.id || '')
      setInterruptionForm({
        ...emptyInterruptionForm,
        feederId: context.feeders.find((item) => item.substationId === initialSubstationId)?.id || '',
      })
      setMeterChangeForm({
        ...emptyMeterChangeForm,
        feederId: context.feeders.find((item) => item.substationId === initialSubstationId)?.id || '',
      })
    }

    void bootstrap()

    return () => {
      active = false
    }
  }, [profile])

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setCurrentTime(new Date())
    }, 30000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [])

  const recordsFingerprint = buildDailyLogFingerprint(records)

  useEffect(() => {
    if (!form.substationId) {
      return undefined
    }

    const timerId = window.setInterval(() => {
      void (async () => {
        await loadDlrRecords({ moduleName: 'daily_log', profile })
        const nextContext = getDailyLogContext(profile)
        const nextFingerprint = buildDailyLogFingerprint(nextContext.records)

        if (nextFingerprint === recordsFingerprint) {
          return
        }

        setFeeders(nextContext.feeders)
        setBatterySets(nextContext.batterySets)
        setTransformers(nextContext.transformers)
        setRecords(nextContext.records)

        if (!isDirty) {
          loadDraft(form.substationId, form.operationalDate, {
            context: nextContext,
            recordId: selectedRecordId || undefined,
          })
          setSyncNotice('Latest daily log data synced from server.')
          return
        }

        setSyncNotice('Remote daily log updates available. Save or reload to sync.')
      })()
    }, 60000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [form.operationalDate, form.substationId, isDirty, loadDraft, profile, recordsFingerprint, selectedRecordId])

  const config = buildDailyLogConfiguration({
    substationId: form.substationId,
    feeders,
    batterySets,
    transformers,
  })
  const derivedState = deriveDailyLogState(form, config)
  const substation = referenceData.substations.find((item) => item.id === form.substationId)
  const carryForwardSnapshot = findCarryForwardSnapshot(
    records,
    form.substationId,
    form.operationalDate,
    feeders,
  )
  const todayIsoDate = formatIsoDate(currentTime)
  const activeHour =
    form.operationalDate === todayIsoDate
      ? `${String(currentTime.getHours()).padStart(2, '0')}:00`
      : ''
  const interruptionDurationMinutes = getDurationBetweenTimes(
    interruptionForm.from_time,
    interruptionForm.to_time,
  )
  const interruptionDurationLabel =
    interruptionDurationMinutes === null
      ? ''
      : formatDurationClock(interruptionDurationMinutes)
  const previewRecord = useMemo(
    () => ({
      substationId: form.substationId,
      substationSnapshot: substation
        ? {
            id: substation.id,
            name: substation.name,
          }
        : null,
      operationalDate: form.operationalDate,
      payload: {
        dayStatus: form.dayStatus,
        shift: form.shift,
        operatorName: form.operatorName,
        inChargeName: form.inChargeName,
        manualRows: form.rows,
        rows: derivedState.resolvedRows,
        interruptions: form.interruptions,
        meterChangeEvents: form.meterChangeEvents,
      },
    }),
    [derivedState.resolvedRows, form, substation],
  )
  const deferredPreviewRecord = useDeferredValue(previewRecord)
  const report = useMemo(
    () =>
      buildDailyLogReport({
        companyProfile: settings.companyProfile,
        substation,
        record: deferredPreviewRecord,
        feeders,
        batterySets,
        transformers,
      }),
    [
      batterySets,
      deferredPreviewRecord,
      feeders,
      settings.companyProfile,
      substation,
      transformers,
    ],
  )
  const analyticsReport = useMemo(
    () =>
      buildDailyLogAnalyticsReport({
        companyProfile: settings.companyProfile,
        substation,
        record: deferredPreviewRecord,
        feeders,
        batterySets,
        transformers,
      }),
    [
      batterySets,
      deferredPreviewRecord,
      feeders,
      settings.companyProfile,
      substation,
      transformers,
    ],
  )
  const operationalSummaryCards = [
    {
      label: 'Carry Forward',
      value: form.carryForwardSource
        ? `${form.carryForwardSource.operationalDate}`
        : 'Previous closing not available',
    },
    {
      label: 'Configured Structure',
      value: `${config.feeders.length} feeders, ${config.batterySets.length} battery sets, ${config.transformers.length} transformers`,
    },
    {
      label: 'Previous Closing Record',
      value: carryForwardSnapshot.record?.operationalDate || '-',
    },
    {
      label: 'Highlighted Hour',
      value: activeHour || 'No live highlight for selected date',
    },
    {
      label: 'Gap Mode',
      value: derivedState.dayStatus === 'finalized' ? 'Auto LS Locked' : 'Pending / Auto Fill',
    },
    ...derivedState.summaryCards,
  ]

  function updateFeederMetric(rowIndex, feederId, metric, value) {
    if (!canWriteCurrentRecord) {
      return
    }

    let carryForwardOverrideWarning = ''
    setIsDirty(true)
    setSyncNotice('Unsaved local changes. Remote auto-sync paused.')

    setForm((current) => {
      const nextRows = current.rows.map((row, currentRowIndex) => {
        if (currentRowIndex !== rowIndex) {
          return row
        }

        const currentReading = row.feederReadings?.[feederId] || {}
        const currentMetadata = currentReading.metadata || {}

        if (
          metric === 'kwh' &&
          rowIndex === 0 &&
          currentMetadata.sourceType === 'carry_forward' &&
          value &&
          value !== currentReading.kwh
        ) {
          carryForwardOverrideWarning =
            '00:00 carry-forward reading override keli aahe. Save karaycha asel tar reading verify kara.'
        }

        return {
          ...row,
          feederReadings: {
            ...row.feederReadings,
            [feederId]: {
              ...currentReading,
              [metric]: value,
              metadata: {
                ...currentMetadata,
                sourceType:
                  metric === 'kwh'
                    ? currentMetadata.entryMode === 'carry_forward' && value === currentReading.kwh
                      ? 'carry_forward'
                      : value
                        ? 'manual'
                        : ''
                    : currentMetadata.sourceType || '',
                ampSourceType:
                  metric === 'amp'
                    ? value
                      ? 'manual'
                      : ''
                    : currentMetadata.ampSourceType || '',
                kvSourceType:
                  metric === 'kv'
                    ? value
                      ? 'manual'
                      : ''
                    : currentMetadata.kvSourceType || '',
                eventCode: '',
                eventOrigin: '',
                interruptionLinkId: '',
                isOverridden: true,
                pendingGap: false,
                entryMode:
                  metric === 'kwh'
                    ? currentMetadata.entryMode === 'carry_forward' && value === currentReading.kwh
                      ? 'carry_forward'
                      : value
                        ? 'actual'
                        : ''
                    : currentMetadata.entryMode,
                source:
                  metric === 'kwh'
                    ? currentMetadata.entryMode === 'carry_forward' && value === currentReading.kwh
                      ? currentMetadata.source
                      : value
                        ? 'manual'
                        : ''
                    : currentMetadata.source || 'manual',
              },
            },
          },
        }
      })

      return {
        ...current,
        dayStatus: 'draft',
        rows: nextRows,
        carryForwardSuppressedCells:
          metric === 'amp' || metric === 'kv'
            ? {
                ...current.carryForwardSuppressedCells,
                [`f:${current.rows[rowIndex]?.hour}:${feederId}:${metric}`]: value === '',
              }
            : current.carryForwardSuppressedCells,
      }
    })

    if (carryForwardOverrideWarning) {
      setStatus(carryForwardOverrideWarning)
    }
  }

  function updateBatteryVoltage(rowIndex, batteryIndex, value) {
    if (!canWriteCurrentRecord) {
      return
    }

    setIsDirty(true)
    setSyncNotice('Unsaved local changes. Remote auto-sync paused.')
    setForm((current) => ({
      ...current,
      dayStatus: 'draft',
      rows: current.rows.map((row, currentRowIndex) =>
        currentRowIndex === rowIndex
          ? {
              ...row,
              batteryVoltages: row.batteryVoltages.map((entry, index) =>
                index === batteryIndex ? value : entry,
              ),
            }
          : row,
      ),
      carryForwardSuppressedCells: {
        ...current.carryForwardSuppressedCells,
        [`b:${current.rows[rowIndex]?.hour}:${batteryIndex}:voltage`]: value === '',
      },
    }))
  }

  function updateTransformerValue(rowIndex, transformerIndex, metric, value) {
    if (!canWriteCurrentRecord) {
      return
    }

    setIsDirty(true)
    setSyncNotice('Unsaved local changes. Remote auto-sync paused.')
    setForm((current) => ({
      ...current,
      dayStatus: 'draft',
      rows: current.rows.map((row, currentRowIndex) => {
        if (currentRowIndex !== rowIndex) {
          return row
        }

        return {
          ...row,
          transformerTaps:
            metric === 'tap'
              ? row.transformerTaps.map((entry, index) =>
                  index === transformerIndex ? value : entry,
                )
              : row.transformerTaps,
          transformerTemperatures:
            metric === 'temperature'
              ? row.transformerTemperatures.map((entry, index) =>
                  index === transformerIndex ? value : entry,
                )
              : row.transformerTemperatures,
        }
      }),
      carryForwardSuppressedCells: {
        ...current.carryForwardSuppressedCells,
        [`t:${current.rows[rowIndex]?.hour}:${transformerIndex}:${metric}`]: value === '',
      },
    }))
  }

  function updateRemark(rowIndex, value) {
    if (!canWriteCurrentRecord) {
      return
    }

    setIsDirty(true)
    setSyncNotice('Unsaved local changes. Remote auto-sync paused.')
    setForm((current) => ({
      ...current,
      dayStatus: 'draft',
      rows: current.rows.map((row, currentRowIndex) =>
        currentRowIndex === rowIndex
          ? {
              ...row,
              remark: value,
            }
          : row,
      ),
    }))
  }

  function addInterruption() {
    if (!canWriteCurrentRecord) {
      setError('Current role sathi daily log interruption update access nahi.')
      setStatus('')
      return
    }

    const normalizedFromTime = normalizeTimeInput(interruptionForm.from_time)
    const normalizedToTime = normalizeTimeInput(interruptionForm.to_time, {
      allowTwentyFour: true,
    })
    const durationMinutes = getDurationBetweenTimes(normalizedFromTime, normalizedToTime)

    if (!interruptionForm.feederId || !normalizedFromTime || !normalizedToTime) {
      setError('Interruption madhye feeder, from time, ani to time required aahet.')
      return
    }

    if (durationMinutes === null) {
      setError('Interruption time 24-hour HH:MM format madhye valid hava ani To Time ha From Time nantar hava.')
      return
    }

    if (
      interruptionForm.scopeType === 'selected_feeders' &&
      !interruptionForm.selectedFeederIds.length
    ) {
      setError('Selected feeders scope sathi kamit-kami ek feeder select kara.')
      return
    }

    setIsDirty(true)
    setSyncNotice('Unsaved local changes. Remote auto-sync paused.')
    setForm((current) => ({
      ...current,
      dayStatus: 'draft',
      interruptions: [
        ...current.interruptions,
        {
          id: `evt-${interruptionForm.event_type}-${interruptionForm.feederId}-${normalizedFromTime}-${normalizedToTime}`,
          ...interruptionForm,
          from_time: normalizedFromTime,
          to_time: normalizedToTime,
          baseFeederId: interruptionForm.feederId,
          feederName:
            config.feeders.find((item) => item.id === interruptionForm.feederId)?.name || '',
          affectedFeederIds: interruptionForm.selectedFeederIds,
          source: 'explicit',
        },
      ],
    }))
    setInterruptionForm({
      ...emptyInterruptionForm,
      feederId: interruptionForm.feederId,
    })
    setError('')
  }

  function toggleInterruptionFeeder(feederId) {
    if (!canWriteCurrentRecord) {
      return
    }

    setInterruptionForm((current) => ({
      ...current,
      selectedFeederIds: current.selectedFeederIds.includes(feederId)
        ? current.selectedFeederIds.filter((item) => item !== feederId)
        : [...current.selectedFeederIds, feederId],
    }))
  }

  function removeInterruption(interruptionId) {
    if (!canWriteCurrentRecord) {
      return
    }

    setIsDirty(true)
    setSyncNotice('Unsaved local changes. Remote auto-sync paused.')
    setForm((current) => ({
      ...current,
      dayStatus: 'draft',
      interruptions: current.interruptions.filter((item) => item.id !== interruptionId),
    }))
  }

  function addMeterChangeEvent() {
    if (!canWriteCurrentRecord) {
      setError('Current role sathi daily log meter change update access nahi.')
      setStatus('')
      return
    }

    const normalizedEffectiveTime = normalizeTimeInput(meterChangeForm.effective_time)

    if (
      !meterChangeForm.feederId ||
      !normalizedEffectiveTime ||
      !String(meterChangeForm.oldMeterLastReading || '').trim() ||
      !String(meterChangeForm.newMeterStartReading || '').trim()
    ) {
      setError('Meter change sathi feeder, effective time, old final reading, ani new meter start reading required aahet.')
      return
    }

    setIsDirty(true)
    setSyncNotice('Unsaved local changes. Remote auto-sync paused.')
    setForm((current) => ({
      ...current,
      dayStatus: 'draft',
      meterChangeEvents: [
        ...current.meterChangeEvents,
        {
          id: `mtr-${meterChangeForm.feederId}-${normalizedEffectiveTime}`,
          ...meterChangeForm,
          effective_time: normalizedEffectiveTime,
          feederName:
            config.feeders.find((item) => item.id === meterChangeForm.feederId)?.name || '',
        },
      ],
    }))
    setMeterChangeForm((current) => ({
      ...emptyMeterChangeForm,
      feederId: current.feederId,
    }))
    setError('')
    setStatus('Meter change event added.')
  }

  function removeMeterChangeEvent(index) {
    if (!canWriteCurrentRecord) {
      return
    }

    setIsDirty(true)
    setSyncNotice('Unsaved local changes. Remote auto-sync paused.')
    setForm((current) => ({
      ...current,
      dayStatus: 'draft',
      meterChangeEvents: current.meterChangeEvents.filter((_, itemIndex) => itemIndex !== index),
    }))
  }

  function markGapAsLs(candidate) {
    if (!canWriteCurrentRecord) {
      return
    }

    setIsDirty(true)
    setSyncNotice('Unsaved local changes. Remote auto-sync paused.')
    const interruption = buildManualLsInterruption(candidate)

    if (!interruption) {
      return
    }

    setForm((current) => ({
      ...current,
      dayStatus: 'draft',
      interruptions: [...current.interruptions, interruption],
    }))
    setStatus(`${candidate.feederName} gap LS mhanun mark zhala.`)
    setError('')
  }

  function recalculateDay() {
    if (!canWriteCurrentRecord) {
      return
    }

    setIsDirty(true)
    setSyncNotice('Unsaved local changes. Remote auto-sync paused.')
    setForm((current) => ({
      ...current,
      dayStatus: 'draft',
    }))
    setStatus('Day recalculated. Pending gaps disat rahatil; unresolved gaps la LS finalize kelela nahi.')
    setError('')
  }

  async function syncNow() {
    const nextContext = await syncCollectionsAsync()

    if (!isDirty) {
      loadDraft(form.substationId, form.operationalDate, {
        context: nextContext,
        recordId: selectedRecordId || undefined,
      })
      setSyncNotice('Daily log synced from server.')
      return
    }

    setSyncNotice('Remote updates loaded in register list. Save or reload to apply them to current draft.')
  }

  async function saveRecord(nextDayStatus = form.dayStatus) {
    if (!canWriteCurrentRecord) {
      setError(
        selectedRecordId
          ? 'Current role sathi daily log edit access nahi.'
          : 'Current role sathi daily log create access nahi.',
      )
      setStatus('')
      return
    }

    try {
      const nextForm = {
        ...form,
        dayStatus: nextDayStatus,
      }

      validateDailyLogInput(nextForm)
      validateDailyLogKwhContinuity(nextForm, config)
      validateDailyLogMeterChanges(nextForm, config)

      const payload = buildDailyLogRecordForSave({
        form: nextForm,
        config,
        profile,
        substation,
      })
      const saved = await saveDlrRecord(
        {
          ...payload,
          id: selectedRecordId || undefined,
        },
        profile,
      )

      const context = await syncCollectionsAsync()
      loadDraft(form.substationId, form.operationalDate, { context, recordId: saved.id })
      setIsDirty(false)
      setSyncNotice('Daily log saved and synced.')
      setStatus(
        nextDayStatus === 'finalized'
          ? 'Day finalized and saved. Unresolved gaps la auto LS interruption madhye convert kele.'
          : 'Daily log saved with carry-forward, interruption, and summary data.',
      )
      setError('')
      alertDetailSaved()
    } catch (saveError) {
      setError(saveError.message)
      setStatus('')
    }
  }

  async function finalizeDay() {
    if (!canWriteCurrentRecord) {
      setError('Current role sathi daily log finalize access nahi.')
      setStatus('')
      return
    }

    await saveRecord('finalized')
  }

  function navigateDate(offsetDays) {
    if (!form.substationId) {
      return
    }

    loadDraft(form.substationId, shiftIsoDate(form.operationalDate, offsetDays))
  }

  async function deleteRecord(recordId) {
    if (!canDeleteDailyLog) {
      setError('Current role sathi daily log delete access nahi.')
      setStatus('')
      return
    }

    await deleteDlrRecord(recordId, profile)
    const context = await syncCollectionsAsync()
    loadDraft(form.substationId, form.operationalDate, { context, recordId: 'new' })
    setIsDirty(false)
    setSyncNotice('Daily log synced after delete.')
    setStatus('Daily log deleted.')
    setError('')
  }

  function scrollToDailyLogReport() {
    document.getElementById('daily-log-report-block')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }

  function triggerDailyLogPrintPdf() {
    scrollToDailyLogReport()
    window.requestAnimationFrame(() => {
      dailyLogPrintActionsRef.current?.querySelector('[data-report-action="print-pdf"]')?.click()
    })
  }

  return (
    <div className="page-stack page-stack-focus page-daily-log daily-log-work-root">
      {showDailyLogGuide ? (
        <section className="content-card content-card-workspace workspace-canvas-card daily-log-guide-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">DLR ERP</p>
              <h2>Daily Log</h2>
            </div>
          </div>
          <p className="muted-copy">
            00:00 carry-forward, grouped feeder hierarchy, interruption overlay, auto LS gap
            detection, and print-ready daily chart are maintained here from one unified data source.
          </p>
        </section>
      ) : null}

      {status ? (
        <section className="callout success-callout">
          <p>{status}</p>
        </section>
      ) : null}
      {error ? (
        <section className="callout danger-callout">
          <p>{error}</p>
        </section>
      ) : null}
      {syncNotice ? (
        <section className="callout">
          <p>{syncNotice}</p>
        </section>
      ) : null}
      {!canCreateDailyLog && !canEditDailyLog && !canDeleteDailyLog ? (
        <section className="callout warning-callout">
          <p>Daily log current role sathi read only mode madhye aahe.</p>
        </section>
      ) : null}
      {form.carryForwardWarning ? (
        <section className="callout warning-callout">
          <p>{form.carryForwardWarning}</p>
        </section>
      ) : null}
      {derivedState.invalidReadings.length ? (
        <section className="callout danger-callout">
          <p>{derivedState.invalidReadings[0].message}</p>
        </section>
      ) : null}

      <section className="content-card report-surface-card daily-log-operation-surface workspace-primary-panel">
        <div className="workspace-focus-toolbar workspace-focus-toolbar-daily-log">
          <div className="workspace-focus-heading">
            <p className="eyebrow">Daily sheet</p>
            <h2>Operational chart entry</h2>
            <span className="workspace-focus-status">
              Status: {derivedState.dayStatus === 'finalized' ? 'Finalized' : 'Live / Draft'} |
              Current hour: {activeHour || 'Not today'}
            </span>
          </div>

          <div className="workspace-focus-controls">
            <label className="workspace-focus-field" htmlFor="daily-log-date">
              <span>Date</span>
              <input
                id="daily-log-date"
                type="date"
                value={form.operationalDate}
                onChange={(event) => loadDraft(form.substationId, event.target.value)}
              />
            </label>

            <label className="workspace-focus-field" htmlFor="daily-log-substation">
              <span>Substation</span>
              <select
                id="daily-log-substation"
                value={form.substationId}
                onChange={(event) => loadDraft(event.target.value, form.operationalDate)}
              >
                <option value="">Select substation</option>
                {referenceData.substations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="workspace-focus-actions">
            <button
              type="button"
              className="ghost-light-button"
              onClick={() => navigateDate(-1)}
              disabled={!form.substationId}
            >
              Previous
            </button>
            <button
              type="button"
              className="ghost-light-button"
              onClick={() => navigateDate(1)}
              disabled={!form.substationId}
            >
              Next
            </button>
            <button
              type="button"
              className="ghost-light-button"
              onClick={recalculateDay}
              disabled={!form.substationId}
            >
              Recalculate
            </button>
            <button
              type="button"
              className="ghost-light-button"
              onClick={() => loadDraft(form.substationId, form.operationalDate)}
              disabled={!form.substationId}
            >
              Reload
            </button>
            <button
              type="button"
              className="ghost-light-button"
              onClick={() => void syncNow()}
              disabled={!form.substationId}
            >
              Sync now
            </button>
            <button
              type="button"
              className="primary-button emphasized-save-button"
              onClick={() => void saveRecord()}
              disabled={!form.substationId || !canWriteCurrentRecord}
            >
              Save Data
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => void finalizeDay()}
              disabled={!form.substationId || !canWriteCurrentRecord}
            >
              Finalize Day
            </button>
            <button
              type="button"
              className="ghost-light-button"
              onClick={() => {
                const nextValue = !showDailyLogKpis
                setShowDailyLogKpis(nextValue)
                setDailyLogKpiVisible(nextValue)
              }}
            >
              {showDailyLogKpis ? 'Hide metrics' : 'Show metrics'}
            </button>
            <button
              type="button"
              className="ghost-light-button"
              onClick={() => setShowDailyLogGuide((current) => !current)}
            >
              {showDailyLogGuide ? 'Hide guide' : 'Guide'}
            </button>
            <button
              type="button"
              className="ghost-light-button"
              onClick={() => {
                setSideDrawerTab('interruptions')
                setSideDrawerOpen(true)
              }}
            >
              Interruptions…
            </button>
            <button type="button" className="ghost-light-button" onClick={() => triggerDailyLogPrintPdf()}>
              Print PDF
            </button>
          </div>
        </div>

        {showDailyLogKpis ? (
          <div className="workspace-kpi-strip daily-log-kpi-strip">
            {operationalSummaryCards.map((item) => (
              <article key={item.label} className="workspace-kpi-card">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </article>
            ))}
          </div>
        ) : null}
        <DailyLogEntryTable
          config={config}
          rows={derivedState.resolvedRows}
          derivedState={derivedState}
          activeHour={activeHour}
          editable={canWriteCurrentRecord}
          onFeederMetricChange={updateFeederMetric}
          onBatteryVoltageChange={updateBatteryVoltage}
          onTransformerValueChange={updateTransformerValue}
          onRemarkChange={updateRemark}
        />
      </section>

      <div
        className={`daily-log-drawer-backdrop ${sideDrawerOpen ? 'is-open' : ''}`}
        onClick={() => setSideDrawerOpen(false)}
        aria-hidden={!sideDrawerOpen}
      />
      <aside
        className={`daily-log-side-drawer ${sideDrawerOpen ? 'is-open' : ''}`}
        aria-hidden={!sideDrawerOpen}
        aria-label="Interruptions, meter changes, and saved records"
      >
        <div className="daily-log-drawer-head">
          <span className="eyebrow" style={{ marginBottom: 0 }}>
            Side entry
          </span>
          <button
            type="button"
            className="ghost-light-button small-button"
            onClick={() => setSideDrawerOpen(false)}
          >
            Close
          </button>
        </div>
        <div className="daily-log-drawer-tabs" role="tablist">
          <button
            type="button"
            className={sideDrawerTab === 'interruptions' ? 'is-active' : ''}
            onClick={() => setSideDrawerTab('interruptions')}
          >
            Interruptions
          </button>
          <button
            type="button"
            className={sideDrawerTab === 'meter' ? 'is-active' : ''}
            onClick={() => setSideDrawerTab('meter')}
          >
            Meter
          </button>
          <button
            type="button"
            className={sideDrawerTab === 'register' ? 'is-active' : ''}
            onClick={() => setSideDrawerTab('register')}
          >
            Register
          </button>
        </div>
        <div className="daily-log-drawer-body">
          {sideDrawerTab === 'interruptions' ? (
            <section className="content-card report-surface-card daily-log-interruption-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Interruptions</p>
            <h2>Explicit event entry and auto LS</h2>
          </div>
        </div>
        <p className="muted-copy">
          Live mode madhye unresolved gap fakt pending rahto. `Finalize Day` nantarach end-of-day unresolved gaps auto LS interruption mhanun insert hotat.
        </p>
        <div className="details-grid">
          <div>
            <label htmlFor="int-feeder">Feeder</label>
            <select
              id="int-feeder"
              value={interruptionForm.feederId}
              disabled={!canWriteCurrentRecord}
              onChange={(event) =>
                setInterruptionForm((current) => ({
                  ...current,
                  feederId: event.target.value,
                }))
              }
            >
              <option value="">Select feeder</option>
              {config.feeders.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="int-scope">Scope</label>
            <select
              id="int-scope"
              value={interruptionForm.scopeType}
              disabled={!canWriteCurrentRecord}
              onChange={(event) =>
                setInterruptionForm((current) => ({
                  ...current,
                  scopeType: event.target.value,
                  selectedFeederIds: [],
                }))
              }
            >
              {DAILY_LOG_EVENT_SCOPE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="int-from">From Time</label>
            <input
              id="int-from"
              type="text"
              inputMode="numeric"
              maxLength={5}
              placeholder="HH:MM"
              value={interruptionForm.from_time}
              disabled={!canWriteCurrentRecord}
              onChange={(event) =>
                setInterruptionForm((current) => ({
                  ...current,
                  from_time: formatTimeInputForEditing(event.target.value),
                }))
              }
              onBlur={(event) =>
                setInterruptionForm((current) => ({
                  ...current,
                  from_time: normalizeTimeInput(event.target.value),
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="int-to">To Time</label>
            <input
              id="int-to"
              type="text"
              inputMode="numeric"
              maxLength={5}
              placeholder="HH:MM"
              value={interruptionForm.to_time}
              disabled={!canWriteCurrentRecord}
              onChange={(event) =>
                setInterruptionForm((current) => ({
                  ...current,
                  to_time: formatTimeInputForEditing(event.target.value),
                }))
              }
              onBlur={(event) =>
                setInterruptionForm((current) => ({
                  ...current,
                  to_time: normalizeTimeInput(event.target.value, {
                    allowTwentyFour: true,
                  }),
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="int-duration">Total Time</label>
            <input
              id="int-duration"
              value={interruptionDurationLabel}
              placeholder="Auto"
              readOnly
            />
            <small className="field-hint">24-hour format: 1230 to 12:30</small>
          </div>
          <div>
            <label htmlFor="int-type">Type</label>
            <select
              id="int-type"
              value={interruptionForm.event_type}
              disabled={!canWriteCurrentRecord}
              onChange={(event) =>
                setInterruptionForm((current) => ({
                  ...current,
                  event_type: event.target.value,
                  scopeType:
                    event.target.value === 'SF' && current.scopeType === 'single_feeder'
                      ? 'selected_feeders'
                      : current.scopeType,
                }))
              }
            >
              {DAILY_LOG_EVENT_TYPES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="int-remark">Remark</label>
            <input
              id="int-remark"
              value={interruptionForm.remark}
              disabled={!canWriteCurrentRecord}
              onChange={(event) =>
                setInterruptionForm((current) => ({
                  ...current,
                  remark: event.target.value,
                }))
              }
            />
          </div>
        </div>
        {interruptionForm.scopeType === 'selected_feeders' ? (
          <div className="daily-log-scope-checklist">
            {config.feeders.map((feeder) => (
              <label key={feeder.id} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={interruptionForm.selectedFeederIds.includes(feeder.id)}
                  disabled={!canWriteCurrentRecord}
                  onChange={() => toggleInterruptionFeeder(feeder.id)}
                />
                {feeder.name}
              </label>
            ))}
          </div>
        ) : null}
        <div className="inline-actions">
          <button
            type="button"
            className="ghost-light-button"
            onClick={addInterruption}
            disabled={!canWriteCurrentRecord}
          >
            Add interruption
          </button>
        </div>
        <div className="table-shell">
          <table className="simple-table">
            <thead>
              <tr>
                <th>Feeder</th>
                <th>Scope</th>
                <th>From</th>
                <th>To</th>
                <th>Duration</th>
                <th>Type</th>
                <th>Source</th>
                <th>Remark</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {derivedState.allInterruptions.map((item) => (
                <tr key={item.id}>
                  <td>{item.feeder_name}</td>
                  <td>{String(item.scopeType || 'single_feeder').replaceAll('_', ' ')}</td>
                  <td>{item.from_time}</td>
                  <td>{item.to_time}</td>
                  <td>{formatDurationClock(item.duration_minutes)}</td>
                  <td>{item.event_type}</td>
                  <td>{item.source === 'auto' ? 'Auto' : 'Manual'}</td>
                  <td>{item.remark || '-'}</td>
                  <td>{item.source === 'auto' ? 'Auto row' : (
                    <button
                      type="button"
                      className="danger-button small-button"
                      onClick={() => removeInterruption(item.id)}
                      disabled={!canWriteCurrentRecord}
                    >
                      Delete
                    </button>
                  )}</td>
                </tr>
              ))}
              {!derivedState.allInterruptions.length ? (
                <tr>
                  <td colSpan={9}>No interruption rows available yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {derivedState.estimationCandidates.length ? (
          <div className="report-legend-grid">
            {derivedState.estimationCandidates.map((candidate) => (
              <div key={`${candidate.feederId}-${candidate.startHour}-${candidate.endHour}`} className="report-legend-item daily-log-gap-card">
                <div>
                  <strong>{candidate.feederName}</strong>
                  <span>
                    {candidate.startHour} to {candidate.endHour} gap auto calculated. Units{' '}
                    {candidate.totalUnits} / {candidate.intervalCount} hours.
                  </span>
                </div>
                <div className="table-actions">
                  <button
                    type="button"
                    className="ghost-light-button small-button"
                    onClick={() => markGapAsLs(candidate)}
                    disabled={!canWriteCurrentRecord}
                  >
                    Mark LS
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>
          ) : null}
          {sideDrawerTab === 'meter' ? (
      <section className="content-card daily-log-meter-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Meter change</p>
            <h2>Meter continuity register</h2>
          </div>
        </div>
        <div className="details-grid">
          <div>
            <label htmlFor="mtr-feeder">Feeder</label>
            <select
              id="mtr-feeder"
              value={meterChangeForm.feederId}
              disabled={!canWriteCurrentRecord}
              onChange={(event) =>
                setMeterChangeForm((current) => ({
                  ...current,
                  feederId: event.target.value,
                }))
              }
            >
              <option value="">Select feeder</option>
              {config.feeders.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="mtr-time">Effective Time</label>
            <input
              id="mtr-time"
              type="text"
              inputMode="numeric"
              maxLength={5}
              placeholder="HH:MM"
              value={meterChangeForm.effective_time}
              disabled={!canWriteCurrentRecord}
              onChange={(event) =>
                setMeterChangeForm((current) => ({
                  ...current,
                  effective_time: formatTimeInputForEditing(event.target.value),
                }))
              }
              onBlur={(event) =>
                setMeterChangeForm((current) => ({
                  ...current,
                  effective_time: normalizeTimeInput(event.target.value),
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="mtr-old">Old Meter Last Reading</label>
            <input
              id="mtr-old"
              type="number"
              inputMode="decimal"
              value={meterChangeForm.oldMeterLastReading}
              disabled={!canWriteCurrentRecord}
              onChange={(event) =>
                setMeterChangeForm((current) => ({
                  ...current,
                  oldMeterLastReading: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="mtr-new">New Meter Start Reading</label>
            <input
              id="mtr-new"
              type="number"
              inputMode="decimal"
              value={meterChangeForm.newMeterStartReading}
              disabled={!canWriteCurrentRecord}
              onChange={(event) =>
                setMeterChangeForm((current) => ({
                  ...current,
                  newMeterStartReading: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="mtr-remark">Remark</label>
            <input
              id="mtr-remark"
              value={meterChangeForm.remark}
              disabled={!canWriteCurrentRecord}
              onChange={(event) =>
                setMeterChangeForm((current) => ({
                  ...current,
                  remark: event.target.value,
                }))
              }
            />
          </div>
        </div>
        <div className="inline-actions">
          <button
            type="button"
            className="ghost-light-button"
            onClick={addMeterChangeEvent}
            disabled={!canWriteCurrentRecord}
          >
            Add meter change
          </button>
        </div>
        <div className="table-shell">
          <table className="simple-table">
            <thead>
              <tr>
                <th>Feeder</th>
                <th>Effective Time</th>
                <th>Old Last</th>
                <th>New Start</th>
                <th>Remark</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {derivedState.meterChangeRows.map((item, index) => (
                <tr key={`${item.feederName}-${item.effectiveTime}-${index}`}>
                  <td>{item.feederName}</td>
                  <td>{item.effectiveTime}</td>
                  <td>{item.oldMeterLastReading}</td>
                  <td>{item.newMeterStartReading}</td>
                  <td>{item.remark}</td>
                  <td>
                    <button
                      type="button"
                      className="danger-button small-button"
                      onClick={() => removeMeterChangeEvent(index)}
                      disabled={!canWriteCurrentRecord}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {!derivedState.meterChangeRows.length ? (
                <tr>
                  <td colSpan={6}>No meter change entries added yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
          ) : null}
          {sideDrawerTab === 'register' ? (
      <section className="content-card daily-log-register-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Saved records</p>
            <h2>Daily log register</h2>
          </div>
        </div>
        <div className="table-shell">
          <table className="simple-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Substation</th>
                <th>Interruptions</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>{record.operationalDate}</td>
                  <td>{record.substationSnapshot?.name || record.substationId}</td>
                  <td>{record.payload?.interruptions?.length || 0}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        type="button"
                        className="ghost-light-button small-button"
                        onClick={() => loadDraft(record.substationId, record.operationalDate, { recordId: record.id })}
                        disabled={!canEditDailyLog}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="danger-button small-button"
                        onClick={() => void deleteRecord(record.id)}
                        disabled={!canDeleteDailyLog}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!records.length ? (
                <tr>
                  <td colSpan={4}>No daily log records yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
          ) : null}
        </div>
      </aside>

      <section
        id="daily-log-report-block"
        className="content-card workspace-secondary-panel daily-log-secondary-panel daily-log-preview-panel"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Unified output</p>
            <h2>Preview / print / PDF / share</h2>
          </div>
        </div>
        <div ref={dailyLogPrintActionsRef}>
          <ReportActions
            documentRef={documentRef}
            filenameBase={`daily-log-${form.operationalDate}-${substation?.name || 'substation'}`}
            orientation={report.orientation}
            pageSize={report.pageSize}
            jsonData={report}
            csvRows={report.exportRows}
            workbookSheets={report.workbookSheets}
          />
        </div>
        <DailyLogReportView
          documentRef={documentRef}
          report={report}
          footerText={settings.companyProfile.reportFooter}
        />
      </section>

      <section className="content-card workspace-secondary-panel daily-log-secondary-panel daily-log-analytics-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">A4 analytics</p>
            <h2>Interruption / units / load report</h2>
          </div>
        </div>
        <p className="muted-copy">
          Finalized interruption blocks, feeder-wise consumption, and load analysis are rendered
          here in one A4-ready office report source for preview, PDF, print, and mobile share.
        </p>
        <ReportActions
          documentRef={analyticsDocumentRef}
          filenameBase={`daily-analysis-${form.operationalDate}-${substation?.name || 'substation'}`}
          orientation={analyticsReport.orientation}
          pageSize={analyticsReport.pageSize}
          jsonData={analyticsReport}
          csvRows={analyticsReport.csvRows}
          workbookSheets={analyticsReport.workbookSheets}
        />
        <DailyLogAnalyticsReportView
          documentRef={analyticsDocumentRef}
          report={analyticsReport}
          footerText={settings.companyProfile.reportFooter}
        />
      </section>
    </div>
  )
}
