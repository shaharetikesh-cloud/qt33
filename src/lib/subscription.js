export function getSubscriptionAccessState(profile) {
  return {
    blocked: false,
    state: profile ? 'active' : 'unknown',
    message: '',
    trialEndsAt: null,
    daysRemaining: 0,
  }
}
