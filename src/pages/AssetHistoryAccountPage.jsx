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

export default function AssetHistoryAccountPage() {
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
  const assetRows = filteredRows.filter((row) => (filters.assetId ? row.assetId === filters.assetId : true))
  const summary = summarizeMaintenanceRows(assetRows)
  const selectedAsset = scopedAssets.find((item) => item.id === filters.assetId) || null
  const feederById = useMemo(() => new Map(feeders.map((item) => [item.id, item])), [feeders])
  const selectedFeeder = selectedAsset ? feederById.get(selectedAsset.feederId) : null
  const filteredAssets = scopedAssets.filter((item) =>
    filters.feederId ? item.feederId === filters.feederId : true,
  )

  return (
    <div className="page-stack">
      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Maintenance account</p>
            <h2>Asset History Account</h2>
          </div>
        </div>
        <div className="details-grid">
          <div>
            <label htmlFor="asset-account-from">From</label>
            <input
              id="asset-account-from"
              type="date"
              value={filters.fromDate}
              onChange={(event) =>
                setFilters((current) => ({ ...current, fromDate: event.target.value }))
              }
            />
          </div>
          <div>
            <label htmlFor="asset-account-to">To</label>
            <input
              id="asset-account-to"
              type="date"
              value={filters.toDate}
              onChange={(event) =>
                setFilters((current) => ({ ...current, toDate: event.target.value }))
              }
            />
          </div>
          <div>
            <label htmlFor="asset-account-feeder">Feeder</label>
            <select
              id="asset-account-feeder"
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
            <label htmlFor="asset-account-asset">Asset</label>
            <select
              id="asset-account-asset"
              value={filters.assetId}
              onChange={(event) =>
                setFilters((current) => ({ ...current, assetId: event.target.value }))
              }
            >
              <option value="">All assets</option>
              {filteredAssets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="asset-account-type">Maintenance type</label>
            <select
              id="asset-account-type"
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
            <small>Asset name</small>
            <strong>{selectedAsset?.name || 'All assets'}</strong>
          </article>
          <article className="detail-card">
            <small>Linked feeder</small>
            <strong>{selectedFeeder?.name || '-'}</strong>
          </article>
          <article className="detail-card">
            <small>Total maintenance count</small>
            <strong>{summary.totalCount}</strong>
          </article>
          <article className="detail-card">
            <small>Part change count</small>
            <strong>{summary.partChangeCount}</strong>
          </article>
          <article className="detail-card">
            <small>Last maintenance date</small>
            <strong>{summary.lastMaintenanceDate}</strong>
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
              {assetRows.map((row) => (
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
              {!assetRows.length ? (
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

