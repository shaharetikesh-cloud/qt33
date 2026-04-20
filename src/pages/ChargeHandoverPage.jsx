import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import ReportActions from '../components/reporting/ReportActions'
import { ChargeHandoverReportView } from '../components/reporting/ReportLayouts'
import { useAuth } from '../context/AuthContext'
import { alertDetailSaved } from '../lib/detailSavedAlert'
import { formatIsoDate } from '../lib/dateUtils'
import { validateChargeHandoverInput } from '../lib/domainValidation'
import { buildChargeHandoverReport } from '../lib/reportData'
import {
  deleteDlrRecord,
  getSettingsBundle,
  listDlrRecords,
  loadDlrRecords,
  loadReferenceData,
  saveDlrRecord,
} from '../lib/unifiedDataService'
import { resolvePreferredSubstationId } from '../lib/uiPreferences'

const blankForm = {
  operationalDate: formatIsoDate(new Date()),
  substationId: '',
  shift: 'Morning',
  outgoingOperator: '',
  incomingOperator: '',
  inChargeName: '',
  chargeDetails: '',
  pendingItems: '',
  remark: '',
}

export default function ChargeHandoverPage() {
  const { profile, canCreateModule, canEditModule, canDeleteModule } = useAuth()
  const canCreateHandover = canCreateModule('charge_handover')
  const canEditHandover = canEditModule('charge_handover')
  const canDeleteHandover = canDeleteModule('charge_handover')
  const documentRef = useRef(null)
  const reportActionsRef = useRef(null)
  const [settings, setSettings] = useState(getSettingsBundle())
  const [referenceData, setReferenceData] = useState({
    substations: [],
    employees: [],
  })
  const [records, setRecords] = useState(listDlrRecords({ moduleName: 'charge_handover', profile }))
  const [form, setForm] = useState(blankForm)
  const [selectedRecordId, setSelectedRecordId] = useState('')
  const canWriteCurrentRecord = selectedRecordId ? canEditHandover : canCreateHandover
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function bootstrap() {
      const bundle = await loadReferenceData(profile)
      await loadDlrRecords({ moduleName: 'charge_handover', profile })

      if (!active) {
        return
      }

      setReferenceData(bundle)
      setRecords(listDlrRecords({ moduleName: 'charge_handover', profile }))
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

  const deferredForm = useDeferredValue(form)

  const previewRecord = useMemo(
    () => ({
      moduleName: 'charge_handover',
      substationId: deferredForm.substationId,
      operationalDate: deferredForm.operationalDate,
      payload: {
        shift: deferredForm.shift,
        outgoingOperator: deferredForm.outgoingOperator,
        incomingOperator: deferredForm.incomingOperator,
        inChargeName: deferredForm.inChargeName,
        chargeDetails: deferredForm.chargeDetails,
        pendingItems: deferredForm.pendingItems,
        remark: deferredForm.remark,
      },
    }),
    [deferredForm],
  )

  const substation = referenceData.substations.find((item) => item.id === previewRecord.substationId)
  const report = useMemo(
    () =>
      buildChargeHandoverReport({
        companyProfile: settings.companyProfile,
        substation,
        record: previewRecord,
      }),
    [previewRecord, settings.companyProfile, substation],
  )

  async function saveRecord() {
    if (!canWriteCurrentRecord) {
      setError(
        selectedRecordId
          ? 'Current role sathi handover edit access nahi.'
          : 'Current role sathi handover create access nahi.',
      )
      setStatus('')
      return
    }

    try {
      validateChargeHandoverInput(form)

      const saved = await saveDlrRecord(
        {
          id: selectedRecordId || undefined,
          moduleName: 'charge_handover',
          substationId: form.substationId,
          operationalDate: form.operationalDate,
          payload: {
            shift: form.shift,
            outgoingOperator: form.outgoingOperator,
            incomingOperator: form.incomingOperator,
            inChargeName: form.inChargeName,
            chargeDetails: form.chargeDetails,
            pendingItems: form.pendingItems,
            remark: form.remark,
          },
        },
        profile,
      )

      setRecords(await loadDlrRecords({ moduleName: 'charge_handover', profile }))
      setSelectedRecordId(saved.id)
      setStatus('Charge handover saved.')
      setError('')
      alertDetailSaved()
    } catch (saveError) {
      setError(saveError.message)
      setStatus('')
    }
  }

  function editRecord(record) {
    if (!canEditHandover) {
      setError('Current role sathi handover edit access nahi.')
      setStatus('')
      return
    }

    setSelectedRecordId(record.id)
    setForm({
      operationalDate: record.operationalDate,
      substationId: record.substationId,
      shift: record.payload?.shift || 'Morning',
      outgoingOperator: record.payload?.outgoingOperator || '',
      incomingOperator: record.payload?.incomingOperator || '',
      inChargeName: record.payload?.inChargeName || '',
      chargeDetails: record.payload?.chargeDetails || '',
      pendingItems: record.payload?.pendingItems || '',
      remark: record.payload?.remark || '',
    })
  }

  async function deleteRecord(recordId) {
    if (!canDeleteHandover) {
      setError('Current role sathi handover delete access nahi.')
      setStatus('')
      return
    }

    await deleteDlrRecord(recordId, profile)
    setRecords(await loadDlrRecords({ moduleName: 'charge_handover', profile }))
    if (selectedRecordId === recordId) {
      setSelectedRecordId('')
    }
  }

  function loadLatestHandover() {
    const latest = records.find((item) => item.substationId === form.substationId)

    if (!latest) {
      setError('Latest charge handover template available nahi.')
      setStatus('')
      return
    }

    editRecord(latest)
    setStatus('Latest handover loaded for quick update.')
    setError('')
  }

  function triggerReportAction(actionName) {
    document.getElementById('handover-report-block')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })

    window.requestAnimationFrame(() => {
      reportActionsRef.current?.querySelector(`[data-report-action="${actionName}"]`)?.click()
    })
  }

  return (
    <div className="page-stack page-stack-focus page-charge-handover">
      <section className="content-card content-card-workspace workspace-canvas-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">DLR ERP</p>
            <h2>Charge Handover</h2>
          </div>
        </div>
        <p className="muted-copy">
          Shift handover details, pending items, and remarks are preserved here in a formal register format.
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
      {!canCreateHandover && !canEditHandover && !canDeleteHandover ? (
        <section className="callout warning-callout">
          <p>Charge handover module current role sathi read only mode madhye aahe.</p>
        </section>
      ) : null}

      <section className="workspace-focus-toolbar dlr-quick-toolbar">
        <div className="workspace-focus-heading">
          <p className="eyebrow">Shift workflow</p>
          <h2>Charge handover quick entry</h2>
          <span className="workspace-focus-status">
            Load the latest register, update pending items, and send PDF/share directly from one bar.
          </span>
        </div>
        <div className="workspace-focus-controls">
          <label className="workspace-focus-field" htmlFor="handover-date-toolbar">
            <span>Date</span>
            <input
              id="handover-date-toolbar"
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
          <label className="workspace-focus-field" htmlFor="handover-substation-toolbar">
            <span>Substation</span>
            <select
              id="handover-substation-toolbar"
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
            disabled={!canWriteCurrentRecord}
          >
            Save Handover
          </button>
          <button
            type="button"
            className="ghost-light-button"
            onClick={loadLatestHandover}
            disabled={!form.substationId || !canEditHandover}
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
            <label htmlFor="handover-date">Date</label>
            <input
              id="handover-date"
              type="date"
              value={form.operationalDate}
              disabled={!canWriteCurrentRecord}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  operationalDate: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="handover-substation">Substation</label>
            <select
              id="handover-substation"
              value={form.substationId}
              disabled={!canWriteCurrentRecord}
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
            <label htmlFor="handover-shift">Shift</label>
            <select
              id="handover-shift"
              value={form.shift}
              disabled={!canWriteCurrentRecord}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  shift: event.target.value,
                }))
              }
            >
              <option value="Morning">Morning</option>
              <option value="Evening">Evening</option>
              <option value="Night">Night</option>
            </select>
          </div>
          <div>
            <label htmlFor="handover-outgoing">Outgoing Operator</label>
            <input
              id="handover-outgoing"
              value={form.outgoingOperator}
              disabled={!canWriteCurrentRecord}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  outgoingOperator: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="handover-incoming">Incoming Operator</label>
            <input
              id="handover-incoming"
              value={form.incomingOperator}
              disabled={!canWriteCurrentRecord}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  incomingOperator: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="handover-incharge">In Charge</label>
            <input
              id="handover-incharge"
              value={form.inChargeName}
              disabled={!canWriteCurrentRecord}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  inChargeName: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="handover-charge">Charge Details</label>
            <textarea
              id="handover-charge"
              value={form.chargeDetails}
              disabled={!canWriteCurrentRecord}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  chargeDetails: event.target.value,
                }))
              }
              rows={4}
            />
          </div>
          <div>
            <label htmlFor="handover-pending">Pending Items</label>
            <textarea
              id="handover-pending"
              value={form.pendingItems}
              disabled={!canWriteCurrentRecord}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  pendingItems: event.target.value,
                }))
              }
              rows={4}
            />
          </div>
          <div>
            <label htmlFor="handover-remark">Remark</label>
            <textarea
              id="handover-remark"
              value={form.remark}
              disabled={!canWriteCurrentRecord}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  remark: event.target.value,
                }))
              }
              rows={4}
            />
          </div>
        </div>
        <div className="inline-actions">
          <button
            type="button"
            className="primary-button"
            onClick={saveRecord}
            disabled={!canWriteCurrentRecord}
          >
            Save handover
          </button>
        </div>
      </section>

      <section className="content-card workspace-secondary-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recent records</p>
            <h2>Latest handover snapshots</h2>
          </div>
        </div>
        <div className="dlr-recent-list">
          {records.slice(0, 4).map((record) => (
            <article key={record.id} className="dlr-recent-card">
              <strong>{record.payload?.shift || 'Shift'} shift</strong>
              <span>{record.operationalDate} | {record.payload?.outgoingOperator || '-'} to {record.payload?.incomingOperator || '-'}</span>
              <small>{record.payload?.pendingItems || record.payload?.remark || 'No pending note'}</small>
            </article>
          ))}
          {!records.length ? <p className="muted-copy">No charge handover records yet.</p> : null}
        </div>
      </section>

      <section className="content-card workspace-secondary-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Saved records</p>
            <h2>Charge handover register</h2>
          </div>
        </div>
        <div className="table-shell">
          <table className="simple-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Substation</th>
                <th>Shift</th>
                <th>Outgoing</th>
                <th>Incoming</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>{record.operationalDate}</td>
                  <td>
                    {referenceData.substations.find((item) => item.id === record.substationId)?.name ||
                      record.substationId}
                  </td>
                  <td>{record.payload?.shift || '-'}</td>
                  <td>{record.payload?.outgoingOperator || '-'}</td>
                  <td>{record.payload?.incomingOperator || '-'}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        type="button"
                        className="ghost-light-button small-button"
                        onClick={() => editRecord(record)}
                        disabled={!canEditHandover}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="danger-button small-button"
                        onClick={() => deleteRecord(record.id)}
                        disabled={!canDeleteHandover}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!records.length ? (
                <tr>
                  <td colSpan={6}>No charge handover records yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section
        id="handover-report-block"
        className="content-card workspace-secondary-panel"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Unified output</p>
            <h2>Charge handover preview / print / PDF / share</h2>
          </div>
        </div>
        <div ref={reportActionsRef}>
          <ReportActions
            documentRef={documentRef}
            filenameBase={`charge-handover-${previewRecord.operationalDate}-${substation?.name || 'substation'}`}
            orientation={report.orientation}
            jsonData={report}
            csvRows={[report.payload]}
            workbookSheets={[{ name: report.title, rows: [report.payload] }]}
          />
        </div>
        <ChargeHandoverReportView
          documentRef={documentRef}
          report={report}
          footerText={settings.companyProfile.reportFooter}
        />
      </section>
    </div>
  )
}
