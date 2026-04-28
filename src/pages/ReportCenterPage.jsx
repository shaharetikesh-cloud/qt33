import { useEffect, useMemo, useRef, useState } from 'react'
import ReportActions from '../components/reporting/ReportActions'
import { GenericMonthlyReportView } from '../components/reporting/ReportLayouts'
import { useAuth } from '../context/AuthContext'
import { toMonthKey } from '../lib/dateUtils'
import { buildMonthlyReports } from '../lib/reportData'
import {
  getSettingsBundle,
  listDlrRecords,
  listMasterRecords,
  loadDlrRecords,
  loadReferenceData,
} from '../lib/unifiedDataService'
import {
  getReportPreviewLayout,
  resolvePreferredSubstationId,
  setReportPreviewLayout,
} from '../lib/uiPreferences'

function isWithinDateRange(isoDate, fromDate, toDate) {
  if (!isoDate) return false
  const value = String(isoDate).slice(0, 10)
  const from = String(fromDate || '').slice(0, 10)
  const to = String(toDate || '').slice(0, 10)
  if (!from || !to) return true
  return value >= from && value <= to
}

const reportOptions = [
  { value: 'monthlyConsumption', label: 'Monthly Consumption' },
  { value: 'dailyMinMaxSummary', label: 'Daily Min/Max Summary' },
  { value: 'monthlyMinMax', label: 'Monthly Min/Max' },
  { value: 'monthlyInterruption', label: 'Monthly Interruption' },
  { value: 'monthlyEnergyBalance', label: 'Monthly Energy Balance / Loss' },
  { value: 'feederLoadTrend', label: 'Feeder Load Trend' },
  { value: 'abnormalConsumption', label: 'Abnormal Consumption' },
  { value: 'eventImpact', label: 'Event Impact' },
  { value: 'dataCompleteness', label: 'Data Completeness' },
  { value: 'mainIncReconciliation', label: 'Main INC vs Child Reconciliation' },
]

export default function ReportCenterPage() {
  const { profile } = useAuth()
  const documentRef = useRef(null)
  const [settings, setSettings] = useState(getSettingsBundle())
  const [referenceData, setReferenceData] = useState({
    substations: [],
    employees: [],
  })
  const [feeders, setFeeders] = useState(listMasterRecords('feeders', { profile }))
  const [filters, setFilters] = useState({
    periodMode: 'month',
    monthKey: toMonthKey(),
    fromDate: `${toMonthKey()}-01`,
    toDate: new Date().toISOString().slice(0, 10),
    substationId: '',
    reportKey: 'monthlyConsumption',
  })
  const [previewLayout, setPreviewLayoutState] = useState(() => getReportPreviewLayout('print'))
  const [recordsVersion, setRecordsVersion] = useState(0)

  function setPreviewLayout(next) {
    setPreviewLayoutState(next)
    setReportPreviewLayout(next)
  }

  useEffect(() => {
    let active = true

    async function bootstrap() {
      const bundle = await loadReferenceData(profile)

      if (!active) {
        return
      }

      setReferenceData(bundle)
      setFeeders(listMasterRecords('feeders', { profile }))
      setSettings(getSettingsBundle())
      setFilters((current) => ({
        ...current,
        substationId: resolvePreferredSubstationId(bundle.substations, current.substationId),
      }))
    }

    void bootstrap()

    return () => {
      active = false
    }
  }, [profile])

  useEffect(() => {
    let active = true

    async function syncRecords() {
      const wantsRange = filters.periodMode === 'range'
      await Promise.all(
        [
          loadDlrRecords({
            moduleName: 'daily_log',
            substationId: filters.substationId,
            monthKey: wantsRange ? undefined : filters.monthKey,
            profile,
          }),
          // History (no monthKey) for range and for derived comparisons
          loadDlrRecords({
            moduleName: 'daily_log',
            substationId: filters.substationId,
            profile,
          }),
          loadDlrRecords({
            moduleName: 'fault',
            substationId: filters.substationId,
            monthKey: wantsRange ? undefined : filters.monthKey,
            profile,
          }),
          loadDlrRecords({
            moduleName: 'maintenance',
            substationId: filters.substationId,
            monthKey: wantsRange ? undefined : filters.monthKey,
            profile,
          }),
        ].filter(Boolean),
      )

      if (active) {
        setRecordsVersion((current) => current + 1)
      }
    }

    void syncRecords()

    return () => {
      active = false
    }
  }, [filters.monthKey, filters.periodMode, filters.substationId, profile])

  const substation = referenceData.substations.find((item) => item.id === filters.substationId)

  const monthlyReports = useMemo(() => {
    void recordsVersion

    const wantsRange = filters.periodMode === 'range'
    const effectiveMonthKey = wantsRange
      ? String(filters.fromDate || filters.toDate || filters.monthKey || toMonthKey()).slice(0, 7)
      : filters.monthKey

    const rawDailyLogRecords = listDlrRecords({
      moduleName: 'daily_log',
      substationId: filters.substationId,
      monthKey: wantsRange ? undefined : filters.monthKey,
      profile,
    })
    const rawDailyLogHistoryRecords = listDlrRecords({
      moduleName: 'daily_log',
      substationId: filters.substationId,
      profile,
    })
    const rawFaultRecords = listDlrRecords({
      moduleName: 'fault',
      substationId: filters.substationId,
      monthKey: wantsRange ? undefined : filters.monthKey,
      profile,
    })
    const rawMaintenanceRecords = listDlrRecords({
      moduleName: 'maintenance',
      substationId: filters.substationId,
      monthKey: wantsRange ? undefined : filters.monthKey,
      profile,
    })

    const dailyLogRecords = wantsRange
      ? rawDailyLogRecords.filter((row) => isWithinDateRange(row.operationalDate, filters.fromDate, filters.toDate))
      : rawDailyLogRecords
    const dailyLogHistoryRecords = wantsRange
      ? rawDailyLogHistoryRecords.filter((row) =>
          isWithinDateRange(row.operationalDate, filters.fromDate, filters.toDate),
        )
      : rawDailyLogHistoryRecords
    const faultRecords = wantsRange
      ? rawFaultRecords.filter((row) => isWithinDateRange(row.operationalDate, filters.fromDate, filters.toDate))
      : rawFaultRecords
    const maintenanceRecords = wantsRange
      ? rawMaintenanceRecords.filter((row) =>
          isWithinDateRange(row.operationalDate, filters.fromDate, filters.toDate),
        )
      : rawMaintenanceRecords

    return buildMonthlyReports({
      monthKey: effectiveMonthKey,
      substation,
      companyProfile: settings.companyProfile,
      feeders: feeders.filter((item) => item.substationId === filters.substationId),
      dailyLogRecords,
      dailyLogHistoryRecords,
      faultRecords,
      maintenanceRecords,
    })
  }, [
    feeders,
    filters.fromDate,
    filters.monthKey,
    filters.periodMode,
    filters.substationId,
    filters.toDate,
    recordsVersion,
    settings.companyProfile,
    substation,
    profile,
  ])

  const activeReport = monthlyReports[filters.reportKey]

  const previewLayoutClass =
    previewLayout === 'wide' ? 'report-preview-layout-wide' : 'report-preview-layout-print'

  return (
    <div className={`page-stack page-stack-report page-report-center ${previewLayoutClass}`}>
      <section className="content-card workspace-toolbar-card report-filters-panel workspace-controls-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">DLR ERP</p>
            <h2>Report Center</h2>
          </div>
          <div className="report-preview-layout-toggle">
            <span className="muted-copy" style={{ marginRight: 8, fontSize: '0.78rem' }}>
              Preview
            </span>
            <button
              type="button"
              className={previewLayout === 'wide' ? 'primary-button small-button' : 'ghost-light-button small-button'}
              onClick={() => setPreviewLayout('wide')}
            >
              Full width
            </button>
            <button
              type="button"
              className={previewLayout === 'print' ? 'primary-button small-button' : 'ghost-light-button small-button'}
              onClick={() => setPreviewLayout('print')}
            >
              Print view
            </button>
          </div>
        </div>
        <p className="muted-copy">
          Monthly reports are derived from saved daily log, fault, and maintenance records using the shared feeder master.
        </p>
        <div className="details-grid">
          <div>
            <label htmlFor="report-center-period">Period</label>
            <select
              id="report-center-period"
              value={filters.periodMode}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  periodMode: event.target.value === 'range' ? 'range' : 'month',
                }))
              }
            >
              <option value="month">Monthly</option>
              <option value="range">Custom date range</option>
            </select>
          </div>
          <div>
            <label htmlFor="report-center-month">Month</label>
            <input
              id="report-center-month"
              type="month"
              value={filters.monthKey}
              disabled={filters.periodMode === 'range'}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  monthKey: event.target.value,
                }))
              }
            />
          </div>
          {filters.periodMode === 'range' ? (
            <div>
              <label htmlFor="report-center-from">From</label>
              <input
                id="report-center-from"
                type="date"
                value={filters.fromDate}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    fromDate: event.target.value,
                  }))
                }
              />
            </div>
          ) : null}
          {filters.periodMode === 'range' ? (
            <div>
              <label htmlFor="report-center-to">To</label>
              <input
                id="report-center-to"
                type="date"
                value={filters.toDate}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    toDate: event.target.value,
                  }))
                }
              />
            </div>
          ) : null}
          <div>
            <label htmlFor="report-center-substation">Substation</label>
            <select
              id="report-center-substation"
              value={filters.substationId}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  substationId: event.target.value,
                }))
              }
            >
              <option value="">Select substation</option>
              {referenceData.substations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="report-center-type">Report Type</label>
            <select
              id="report-center-type"
              value={filters.reportKey}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  reportKey: event.target.value,
                }))
              }
            >
              {reportOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {activeReport ? (
        <section className="content-card report-surface-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Unified output</p>
              <h2>Preview / Print / PDF / Share</h2>
            </div>
          </div>
          <ReportActions
            documentRef={documentRef}
            filenameBase={`${filters.reportKey}-${filters.monthKey}-${substation?.name || 'substation'}`}
            orientation={activeReport.orientation}
            pageSize={activeReport.pageSize}
            jsonData={activeReport}
            csvRows={activeReport.rows}
            workbookSheets={
              activeReport.tables?.length
                ? activeReport.tables.map((table) => ({
                    name: table.title || activeReport.title,
                    rows: table.rows,
                  }))
                : [{ name: activeReport.title, rows: activeReport.rows }]
            }
          />
          <GenericMonthlyReportView
            documentRef={documentRef}
            report={activeReport}
            footerText={settings.companyProfile.reportFooter}
          />
        </section>
      ) : null}
    </div>
  )
}
