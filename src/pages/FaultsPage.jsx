import { useEffect, useMemo, useRef, useState } from 'react'
import ReportActions from '../components/reporting/ReportActions'
import { FaultReportView } from '../components/reporting/ReportLayouts'
import { useAuth } from '../context/AuthContext'
import { alertDetailSaved } from '../lib/detailSavedAlert'
import { formatIsoDate } from '../lib/dateUtils'
import { validateFaultInput } from '../lib/domainValidation'
import { buildFaultReport } from '../lib/reportData'
import {
  formatDurationClock,
  getDurationBetweenTimes,
  resolveTimeRange,
} from '../lib/timeRange'
import {
  deleteDlrRecord,
  getSettingsBundle,
  listDlrRecords,
  listMasterRecords,
  loadDlrRecords,
  loadReferenceData,
  saveDlrRecord,
} from '../lib/unifiedDataService'
import { resolvePreferredSubstationId } from '../lib/uiPreferences'

const blankForm = {
  operationalDate: formatIsoDate(new Date()),
  substationId: '',
  fromTime: '',
  toTime: '',
  feederId: '',
  faultType: '',
  cause: '',
  remark: '',
}

const faultTypePresets = ['LS', 'SD', 'OC', 'EF', 'BD', 'Tripping']

export default function FaultsPage() {
  const { profile, canCreateModule, canDeleteModule } = useAuth()
  const canCreateFaults = canCreateModule('faults')
  const canDeleteFaults = canDeleteModule('faults')
  const documentRef = useRef(null)
  const reportActionsRef = useRef(null)
  const [settings, setSettings] = useState(getSettingsBundle())
  const [referenceData, setReferenceData] = useState({
    substations: [],
    employees: [],
  })
  const [feeders, setFeeders] = useState(listMasterRecords('feeders', { profile }))
  const [records, setRecords] = useState(listDlrRecords({ moduleName: 'fault', profile }))
  const [form, setForm] = useState(blankForm)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function bootstrap() {
      const bundle = await loadReferenceData(profile)
      await loadDlrRecords({ moduleName: 'fault', profile })

      if (!active) {
        return
      }

      setReferenceData(bundle)
      setFeeders(listMasterRecords('feeders', { profile }))
      setRecords(listDlrRecords({ moduleName: 'fault', profile }))
      setSettings(getSettingsBundle())
      setForm((current) => ({
        ...current,
        substationId: resolvePreferredSubstationId(bundle.substations, current.substationId),
      }))
    }

    void bootstrap()

    return () => {
      active = false
    }
  }, [profile])

  const filteredFeeders = feeders.filter((item) => item.substationId === form.substationId)
  const substation = referenceData.substations.find((item) => item.id === form.substationId)
  const filteredRecords = useMemo(
    () =>
      records.filter(
        (item) =>
          item.substationId === form.substationId &&
          item.operationalDate === form.operationalDate,
      ),
    [form.operationalDate, form.substationId, records],
  )

  const report = buildFaultReport({
    companyProfile: settings.companyProfile,
    substation,
    records: filteredRecords,
    feeders,
    filterDate: form.operationalDate,
  })
  const faultDurationMinutes = useMemo(
    () => getDurationBetweenTimes(form.fromTime, form.toTime),
    [form.fromTime, form.toTime],
  )
  const faultDurationLabel =
    faultDurationMinutes === null ? '' : formatDurationClock(faultDurationMinutes)

  async function saveFault() {
    if (!canCreateFaults) {
      setError('Current role sathi fault entry create access nahi.')
      setStatus('')
      return
    }

    try {
      validateFaultInput({
        ...form,
        durationMinutes: faultDurationMinutes,
      })

      await saveDlrRecord(
        {
          moduleName: 'fault',
          substationId: form.substationId,
          operationalDate: form.operationalDate,
          payload: {
            time: form.fromTime,
            fromTime: form.fromTime,
            toTime: form.toTime,
            feederId: form.feederId,
            faultType: form.faultType,
            cause: form.cause,
            durationMinutes: faultDurationMinutes,
            remark: form.remark,
          },
        },
        profile,
      )

      setRecords(await loadDlrRecords({ moduleName: 'fault', profile }))
      setStatus('Fault entry saved.')
      setError('')
      alertDetailSaved()
      setForm((current) => ({
        ...blankForm,
        operationalDate: current.operationalDate,
        substationId: current.substationId,
      }))
    } catch (saveError) {
      setError(saveError.message)
      setStatus('')
    }
  }

  function applyLatestFaultTemplate() {
    const latest = records.find((item) => item.substationId === form.substationId)

    if (!latest) {
      setError('Latest fault template available nahi.')
      setStatus('')
      return
    }

    const timeRange = resolveTimeRange(latest.payload || {})

    setForm((current) => ({
      ...current,
      fromTime: timeRange.fromTime || current.fromTime,
      toTime: timeRange.toTime || current.toTime,
      feederId: latest.payload?.feederId || current.feederId,
      faultType: latest.payload?.faultType || current.faultType,
      cause: latest.payload?.cause || current.cause,
      remark: latest.payload?.remark || current.remark,
    }))
    setStatus('Latest fault template loaded for faster entry.')
    setError('')
  }

  function triggerReportAction(actionName) {
    document.getElementById('fault-report-block')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })

    window.requestAnimationFrame(() => {
      reportActionsRef.current?.querySelector(`[data-report-action="${actionName}"]`)?.click()
    })
  }

  async function deleteRecord(recordId) {
    if (!canDeleteFaults) {
      setError('Current role sathi fault entry delete access nahi.')
      setStatus('')
      return
    }

    await deleteDlrRecord(recordId, profile)
    setRecords(await loadDlrRecords({ moduleName: 'fault', profile }))
  }

  return (
    <div className="page-stack page-stack-focus page-faults">
      <section className="content-card content-card-workspace workspace-canvas-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">DLR ERP</p>
            <h2>Fault Register</h2>
          </div>
        </div>
        <p className="muted-copy">
          Fault rows saved here feed the daily fault report and the monthly interruption summary.
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
      {!canCreateFaults && !canDeleteFaults ? (
        <section className="callout warning-callout">
          <p>Fault register current role sathi read only mode madhye aahe.</p>
        </section>
      ) : null}

      <section className="workspace-focus-toolbar dlr-quick-toolbar">
        <div className="workspace-focus-heading">
          <p className="eyebrow">Field entry</p>
          <h2>Fault quick register</h2>
          <span className="workspace-focus-status">
            Recent feeder faults, quick type chips, and one-tap report actions for operators.
          </span>
        </div>
        <div className="workspace-focus-controls">
          <label className="workspace-focus-field" htmlFor="fault-date-toolbar">
            <span>Date</span>
            <input
              id="fault-date-toolbar"
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
          <label className="workspace-focus-field" htmlFor="fault-substation-toolbar">
            <span>Substation</span>
            <select
              id="fault-substation-toolbar"
              value={form.substationId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  substationId: event.target.value,
                  feederId: '',
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
            onClick={saveFault}
            disabled={!canCreateFaults}
          >
            Save Fault
          </button>
          <button
            type="button"
            className="ghost-light-button"
            onClick={applyLatestFaultTemplate}
            disabled={!form.substationId || !canCreateFaults}
          >
            Load Latest
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

      <section className="content-card report-surface-card workspace-primary-panel">
        <div className="details-grid dlr-entry-grid">
          <div>
            <label htmlFor="fault-date">Date</label>
            <input
              id="fault-date"
              type="date"
              value={form.operationalDate}
              disabled={!canCreateFaults}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  operationalDate: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="fault-substation">Substation</label>
            <select
              id="fault-substation"
              value={form.substationId}
              disabled={!canCreateFaults}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  substationId: event.target.value,
                  feederId: '',
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
            <label htmlFor="fault-time">From Time</label>
            <input
              id="fault-time"
              type="time"
              value={form.fromTime}
              disabled={!canCreateFaults}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  fromTime: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="fault-to-time">To Time</label>
            <input
              id="fault-to-time"
              type="time"
              value={form.toTime}
              disabled={!canCreateFaults}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  toTime: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="fault-feeder">Feeder</label>
            <select
              id="fault-feeder"
              value={form.feederId}
              disabled={!canCreateFaults}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  feederId: event.target.value,
                }))
              }
            >
              <option value="">Select feeder</option>
              {filteredFeeders.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fault-type">Fault Type</label>
            <input
              id="fault-type"
              value={form.faultType}
              disabled={!canCreateFaults}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  faultType: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="fault-cause">Cause</label>
            <input
              id="fault-cause"
              value={form.cause}
              disabled={!canCreateFaults}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  cause: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="fault-duration">Duration</label>
            <input
              id="fault-duration"
              value={faultDurationLabel}
              disabled
              readOnly
            />
          </div>
          <div>
            <label htmlFor="fault-remark">Remark</label>
            <input
              id="fault-remark"
              value={form.remark}
              disabled={!canCreateFaults}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  remark: event.target.value,
                }))
              }
            />
          </div>
        </div>
        <div className="dlr-helper-strip">
          {faultTypePresets.map((item) => (
            <button
              key={item}
              type="button"
              className="ghost-light-button small-button"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  faultType: item,
                }))
              }
              disabled={!canCreateFaults}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="inline-actions">
          <button
            type="button"
            className="primary-button"
            onClick={saveFault}
            disabled={!canCreateFaults}
          >
            Save fault entry
          </button>
        </div>
      </section>

      <section className="content-card workspace-secondary-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recent records</p>
            <h2>Latest fault activity</h2>
          </div>
        </div>
        <div className="dlr-recent-list">
          {records.slice(0, 4).map((record) => (
            <article key={record.id} className="dlr-recent-card">
              <strong>{feeders.find((item) => item.id === record.payload?.feederId)?.name || 'Feeder'}</strong>
              <span>
                {record.operationalDate} | {resolveTimeRange(record.payload || {}).fromTime || '-'} - {resolveTimeRange(record.payload || {}).toTime || '-'}
              </span>
              <small>{record.payload?.remark || record.payload?.cause || 'No remark'}</small>
            </article>
          ))}
          {!records.length ? <p className="muted-copy">No recent fault records yet.</p> : null}
        </div>
      </section>

      <section className="content-card workspace-secondary-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Daily sheet</p>
            <h2>Saved fault rows</h2>
          </div>
        </div>
        <div className="table-shell">
          <table className="simple-table">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Duration</th>
                <th>Feeder</th>
                <th>Fault Type</th>
                <th>Cause</th>
                <th>Remark</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((record) => (
                <tr key={record.id}>
                  <td>{resolveTimeRange(record.payload || {}).fromTime || '-'}</td>
                  <td>{resolveTimeRange(record.payload || {}).toTime || '-'}</td>
                  <td>{resolveTimeRange(record.payload || {}).durationLabel}</td>
                  <td>{feeders.find((item) => item.id === record.payload?.feederId)?.name || '-'}</td>
                  <td>{record.payload?.faultType || '-'}</td>
                  <td>{record.payload?.cause || '-'}</td>
                  <td>{record.payload?.remark || '-'}</td>
                  <td>
                    <button
                      type="button"
                      className="danger-button small-button"
                      onClick={() => deleteRecord(record.id)}
                      disabled={!canDeleteFaults}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {!filteredRecords.length ? (
                <tr>
                  <td colSpan={8}>No fault entries for this date.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section
        id="fault-report-block"
        className="content-card workspace-secondary-panel"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Unified output</p>
            <h2>Fault preview / print / PDF / share</h2>
          </div>
        </div>
        <div ref={reportActionsRef}>
          <ReportActions
            documentRef={documentRef}
            filenameBase={`fault-report-${form.operationalDate}-${substation?.name || 'substation'}`}
            orientation={report.orientation}
            jsonData={report}
            csvRows={report.rows}
            workbookSheets={[{ name: report.title, rows: report.rows }]}
          />
        </div>
        <FaultReportView
          documentRef={documentRef}
          report={report}
          footerText={settings.companyProfile.reportFooter}
        />
      </section>
    </div>
  )
}
