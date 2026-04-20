const SIDEBAR_COLLAPSED_KEY = 'unified.workspace.sidebarCollapsed'
const NAV_GROUP_STATE_KEY = 'unified.workspace.navGroups'
const PREFERRED_SUBSTATION_KEY = 'unified.workspace.preferredSubstationId'
const WORKSPACE_EXPANDED_KEY = 'unified.workspace.expanded'
const REPORT_PREVIEW_LAYOUT_KEY = 'unified.workspace.reportPreviewLayout'
const DAILY_LOG_KPI_VISIBLE_KEY = 'unified.dailyLog.kpiVisible'
const UI_THEME_KEY = 'unified.workspace.uiTheme'

function readLocalStorage(key, fallbackValue) {
  try {
    const rawValue = window.localStorage.getItem(key)
    return rawValue === null ? fallbackValue : rawValue
  } catch {
    return fallbackValue
  }
}

function writeLocalStorage(key, value) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

export function getSidebarCollapsed(defaultValue = false) {
  const rawValue = readLocalStorage(SIDEBAR_COLLAPSED_KEY, '')

  if (rawValue === '') {
    return defaultValue
  }

  return rawValue === 'true'
}

export function hasStoredSidebarPreference() {
  return readLocalStorage(SIDEBAR_COLLAPSED_KEY, '') !== ''
}

export function setSidebarCollapsed(value) {
  writeLocalStorage(SIDEBAR_COLLAPSED_KEY, String(Boolean(value)))
}

export function getNavigationGroupState(defaultValue = {}) {
  const rawValue = readLocalStorage(NAV_GROUP_STATE_KEY, '')

  if (!rawValue) {
    return defaultValue
  }

  try {
    return JSON.parse(rawValue)
  } catch {
    return defaultValue
  }
}

export function setNavigationGroupState(value) {
  writeLocalStorage(NAV_GROUP_STATE_KEY, JSON.stringify(value || {}))
}

export function getPreferredSubstationId() {
  return readLocalStorage(PREFERRED_SUBSTATION_KEY, '')
}

export function setPreferredSubstationId(value) {
  writeLocalStorage(PREFERRED_SUBSTATION_KEY, String(value || ''))
}

export function getWorkspaceExpanded(defaultValue = false) {
  const rawValue = readLocalStorage(WORKSPACE_EXPANDED_KEY, '')

  if (rawValue === '') {
    return defaultValue
  }

  return rawValue === 'true'
}

export function setWorkspaceExpanded(value) {
  writeLocalStorage(WORKSPACE_EXPANDED_KEY, String(Boolean(value)))
}

/** 'wide' = full-width on screen; 'print' = paper-width centered preview */
export function getReportPreviewLayout(defaultValue = 'print') {
  const raw = readLocalStorage(REPORT_PREVIEW_LAYOUT_KEY, '')
  return raw === 'wide' || raw === 'print' ? raw : defaultValue
}

export function setReportPreviewLayout(value) {
  const next = value === 'wide' ? 'wide' : 'print'
  writeLocalStorage(REPORT_PREVIEW_LAYOUT_KEY, next)
}

export function getDailyLogKpiVisible(defaultValue = true) {
  const rawValue = readLocalStorage(DAILY_LOG_KPI_VISIBLE_KEY, '')

  if (rawValue === '') {
    return defaultValue
  }

  return rawValue === 'true'
}

export function setDailyLogKpiVisible(value) {
  writeLocalStorage(DAILY_LOG_KPI_VISIBLE_KEY, String(Boolean(value)))
}

/** 'light' | 'dark' — applied on <html data-theme="…"> from AppShell */
export function getUiTheme(defaultValue = 'light') {
  const raw = readLocalStorage(UI_THEME_KEY, '')
  if (raw === 'dark' || raw === 'light') {
    return raw
  }
  return defaultValue
}

export function setUiTheme(value) {
  const next = value === 'dark' ? 'dark' : 'light'
  writeLocalStorage(UI_THEME_KEY, next)
}

export function resolvePreferredSubstationId(substations = [], currentValue = '') {
  const availableIds = substations.map((item) => item.id)

  if (currentValue && availableIds.includes(currentValue)) {
    return currentValue
  }

  const preferredSubstationId = getPreferredSubstationId()

  if (preferredSubstationId && availableIds.includes(preferredSubstationId)) {
    return preferredSubstationId
  }

  return substations[0]?.id || ''
}
