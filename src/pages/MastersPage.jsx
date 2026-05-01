import { useEffect, useState } from 'react'
import MasterDataManager from '../components/forms/MasterDataManager'
import { useAuth } from '../context/AuthContext'
import { Capacitor } from '@capacitor/core'
import { alertDetailSaved } from '../lib/detailSavedAlert'
import { exportJson } from '../lib/exportUtils'
import { saveBlobToDevice, shareFileUri } from '../lib/shareUtils'
import { APP_VERSION_NAME } from '../lib/appVersion'
import {
  buildBackupSnapshot,
  deleteMasterRecord,
  deleteUserSubstationMapping,
  getSettingsBundle,
  importBackupSnapshot,
  listMasterRecords,
  loadWorkspaceConfiguration,
  loadUserSubstationMappings,
  loadReferenceData,
  saveMasterRecord,
  saveSettingsBundle,
  saveUserSubstationMapping,
} from '../lib/unifiedDataService'
import { normalizeAccessRole } from '../lib/substationAccess'

const emptyImportState = {
  error: '',
  status: '',
  preview: null,
}

function formatBackupFileName(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `qt33-dlr-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}.json`
}

function summarizeBackupSnapshot(snapshot) {
  const payload =
    snapshot?.snapshotPayload && typeof snapshot.snapshotPayload === 'object'
      ? snapshot.snapshotPayload
      : snapshot
  const countCollection = (value) => {
    if (Array.isArray(value)) {
      return value.length
    }
    if (value && typeof value === 'object') {
      return Object.values(value).reduce((total, item) => total + countCollection(item), 0)
    }
    return 0
  }
  return {
    backupVersion: snapshot?.backupVersion || 'legacy',
    appVersion: snapshot?.appVersion || 'unknown',
    exportedAt: snapshot?.exportedAt || snapshot?.created_at || '',
    recordsCount: countCollection(payload),
  }
}

function normalizeCtRatioValue(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
}

function isValidCtRatio(value) {
  return /^\d+\/\d+$/.test(normalizeCtRatioValue(value))
}

function suggestMfFromCtRatio(value) {
  if (!isValidCtRatio(value)) {
    return ''
  }

  const [primary, secondary] = normalizeCtRatioValue(value)
    .split('/')
    .map((part) => Number(part))

  if (!secondary) {
    return ''
  }

  const ratio = Number((primary / secondary).toFixed(2))
  return Number.isFinite(ratio) ? String(ratio) : ''
}

function applyFeederCtRatioChange(currentForm, nextCtRatio) {
  const previousSuggestion = suggestMfFromCtRatio(currentForm.ctRatio)
  const nextSuggestion = suggestMfFromCtRatio(nextCtRatio)
  const currentMf = String(currentForm.mf || '').trim()
  const shouldAutoUpdateMf =
    !currentMf || (previousSuggestion && currentMf === previousSuggestion)

  return {
    ...currentForm,
    ctRatio: nextCtRatio,
    mf: shouldAutoUpdateMf ? nextSuggestion : currentForm.mf,
  }
}

export default function MastersPage() {
  const { profile, isAdmin, listUsers } = useAuth()
  const actorRole = normalizeAccessRole(profile?.role)
  const isSubstationAdmin = actorRole === 'substation_admin'
  const [substations, setSubstations] = useState([])
  const [users, setUsers] = useState([])
  const [settings, setSettings] = useState(getSettingsBundle())
  const [divisions, setDivisions] = useState(listMasterRecords('divisions', { profile }))
  const [feeders, setFeeders] = useState(listMasterRecords('feeders', { profile }))
  const [batterySets, setBatterySets] = useState(listMasterRecords('batterySets', { profile }))
  const [transformers, setTransformers] = useState(listMasterRecords('transformers', { profile }))
  const [mappings, setMappings] = useState([])
  const [importState, setImportState] = useState(emptyImportState)
  const [pendingImportSnapshot, setPendingImportSnapshot] = useState(null)

  useEffect(() => {
    let active = true

    async function bootstrap() {
      const referenceData = await loadReferenceData(profile)
      const mappingRows = await loadUserSubstationMappings(profile)

      if (!active) {
        return
      }

      setSubstations(referenceData.substations)

      if (isAdmin) {
        try {
          const userRows = await listUsers()
          const visibleUsers = userRows.users || []
          const visibleUserIds = new Set(
            visibleUsers
              .flatMap((user) => [user?.id, user?.auth_user_id, user?.firebase_uid])
              .map((value) => String(value || '').trim())
              .filter(Boolean),
          )
          const visibleMappings = isSubstationAdmin
            ? mappingRows.filter((mapping) =>
                visibleUserIds.has(
                  String(
                    mapping?.userId ??
                      mapping?.user_id ??
                      mapping?.profile_id ??
                      mapping?.auth_user_id ??
                      '',
                  ).trim(),
                ),
              )
            : mappingRows

          if (active) {
            setUsers(visibleUsers)
            setMappings(visibleMappings)
          }
        } catch {
          if (active) {
            setUsers([])
            setMappings(isSubstationAdmin ? [] : mappingRows)
          }
        }
      } else {
        setMappings(mappingRows)
      }
    }

    void bootstrap()

    return () => {
      active = false
    }
  }, [isAdmin, listUsers, profile])

  async function refreshCollections() {
    const referenceData = await loadReferenceData(profile)
    await loadWorkspaceConfiguration(profile)
    const mappingRows = await loadUserSubstationMappings(profile)
    setSubstations(referenceData.substations)
    setDivisions(listMasterRecords('divisions', { profile }))
    setFeeders(listMasterRecords('feeders', { profile }))
    setBatterySets(listMasterRecords('batterySets', { profile }))
    setTransformers(listMasterRecords('transformers', { profile }))
    if (isAdmin) {
      try {
        const userRows = await listUsers()
        const visibleUsers = userRows.users || []
        const visibleUserIds = new Set(
          visibleUsers
            .flatMap((user) => [user?.id, user?.auth_user_id, user?.firebase_uid])
            .map((value) => String(value || '').trim())
            .filter(Boolean),
        )
        const visibleMappings = isSubstationAdmin
          ? mappingRows.filter((mapping) =>
              visibleUserIds.has(
                String(
                  mapping?.userId ??
                    mapping?.user_id ??
                    mapping?.profile_id ??
                    mapping?.auth_user_id ??
                    '',
                ).trim(),
              ),
            )
          : mappingRows
        setUsers(visibleUsers)
        setMappings(visibleMappings)
      } catch {
        setUsers([])
        setMappings(isSubstationAdmin ? [] : mappingRows)
      }
    } else {
      setMappings(mappingRows)
    }
    setSettings(getSettingsBundle())
  }

  async function handleMasterSave(type, record) {
    const nextRecord =
      type === 'feeders'
        ? {
            ...record,
            expectedUnit:
              record.expectedUnit ??
              record.expected_unit ??
              record.daily_expected_unit ??
              '',
            expected_unit:
              record.expected_unit ??
              record.expectedUnit ??
              record.daily_expected_unit ??
              '',
            daily_expected_unit:
              record.daily_expected_unit ??
              record.expected_unit ??
              record.expectedUnit ??
              '',
          }
        : record

    await saveMasterRecord(type, nextRecord, profile)
    await refreshCollections()
    alertDetailSaved()
  }

  async function handleMasterDelete(type, recordId) {
    await deleteMasterRecord(type, recordId, profile)
    await refreshCollections()
  }

  function handleSettingsChange(section, field, value) {
    setSettings((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [field]: value,
      },
    }))
  }

  async function saveSettings() {
    await saveSettingsBundle(settings, profile)
    await refreshCollections()
    alertDetailSaved()
  }

  async function handleBackupExport() {
    try {
      const snapshot = await buildBackupSnapshot(profile)
      const filename = formatBackupFileName(new Date())
      if (Capacitor.isNativePlatform()) {
        const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
          type: 'application/json',
        })
        const uri = await saveBlobToDevice(blob, filename)
        await shareFileUri(uri, filename, 'QT33 Backup Export')
        setImportState({
          error: '',
          status: `Backup exported. ${filename}`,
          preview: null,
        })
      } else {
        exportJson(snapshot, filename)
        setImportState({
          error: '',
          status: `Backup exported. ${filename}`,
          preview: null,
        })
      }
    } catch (error) {
      setImportState({
        error: error.message,
        status: '',
        preview: null,
      })
    }
  }

  async function handleImportChange(event) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const parsedSnapshot = JSON.parse(text)
      const preview = summarizeBackupSnapshot(parsedSnapshot)
      setPendingImportSnapshot(parsedSnapshot)
      setImportState({
        error: '',
        status: 'Backup file parsed. Confirm import to continue.',
        preview,
      })
    } catch (error) {
      setImportState({
        error: error.message,
        status: '',
        preview: null,
      })
      setPendingImportSnapshot(null)
    }
  }

  async function handleConfirmImport() {
    if (!pendingImportSnapshot) {
      return
    }
    try {
      await importBackupSnapshot(
        {
          ...pendingImportSnapshot,
          imported_at: new Date().toISOString(),
        },
        profile,
      )
      await refreshCollections()
      setImportState({
        error: '',
        status: 'Backup imported successfully. Please restart app once.',
        preview: null,
      })
      setPendingImportSnapshot(null)
    } catch (error) {
      setImportState({
        error: error.message,
        status: '',
        preview: null,
      })
    }
  }

  const substationOptions = substations.map((item) => ({
    value: item.id,
    label: item.name,
  }))

  const feederOptions = feeders.map((item) => ({
    value: item.id,
    label: item.name,
  }))

  const divisionOptions = divisions.map((item) => ({
    value: item.id,
    label: item.name,
  }))

  const userOptions = users.flatMap((item) => {
    const label = `${item.full_name || item.email} (${item.email})`
    const candidateIds = [item.id, item.auth_user_id, item.firebase_uid]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
    return Array.from(new Set(candidateIds)).map((value) => ({
      value,
      label,
    }))
  })

  if (!isAdmin) {
    return (
      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Restricted</p>
            <h2>Masters screen admin kiwa super admin sathi aahe.</h2>
          </div>
        </div>
        <p className="muted-copy">
          Substation users la operational entry ani reports available rahatil, pan master configuration admin madhunach maintain hoil.
        </p>
      </section>
    )
  }

  return (
    <div className="page-stack">
      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Shared masters</p>
            <h2>Operational configuration</h2>
          </div>
        </div>
        <p className="muted-copy">
          Divisions, feeders, battery sets, company profile, print defaults,
          backup, and user-substation mapping are maintained here for DLR operations.
        </p>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Company profile</p>
            <h2>Header and print settings</h2>
          </div>
        </div>
        <div className="details-grid">
          <div>
            <label htmlFor="company-name">Company Name</label>
            <input
              id="company-name"
              value={settings.companyProfile.companyName}
              onChange={(event) =>
                handleSettingsChange('companyProfile', 'companyName', event.target.value)
              }
            />
          </div>
          <div>
            <label htmlFor="office-name">Office Name</label>
            <input
              id="office-name"
              value={settings.companyProfile.officeName}
              onChange={(event) =>
                handleSettingsChange('companyProfile', 'officeName', event.target.value)
              }
            />
          </div>
          <div>
            <label htmlFor="company-address">Address</label>
            <input
              id="company-address"
              value={settings.companyProfile.address}
              onChange={(event) =>
                handleSettingsChange('companyProfile', 'address', event.target.value)
              }
            />
          </div>
          <div>
            <label htmlFor="company-contact">Contact</label>
            <input
              id="company-contact"
              value={settings.companyProfile.contactNumber}
              onChange={(event) =>
                handleSettingsChange('companyProfile', 'contactNumber', event.target.value)
              }
            />
          </div>
          <div>
            <label htmlFor="report-footer">Report Footer</label>
            <input
              id="report-footer"
              value={settings.companyProfile.reportFooter}
              onChange={(event) =>
                handleSettingsChange('companyProfile', 'reportFooter', event.target.value)
              }
            />
          </div>
          <div>
            <label htmlFor="print-orientation">Default Orientation</label>
            <select
              id="print-orientation"
              value={settings.printSettings.defaultOrientation}
              onChange={(event) =>
                handleSettingsChange('printSettings', 'defaultOrientation', event.target.value)
              }
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </div>
          <div>
            <label htmlFor="font-scale">Print Font Scale</label>
            <input
              id="font-scale"
              type="number"
              step="0.05"
              value={settings.printSettings.fontScale}
              onChange={(event) =>
                handleSettingsChange('printSettings', 'fontScale', event.target.value)
              }
            />
          </div>
          <label className="checkbox-label" htmlFor="compact-tables">
            <input
              id="compact-tables"
              type="checkbox"
              checked={Boolean(settings.printSettings.compactTables)}
              onChange={(event) =>
                handleSettingsChange('printSettings', 'compactTables', event.target.checked)
              }
            />
            Compact tables
          </label>
        </div>
        <div className="inline-actions">
          <button type="button" className="primary-button" onClick={() => void saveSettings()}>
            Save settings
          </button>
        </div>
      </section>

      <MasterDataManager
        title="Divisions"
        description="Division names are used in battery records, maintenance reports, and section headers."
        fields={[
          { name: 'code', label: 'Code', required: true },
          { name: 'name', label: 'Name', required: true },
        ]}
        records={divisions}
        onSave={(record) => void handleMasterSave('divisions', record)}
        onDelete={(recordId) => void handleMasterDelete('divisions', recordId)}
      />

      <MasterDataManager
        title="Feeders"
        description="Feeder master drives daily log data entry and monthly reconciliation reports."
        fields={[
          { name: 'code', label: 'Code', required: true },
          { name: 'name', label: 'Name', required: true },
          {
            name: 'substationId',
            label: 'Substation',
            required: true,
            type: 'select',
            options: substationOptions,
          },
          {
            name: 'voltageLevel',
            label: 'Voltage Level',
            required: true,
            type: 'select',
            options: [
              { value: '11', label: '11 KV' },
              { value: '33', label: '33 KV' },
            ],
          },
          {
            name: 'feederType',
            label: 'Feeder Type',
            required: true,
            type: 'select',
            options: [
              { value: 'main_incoming', label: 'Main Incoming' },
              { value: 'child_feeder', label: 'Child Feeder' },
              { value: 'normal', label: 'Normal Feeder' },
              { value: 'express_feeder', label: 'Express Feeder' },
              { value: 'incoming_33kv', label: '33 KV Incoming' },
            ],
          },
          {
            name: 'parentFeederId',
            label: 'Parent Feeder',
            type: 'select',
            options: feederOptions,
          },
          {
            name: 'displayOrder',
            label: 'Serial No',
            type: 'number',
          },
          {
            name: 'ctRatio',
            label: 'CT Ratio',
            applyChange: applyFeederCtRatioChange,
          },
          {
            name: 'mf',
            label: 'MF',
          },
          {
            name: 'expectedUnit',
            label: 'Expected Unit',
            type: 'number',
          },
          {
            name: 'isMainIncoming',
            label: 'Main Incoming',
            type: 'checkbox',
          },
          {
            name: 'includeInTotal',
            label: 'Include In Total Load',
            type: 'checkbox',
          },
        ]}
        records={feeders}
        onSave={(record) => void handleMasterSave('feeders', record)}
        onDelete={(recordId) => void handleMasterDelete('feeders', recordId)}
      />

      <MasterDataManager
        title="Battery Sets"
        description="Battery set metadata controls weekly maintenance records and cell-grid defaults."
        fields={[
          { name: 'name', label: 'Name', required: true },
          {
            name: 'divisionId',
            label: 'Division',
            required: true,
            type: 'select',
            options: divisionOptions,
          },
          {
            name: 'substationId',
            label: 'Substation',
            required: true,
            type: 'select',
            options: substationOptions,
          },
          { name: 'displayOrder', label: 'Serial No', type: 'number' },
          { name: 'cellCount', label: 'Cell Count', type: 'number', required: true },
          { name: 'nominalVoltage', label: 'Nominal Voltage', type: 'number', required: true },
        ]}
        records={batterySets}
        onSave={(record) => void handleMasterSave('batterySets', record)}
        onDelete={(recordId) => void handleMasterDelete('batterySets', recordId)}
      />

      <MasterDataManager
        title="Transformers"
        description="Transformer master controls the tap-position and temperature columns in the Daily Log chart and print layout."
        fields={[
          { name: 'name', label: 'Name', required: true },
          {
            name: 'substationId',
            label: 'Substation',
            required: true,
            type: 'select',
            options: substationOptions,
          },
          { name: 'displayOrder', label: 'Serial No', type: 'number' },
          { name: 'ratedCapacityMva', label: 'Rated Capacity (MVA)', type: 'number' },
        ]}
        records={transformers}
        onSave={(record) => void handleMasterSave('transformers', record)}
        onDelete={(recordId) => void handleMasterDelete('transformers', recordId)}
      />

      {isAdmin ? (
        <MasterDataManager
          title="User Substation Mapping"
          description="Non-admin users are restricted to the mapped substations in DLR pages."
          fields={[
            {
              name: 'userId',
              label: 'User',
              required: true,
              type: 'select',
              options: userOptions,
            },
            {
              name: 'substationId',
              label: 'Substation',
              required: true,
              type: 'select',
              options: substationOptions,
            },
          ]}
          records={mappings}
          onSave={async (record) => {
            await saveUserSubstationMapping(record, profile)
            await refreshCollections()
            alertDetailSaved()
          }}
          onDelete={async (recordId) => {
            await deleteUserSubstationMapping(recordId, profile)
            await refreshCollections()
          }}
        />
      ) : null}

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Backup</p>
            <h2>Import / Export</h2>
          </div>
        </div>
        <p className="muted-copy">
          Export the full local operational dataset as JSON or import it back for localhost and APK continuity.
        </p>
        {importState.status ? (
          <div className="callout success-callout">
            <p>{importState.status}</p>
          </div>
        ) : null}
        {importState.error ? (
          <div className="callout danger-callout">
            <p>{importState.error}</p>
          </div>
        ) : null}
        {importState.preview ? (
          <div className="callout info-callout">
            <p>{`Backup version: ${importState.preview.backupVersion}`}</p>
            <p>{`App version: ${importState.preview.appVersion}`}</p>
            <p>{`Exported at: ${importState.preview.exportedAt || '-'}`}</p>
            <p>{`Estimated records: ${importState.preview.recordsCount}`}</p>
          </div>
        ) : null}
        <div className="inline-actions">
          <button type="button" className="primary-button" onClick={() => void handleBackupExport()}>
            Export backup
          </button>
          <label className="ghost-light-button file-upload-button" htmlFor="backup-import">
            Import backup
          </label>
          <input id="backup-import" type="file" accept=".json,application/json" onChange={(event) => void handleImportChange(event)} hidden />
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleConfirmImport()}
            disabled={!pendingImportSnapshot}
          >
            Confirm import
          </button>
        </div>
        <p className="muted-copy">{`Backup app version: ${APP_VERSION_NAME}`}</p>
      </section>
    </div>
  )
}
