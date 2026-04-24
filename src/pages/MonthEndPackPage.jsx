import { useEffect, useMemo, useRef, useState } from 'react'
import ReportActions from '../components/reporting/ReportActions'
import { MonthEndPackReportView } from '../components/reporting/ReportLayouts'
import { useAuth } from '../context/AuthContext'
import { toMonthKey } from '../lib/dateUtils'
import {
  buildMonthEndPackSections,
  buildMonthlyReports,
} from '../lib/reportData'
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

export default function MonthEndPackPage() {
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

  const sections = buildMonthEndPackSections(monthlyReports)
  const report = {
    title: 'Month-End Pack',
    rows: sections.flatMap((section) =>
      (section.tables?.length
        ? section.tables.flatMap((table) =>
            table.rows.map((row) => ({
              section: section.title,
              table: table.title || section.title,
              ...row,
            })),
          )
        : section.rows.map((row) => ({
            section: section.title,
            ...row,
          }))),
    ),
    orientation: 'landscape',
    pageSize: 'a4',
  }

  const previewLayoutClass =
    previewLayout === 'wide' ? 'report-preview-layout-wide' : 'report-preview-layout-print'

  return (
    <div className={`page-stack page-stack-report page-month-end-pack ${previewLayoutClass}`}>
      <section className="content-card workspace-toolbar-card month-end-filters-panel workspace-controls-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">DLR ERP</p>
            <h2>One Click Month-End Pack</h2>
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
          All required monthly sections are combined here with page breaks, repeated section headers,
          PDF export, workbook export, and share-ready output.
        </p>
        <div className="details-grid">
          <div>
            <label htmlFor="month-end-month">Month</label>
            <input
              id="month-end-month"
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
            <label htmlFor="month-end-substation">Substation</label>
            <select
              id="month-end-substation"
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
        </div>
      </section>

      <section className="content-card report-surface-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Unified output</p>
            <h2>Pack preview / print / PDF / share / workbook</h2>
          </div>
        </div>
        <ReportActions
          documentRef={documentRef}
          filenameBase={`month-end-pack-${filters.monthKey}-${substation?.name || 'substation'}`}
          orientation={report.orientation}
          pageSize={report.pageSize}
          jsonData={sections}
          csvRows={report.rows}
          workbookSheets={sections.flatMap((section) =>
            section.tables?.length
              ? section.tables.map((table) => ({
                  name: table.title || section.title,
                  rows: table.rows,
                }))
              : [
                  {
                    name: section.title,
                    rows: section.rows,
                  },
                ],
          )}
        />
        <MonthEndPackReportView
          documentRef={documentRef}
          sections={sections}
          companyProfile={settings.companyProfile}
          footerText={settings.companyProfile.reportFooter}
        />
      </section>
    </div>
  )
}
