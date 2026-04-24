/**
 * Asset History Register
 * ─────────────────────
 * Self-contained asset management for MSEDCL substation equipment.
 * Data is stored in localStorage via readScope/writeScope (same pattern
 * as the rest of the app). No backend changes required.
 *
 * Scopes used:
 *   "asset-master"  → AssetRecord[]
 *   "asset-history" → AssetEvent[]
 */

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { alertDetailSaved } from '../lib/detailSavedAlert'
import { localGetScopeSnapshot, localSaveScopeSnapshot } from '../lib/localApi'
import { loadReferenceData } from '../lib/unifiedDataService'
import { resolvePreferredSubstationId } from '../lib/uiPreferences'
import { readScope, writeScope, createLocalId, getNowIso } from '../lib/storageAdapter'
import { listMasterRecords } from '../lib/unifiedDataService'

// ─── Storage helpers ─────────────────────────────────────────────
const ASSET_SCOPE   = 'asset-master'
const HISTORY_SCOPE = 'asset-history'

function readAssets()           { return readScope(ASSET_SCOPE,   []) }
function writeAssets(v)         { writeScope(ASSET_SCOPE,   v)        }
function readEvents()           { return readScope(HISTORY_SCOPE, []) }
function writeEvents(v)         { writeScope(HISTORY_SCOPE, v)        }

function syncHistoryScopesToCloud(assets, events) {
  void localSaveScopeSnapshot(ASSET_SCOPE, assets).catch(() => {})
  void localSaveScopeSnapshot(HISTORY_SCOPE, events).catch(() => {})
}

function saveAsset(record) {
  const now  = getNowIso()
  const next = { ...record, id: record.id || createLocalId('ast'), updatedAt: now }
  if (!record.id) next.createdAt = now
  const all = readAssets()
  const idx = all.findIndex((a) => a.id === next.id)
  if (idx >= 0) all[idx] = { ...all[idx], ...next }
  else          all.unshift(next)
  writeAssets(all)
  return next
}

function saveEvent(ev) {
  const now  = getNowIso()
  const next = { ...ev, id: ev.id || createLocalId('aev'), createdAt: now }
  const all  = readEvents()
  all.unshift(next)
  writeEvents(all)
  return next
}

function deleteAsset(id) { writeAssets(readAssets().filter((a) => a.id !== id)) }
function deleteEvent(id) { writeEvents(readEvents().filter((e) => e.id !== id)) }

// ─── Constants ───────────────────────────────────────────────────
const ASSET_TYPES = [
  'Transformer', 'Circuit Breaker', 'Isolator', 'CT / PT',
  'Battery Set', 'Battery Charger', 'Cable', 'Lightning Arrester',
  'Capacitor Bank', 'Protection Relay', 'Control Panel', 'Meter',
  'Bus Bar', 'Earth Switch', 'Other',
]

const EVENT_TYPES = [
  { value: 'install',     label: 'Installation',         color: '#2563eb' },
  { value: 'repair',      label: 'Repair / Maintenance',  color: '#d97706' },
  { value: 'test',        label: 'Testing / Inspection',  color: '#7c3aed' },
  { value: 'replace',     label: 'Replacement',           color: '#dc2626' },
  { value: 'update',      label: 'Parameter Update',      color: '#059669' },
  { value: 'fault',       label: 'Fault Recorded',        color: '#b91c1c' },
  { value: 'restored',    label: 'Restored to Service',   color: '#16a34a' },
  { value: 'decommission',label: 'Decommission',          color: '#64748b' },
]

const STATUS_META = {
  active:   { label: 'Active',   bg: '#d1fae5', color: '#065f46', border: '#6ee7b7' },
  inactive: { label: 'Inactive', bg: '#f3f4f6', color: '#374151', border: '#d1d5db' },
  faulty:   { label: 'Faulty',   bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
}

const EMPTY_ASSET = {
  name: '', type: '', substationId: '', feederId: '', serialNo: '',
  make: '', model: '', capacity: '', installDate: '',
  status: 'active', notes: '',
}

const EMPTY_EVENT = {
  assetId: '', eventType: 'repair', date: '', technician: '',
  cost: '', description: '', notes: '', isReplacement: false,
  newAssetName: '', newAssetSerial: '',
}

// ─── Sub-components ──────────────────────────────────────────────

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.active
  return (
    <span className="hr-status-badge" style={{ background: m.bg, color: m.color, borderColor: m.border }}>
      {m.label}
    </span>
  )
}

function EventTypeBadge({ eventType }) {
  const m = EVENT_TYPES.find((e) => e.value === eventType) || EVENT_TYPES[0]
  return (
    <span className="hr-event-badge" style={{ color: m.color, borderColor: m.color + '44', background: m.color + '14' }}>
      {m.label}
    </span>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div className="hr-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="hr-modal">
        <div className="hr-modal-header">
          <h3>{title}</h3>
          <button type="button" className="hr-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="hr-modal-body">{children}</div>
      </div>
    </div>
  )
}

function Field({ label, children, hint }) {
  return (
    <div className="hr-field">
      <label className="hr-field-label">{label}</label>
      {children}
      {hint && <span className="hr-field-hint">{hint}</span>}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────
export default function HistoryRegisterPage() {
  const {
    profile,
    isMainAdmin,
    canCreateModule,
    canEditModule,
    canDeleteModule,
  } = useAuth()
  const printRef    = useRef(null)
  const scopedSubstationId = String(profile?.substation_id || profile?.substationId || '').trim()
  const canCreateHistory = canCreateModule('history_register')
  const canEditHistory = canEditModule('history_register')
  const canDeleteHistory = canDeleteModule('history_register')
  const canWriteHistory = canCreateHistory || canEditHistory

  // Reference data
  const [referenceData, setReferenceData] = useState({ substations: [], employees: [] })
  const [feeders, setFeeders]             = useState([])

  // Asset + event state
  const [assets,  setAssets]  = useState(() => readAssets())
  const [events,  setEvts]    = useState(() => readEvents())

  // UI state
  const [selectedId,  setSelectedId]  = useState(null)
  const [showAddAsset,setShowAddAsset] = useState(false)
  const [showAddEv,   setShowAddEv]   = useState(false)
  const [editAsset,   setEditAsset]   = useState(null)   // null = new
  const [filters, setFilters] = useState({
    substationId: '', feederId: '', type: '', status: '', search: '',
  })

  // Form state
  const [assetForm, setAssetForm] = useState(EMPTY_ASSET)
  const [evForm,    setEvForm]    = useState(EMPTY_EVENT)
  const [formError, setFormError] = useState('')

  // Bootstrap
  useEffect(() => {
    let active = true
    async function bootstrap() {
      const [bundle, cloudAssets, cloudEvents] = await Promise.all([
        loadReferenceData(profile),
        localGetScopeSnapshot(ASSET_SCOPE),
        localGetScopeSnapshot(HISTORY_SCOPE),
      ])
      if (!active) return
      setReferenceData(bundle)
      setFeeders(listMasterRecords('feeders'))
      if (Array.isArray(cloudAssets) && cloudAssets.length) {
        writeAssets(cloudAssets)
        setAssets(cloudAssets)
      }
      if (Array.isArray(cloudEvents) && cloudEvents.length) {
        writeEvents(cloudEvents)
        setEvts(cloudEvents)
      }
      setFilters((c) => ({
        ...c,
        substationId: isMainAdmin
          ? resolvePreferredSubstationId(bundle.substations, c.substationId)
          : scopedSubstationId || resolvePreferredSubstationId(bundle.substations, c.substationId),
      }))
    }
    void bootstrap()
    return () => { active = false }
  }, [isMainAdmin, profile, scopedSubstationId])

  useEffect(() => {
    let active = true
    async function refreshFromCloud() {
      const [cloudAssets, cloudEvents] = await Promise.all([
        localGetScopeSnapshot(ASSET_SCOPE),
        localGetScopeSnapshot(HISTORY_SCOPE),
      ])
      if (!active) {
        return
      }
      if (Array.isArray(cloudAssets) && cloudAssets.length) {
        setAssets(cloudAssets)
        writeAssets(cloudAssets)
      }
      if (Array.isArray(cloudEvents) && cloudEvents.length) {
        setEvts(cloudEvents)
        writeEvents(cloudEvents)
      }
    }
    const timerId = window.setInterval(() => {
      void refreshFromCloud()
    }, 60000)
    return () => {
      active = false
      window.clearInterval(timerId)
    }
  }, [])

  // Derived
  const visibleAssets = assets.filter((asset) => {
    if (isMainAdmin) return true
    if (!scopedSubstationId) return false
    return asset.substationId === scopedSubstationId
  })
  const selectedAsset =
    visibleAssets.find((asset) => asset.id === selectedId) || null
  const assetEvents   = events
    .filter((e) => e.assetId === selectedAsset?.id)
    .sort((a, b) => new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime())

  const filteredAssets = visibleAssets.filter((a) => {
    if (filters.substationId && a.substationId !== filters.substationId) return false
    if (filters.feederId     && a.feederId     !== filters.feederId)      return false
    if (filters.type         && a.type         !== filters.type)          return false
    if (filters.status       && a.status       !== filters.status)        return false
    if (filters.search) {
      const q = filters.search.toLowerCase()
      const hay = `${a.name} ${a.serialNo} ${a.make} ${a.model}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  const substationFeeders = feeders.filter((f) =>
    !filters.substationId || f.substationId === filters.substationId
  )

  // ── Handlers ──────────────────────────────────────────────────
  function openNewAsset() {
    if (!canCreateHistory) {
      setFormError('Current role sathi asset create access nahi.')
      return
    }

    setEditAsset(null)
    setAssetForm({
      ...EMPTY_ASSET,
      substationId: isMainAdmin ? filters.substationId || '' : scopedSubstationId,
    })
    setFormError('')
    setShowAddAsset(true)
  }

  function openEditAsset(asset) {
    if (!canEditHistory) {
      setFormError('Current role sathi asset edit access nahi.')
      return
    }

    setEditAsset(asset)
    setAssetForm({ ...EMPTY_ASSET, ...asset })
    setFormError('')
    setShowAddAsset(true)
  }

  function handleSaveAsset() {
    if (editAsset && !canEditHistory) return setFormError('Current role sathi asset edit access nahi.')
    if (!editAsset && !canCreateHistory) return setFormError('Current role sathi asset create access nahi.')
    if (!assetForm.name.trim())    return setFormError('Asset name is required.')
    if (!assetForm.type)           return setFormError('Asset type is required.')
    if (!assetForm.substationId)   return setFormError('Substation is required.')
    setFormError('')
    const saved = saveAsset({ ...assetForm, id: editAsset?.id })
    // If new, add Installation event automatically
    if (!editAsset) {
      saveEvent({
        assetId: saved.id, eventType: 'install',
        date: assetForm.installDate || new Date().toISOString().slice(0, 10),
        technician: '', cost: '', description: 'Asset commissioned.',
        notes: '',
      })
    }
    setAssets(readAssets())
    setEvts(readEvents())
    syncHistoryScopesToCloud(readAssets(), readEvents())
    setSelectedId(saved.id)
    setShowAddAsset(false)
    alertDetailSaved()
  }

  function handleDeleteAsset(id) {
    if (!canDeleteHistory) {
      setFormError('Current role sathi asset delete access nahi.')
      return
    }

    if (!window.confirm('Delete this asset and all its history? This cannot be undone.')) return
    deleteAsset(id)
    writeEvents(readEvents().filter((e) => e.assetId !== id))
    setAssets(readAssets())
    setEvts(readEvents())
    syncHistoryScopesToCloud(readAssets(), readEvents())
    if (selectedId === id) setSelectedId(null)
  }

  function openAddEvent() {
    if (!canWriteHistory) {
      setFormError('Current role sathi asset history update access nahi.')
      return
    }

    if (!selectedId) return
    setEvForm({ ...EMPTY_EVENT, assetId: selectedId, date: new Date().toISOString().slice(0, 10) })
    setFormError('')
    setShowAddEv(true)
  }

  function handleSaveEvent() {
    if (!canWriteHistory) return setFormError('Current role sathi asset history update access nahi.')
    if (!evForm.date)        return setFormError('Event date is required.')
    if (!evForm.description.trim()) return setFormError('Description is required.')
    setFormError('')

    // Replacement logic
    if (evForm.eventType === 'replace' && evForm.isReplacement) {
      // Mark current asset inactive
      saveAsset({ ...selectedAsset, status: 'inactive' })
      // Create new asset
      const newAsset = saveAsset({
        ...EMPTY_ASSET,
        name: evForm.newAssetName || `${selectedAsset.name} (Replacement)`,
        type: selectedAsset.type,
        substationId: selectedAsset.substationId,
        feederId: selectedAsset.feederId,
        serialNo: evForm.newAssetSerial,
        make: selectedAsset.make,
        model: selectedAsset.model,
        capacity: selectedAsset.capacity,
        installDate: evForm.date,
        status: 'active',
        notes: `Replaced from: ${selectedAsset.name} (${selectedAsset.serialNo || 'N/A'})`,
      })
      // Installation event for new asset
      saveEvent({ assetId: newAsset.id, eventType: 'install', date: evForm.date,
        technician: evForm.technician, cost: evForm.cost,
        description: `Installed as replacement for ${selectedAsset.name}.`, notes: evForm.notes })
      // Replacement event on old asset
      saveEvent({ ...evForm, id: undefined, assetId: selectedAsset.id,
        description: `${evForm.description} → replaced by: ${newAsset.name}` })
      setAssets(readAssets())
      setEvts(readEvents())
      syncHistoryScopesToCloud(readAssets(), readEvents())
      setSelectedId(newAsset.id)
      setShowAddEv(false)
      alertDetailSaved()
      return
    }

    // Update asset status based on event type
    if (evForm.eventType === 'fault')        saveAsset({ ...selectedAsset, status: 'faulty' })
    if (evForm.eventType === 'restored')     saveAsset({ ...selectedAsset, status: 'active' })
    if (evForm.eventType === 'decommission') saveAsset({ ...selectedAsset, status: 'inactive' })

    saveEvent({ ...evForm, id: undefined })
    setAssets(readAssets())
    setEvts(readEvents())
    syncHistoryScopesToCloud(readAssets(), readEvents())
    setShowAddEv(false)
    alertDetailSaved()
  }

  function handleDeleteEvent(id) {
    if (!canDeleteHistory) {
      setFormError('Current role sathi asset event delete access nahi.')
      return
    }

    if (!window.confirm('Delete this history entry?')) return
    deleteEvent(id)
    setEvts(readEvents())
    syncHistoryScopesToCloud(readAssets(), readEvents())
  }

  // ── Stats card data ────────────────────────────────────────────
  const totalActive   = visibleAssets.filter((a) => a.status === 'active').length
  const totalFaulty   = visibleAssets.filter((a) => a.status === 'faulty').length
  const totalInactive = visibleAssets.filter((a) => a.status === 'inactive').length

  // ── Print ──────────────────────────────────────────────────────
  function handlePrint() { window.print() }

  // ─────────────────────────────────────────────────────────────
  return (
    <div className="page-stack page-history-register hr-root" ref={printRef}>

      {/* ── Page title ── */}
      <section className="content-card workspace-canvas-card hr-title-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">DLR ERP</p>
            <h2>Asset History Register</h2>
          </div>
          <div className="hr-title-actions">
            <button type="button" className="ghost-light-button small-button" onClick={handlePrint}>
              🖨 Print
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={openNewAsset}
              disabled={!canCreateHistory}
            >
              + Add Asset
            </button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="hr-kpi-strip">
          <div className="hr-kpi-card">
            <span>Total Assets</span>
            <strong>{visibleAssets.length}</strong>
          </div>
          <div className="hr-kpi-card hr-kpi-good">
            <span>Active</span>
            <strong>{totalActive}</strong>
          </div>
          <div className="hr-kpi-card hr-kpi-warn">
            <span>Faulty</span>
            <strong>{totalFaulty}</strong>
          </div>
          <div className="hr-kpi-card hr-kpi-muted">
            <span>Inactive</span>
            <strong>{totalInactive}</strong>
          </div>
          <div className="hr-kpi-card">
            <span>History Events</span>
            <strong>{events.filter((event) => visibleAssets.some((asset) => asset.id === event.assetId)).length}</strong>
          </div>
        </div>
      </section>

      {/* ── Filter bar ── */}
      <section className="content-card hr-filter-bar">
        <div className="hr-filter-row">
          <div className="hr-filter-field hr-filter-search">
            <label htmlFor="hr-search">🔍 Search</label>
            <input
              id="hr-search" type="text" placeholder="Name, serial, make, model…"
              value={filters.search}
              onChange={(e) => setFilters((c) => ({ ...c, search: e.target.value }))}
            />
          </div>
          <div className="hr-filter-field">
            <label htmlFor="hr-substation">Substation</label>
            <select id="hr-substation" value={filters.substationId}
              disabled={!isMainAdmin}
              onChange={(e) => setFilters((c) => ({ ...c, substationId: e.target.value, feederId: '' }))}>
              {isMainAdmin ? <option value="">All</option> : null}
              {referenceData.substations.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="hr-filter-field">
            <label htmlFor="hr-feeder">Feeder</label>
            <select id="hr-feeder" value={filters.feederId}
              onChange={(e) => setFilters((c) => ({ ...c, feederId: e.target.value }))}>
              <option value="">All</option>
              {substationFeeders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <div className="hr-filter-field">
            <label htmlFor="hr-type">Type</label>
            <select id="hr-type" value={filters.type}
              onChange={(e) => setFilters((c) => ({ ...c, type: e.target.value }))}>
              <option value="">All Types</option>
              {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="hr-filter-field">
            <label htmlFor="hr-status">Status</label>
            <select id="hr-status" value={filters.status}
              onChange={(e) => setFilters((c) => ({ ...c, status: e.target.value }))}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="faulty">Faulty</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="hr-filter-field hr-filter-clear">
            <label>&nbsp;</label>
            <button type="button" className="ghost-light-button small-button"
              onClick={() => setFilters({ substationId: '', feederId: '', type: '', status: '', search: '' })}>
              Clear
            </button>
          </div>
        </div>
      </section>

      {/* ── Main layout: asset grid + detail panel ── */}
      <div className="hr-workspace">

        {/* Asset grid */}
        <section className="content-card hr-asset-panel">
          <div className="hr-asset-panel-header">
            <strong>Assets ({filteredAssets.length})</strong>
          </div>

          {filteredAssets.length === 0 ? (
            <div className="hr-empty-state">
              <p>No assets found.</p>
              <button
                type="button"
                className="primary-button small-button"
                onClick={openNewAsset}
                disabled={!canCreateHistory}
              >
                + Add first asset
              </button>
            </div>
          ) : (
            <div className="hr-asset-list">
              {filteredAssets.map((asset) => {
                const evCount = events.filter((e) => e.assetId === asset.id).length
                const substation = referenceData.substations.find((s) => s.id === asset.substationId)
                const feeder = feeders.find((f) => f.id === asset.feederId)
                return (
                  <div
                    key={asset.id}
                    className={`hr-asset-card ${selectedId === asset.id ? 'hr-asset-card-selected' : ''} hr-asset-${asset.status}`}
                    onClick={() => setSelectedId(asset.id)}
                  >
                    <div className="hr-asset-card-top">
                      <span className="hr-asset-type-chip">{asset.type || 'Asset'}</span>
                      <StatusBadge status={asset.status} />
                    </div>
                    <div className="hr-asset-name">{asset.name}</div>
                    {asset.serialNo && <div className="hr-asset-meta">S/N: {asset.serialNo}</div>}
                    <div className="hr-asset-meta">
                      {substation?.name || '—'}
                      {feeder ? ` › ${feeder.name}` : ''}
                    </div>
                    <div className="hr-asset-footer">
                      <span className="hr-event-count">{evCount} event{evCount !== 1 ? 's' : ''}</span>
                      {asset.installDate && <span>{asset.installDate}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Detail panel */}
        <section className="content-card hr-detail-panel">
          {!selectedAsset ? (
            <div className="hr-empty-state hr-no-selection">
              <div className="hr-empty-icon">📋</div>
              <p>Select an asset to view details &amp; history</p>
            </div>
          ) : (
            <>
              {/* Asset detail header */}
              <div className="hr-detail-header">
                <div className="hr-detail-title-row">
                  <div>
                    <span className="hr-asset-type-chip">{selectedAsset.type}</span>
                    <h3 className="hr-detail-name">{selectedAsset.name}</h3>
                  </div>
                  <StatusBadge status={selectedAsset.status} />
                </div>
                <div className="hr-detail-actions">
                  <button
                    type="button"
                    className="ghost-light-button small-button"
                    onClick={() => openEditAsset(selectedAsset)}
                    disabled={!canEditHistory}
                  >
                    ✏ Edit
                  </button>
                  <button
                    type="button"
                    className="primary-button small-button"
                    onClick={openAddEvent}
                    disabled={!canWriteHistory}
                  >
                    + Add Event
                  </button>
                  <button
                    type="button"
                    className="danger-button small-button"
                    onClick={() => handleDeleteAsset(selectedAsset.id)}
                    disabled={!canDeleteHistory}
                  >
                    🗑 Delete
                  </button>
                </div>
              </div>

              {/* Asset info grid */}
              <div className="hr-info-grid">
                {[
                  ['Serial No',    selectedAsset.serialNo  || '—'],
                  ['Make',         selectedAsset.make      || '—'],
                  ['Model',        selectedAsset.model     || '—'],
                  ['Capacity',     selectedAsset.capacity  || '—'],
                  ['Install Date', selectedAsset.installDate || '—'],
                  ['Substation', referenceData.substations.find((s) => s.id === selectedAsset.substationId)?.name || '—'],
                  ['Feeder',    feeders.find((f) => f.id === selectedAsset.feederId)?.name || '—'],
                  ['Status',    selectedAsset.status],
                ].map(([k, v]) => (
                  <div key={k} className="hr-info-item">
                    <span>{k}</span>
                    <strong>{k === 'Status' ? <StatusBadge status={v} /> : v}</strong>
                  </div>
                ))}
              </div>

              {selectedAsset.notes && (
                <div className="hr-notes-box">
                  <span>Notes:</span> {selectedAsset.notes}
                </div>
              )}

              {/* History timeline */}
              <div className="hr-timeline-section">
                <div className="hr-timeline-header">
                  <strong>Event History ({assetEvents.length})</strong>
                </div>

                {assetEvents.length === 0 ? (
                  <div className="hr-timeline-empty">No events recorded yet.</div>
                ) : (
                  <div className="hr-timeline">
                    {assetEvents.map((ev, idx) => {
                      const meta = EVENT_TYPES.find((t) => t.value === ev.eventType) || EVENT_TYPES[0]
                      return (
                        <div key={ev.id} className="hr-timeline-item">
                          <div className="hr-timeline-dot" style={{ background: meta.color }} />
                          {idx < assetEvents.length - 1 && <div className="hr-timeline-line" />}
                          <div className="hr-timeline-content">
                            <div className="hr-timeline-row1">
                              <EventTypeBadge eventType={ev.eventType} />
                              <span className="hr-timeline-date">{ev.date || ev.createdAt?.slice(0, 10)}</span>
                              <button type="button" className="hr-timeline-del"
                                onClick={() => handleDeleteEvent(ev.id)} title="Delete event" disabled={!canDeleteHistory}>✕</button>
                            </div>
                            <div className="hr-timeline-desc">{ev.description}</div>
                            <div className="hr-timeline-meta-row">
                              {ev.technician && <span>👷 {ev.technician}</span>}
                              {ev.cost       && <span>₹ {ev.cost}</span>}
                              {ev.notes      && <span className="hr-timeline-notes">{ev.notes}</span>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {/* ── Add / Edit Asset Modal ── */}
      {showAddAsset && (
        <Modal title={editAsset ? 'Edit Asset' : 'Add New Asset'} onClose={() => setShowAddAsset(false)}>
          {formError && <div className="hr-form-error">{formError}</div>}
          <div className="hr-form-grid">
            <Field label="Asset Name *">
              <input type="text" placeholder="e.g. Bay-1 Transformer" value={assetForm.name}
                onChange={(e) => setAssetForm((c) => ({ ...c, name: e.target.value }))} />
            </Field>
            <Field label="Asset Type *">
              <select value={assetForm.type}
                onChange={(e) => setAssetForm((c) => ({ ...c, type: e.target.value }))}>
                <option value="">Select type…</option>
                {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Substation *">
              <select value={assetForm.substationId}
                disabled={!isMainAdmin}
                onChange={(e) => setAssetForm((c) => ({ ...c, substationId: e.target.value, feederId: '' }))}>
                <option value="">Select…</option>
                {referenceData.substations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Feeder / Bay">
              <select value={assetForm.feederId}
                onChange={(e) => setAssetForm((c) => ({ ...c, feederId: e.target.value }))}>
                <option value="">None / All</option>
                {feeders.filter((f) => !assetForm.substationId || f.substationId === assetForm.substationId)
                  .map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </Field>
            <Field label="Serial No">
              <input type="text" placeholder="Manufacturer serial"
                value={assetForm.serialNo}
                onChange={(e) => setAssetForm((c) => ({ ...c, serialNo: e.target.value }))} />
            </Field>
            <Field label="Make / Brand">
              <input type="text" placeholder="ABB, Siemens…"
                value={assetForm.make}
                onChange={(e) => setAssetForm((c) => ({ ...c, make: e.target.value }))} />
            </Field>
            <Field label="Model">
              <input type="text" value={assetForm.model}
                onChange={(e) => setAssetForm((c) => ({ ...c, model: e.target.value }))} />
            </Field>
            <Field label="Capacity / Rating">
              <input type="text" placeholder="100 kVA, 33 kV…"
                value={assetForm.capacity}
                onChange={(e) => setAssetForm((c) => ({ ...c, capacity: e.target.value }))} />
            </Field>
            <Field label="Installation Date">
              <input type="date" value={assetForm.installDate}
                onChange={(e) => setAssetForm((c) => ({ ...c, installDate: e.target.value }))} />
            </Field>
            <Field label="Status">
              <select value={assetForm.status}
                onChange={(e) => setAssetForm((c) => ({ ...c, status: e.target.value }))}>
                <option value="active">Active</option>
                <option value="faulty">Faulty</option>
                <option value="inactive">Inactive</option>
              </select>
            </Field>
            <Field label="Notes" hint="Optional additional info">
              <textarea rows={2} value={assetForm.notes}
                onChange={(e) => setAssetForm((c) => ({ ...c, notes: e.target.value }))} />
            </Field>
          </div>
          <div className="hr-modal-footer">
            <button type="button" className="ghost-light-button" onClick={() => setShowAddAsset(false)}>Cancel</button>
            <button type="button" className="primary-button" onClick={handleSaveAsset} disabled={editAsset ? !canEditHistory : !canCreateHistory}>
              {editAsset ? 'Save Changes' : 'Add Asset'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Add History Event Modal ── */}
      {showAddEv && (
        <Modal title={`Add Event — ${selectedAsset?.name}`} onClose={() => setShowAddEv(false)}>
          {formError && <div className="hr-form-error">{formError}</div>}
          <div className="hr-form-grid">
            <Field label="Event Type *">
              <select value={evForm.eventType}
                onChange={(e) => setEvForm((c) => ({ ...c, eventType: e.target.value, isReplacement: e.target.value === 'replace' }))}>
                {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Date *">
              <input type="date" value={evForm.date}
                onChange={(e) => setEvForm((c) => ({ ...c, date: e.target.value }))} />
            </Field>
            <Field label="Technician / Team">
              <input type="text" placeholder="Name or team"
                value={evForm.technician}
                onChange={(e) => setEvForm((c) => ({ ...c, technician: e.target.value }))} />
            </Field>
            <Field label="Cost (₹)">
              <input type="number" min="0" placeholder="0"
                value={evForm.cost}
                onChange={(e) => setEvForm((c) => ({ ...c, cost: e.target.value }))} />
            </Field>
            <Field label="Description *" hint="What was done?">
              <textarea rows={3} value={evForm.description}
                onChange={(e) => setEvForm((c) => ({ ...c, description: e.target.value }))} />
            </Field>
            <Field label="Notes">
              <textarea rows={2} value={evForm.notes}
                onChange={(e) => setEvForm((c) => ({ ...c, notes: e.target.value }))} />
            </Field>

            {/* Replacement-specific fields */}
            {evForm.eventType === 'replace' && (
              <div className="hr-replacement-section">
                <label className="checkbox-label">
                  <input type="checkbox" checked={evForm.isReplacement}
                    onChange={(e) => setEvForm((c) => ({ ...c, isReplacement: e.target.checked }))} />
                  Create new replacement asset (old asset → Inactive)
                </label>
                {evForm.isReplacement && (
                  <>
                    <Field label="New Asset Name" hint="Leave blank to auto-generate">
                      <input type="text" placeholder={`${selectedAsset?.name} (Replacement)`}
                        value={evForm.newAssetName}
                        onChange={(e) => setEvForm((c) => ({ ...c, newAssetName: e.target.value }))} />
                    </Field>
                    <Field label="New Asset Serial No">
                      <input type="text" value={evForm.newAssetSerial}
                        onChange={(e) => setEvForm((c) => ({ ...c, newAssetSerial: e.target.value }))} />
                    </Field>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="hr-modal-footer">
            <button type="button" className="ghost-light-button" onClick={() => setShowAddEv(false)}>Cancel</button>
            <button type="button" className="primary-button" onClick={handleSaveEvent} disabled={!canWriteHistory}>
              Save Event
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
