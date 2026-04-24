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
    monthKey: toMonthKey(),
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
      await Promise.all([
        loadDlrRecords({
          moduleName: 'daily_log',
          substationId: filters.substationId,
          monthKey: filters.monthKey,
          profile,
        }),
        loadDlrRecords({
          moduleName: 'daily_log',
          substationId: filters.substationId,
          profile,
        }),
        loadDlrRecords({
          moduleName: 'fault',
          substationId: filters.substationId,
          monthKey: filters.monthKey,
          profile,
        }),
        loadDlrRecords({
          moduleName: 'maintenance',
          substationId: filters.substationId,
          monthKey: filters.monthKey,
          profile,
        }),
      ])

      if (active) {
        setRecordsVersion((current) => current + 1)
      }
    }

    void syncRecords()

    return () => {
      active = false
    }
  }, [filters.monthKey, filters.substationId, profile])

  const substation = referenceData.substations.find((item) => item.id === filters.substationId)

  const monthlyReports = useMemo(() => {
    void recordsVersion

    const dailyLogRecords = listDlrRecords({
      moduleName: 'daily_log',
      substationId: filters.substationId,
      monthKey: filters.monthKey,
      profile,
    })
    const dailyLogHistoryRecords = listDlrRecords({
      moduleName: 'daily_log',
      substationId: filters.substationId,
      profile,
    })
    const faultRecords = listDlrRecords({
      moduleName: 'fault',
      substationId: filters.substationId,
      monthKey: filters.monthKey,
      profile,
    })
    const maintenanceRecords = listDlrRecords({
      moduleName: 'maintenance',
      substationId: filters.substationId,
      monthKey: filters.monthKey,
      profile,
    })

    return buildMonthlyReports({
      monthKey: filters.monthKey,
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
    filters.monthKey,
    filters.substationId,
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
            <label htmlFor="report-center-month">Month</label>
            <input
              id="report-center-month"
              type="month"
              value={filters.monthKey}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  monthKey: event.target.value,
                }))
              }
            />
          </div>
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
