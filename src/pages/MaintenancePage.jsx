import { useEffect, useMemo, useRef, useState } from 'react'
import ReportActions from '../components/reporting/ReportActions'
import { MaintenanceReportView } from '../components/reporting/ReportLayouts'
import { useAuth } from '../context/AuthContext'
import { alertDetailSaved } from '../lib/detailSavedAlert'
import { formatIsoDate } from '../lib/dateUtils'
import { validateMaintenanceInput } from '../lib/domainValidation'
import { buildMaintenanceReport } from '../lib/reportData'
import {
  formatDurationClock,
  getDurationBetweenTimes,
  resolveTimeRange,
} from '../lib/timeRange'
import {
  deleteDlrRecord,
  getSettingsBundle,
  listDlrRecords,
  loadDlrRecords,
  loadReferenceData,
  saveDlrRecord,
} from '../lib/unifiedDataService'
import { resolvePreferredSubstationId } from '../lib/uiPreferences'

const todayIso = formatIsoDate(new Date())

export default function MaintenancePage() {
  const { profile, canCreateModule, canDeleteModule } = useAuth()
  const canCreateMaintenance = canCreateModule('maintenance')
  const canDeleteMaintenance = canDeleteModule('maintenance')
  const documentRef = useRef(null)
  const reportActionsRef = useRef(null)
  const [settings, setSettings] = useState(getSettingsBundle())
  const [referenceData, setReferenceData] = useState({
    substations: [],
    employees: [],
  })
  const [records, setRecords] = useState(listDlrRecords({ moduleName: 'maintenance', profile }))
  const [form, setForm] = useState({
    operationalDate: todayIso,
    substationId: '',
    fromTime: '',
    toTime: '',
    workDetail: '',
    remark: '',
  })
  const [filters, setFilters] = useState({
    fromDate: todayIso.slice(0, 8) + '01',
    toDate: todayIso,
    substationId: '',
  })
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function bootstrap() {
      const bundle = await loadReferenceData(profile)
      await loadDlrRecords({ moduleName: 'maintenance', profile })

      if (!active) {
        return
      }

      const firstSubstationId = resolvePreferredSubstationId(bundle.substations)
      setReferenceData(bundle)
      setRecords(listDlrRecords({ moduleName: 'maintenance', profile }))
      setSettings(getSettingsBundle())
      setForm((current) => ({
        ...current,
        substationId: current.substationId || firstSubstationId,
      }))
      setFilters((current) => ({
        ...current,
        substationId: current.substationId || firstSubstationId,
      }))
    }

    void bootstrap()

    return () => {
      active = false
    }
  }, [profile])

  const filteredRecords = useMemo(
    () =>
      records.filter(
        (item) =>
          (!filters.substationId || item.substationId === filters.substationId) &&
          item.operationalDate >= filters.fromDate &&
          item.operationalDate <= filters.toDate,
      ),
    [filters.fromDate, filters.substationId, filters.toDate, records],
  )

  const substation = referenceData.substations.find((item) => item.id === filters.substationId)
  const report = buildMaintenanceReport({
    companyProfile: settings.companyProfile,
    substation,
    records: filteredRecords,
    fromDate: filters.fromDate,
    toDate: filters.toDate,
  })
  const maintenanceDurationMinutes = useMemo(
    () => getDurationBetweenTimes(form.fromTime, form.toTime),
    [form.fromTime, form.toTime],
  )
  const maintenanceDurationLabel =
    maintenanceDurationMinutes === null
      ? ''
      : formatDurationClock(maintenanceDurationMinutes)

  async function saveRecord() {
    if (!canCreateMaintenance) {
      setError('Current role sathi maintenance entry create access nahi.')
      setStatus('')
      return
    }

    try {
      validateMaintenanceInput({
        ...form,
        durationMinutes: maintenanceDurationMinutes,
      })

      await saveDlrRecord(
        {
          moduleName: 'maintenance',
          substationId: form.substationId,
          operationalDate: form.operationalDate,
          payload: {
            time: form.fromTime,
            fromTime: form.fromTime,
            toTime: form.toTime,
            durationMinutes: maintenanceDurationMinutes,
            workDetail: form.workDetail,
            remark: form.remark,
          },
        },
        profile,
      )

      setRecords(await loadDlrRecords({ moduleName: 'maintenance', profile }))
      setStatus('Maintenance entry saved.')
      setError('')
      alertDetailSaved()
      setForm((current) => ({
        ...current,
        fromTime: '',
        toTime: '',
        workDetail: '',
        remark: '',
      }))
    } catch (saveError) {
      setError(saveError.message)
      setStatus('')
    }
  }

  async function deleteRecord(recordId) {
    if (!canDeleteMaintenance) {
      setError('Current role sathi maintenance entry delete access nahi.')
      setStatus('')
      return
    }

    await deleteDlrRecord(recordId, profile)
    setRecords(await loadDlrRecords({ moduleName: 'maintenance', profile }))
  }

  function loadPreviousDayEntry() {
    const latest = records.find((item) => item.substationId === form.substationId)

    if (!latest) {
      setError('Previous maintenance entry available nahi.')
      setStatus('')
      return
    }

    const timeRange = resolveTimeRange(latest.payload || {})

    setForm((current) => ({
      ...current,
      fromTime: timeRange.fromTime || current.fromTime,
      toTime: timeRange.toTime || current.toTime,
      workDetail: latest.payload?.workDetail || current.workDetail,
      remark: latest.payload?.remark || current.remark,
    }))
    setStatus('Previous maintenance entry copied for quick follow-up.')
    setError('')
  }

  function triggerReportAction(actionName) {
    document.getElementById('maintenance-report-block')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })

    window.requestAnimationFrame(() => {
      reportActionsRef.current?.querySelector(`[data-report-action="${actionName}"]`)?.click()
    })
  }

  return (
    <div className="page-stack page-stack-focus page-maintenance">
      <section className="content-card content-card-workspace workspace-canvas-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">DLR ERP</p>
            <h2>Maintenance Register</h2>
          </div>
        </div>
        <p className="muted-copy">
          Maintenance entries stay chronological here and feed the formal maintenance register report.
        </p>
      </section>

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
      {!canCreateMaintenance && !canDeleteMaintenance ? (
        <section className="callout warning-callout">
          <p>Maintenance register current role sathi read only mode madhye aahe.</p>
        </section>
      ) : null}

      <section className="workspace-focus-toolbar dlr-quick-toolbar">
        <div className="workspace-focus-heading">
          <p className="eyebrow">Field workflow</p>
          <h2>Maintenance quick entry</h2>
          <span className="workspace-focus-status">
            Copy latest work detail, save from the top bar, and jump straight to PDF/export actions.
          </span>
        </div>
        <div className="workspace-focus-controls">
          <label className="workspace-focus-field" htmlFor="maintenance-date-toolbar">
            <span>Date</span>
            <input
              id="maintenance-date-toolbar"
              type="date"
              value={form.operationalDate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  operationalDate: event.target.value,
                }))
              }
            />
          </label>
          <label className="workspace-focus-field" htmlFor="maintenance-substation-toolbar">
            <span>Substation</span>
            <select
              id="maintenance-substation-toolbar"
              value={form.substationId}
              onChange={(event) =>
                setForm((current) => ({
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
          </label>
        </div>
        <div className="workspace-focus-actions">
          <button
            type="button"
            className="primary-button"
            onClick={saveRecord}
            disabled={!canCreateMaintenance}
          >
            Save Entry
          </button>
          <button
            type="button"
            className="ghost-light-button"
            onClick={loadPreviousDayEntry}
            disabled={!form.substationId || !canCreateMaintenance}
          >
            Carry Forward
          </button>
          <button
            type="button"
            className="ghost-light-button"
            onClick={() => triggerReportAction('preview-pdf')}
          >
            Preview
          </button>
          <button
            type="button"
            className="ghost-light-button"
            onClick={() => triggerReportAction('save-pdf')}
          >
            Save PDF
          </button>
          <button
            type="button"
            className="ghost-light-button"
            onClick={() => triggerReportAction('share-pdf')}
          >
            Share
          </button>
          <button
            type="button"
            className="ghost-light-button"
            onClick={() => triggerReportAction('export-excel')}
          >
            Excel
          </button>
        </div>
      </section>

      <section className="content-card workspace-toolbar-card workspace-primary-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Entry</p>
            <h2>Maintenance log entry</h2>
          </div>
        </div>
        <div className="details-grid dlr-entry-grid">
          <div>
            <label htmlFor="maintenance-date">Date</label>
            <input
              id="maintenance-date"
              type="date"
              value={form.operationalDate}
              disabled={!canCreateMaintenance}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  operationalDate: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="maintenance-substation">Substation</label>
            <select
              id="maintenance-substation"
              value={form.substationId}
              disabled={!canCreateMaintenance}
              onChange={(event) =>
                setForm((current) => ({
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
            <label htmlFor="maintenance-time">From Time</label>
            <input
              id="maintenance-time"
              type="time"
              value={form.fromTime}
              disabled={!canCreateMaintenance}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  fromTime: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="maintenance-to-time">To Time</label>
            <input
              id="maintenance-to-time"
              type="time"
              value={form.toTime}
              disabled={!canCreateMaintenance}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  toTime: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="maintenance-duration">Duration</label>
            <input
              id="maintenance-duration"
              value={maintenanceDurationLabel}
              disabled
              readOnly
            />
          </div>
          <div>
            <label htmlFor="maintenance-work">Work Detail</label>
            <input
              id="maintenance-work"
              value={form.workDetail}
              disabled={!canCreateMaintenance}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  workDetail: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="maintenance-remark">Remark</label>
            <input
              id="maintenance-remark"
              value={form.remark}
              disabled={!canCreateMaintenance}
              onChange={(event) =>
                setForm((current) => ({
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
            className="primary-button"
            onClick={saveRecord}
            disabled={!canCreateMaintenance}
          >
            Save maintenance entry
          </button>
        </div>
      </section>

      <section className="content-card workspace-secondary-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recent records</p>
            <h2>Latest maintenance notes</h2>
          </div>
        </div>
        <div className="dlr-recent-list">
          {records.slice(0, 4).map((record) => (
            <article key={record.id} className="dlr-recent-card">
              <strong>{record.payload?.workDetail || 'Maintenance entry'}</strong>
              <span>
                {record.operationalDate} | {resolveTimeRange(record.payload || {}).fromTime || '-'} - {resolveTimeRange(record.payload || {}).toTime || '-'}
              </span>
              <small>{record.payload?.remark || 'No remark'}</small>
            </article>
          ))}
          {!records.length ? <p className="muted-copy">No maintenance records yet.</p> : null}
        </div>
      </section>

      <section className="content-card report-surface-card workspace-secondary-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Report filter</p>
            <h2>Date range</h2>
          </div>
        </div>
        <div className="details-grid">
          <div>
            <label htmlFor="maintenance-filter-from">From</label>
            <input
              id="maintenance-filter-from"
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
          <div>
            <label htmlFor="maintenance-filter-to">To</label>
            <input
              id="maintenance-filter-to"
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
          <div>
            <label htmlFor="maintenance-filter-substation">Substation</label>
            <select
              id="maintenance-filter-substation"
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

      <section className="content-card workspace-secondary-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Filtered rows</p>
            <h2>Maintenance entries</h2>
          </div>
        </div>
        <div className="table-shell">
          <table className="simple-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Substation</th>
                <th>From</th>
                <th>To</th>
                <th>Duration</th>
                <th>Work Detail</th>
                <th>Remark</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((record) => (
                <tr key={record.id}>
                  <td>{record.operationalDate}</td>
                  <td>
                    {referenceData.substations.find((item) => item.id === record.substationId)?.name ||
                      record.substationId}
                  </td>
                  <td>{resolveTimeRange(record.payload || {}).fromTime || '-'}</td>
                  <td>{resolveTimeRange(record.payload || {}).toTime || '-'}</td>
                  <td>{resolveTimeRange(record.payload || {}).durationLabel}</td>
                  <td>{record.payload?.workDetail || '-'}</td>
                  <td>{record.payload?.remark || '-'}</td>
                  <td>
                    <button
                      type="button"
                      className="danger-button small-button"
                      onClick={() => deleteRecord(record.id)}
                      disabled={!canDeleteMaintenance}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {!filteredRecords.length ? (
                <tr>
                  <td colSpan={8}>No maintenance entries in this range.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section
        id="maintenance-report-block"
        className="content-card workspace-secondary-panel"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Unified output</p>
            <h2>Maintenance preview / print / PDF / share</h2>
          </div>
        </div>
        <div ref={reportActionsRef}>
          <ReportActions
            documentRef={documentRef}
            filenameBase={`maintenance-${filters.fromDate}-${filters.toDate}-${substation?.name || 'substation'}`}
            orientation={report.orientation}
            jsonData={report}
            csvRows={report.rows}
            workbookSheets={[{ name: report.title, rows: report.rows }]}
          />
        </div>
        <MaintenanceReportView
          documentRef={documentRef}
          report={report}
          footerText={settings.companyProfile.reportFooter}
        />
      </section>
    </div>
  )
}
