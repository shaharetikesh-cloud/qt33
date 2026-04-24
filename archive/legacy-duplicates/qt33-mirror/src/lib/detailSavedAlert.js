/**
 * Confirms a successful save via a native dialog (explicit product requirement).
 */
export function alertDetailSaved() {
  if (typeof window === 'undefined') {
    return
  }

  window.alert('Detail Saved')
}
