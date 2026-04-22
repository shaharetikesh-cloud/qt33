/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import {
  clearLocalSession,
  localChangePassword,
  fetchLocalSession,
  localCreateUser,
  localDeleteUser,
  localListUsers,
  localRequestPasswordReset,
  localResendVerificationEmail,
  localResetUserPassword,
  localSignIn,
  localSignOut,
  localSignUp,
  localUpdateUser,
  localUpdatePassword,
} from '../lib/localApi'
import {
  canManageUsers as canManageUsersByRole,
  canPerformModuleAction,
  getRoleLabel,
  isMainAdminRole,
  isReadOnlyRole,
  isSubstationAdminRole,
} from '../lib/rbac'
import { backendLabel, isLocalSqlMode } from '../lib/runtimeConfig'
import { supabase, supabaseConfigError } from '../lib/supabase'
import { firebaseAuth } from '../lib/firebase'
import { setSupabaseAccessTokenProvider } from '../lib/supabase'
import { onAuthStateChanged } from 'firebase/auth'

const AuthContext = createContext(null)

function getRedirectUrl() {
  if (typeof window === 'undefined') {
    return undefined
  }

  return `${window.location.origin}${window.location.pathname}`
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authBusy, setAuthBusy] = useState(false)
  const [profileError, setProfileError] = useState(
    isLocalSqlMode ? null : supabaseConfigError,
  )
  const [recoveryMode, setRecoveryMode] = useState(false)

  const applyAuthPayload = useCallback((payload) => {
    setSession(payload?.session ?? null)
    setProfile(payload?.profile ?? null)

    if (payload?.session && !payload?.profile) {
      setProfileError('Profile load zala nahi.')
      return
    }

    setProfileError(isLocalSqlMode ? null : supabaseConfigError)
  }, [])

  const loadSupabaseProfile = useCallback(async (userId) => {
    if (!supabase || !userId) {
      setProfile(null)
      return null
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('auth_user_id', userId)
      .maybeSingle()

    if (error) {
      setProfile(null)
      setProfileError(error.message)
      return null
    }

    setProfile(data ?? null)
    setProfileError(
      data
        ? null
        : 'Profile row sapadli nahi. Admin approval kiwa profile sync pending asu shakte.',
    )

    return data
  }, [])

  const syncSupabaseSessionState = useCallback(
    async (event, nextSession) => {
      setSession(nextSession ?? null)

      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true)
      }

      if (event === 'SIGNED_OUT' || !nextSession) {
        setRecoveryMode(false)
        setProfile(null)
        setProfileError(supabaseConfigError)
        return
      }

      await loadSupabaseProfile(nextSession.user.id)
    },
    [loadSupabaseProfile],
  )

  const bootstrapLocalSession = useCallback(async () => {
    const payload = await fetchLocalSession()
    if (payload?.session?.user && !payload.session.user.emailVerified) {
      await localSignOut()
      applyAuthPayload({ session: null, profile: null })
      throw new Error('Email verify kelya nantarach dashboard access milel.')
    }
    applyAuthPayload(payload)
    setRecoveryMode(false)
  }, [applyAuthPayload])

  useEffect(() => {
    setSupabaseAccessTokenProvider(async () => {
      if (!firebaseAuth?.currentUser) {
        return ''
      }
      return firebaseAuth.currentUser.getIdToken()
    })
  }, [])

  useEffect(() => {
    let alive = true

    if (isLocalSqlMode) {
      let initialAuthResolved = false
      const unsubscribe = firebaseAuth
        ? onAuthStateChanged(firebaseAuth, () => {
            if (!alive) {
              return
            }
            void bootstrapLocalSession().finally(() => {
              if (alive && !initialAuthResolved) {
                initialAuthResolved = true
                setLoading(false)
              }
            })
          })
        : () => {}

      if (!firebaseAuth) {
        setLoading(false)
      }

      return () => {
        alive = false
        unsubscribe()
      }
    }

    if (!supabase) {
      setLoading(false)
      return () => {
        alive = false
      }
    }

    async function bootstrap() {
      const { data, error } = await supabase.auth.getSession()

      if (!alive) {
        return
      }

      if (error) {
        setProfileError(error.message)
        setLoading(false)
        return
      }

      await syncSupabaseSessionState('INITIAL_SESSION', data.session ?? null)

      if (alive) {
        setLoading(false)
      }
    }

    void bootstrap()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      void syncSupabaseSessionState(event, nextSession ?? null)

      if (alive) {
        setLoading(false)
      }
    })

    return () => {
      alive = false
      subscription.unsubscribe()
    }
  }, [bootstrapLocalSession, syncSupabaseSessionState])

  async function signIn({ identifier, username, email, password }) {
    setAuthBusy(true)

    try {
      if (isLocalSqlMode) {
        const payload = await localSignIn({
          identifier: identifier || username || email,
          password,
        })
        applyAuthPayload(payload)
        setRecoveryMode(false)
        return payload
      }

      if (!supabase) {
        throw new Error(supabaseConfigError)
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: identifier || username || email,
        password,
      })

      if (error) {
        throw error
      }

      return null
    } finally {
      setAuthBusy(false)
    }
  }

  async function signUp({ email, password, fullName, phone }) {
    setAuthBusy(true)

    try {
      if (isLocalSqlMode) {
        const payload = await localSignUp({
          email,
          password,
          fullName,
          phone,
        })
        applyAuthPayload(payload)
        setRecoveryMode(false)
        return payload
      }

      if (!supabase) {
        throw new Error(supabaseConfigError)
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: getRedirectUrl(),
          data: {
            full_name: fullName,
            phone,
          },
        },
      })

      if (error) {
        throw error
      }

      if (data.user) {
        const { error: profileUpsertError } = await supabase
          .from('profiles')
          .upsert(
            {
              auth_user_id: data.user.id,
              email,
              full_name: fullName,
              phone,
              role: 'substation_user',
              is_active: false,
              approval_status: 'pending',
            },
            {
              onConflict: 'auth_user_id',
            },
          )

        if (profileUpsertError) {
          throw profileUpsertError
        }
      }

      return data
    } finally {
      setAuthBusy(false)
    }
  }

  async function requestPasswordReset(email) {
    setAuthBusy(true)

    try {
      if (isLocalSqlMode) {
        const payload = await localRequestPasswordReset(email)
        setRecoveryMode(Boolean(payload?.recoveryToken))
        return payload
      }

      if (!supabase) {
        throw new Error(supabaseConfigError)
      }

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: getRedirectUrl(),
      })

      if (error) {
        throw error
      }

      return null
    } finally {
      setAuthBusy(false)
    }
  }

  async function resendVerificationEmail(email) {
    setAuthBusy(true)
    try {
      if (isLocalSqlMode) {
        return localResendVerificationEmail(email)
      }
      throw new Error('Resend verification local mode sathi configured aahe.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function updatePassword(newPassword) {
    setAuthBusy(true)

    try {
      if (isLocalSqlMode) {
        const payload = await localUpdatePassword(newPassword)
        setRecoveryMode(false)
        return payload
      }

      if (!supabase) {
        throw new Error(supabaseConfigError)
      }

      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      })

      if (error) {
        throw error
      }

      setRecoveryMode(false)
      return null
    } finally {
      setAuthBusy(false)
    }
  }

  async function refreshProfile() {
    if (isLocalSqlMode) {
      const payload = await fetchLocalSession()
      applyAuthPayload(payload)
      return payload?.profile ?? null
    }

    if (!session?.user?.id) {
      return null
    }

    return loadSupabaseProfile(session.user.id)
  }

  async function signOut() {
    setAuthBusy(true)

    try {
      if (isLocalSqlMode) {
        await localSignOut()
        clearLocalSession()
        setRecoveryMode(false)
        setSession(null)
        setProfile(null)
        setProfileError(null)
        return
      }

      if (!supabase) {
        return
      }

      const { error } = await supabase.auth.signOut()

      if (error) {
        throw error
      }
    } finally {
      setAuthBusy(false)
    }
  }

  const listUsers = useCallback(async (filters = {}) => {
    if (isLocalSqlMode) {
      return localListUsers(filters)
    }

    throw new Error('Supabase mode users UI ajun implement kelela nahi.')
  }, [])

  const createUserByAdmin = useCallback(async (data) => {
    if (isLocalSqlMode) {
      return localCreateUser(data)
    }

    throw new Error('Supabase mode admin user create UI ajun implement kelela nahi.')
  }, [])

  const updateUserByAdmin = useCallback(async (userId, data) => {
    if (isLocalSqlMode) {
      return localUpdateUser(userId, data)
    }

    throw new Error('Supabase mode admin user update UI ajun implement kelela nahi.')
  }, [])

  const resetUserPasswordByAdmin = useCallback(async (userId, temporaryPassword) => {
    if (isLocalSqlMode) {
      return localResetUserPassword(userId, temporaryPassword)
    }

    throw new Error('Supabase mode admin password reset UI ajun implement kelela nahi.')
  }, [])

  const deleteUserByAdmin = useCallback(async (userId) => {
    if (isLocalSqlMode) {
      return localDeleteUser(userId)
    }

    throw new Error('Supabase mode admin user delete UI ajun implement kelela nahi.')
  }, [])

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    if (isLocalSqlMode) {
      return localChangePassword(currentPassword, newPassword)
    }

    throw new Error('Supabase mode password change UI ajun implement kelela nahi.')
  }, [])

  const role = profile?.role || ''
  const isMainAdmin = isMainAdminRole(role)
  const isSubstationAdmin = isSubstationAdminRole(role)
  const isAdmin = canManageUsersByRole(role)
  const canManageUsers = canManageUsersByRole(role)
  const roleLabel = getRoleLabel(role)
  const isReadOnlyUser = isReadOnlyRole(role)

  const value = {
    session,
    profile,
    loading,
    authBusy,
    profileError,
    recoveryMode,
    backendLabel,
    backendMode: isLocalSqlMode ? 'local-sql' : 'supabase',
    roleLabel,
    isAdmin,
    isMainAdmin,
    isSuperAdmin: isMainAdmin,
    isSubstationAdmin,
    isApproved: Boolean(profile?.is_active),
    isReadOnlyUser,
    canManageUsers,
    canViewModule: (moduleKey) => canPerformModuleAction(profile, moduleKey, 'view'),
    canCreateModule: (moduleKey) => canPerformModuleAction(profile, moduleKey, 'create'),
    canEditModule: (moduleKey) => canPerformModuleAction(profile, moduleKey, 'update'),
    canDeleteModule: (moduleKey) => canPerformModuleAction(profile, moduleKey, 'delete'),
    signIn,
    signUp,
    signOut,
    refreshProfile,
    requestPasswordReset,
    resendVerificationEmail,
    updatePassword,
    changePassword,
    listUsers,
    createUserByAdmin,
    updateUserByAdmin,
    resetUserPasswordByAdmin,
    deleteUserByAdmin,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)

  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider')
  }

  return value
}
