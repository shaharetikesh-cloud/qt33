import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { isLocalSqlMode } from '../lib/runtimeConfig'
import { supabaseConfigError } from '../lib/supabase'
import { firebaseConfigError } from '../lib/firebase'
import Qt33OffsiteBrand from '../components/ui/Qt33OffsiteBrand'

export default function LoginPage() {
  const {
    authBusy,
    recoveryMode,
    backendLabel,
    signIn,
    signUp,
    requestPasswordReset,
    resendVerificationEmail,
    updatePassword,
  } = useAuth()
  const [mode, setMode] = useState('login')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [loginForm, setLoginForm] = useState({
    identifier: '',
    password: '',
  })
  const [signupForm, setSignupForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    password: '',
    requestedRole: 'substation_admin',
  })
  const [forgotEmail, setForgotEmail] = useState('')
  const [verificationEmail, setVerificationEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const runtimeConfigError = [firebaseConfigError, supabaseConfigError].filter(Boolean).join(' | ')

  const currentMode = recoveryMode ? 'recovery' : mode

  async function handleLoginSubmit(event) {
    event.preventDefault()
    setStatus('')
    setError('')

    try {
      await signIn(loginForm)
      setStatus('Login successful.')
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  async function handleSignupSubmit(event) {
    event.preventDefault()
    setStatus('')
    setError('')

    try {
      await signUp(signupForm)
      setStatus(
        isLocalSqlMode
          ? 'Signup request submit zala. Approval nantar 15 divas trial var login karta yeil.'
          : 'Account request create zala. Email verify nantarach dashboard login allow asel.',
      )
      setMode('login')
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  async function handleForgotSubmit(event) {
    event.preventDefault()
    setStatus('')
    setError('')

    try {
      const result = await requestPasswordReset(forgotEmail)
      setStatus(
        isLocalSqlMode
          ? result?.message ||
              'Local recovery mode start zali. Ata navi password set kara.'
          : 'Password reset email pathavla aahe. Mail madhil link open karun navi password set kara.',
      )
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  async function handleResendVerification(event) {
    event.preventDefault()
    setStatus('')
    setError('')
    try {
      const result = await resendVerificationEmail(verificationEmail)
      setStatus(result?.message || 'Verification email punha pathavla.')
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  async function handleRecoverySubmit(event) {
    event.preventDefault()
    setStatus('')
    setError('')

    if (newPassword.length < 8) {
      setError('New password kamit kami 8 characters cha hava.')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Password ani confirm password same nahi.')
      return
    }

    try {
      await updatePassword(newPassword)
      setStatus('Password update zala. Ata navi password ne login kara.')
      setMode('login')
      setNewPassword('')
      setConfirmPassword('')
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  return (
    <div className="auth-layout">
      <section className="auth-side-panel">
        <Qt33OffsiteBrand variant="login" />
        <p className="eyebrow">{backendLabel} Access Layer</p>
        <h1>Unified Substation Workspace</h1>
        <p className="muted-copy">
          Advance DLR ERP cha operational depth ani `firebase_adv` cha modern
          mobile-friendly workflow ekatra anaycha ha nava product base aahe.
        </p>

        <div className="details-grid">
          <article className="detail-card">
            <h3>Admin controls</h3>
            <p>New users approve karne, roles manage karne, ani sarv data review karne.</p>
          </article>
          <article className="detail-card">
            <h3>User privacy</h3>
            <p>Normal user la fakta swata tayar kelela data disel.</p>
          </article>
          <article className="detail-card">
            <h3>Hosting path</h3>
            <p>Local dev ata, nantar Hostinger web hosting plus Android APK.</p>
          </article>
          <article className="detail-card">
            <h3>Forgot password</h3>
            <p>
              {isLocalSqlMode
                ? 'Local mode madhye email aivaji direct reset flow test karta yeil.'
                : 'Supabase reset email flow ya project madhye wire kelela aahe.'}
            </p>
          </article>
        </div>

      </section>

      <section className="auth-card">
        <div className="auth-tabs">
          <button
            type="button"
            className={
              currentMode === 'login' ? 'tab-button tab-active' : 'tab-button'
            }
            onClick={() => setMode('login')}
            disabled={authBusy || recoveryMode}
          >
            Login
          </button>
          <button
            type="button"
            className={
              currentMode === 'signup' ? 'tab-button tab-active' : 'tab-button'
            }
            onClick={() => setMode('signup')}
            disabled={authBusy || recoveryMode}
          >
            Signup
          </button>
          <button
            type="button"
            className={
              currentMode === 'forgot' ? 'tab-button tab-active' : 'tab-button'
            }
            onClick={() => setMode('forgot')}
            disabled={authBusy || recoveryMode}
          >
            Forgot
          </button>
        </div>

        {runtimeConfigError ? (
          <div className="callout warning-callout">
            <h2>Config required</h2>
            <p>{runtimeConfigError}</p>
          </div>
        ) : null}

        {status ? (
          <div className="callout success-callout">
            <p>{status}</p>
          </div>
        ) : null}

        {error ? (
          <div className="callout danger-callout">
            <p>{error}</p>
          </div>
        ) : null}

        {currentMode === 'login' ? (
          <form className="form-stack" onSubmit={handleLoginSubmit}>
            <div>
              <label htmlFor="login-identifier">Email / Username / User ID</label>
              <input
                id="login-identifier"
                type="text"
                value={loginForm.identifier}
                onChange={(event) =>
                  setLoginForm((current) => ({
                    ...current,
                    identifier: event.target.value,
                  }))
                }
                required
              />
            </div>
            <div>
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                value={loginForm.password}
                onChange={(event) =>
                  setLoginForm((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                required
              />
            </div>
            <button type="submit" className="primary-button" disabled={authBusy}>
              {authBusy ? 'Signing in...' : 'Login'}
            </button>
            <div className="callout info-callout">
              <p>Email verify zalyavarach dashboard access milto.</p>
            </div>

            <div>
              <label htmlFor="resend-verification-email">Resend verification email</label>
              <div className="inline-actions">
                <input
                  id="resend-verification-email"
                  type="email"
                  value={verificationEmail}
                  onChange={(event) => setVerificationEmail(event.target.value)}
                  placeholder="Email for verification"
                />
                <button type="button" className="ghost-light-button" onClick={handleResendVerification}>
                  Resend
                </button>
              </div>
            </div>
          </form>
        ) : null}

        {currentMode === 'signup' ? (
          <form className="form-stack" onSubmit={handleSignupSubmit}>
            <div>
              <label htmlFor="signup-name">Full name</label>
              <input
                id="signup-name"
                type="text"
                value={signupForm.fullName}
                onChange={(event) =>
                  setSignupForm((current) => ({
                    ...current,
                    fullName: event.target.value,
                  }))
                }
                required
              />
            </div>
            <div>
              <label htmlFor="signup-phone">Phone</label>
              <input
                id="signup-phone"
                type="tel"
                value={signupForm.phone}
                onChange={(event) =>
                  setSignupForm((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label htmlFor="signup-email">Email</label>
              <input
                id="signup-email"
                type="email"
                value={signupForm.email}
                onChange={(event) =>
                  setSignupForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                required
              />
            </div>
            <div>
              <label htmlFor="signup-password">Password</label>
              <input
                id="signup-password"
                type="password"
                value={signupForm.password}
                onChange={(event) =>
                  setSignupForm((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                minLength={8}
                required
              />
            </div>
            <button type="submit" className="primary-button" disabled={authBusy}>
              {authBusy ? 'Creating request...' : 'Create account request'}
            </button>
            <div className="callout info-callout">
              <p>
                Public signup madhye fakta Substation Admin role allowed aahe.
                Approval nantar 15-day trial active hoil. Trial samplya nantar subscription required.
              </p>
            </div>
          </form>
        ) : null}

        {currentMode === 'forgot' ? (
          <form className="form-stack" onSubmit={handleForgotSubmit}>
            <div>
              <label htmlFor="forgot-email">Email</label>
              <input
                id="forgot-email"
                type="email"
                value={forgotEmail}
                onChange={(event) => setForgotEmail(event.target.value)}
                required
              />
            </div>
            <button type="submit" className="primary-button" disabled={authBusy}>
              {authBusy ? 'Sending...' : 'Send reset email'}
            </button>
          </form>
        ) : null}

        {currentMode === 'recovery' ? (
          <form className="form-stack" onSubmit={handleRecoverySubmit}>
            <div>
              <label htmlFor="new-password">New password</label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={8}
                required
              />
            </div>
            <div>
              <label htmlFor="confirm-password">Confirm password</label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={8}
                required
              />
            </div>
            <button type="submit" className="primary-button" disabled={authBusy}>
              {authBusy ? 'Updating...' : 'Update password'}
            </button>
          </form>
        ) : null}
      </section>
    </div>
  )
}
