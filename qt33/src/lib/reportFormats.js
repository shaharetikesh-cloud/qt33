export function formatNumber(value, fractionDigits = 2) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return '-'
  }

  return numericValue.toLocaleString('en-IN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
}

export function formatInteger(value) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return '-'
  }

  return numericValue.toLocaleString('en-IN', {
    maximumFractionDigits: 0,
  })
}

export function formatTime(value) {
  return String(value || '').trim() || '-'
}

export function safeText(value, fallback = '-') {
  const text = String(value || '').trim()
  return text || fallback
}

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function getEmployeePrintLines(employee) {
  const fullName = employee?.full_name || employee?.fullName || employee?.name || 'Vacant'
  const cpfNo = employee?.cpfNo || employee?.cpf_no || ''

  return {
    fullName,
    cpfLine: cpfNo ? `CPF- ${cpfNo}` : '',
  }
}

