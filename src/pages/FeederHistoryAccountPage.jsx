import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  MAINTENANCE_TYPES,
  applyMaintenanceHistoryFilters,
  normalizeMaintenanceRows,
  readAssetMasterRecords,
  summarizeMaintenanceRows,
} from '../lib/maintenanceLinking'
import {
  listDlrRecords,
  listMasterRecords,
  loadDlrRecords,
  loadReferenceData,
} from '../lib/unifiedDataService'
import { formatIsoDate } from '../lib/dateUtils'

const todayIso = formatIsoDate(new Date())

export default function FeederHistoryAccountPage() {
  const { profile } = useAuth()
  const [referenceData, setReferenceData] = useState({ substations: [] })
  const [feeders, setFeeders] = useState([])
  const [assets, setAssets] = useState([])
  const [records, setRecords] = useState([])
  const [filters, setFilters] = useState({
    fromDate: todayIso.slice(0, 8) + '01',
    toDate: todayIso,
    feederId: '',
    assetId: '',
    maintenanceType: '',
  })

  useEffect(() => {
    let active = true
    async function bootstrap() {
      const bundle = await loadReferenceData(profile)
      await loadDlrRecords({ moduleName: 'maintenance', profile })
      if (!active) return
      setReferenceData(bundle)
      setFeeders(listMasterRecords('feeders', { profile }))
      setAssets(readAssetMasterRecords())
      setRecords(listDlrRecords({ moduleName: 'maintenance', profile }))
    }
    void bootstrap()
    return () => {
      active = false
    }
  }, [profile])

  const visibleSubstationIds = useMemo(
    () => new Set((referenceData.substations || []).map((item) => item.id)),
    [referenceData.substations],
  )
  const scopedAssets = useMemo(
    () => assets.filter((item) => !visibleSubstationIds.size || visibleSubstationIds.has(item.substationId)),
    [assets, visibleSubstationIds],
  )
  const rows = useMemo(
    () => normalizeMaintenanceRows({ records, assets: scopedAssets, feeders }),
    [feeders, records, scopedAssets],
  )
  const filteredRows = useMemo(
    () => applyMaintenanceHistoryFilters(rows, filters),
    [filters, rows],
  )
  const selectedFeeder = feeders.find((item) => item.id === filters.feederId) || null
  const feederRows = filteredRows.filter((row) =>
    filters.feederId ? row.feederId === filters.feederId : true,
  )
  const summary = summarizeMaintenanceRows(feederRows)
  const feederAssets = scopedAssets.filter((item) =>
    filters.feederId ? item.feederId === filters.feederId : true,
  )

  return (
    <div className="page-stack">
      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Maintenance account</p>
            <h2>Feeder History Account</h2>
          </div>
        </div>
        <div className="details-grid">
          <div>
            <label htmlFor="feeder-account-from">From</label>
            <input
              id="feeder-account-from"
              type="date"
              value={filters.fromDate}
              onChange={(event) =>
                setFilters((current) => ({ ...current, fromDate: event.target.value }))
              }
            />
          </div>
          <div>
            <label htmlFor="feeder-account-to">To</label>
            <input
              id="feeder-account-to"
              type="date"
              value={filters.toDate}
              onChange={(event) =>
                setFilters((current) => ({ ...current, toDate: event.target.value }))
              }
            />
          </div>
          <div>
            <label htmlFor="feeder-account-feeder">Feeder</label>
            <select
              id="feeder-account-feeder"
              value={filters.feederId}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  feederId: event.target.value,
                  assetId: '',
                }))
              }
            >
              <option value="">All feeders</option>
              {feeders.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="feeder-account-asset">Asset</label>
            <select
              id="feeder-account-asset"
              value={filters.assetId}
              onChange={(event) =>
                setFilters((current) => ({ ...current, assetId: event.target.value }))
              }
            >
              <option value="">All assets</option>
              {feederAssets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="feeder-account-type">Maintenance type</label>
            <select
              id="feeder-account-type"
              value={filters.maintenanceType}
              onChange={(event) =>
                setFilters((current) => ({ ...current, maintenanceType: event.target.value }))
              }
            >
              <option value="">All types</option>
              {MAINTENANCE_TYPES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="content-card">
        <div className="details-grid">
          <article className="detail-card">
            <small>Feeder name</small>
            <strong>{selectedFeeder?.name || 'All feeders'}</strong>
          </article>
          <article className="detail-card">
            <small>Total maintenance count</small>
            <strong>{summary.totalCount}</strong>
          </article>
          <article className="detail-card">
            <small>Last maintenance date</small>
            <strong>{summary.lastMaintenanceDate}</strong>
          </article>
          <article className="detail-card">
            <small>Total duration/downtime</small>
            <strong>{summary.totalDurationLabel}</strong>
          </article>
        </div>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Read only</p>
            <h2>Maintenance entries</h2>
          </div>
        </div>
        <div className="table-shell">
          <table className="simple-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Maintenance type</th>
                <th>Duration</th>
                <th>Part changed</th>
                <th>Part name</th>
                <th>Remark</th>
                <th>Done by</th>
              </tr>
            </thead>
            <tbody>
              {feederRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.operationalDate || '-'}</td>
                  <td>{row.time || '-'}</td>
                  <td>{row.maintenanceType || '-'}</td>
                  <td>{row.durationLabel || '-'}</td>
                  <td>{row.partChanged ? 'Yes' : 'No'}</td>
                  <td>{row.partName || '-'}</td>
                  <td>{row.remark || row.workDetail || '-'}</td>
                  <td>{row.doneBy || '-'}</td>
                </tr>
              ))}
              {!feederRows.length ? (
                <tr>
                  <td colSpan={8}>No linked maintenance entries found.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

