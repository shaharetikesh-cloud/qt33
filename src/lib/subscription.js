const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_TRIAL_DAYS = 15

function toValidDate(value) {
  if (!value) {
    return null
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return parsed
}

function getSubscriptionMeta(profile) {
  if (!profile || typeof profile !== 'object') {
    return {}
  }

  if (
    profile.module_permissions &&
    typeof profile.module_permissions === 'object' &&
    profile.module_permissions.subscription &&
    typeof profile.module_permissions.subscription === 'object'
  ) {
    return profile.module_permissions.subscription
  }

  return {}
}

export function getSubscriptionAccessState(profile) {
  if (!profile) {
    return {
      blocked: false,
      state: 'unknown',
      message: '',
      trialEndsAt: null,
      daysRemaining: 0,
    }
  }

  const subscriptionMeta = getSubscriptionMeta(profile)
  const now = new Date()
  const trialStartsAt =
    toValidDate(subscriptionMeta.trialStartedAt) ||
    toValidDate(profile.created_at) ||
    new Date()
  const trialEndsAt =
    toValidDate(subscriptionMeta.trialEndsAt) ||
    new Date(trialStartsAt.getTime() + DEFAULT_TRIAL_DAYS * DAY_MS)
  const paidUntil =
    toValidDate(subscriptionMeta.paidUntil) ||
    toValidDate(subscriptionMeta.subscriptionEndsAt)
  const status = String(subscriptionMeta.status || '').trim().toLowerCase()
  const daysRemaining = Math.max(
    0,
    Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS),
  )

  if (status === 'active' || status === 'paid' || status === 'lifetime') {
    if (!paidUntil || paidUntil >= now) {
      return {
        blocked: false,
        state: 'paid',
        message: '',
        trialEndsAt,
        daysRemaining,
      }
    }
  }

  if (paidUntil && paidUntil >= now) {
    return {
      blocked: false,
      state: 'paid',
      message: '',
      trialEndsAt,
      daysRemaining,
    }
  }

  if (trialEndsAt >= now) {
    return {
      blocked: false,
      state: 'trial',
      message: '',
      trialEndsAt,
      daysRemaining,
    }
  }

  return {
    blocked: true,
    state: 'expired',
    message:
      '15-day trial sampali aahe. Login continue karaycha asel tar subscription renew/activate kara.',
    trialEndsAt,
    daysRemaining: 0,
  }
}
