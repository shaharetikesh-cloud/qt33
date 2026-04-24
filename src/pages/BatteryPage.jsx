import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import ReportActions from '../components/reporting/ReportActions'
import { BatteryReportView } from '../components/reporting/ReportLayouts'
import { useAuth } from '../context/AuthContext'
import { alertDetailSaved } from '../lib/detailSavedAlert'
import { formatIsoDate } from '../lib/dateUtils'
import { validateBatteryInput } from '../lib/domainValidation'
import { buildBatteryReport } from '../lib/reportData'
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

const defaultChecklist = {
  'Terminal cleaned': true,
  'Electrolyte level checked': true,
  'Vent plugs checked': true,
  'Float charger healthy': true,
}

/**
 * Auto-calculate cell condition from Specific Gravity + Voltage.
 *
 * Industry thresholds (standard lead-acid battery):
 *   Good    → S.G ≥ 1.200  AND  V ≥ 2.00
 *   Average → S.G ≥ 1.140  AND  V ≥ 1.85
 *   Weak    → below average values
 */
function calcCondition(specificGravity, voltage) {
  const sg = parseFloat(specificGravity)
  const v = parseFloat(voltage)
  if (isNaN(sg) || isNaN(v)) return ''
  if (sg >= 1.2 && v >= 2.0) return 'Good'
  if (sg >= 1.14 && v >= 1.85) return 'Average'
  return 'Weak'
}

function buildCells(count) {
  return Array.from({ length: Math.max(Number(count) || 1, 1) }, () => ({
    specificGravity: '',
    voltage: '',
    condition: '',
    remark: '',
  }))
}

export default function BatteryPage() {
  const { profile, canCreateModule, canEditModule, canDeleteModule } = useAuth()
  const canCreateBattery = canCreateModule('battery')
  const canEditBattery = canEditModule('battery')
  const canDeleteBattery = canDeleteModule('battery')
  const documentRef = useRef(null)
  const reportActionsRef = useRef(null)
  const [settings, setSettings] = useState(getSettingsBundle())
  const [referenceData, setReferenceData] = useState({ substations: [], employees: [] })
  const [divisions, setDivisions] = useState(listMasterRecords('divisions', { profile }))
  const [batterySets, setBatterySets] = useState(listMasterRecords('batterySets', { profile }))
  const [records, setRecords] = useState(listDlrRecords({ moduleName: 'battery', profile }))
  const [selectedRecordId, setSelectedRecordId] = useState('')
  const canWriteCurrentRecord = selectedRecordId ? canEditBattery : canCreateBattery
  const [form, setForm] = useState({
    operationalDate: formatIsoDate(new Date()),
    divisionId: '',
    substationId: '',
    batterySetId: '',
    operatorName: '',
    inChargeName: '',
    checklist: defaultChecklist,
    cells: buildCells(24),
  })
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function bootstrap() {
      const bundle = await loadReferenceData(profile)
      await loadDlrRecords({ moduleName: 'battery', profile })
      if (!active) return
      setReferenceData(bundle)
      setDivisions(listMasterRecords('divisions', { profile }))
      setBatterySets(listMasterRecords('batterySets', { profile }))
      setSettings(getSettingsBundle())
      setRecords(listDlrRecords({ moduleName: 'battery', profile }))
      setForm((current) => ({
        ...current,
        substationId: resolvePreferredSubstationId(bundle.substations, current.substationId),
      }))
    }
    void bootstrap()
    return () => { active = false }
  }, [profile])

  const filteredBatterySets = batterySets.filter((item) => item.substationId === form.substationId)
  const deferredForm = useDeferredValue(form)

  const previewRecord = useMemo(() => ({
    moduleName: 'battery',
    substationId: deferredForm.substationId,
    operationalDate: deferredForm.operationalDate,
    payload: {
      batterySetId: deferredForm.batterySetId,
      checklist: deferredForm.checklist,
      cells: deferredForm.cells,
      operatorName: deferredForm.operatorName,
      inChargeName: deferredForm.inChargeName,
    },
  }), [deferredForm])

  const substation = referenceData.substations.find((item) => item.id === previewRecord.substationId)
  const batterySet = batterySets.find((item) => item.id === previewRecord.payload?.batterySetId)
  const division = divisions.find(
    (item) => item.id === (deferredForm.divisionId || batterySet?.divisionId),
  )
  const report = useMemo(
    () => buildBatteryReport({
      companyProfile: settings.companyProfile,
      substation, batterySet, division,
      record: previewRecord,
    }),
    [batterySet, division, previewRecord, settings.companyProfile, substation],
  )

  function updateCell(index, field, value) {
    setForm((current) => ({
      ...current,
      cells: current.cells.map((cell, cellIndex) => {
        if (cellIndex !== index) return cell
        const updated = { ...cell, [field]: value }
        // Auto-recalculate condition when gravity or voltage changes
        if (field === 'specificGravity' || field === 'voltage') {
          const auto = calcCondition(updated.specificGravity, updated.voltage)
          if (auto) updated.condition = auto
        }
        return updated
      }),
    }))
  }

  async function saveRecord() {
    if (!canWriteCurrentRecord) {
      setError(
        selectedRecordId
          ? 'Current role sathi battery record edit access nahi.'
          : 'Current role sathi battery record create access nahi.',
      )
      setStatus('')
      return
    }

    try {
      validateBatteryInput(form, batterySet)
      const saved = await saveDlrRecord({
        id: selectedRecordId || undefined,
        moduleName: 'battery',
        substationId: form.substationId,
        operationalDate: form.operationalDate,
        payload: {
          batterySetId: form.batterySetId,
          checklist: form.checklist,
          cells: form.cells,
          operatorName: form.operatorName,
          inChargeName: form.inChargeName,
        },
      }, profile)
      setRecords(await loadDlrRecords({ moduleName: 'battery', profile }))
      setSelectedRecordId(saved.id)
      setStatus('Battery record saved.')
      setError('')
      alertDetailSaved()
    } catch (saveError) {
      setError(saveError.message)
      setStatus('')
    }
  }

  function editRecord(record) {
    if (!canEditBattery) {
      setError('Current role sathi battery record edit access nahi.')
      setStatus('')
      return
    }

    setSelectedRecordId(record.id)
    setForm({
      operationalDate: record.operationalDate,
      divisionId: batterySets.find((item) => item.id === record.payload?.batterySetId)?.divisionId || '',
      substationId: record.substationId,
      batterySetId: record.payload?.batterySetId || '',
      operatorName: record.payload?.operatorName || '',
      inChargeName: record.payload?.inChargeName || '',
      checklist: { ...defaultChecklist, ...(record.payload?.checklist || {}) },
      cells: record.payload?.cells?.length
        ? record.payload.cells.map((c) => ({ remark: '', ...c }))
        : buildCells(24),
    })
  }

  async function deleteRecord(recordId) {
    if (!canDeleteBattery) {
      setError('Current role sathi battery record delete access nahi.')
      setStatus('')
      return
    }

    await deleteDlrRecord(recordId, profile)
    setRecords(await loadDlrRecords({ moduleName: 'battery', profile }))
    if (selectedRecordId === recordId) setSelectedRecordId('')
  }

  function loadLatestBatteryRecord() {
    const latest = records.find((item) => item.substationId === form.substationId)

    if (!latest) {
      setError('Latest battery record available nahi.')
      setStatus('')
      return
    }

    editRecord(latest)
    setStatus('Latest battery inspection loaded for quicker repeat entry.')
    setError('')
  }

  function triggerReportAction(actionName) {
    document.getElementById('battery-report-block')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })

    window.requestAnimationFrame(() => {
      reportActionsRef.current?.querySelector(`[data-report-action="${actionName}"]`)?.click()
    })
  }

  return (
    <div className="page-stack page-stack-focus page-battery">
      <section className="content-card content-card-workspace workspace-canvas-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">DLR ERP</p>
            <h2>Battery Maintenance</h2>
          </div>
        </div>
        <p className="muted-copy">
          Weekly battery checks — Specific Gravity &amp; Voltage auto-determinates cell condition.
        </p>
      </section>

      {status ? <section className="callout success-callout"><p>{status}</p></section> : null}
      {error  ? <section className="callout danger-callout"><p>{error}</p></section>  : null}
      {!canCreateBattery && !canEditBattery && !canDeleteBattery ? (
        <section className="callout warning-callout">
          <p>Battery module current role sathi read only mode madhye aahe.</p>
        </section>
      ) : null}

      <section className="workspace-focus-toolbar dlr-quick-toolbar">
        <div className="workspace-focus-heading">
          <p className="eyebrow">Field workflow</p>
          <h2>Battery maintenance quick entry</h2>
          <span className="workspace-focus-status">
            Reload the latest inspection, keep mobile cards readable, and export from the same action bar.
          </span>
        </div>
        <div className="workspace-focus-controls">
          <label className="workspace-focus-field" htmlFor="battery-date-toolbar">
            <span>Date</span>
            <input
              id="battery-date-toolbar"
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
          <label className="workspace-focus-field" htmlFor="battery-substation-toolbar">
            <span>Substation</span>
            <select
              id="battery-substation-toolbar"
              value={form.substationId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  substationId: event.target.value,
                  batterySetId: '',
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
            Save Record
          </button>
          <button
            type="button"
            className="ghost-light-button"
            onClick={loadLatestBatteryRecord}
            disabled={!form.substationId || !canEditBattery}
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
        <div className="section-heading">
          <div>
            <p className="eyebrow">Entry</p>
            <h2>Weekly battery maintenance record</h2>
          </div>
        </div>

        {/* Meta fields */}
        <div className="details-grid dlr-entry-grid">
          <div>
            <label htmlFor="battery-date">Date</label>
            <input
              id="battery-date" type="date" value={form.operationalDate}
              disabled={!canWriteCurrentRecord}
              onChange={(e) => setForm((c) => ({ ...c, operationalDate: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="battery-substation">Substation</label>
            <select id="battery-substation" value={form.substationId}
              disabled={!canWriteCurrentRecord}
              onChange={(e) => setForm((c) => ({ ...c, substationId: e.target.value, batterySetId: '' }))}
            >
              <option value="">Select substation</option>
              {referenceData.substations.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="battery-set">Battery Set</label>
            <select id="battery-set" value={form.batterySetId}
              disabled={!canWriteCurrentRecord}
              onChange={(e) => {
                const id = e.target.value
                const bs = batterySets.find((x) => x.id === id)
                setForm((c) => ({
                  ...c,
                  batterySetId: id,
                  divisionId: bs?.divisionId || c.divisionId,
                  cells: bs ? buildCells(bs.cellCount) : c.cells,
                }))
              }}
            >
              <option value="">Select battery set</option>
              {filteredBatterySets.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="battery-operator">Operator</label>
            <input id="battery-operator" value={form.operatorName}
              disabled={!canWriteCurrentRecord}
              onChange={(e) => setForm((c) => ({ ...c, operatorName: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="battery-incharge">In Charge</label>
            <input id="battery-incharge" value={form.inChargeName}
              disabled={!canWriteCurrentRecord}
              onChange={(e) => setForm((c) => ({ ...c, inChargeName: e.target.value }))}
            />
          </div>
        </div>

        {/* Checklist */}
        <div className="details-grid">
          {Object.entries(form.checklist).map(([label, value]) => (
            <label key={label} className="checkbox-label">
              <input type="checkbox" checked={Boolean(value)}
                disabled={!canWriteCurrentRecord}
                onChange={(e) => setForm((c) => ({ ...c, checklist: { ...c.checklist, [label]: e.target.checked } }))}
              />
              {label}
            </label>
          ))}
        </div>

        {/* Condition legend */}
        <div className="battery-condition-legend">
          <span className="batt-badge batt-badge-good">Good</span>
          <span className="batt-legend-hint">S.G ≥ 1.200 &amp; V ≥ 2.00</span>
          <span className="batt-badge batt-badge-average">Average</span>
          <span className="batt-legend-hint">S.G ≥ 1.140 &amp; V ≥ 1.85</span>
          <span className="batt-badge batt-badge-weak">Weak</span>
          <span className="batt-legend-hint">Below average</span>
        </div>

        {/* Cell entry table */}
        <div className="table-shell battery-cell-table-shell">
          <table className="battery-cell-table">
            <colgroup>
              <col className="batt-col-srno" />
              <col className="batt-col-gravity" />
              <col className="batt-col-voltage" />
              <col className="batt-col-condition" />
              <col className="batt-col-remark" />
            </colgroup>
            <thead>
              <tr>
                <th>Sr</th>
                <th>S.P. Gravity<br /><small className="batt-th-hint">1.100 – 1.280</small></th>
                <th>Cell Voltage<br /><small className="batt-th-hint">Volts</small></th>
                <th>Condition<br /><small className="batt-th-hint">auto</small></th>
                <th>Remark</th>
              </tr>
            </thead>
            <tbody>
              {form.cells.map((cell, index) => {
                const cond = cell.condition || calcCondition(cell.specificGravity, cell.voltage)
                const condClass = cond ? `batt-row-${cond.toLowerCase()}` : ''
                return (
                  <tr key={`cell-${index}`} className={condClass}>
                    <td className="batt-cell-srno">{index + 1}</td>
                    <td>
                      <input
                        type="number" step="0.001" min="1.000" max="1.300"
                        className="batt-cell-input"
                        placeholder="1.200"
                        value={cell.specificGravity}
                        disabled={!canWriteCurrentRecord}
                        onChange={(e) => updateCell(index, 'specificGravity', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number" step="0.01" min="1.50" max="2.50"
                        className="batt-cell-input"
                        placeholder="2.00"
                        value={cell.voltage}
                        disabled={!canWriteCurrentRecord}
                        onChange={(e) => updateCell(index, 'voltage', e.target.value)}
                      />
                    </td>
                    <td className="batt-condition-cell">
                      {cond
                        ? <span className={`batt-badge batt-badge-${cond.toLowerCase()}`}>{cond}</span>
                        : <span className="batt-badge-empty">—</span>
                      }
                    </td>
                    <td>
                      <input
                        type="text"
                        className="batt-remark-input"
                        placeholder="Remark…"
                        value={cell.remark || ''}
                        disabled={!canWriteCurrentRecord}
                        onChange={(e) => updateCell(index, 'remark', e.target.value)}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="inline-actions">
          <button
            type="button"
            className="primary-button"
            onClick={saveRecord}
            disabled={!canWriteCurrentRecord}
          >
            Save battery record
          </button>
        </div>
      </section>

      <section className="content-card workspace-secondary-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recent records</p>
            <h2>Latest battery snapshots</h2>
          </div>
        </div>
        <div className="dlr-recent-list">
          {records.slice(0, 4).map((record) => (
            <article key={record.id} className="dlr-recent-card">
              <strong>{batterySets.find((item) => item.id === record.payload?.batterySetId)?.name || 'Battery set'}</strong>
              <span>{record.operationalDate} | {record.payload?.cells?.length || 0} cells</span>
              <small>{record.payload?.inChargeName || record.payload?.operatorName || 'No assignee'}</small>
            </article>
          ))}
          {!records.length ? <p className="muted-copy">No battery records yet.</p> : null}
        </div>
      </section>

      <section className="content-card workspace-secondary-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Saved records</p>
            <h2>Weekly battery register</h2>
          </div>
        </div>
        <div className="table-shell">
          <table className="simple-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Substation</th>
                <th>Battery Set</th>
                <th>Cells</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>{record.operationalDate}</td>
                  <td>{referenceData.substations.find((item) => item.id === record.substationId)?.name || record.substationId}</td>
                  <td>{batterySets.find((item) => item.id === record.payload?.batterySetId)?.name || '-'}</td>
                  <td>{record.payload?.cells?.length || 0}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        type="button"
                        className="ghost-light-button small-button"
                        onClick={() => editRecord(record)}
                        disabled={!canEditBattery}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="danger-button small-button"
                        onClick={() => deleteRecord(record.id)}
                        disabled={!canDeleteBattery}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!records.length ? <tr><td colSpan={5}>No battery records yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section
        id="battery-report-block"
        className="content-card workspace-secondary-panel"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Unified output</p>
            <h2>Battery preview / print / PDF / share</h2>
          </div>
        </div>
        <div ref={reportActionsRef}>
          <ReportActions
            documentRef={documentRef}
            filenameBase={`battery-${previewRecord.operationalDate}-${substation?.name || 'substation'}`}
            orientation={report.orientation}
            jsonData={report}
            csvRows={report.cells}
            workbookSheets={[
              { name: 'Battery Cells', rows: report.cells },
              { name: 'Battery Summary', rows: [report.analysis] },
            ]}
          />
        </div>
        <BatteryReportView
          documentRef={documentRef}
          report={report}
          footerText={settings.companyProfile.reportFooter}
        />
      </section>
    </div>
  )
}
