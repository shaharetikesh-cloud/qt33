import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { navigationGroups, findNavigationItem } from '../config/navigation'
import { useAuth } from '../context/AuthContext'
import { loadReferenceData } from '../lib/unifiedDataService'
import {
  getNavigationGroupState,
  getPreferredSubstationId,
  getSidebarCollapsed,
  getUiTheme,
  getWorkspaceExpanded,
  hasStoredSidebarPreference,
  setNavigationGroupState,
  setPreferredSubstationId,
  setSidebarCollapsed,
  setUiTheme,
  setWorkspaceExpanded,
} from '../lib/uiPreferences'
import AppIcon from './ui/AppIcon'
import Qt33OffsiteBrand from './ui/Qt33OffsiteBrand'
import { runManualSyncNow, subscribeSyncState } from '../lib/syncEngine'

const defaultGroupState = Object.fromEntries(
  navigationGroups.map((group) => [group.key, true]),
)

function canAccessNavigationItem(item, access) {
  if (item.moduleKey && !access.canViewModule(item.moduleKey)) {
    return false
  }

  if (!item.access) {
    return true
  }

  if (item.access === 'main_admin') {
    return access.isMainAdmin
  }

  if (item.access === 'user_manager') {
    return access.canManageUsers
  }

  return true
}

function getVisibleGroups(access) {
  return navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccessNavigationItem(item, access)),
    }))
    .filter((group) => group.items.length)
}

function getWorkspaceRouteKey(pathname) {
  const raw = pathname || '/'
  if (raw === '/' || raw === '') {
    return 'dashboard'
  }
  const first = raw.replace(/^\/+/, '').split('/')[0] || 'workspace'
  return first.replace(/[^a-z0-9-]/gi, '') || 'workspace'
}

export default function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    profile,
    session,
    canViewModule,
    canManageUsers,
    isMainAdmin,
    isApproved,
    signOut,
    authBusy,
    profileError,
    backendLabel,
    roleLabel,
  } = useAuth()

  const headerRef = useRef(null)
  const dropdownRef = useRef(null)
  const sidebarBeforeWorkspaceExpandRef = useRef(null)
  const hasCommittedRouteRef = useRef(false)
  const activeItem = findNavigationItem(location.pathname)
  const visibleGroups = useMemo(
    () =>
      getVisibleGroups({
        canViewModule,
        canManageUsers,
        isMainAdmin,
      }),
    [canManageUsers, canViewModule, isMainAdmin],
  )

  const [sidebarCollapsed, setSidebarCollapsedState] = useState(() =>
    getSidebarCollapsed(Boolean(activeItem?.focusMode) || window.innerWidth < 1180),
  )
  const [expandedGroups, setExpandedGroups] = useState(() => ({
    ...defaultGroupState,
    ...getNavigationGroupState(defaultGroupState),
  }))
  const [workspaceExpanded, setWorkspaceExpandedState] = useState(() =>
    getWorkspaceExpanded(false),
  )
  const [substations, setSubstations] = useState([])
  const [preferredSubstationId, setPreferredSubstationIdState] = useState(() =>
    getPreferredSubstationId(),
  )
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1366,
  )
  const [referenceError, setReferenceError] = useState('')
  const [uiTheme, setUiThemeState] = useState(() => getUiTheme())
  const [syncState, setSyncState] = useState({
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    pending: 0,
    failed: 0,
    syncing: false,
    conflicts: 0,
    runTotal: 0,
    runProcessed: 0,
    runPulled: 0,
    runPushed: 0,
  })
  const [manualSyncBusy, setManualSyncBusy] = useState(false)
  const [manualSyncNote, setManualSyncNote] = useState('')

  const isCompactViewport = viewportWidth <= 1080
  const isPhoneViewport = viewportWidth <= 760
  const isWorkspaceExpanded = Boolean(workspaceExpanded)
  const showMobileSidebar = isCompactViewport && !sidebarCollapsed && !isWorkspaceExpanded
  const currentBreadcrumbs = activeItem?.breadcrumbs || ['Dashboard', 'Overview']
  const currentPageTitle = activeItem?.pageTitle || 'Workspace'
  const currentUserName =
    profile?.full_name || profile?.username || session?.user?.username || 'Guest'
  const currentUserLabel =
    isPhoneViewport && currentUserName.includes(' ')
      ? currentUserName.split(' ')[0]
      : currentUserName
  const approvalLabel = isApproved ? 'Approved' : profile?.approval_status || 'Pending'
  const brandTitle = isPhoneViewport ? 'QT ERP' : 'QT - Unified Substation ERP'
  const brandSubtitle = 'Substation DLR & Reports'

  const workspaceRouteKey = useMemo(
    () => getWorkspaceRouteKey(location.pathname),
    [location.pathname],
  )

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', uiTheme === 'dark' ? 'dark' : 'light')
  }, [uiTheme])

  function handleToggleUiTheme() {
    setUiThemeState((current) => {
      const next = current === 'dark' ? 'light' : 'dark'
      setUiTheme(next)
      return next
    })
  }

  useEffect(() => {
    let active = true

    async function bootstrap() {
      try {
        const bundle = await loadReferenceData(profile)

        if (!active) {
          return
        }

        setSubstations(bundle.substations || [])
        setReferenceError('')

        const availableIds = (bundle.substations || []).map((item) => item.id)
        const fallbackSubstationId =
          preferredSubstationId && availableIds.includes(preferredSubstationId)
            ? preferredSubstationId
            : bundle.substations?.[0]?.id || ''

        if (fallbackSubstationId && fallbackSubstationId !== preferredSubstationId) {
          setPreferredSubstationIdState(fallbackSubstationId)
          setPreferredSubstationId(fallbackSubstationId)
        }
      } catch (error) {
        if (!active) {
          return
        }

        setReferenceError(error?.message || 'Reference data load hou shakla nahi.')
      }
    }

    void bootstrap()

    return () => {
      active = false
    }
  }, [preferredSubstationId, profile])

  useEffect(() => {
    return subscribeSyncState((state) => {
      setSyncState({
        online: state.online,
        pending: state.pending,
        failed: state.failed,
        syncing: state.syncing,
        conflicts: state.conflicts,
        runTotal: state.runTotal || 0,
        runProcessed: state.runProcessed || 0,
        runPulled: state.runPulled || 0,
        runPushed: state.runPushed || 0,
      })
    })
  }, [])

  useEffect(() => {
    let syncDebounceTimer = null

    function scheduleForegroundSync() {
      if (syncDebounceTimer) {
        window.clearTimeout(syncDebounceTimer)
      }
      syncDebounceTimer = window.setTimeout(() => {
        void runManualSyncNow().catch(() => {})
      }, 250)
    }

    function handleWindowFocus() {
      scheduleForegroundSync()
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        scheduleForegroundSync()
      }
    }

    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', handleWindowFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (syncDebounceTimer) {
        window.clearTimeout(syncDebounceTimer)
      }
    }
  }, [])

  async function handleManualSync() {
    if (manualSyncBusy) {
      return
    }
    setManualSyncBusy(true)
    setManualSyncNote('')
    try {
      const summary = await runManualSyncNow()
      setManualSyncNote(
        `Sync done: ${summary.runProcessed || 0}/${summary.runTotal || 0} push, pulled ${summary.runPulled || 0}.`,
      )
    } catch (error) {
      setManualSyncNote(error?.message || 'Manual sync failed.')
    } finally {
      setManualSyncBusy(false)
    }
  }

  useEffect(() => {
    function handleWindowClick(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setProfileMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', handleWindowClick)
    return () => window.removeEventListener('pointerdown', handleWindowClick)
  }, [])

  useEffect(() => {
    function handleResize() {
      const nextWidth = window.innerWidth
      setViewportWidth(nextWidth)

      if (nextWidth <= 1080) {
        const restore = sidebarBeforeWorkspaceExpandRef.current
        sidebarBeforeWorkspaceExpandRef.current = null
        setWorkspaceExpandedState(false)
        setWorkspaceExpanded(false)
        const nextCollapsed = restore === null ? true : restore
        setSidebarCollapsedState(nextCollapsed)
        setSidebarCollapsed(nextCollapsed)
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useLayoutEffect(() => {
    const root = document.documentElement
    const headerElement = headerRef.current

    if (!root || !headerElement) {
      return undefined
    }

    function updateHeaderOffset() {
      const nextHeight = headerElement.offsetHeight

      if (nextHeight > 0) {
        root.style.setProperty('--workspace-header-height', `${nextHeight}px`)
        root.style.setProperty('--app-header-offset', `${nextHeight}px`)
      }
    }

    updateHeaderOffset()

    let resizeObserver = null

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateHeaderOffset()
      })
      resizeObserver.observe(headerElement)
    }

    window.addEventListener('resize', updateHeaderOffset)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateHeaderOffset)
      root.style.removeProperty('--workspace-header-height')
      root.style.removeProperty('--app-header-offset')
    }
  }, [location.pathname, viewportWidth, workspaceExpanded, preferredSubstationId, profileMenuOpen])

  useEffect(() => {
    document.body.classList.toggle('workspace-expanded', workspaceExpanded)
    return () => document.body.classList.remove('workspace-expanded')
  }, [workspaceExpanded])

  useEffect(() => {
    document.body.classList.toggle('workspace-mobile-nav-open', showMobileSidebar)
    return () => document.body.classList.remove('workspace-mobile-nav-open')
  }, [showMobileSidebar])

  useEffect(() => {
    if (!isCompactViewport) {
      return
    }
    if (!hasCommittedRouteRef.current) {
      hasCommittedRouteRef.current = true
      return
    }
    const timeoutId = window.setTimeout(() => {
      setSidebarCollapsedState(true)
      setSidebarCollapsed(true)
      setProfileMenuOpen(false)
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [location.pathname, isCompactViewport])

  function exitWorkspaceExpanded() {
    const restore = sidebarBeforeWorkspaceExpandRef.current
    sidebarBeforeWorkspaceExpandRef.current = null
    setWorkspaceExpandedState(false)
    setWorkspaceExpanded(false)
    const nextCollapsed = restore === null ? false : restore
    setSidebarCollapsedState(nextCollapsed)
    setSidebarCollapsed(nextCollapsed)
  }

  function handleToggleSidebar() {
    if (isWorkspaceExpanded) {
      exitWorkspaceExpanded()
      return
    }

    setSidebarCollapsedState((current) => {
      const nextValue = !current
      setSidebarCollapsed(nextValue)
      return nextValue
    })
  }

  function handleToggleWorkspaceExpanded() {
    setWorkspaceExpandedState((current) => {
      const nextValue = !current
      setWorkspaceExpanded(nextValue)

      if (nextValue) {
        setSidebarCollapsedState((wasCollapsed) => {
          sidebarBeforeWorkspaceExpandRef.current = wasCollapsed
          return true
        })
        setSidebarCollapsed(true)
      } else {
        const restore = sidebarBeforeWorkspaceExpandRef.current
        sidebarBeforeWorkspaceExpandRef.current = null
        const nextCollapsed = restore === null ? false : restore
        setSidebarCollapsedState(nextCollapsed)
        setSidebarCollapsed(nextCollapsed)
      }

      return nextValue
    })
  }

  function handleGroupToggle(groupKey) {
    setExpandedGroups((current) => {
      const nextValue = {
        ...current,
        [groupKey]: !current[groupKey],
      }
      setNavigationGroupState(nextValue)
      return nextValue
    })
  }

  return (
    <div
      className={[
        'app-shell',
        sidebarCollapsed ? 'app-shell-sidebar-collapsed' : '',
        activeItem?.focusMode ? 'app-shell-focus' : '',
        isWorkspaceExpanded ? 'app-shell-workspace-expanded' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-workspace-route={workspaceRouteKey}
    >
      <header
        ref={headerRef}
        className={[
          'workspace-header',
          isCompactViewport ? 'workspace-header-compact' : '',
          isPhoneViewport ? 'workspace-header-phone' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="gov-tricolor-strip">
          <span className="gov-strip-saffron" />
          <span className="gov-strip-white" />
          <span className="gov-strip-green" />
        </div>

        <div className="workspace-header-inner">
          <div className="workspace-header-left">
            <button
              type="button"
              className="header-icon-button"
              onClick={handleToggleSidebar}
              aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            >
              <AppIcon name="menu" />
            </button>

            <button
              type="button"
              className="header-icon-button workspace-theme-toggle"
              onClick={handleToggleUiTheme}
              aria-label={uiTheme === 'dark' ? 'Light mode' : 'Dark mode'}
              title={uiTheme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              <AppIcon name={uiTheme === 'dark' ? 'sun' : 'moon'} />
            </button>

            <div className="workspace-brand workspace-brand-qt33">
              <Qt33OffsiteBrand variant="header" />
              <div className="workspace-brand-copy">
                <strong className="workspace-brand-title">{brandTitle}</strong>
                <span className="workspace-brand-sub">{brandSubtitle}</span>
              </div>
            </div>
          </div>

          <div className="workspace-header-center">
            <p className="workspace-breadcrumbs">
              {currentBreadcrumbs.map((item, index) => (
                <span key={`${item}-${index}`}>
                  {index ? <span className="workspace-breadcrumb-separator">&gt;</span> : null}
                  {item}
                </span>
              ))}
            </p>
            <h1>{currentPageTitle}</h1>
          </div>

          <div className="workspace-header-right">
            {!isCompactViewport ? (
              <button
                type="button"
                className={[
                  'workspace-expand-button',
                  isWorkspaceExpanded ? 'workspace-expand-button-active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={handleToggleWorkspaceExpanded}
              >
                <AppIcon name={isWorkspaceExpanded ? 'compress' : 'expand'} size={16} />
                <span>{isWorkspaceExpanded ? 'Exit Workspace' : 'Expand Workspace'}</span>
              </button>
            ) : null}

            <label className="header-substation-picker" htmlFor="workspace-substation">
              <span className={syncState.online ? '' : 'text-danger'}>
                {syncState.online
                  ? `${syncState.syncing ? 'Syncing' : 'Sync'} ${syncState.pending}${syncState.failed ? ` / F${syncState.failed}` : ''}${syncState.conflicts ? ` / C${syncState.conflicts}` : ''}`
                  : 'Offline'}
              </span>
              {syncState.syncing || syncState.runTotal ? (
                <span>{`Run ${syncState.runProcessed || 0}/${syncState.runTotal || 0} | Pull ${syncState.runPulled || 0}`}</span>
              ) : null}
              {manualSyncNote ? <span>{manualSyncNote}</span> : null}
              <button
                type="button"
                className="ghost-light-button small-button"
                onClick={() => void handleManualSync()}
                disabled={!syncState.online || manualSyncBusy || syncState.syncing}
                title="Manual sync now"
              >
                {manualSyncBusy || syncState.syncing ? 'Syncing...' : 'Sync now'}
              </button>
              <span>Substation</span>
              <select
                id="workspace-substation"
                value={preferredSubstationId}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setPreferredSubstationIdState(nextValue)
                  setPreferredSubstationId(nextValue)
                }}
              >
                <option value="">All</option>
                {substations.map((substation) => (
                  <option key={substation.id} value={substation.id}>
                    {substation.name}
                  </option>
                ))}
              </select>
            </label>

            <div ref={dropdownRef} className="workspace-profile-shell">
              <button
                type="button"
                className="workspace-profile-button"
                onClick={() => setProfileMenuOpen((current) => !current)}
              >
                <div className="workspace-profile-avatar">
                  {currentUserName.slice(0, 1).toUpperCase()}
                </div>
                <div className="workspace-profile-copy">
                  <strong>{currentUserLabel}</strong>
                  <span>{roleLabel || 'Pending profile'}</span>
                </div>
                <AppIcon name={profileMenuOpen ? 'chevronDown' : 'chevronRight'} size={16} />
              </button>

              {profileMenuOpen ? (
                <div className="workspace-profile-menu">
                  <div className="workspace-profile-menu-header">
                    <strong>{currentUserName}</strong>
                    <span>
                      {profile?.username || session?.user?.username || 'No username available'}
                    </span>
                  </div>
                  <div className="workspace-profile-meta">
                    <div>
                      <span>Role</span>
                      <strong>{roleLabel || 'Pending'}</strong>
                    </div>
                    <div>
                      <span>Backend</span>
                      <strong>{backendLabel}</strong>
                    </div>
                    <div>
                      <span>Status</span>
                      <strong>{approvalLabel}</strong>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="workspace-profile-action"
                    onClick={() => navigate('/session')}
                  >
                    <AppIcon name="session" size={16} />
                    <span>Session</span>
                  </button>
                  <button
                    type="button"
                    className="workspace-profile-action workspace-profile-action-danger"
                    onClick={() => void signOut()}
                    disabled={!session || authBusy}
                  >
                    <AppIcon name="signOut" size={16} />
                    <span>{authBusy ? 'Working...' : 'Sign Out'}</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <button
        type="button"
        className={[
          'workspace-sidebar-backdrop',
          showMobileSidebar ? 'workspace-sidebar-backdrop-visible' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label="Close navigation"
        aria-hidden={!showMobileSidebar}
        tabIndex={showMobileSidebar ? 0 : -1}
        onClick={() => {
          setSidebarCollapsedState(true)
          setSidebarCollapsed(true)
        }}
      />

      <div className="workspace-body">
        <aside className="sidebar workspace-sidebar" aria-label="Primary navigation">
          <nav className="workspace-nav">
            {visibleGroups.map((group) => (
              <section
                key={group.key}
                className={[
                  'workspace-nav-group',
                  expandedGroups[group.key] ? 'workspace-nav-group-open' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <button
                  type="button"
                  className="workspace-nav-group-toggle"
                  onClick={() => handleGroupToggle(group.key)}
                  title={sidebarCollapsed ? group.label : undefined}
                >
                  {!sidebarCollapsed ? (
                    <span>{group.label}</span>
                  ) : (
                    <span className="workspace-nav-group-dot" />
                  )}
                  <AppIcon
                    name={expandedGroups[group.key] ? 'chevronDown' : 'chevronRight'}
                    size={14}
                  />
                </button>
                <div className="workspace-nav-group-body">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      title={sidebarCollapsed ? item.label : undefined}
                      onClick={() => {
                        if (isCompactViewport) {
                          setSidebarCollapsedState(true)
                          setSidebarCollapsed(true)
                        } else if (!hasStoredSidebarPreference()) {
                          setSidebarCollapsedState(Boolean(item.focusMode))
                        }

                        if (!item.focusMode && workspaceExpanded) {
                          exitWorkspaceExpanded()
                        }
                      }}
                      className={({ isActive }) =>
                        [
                          'nav-link workspace-nav-link',
                          isActive ? 'nav-link-active workspace-nav-link-active' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')
                      }
                      end={item.to === '/'}
                    >
                      <span className="workspace-nav-link-icon">
                        <AppIcon name={item.icon} size={18} />
                      </span>
                      {!sidebarCollapsed ? (
                        <span className="workspace-nav-link-copy">
                          <strong>{item.label}</strong>
                          <small>{item.groupLabel || item.section}</small>
                        </span>
                      ) : null}
                    </NavLink>
                  ))}
                </div>
              </section>
            ))}
          </nav>
        </aside>

        <main className="content-shell workspace-content-shell">
          {!isApproved ? (
            <section className="callout warning-callout workspace-inline-note">
              <p>
                Approval pending. Admin activate kareparyant operational writes restricted
                thevata yetil.
              </p>
            </section>
          ) : null}

          {profile?.must_change_password ? (
            <section className="callout warning-callout workspace-inline-note">
              <p>
                Temporary password active aahe. Secure password set karanyasathi Session
                page open kara.
              </p>
            </section>
          ) : null}

          {profileError ? (
            <section className="callout info-callout workspace-inline-note">
              <p>{profileError}</p>
            </section>
          ) : null}

          {referenceError ? (
            <section className="callout warning-callout workspace-inline-note">
              <p>{referenceError}</p>
            </section>
          ) : null}

          <Outlet />
          <section className="content-card" style={{ marginTop: '1rem' }}>
            <p className="muted-copy">
              Contact: qt33dlrerp@gmail.com |{' '}
              <a
                href="https://youtube.com/@qt-unifiedsubstationerp?si=AMl-m0btmMKwHAjh"
                target="_blank"
                rel="noreferrer"
                aria-label="Open YouTube channel"
                title="YouTube"
              >
                <AppIcon name="youtube" size={14} />
              </a>
            </p>
          </section>
        </main>
      </div>
    </div>
  )
}
