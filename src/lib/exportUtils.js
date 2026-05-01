import * as XLSX from 'xlsx'
import { slugify } from './reportFormats'

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function exportJson(data, filename) {
  const blob = buildJsonBlob(data)

  downloadBlob(blob, filename)
}

export function buildJsonBlob(data) {
  return new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
}

export function buildCsvBlob(rows) {
  const normalizedRows = Array.isArray(rows) ? rows : []
  if (!normalizedRows.length) {
    return new Blob([''], { type: 'text/csv;charset=utf-8' })
  }

  const headers = Array.from(
    normalizedRows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key))
      return set
    }, new Set()),
  )

  const csvLines = [
    headers.join(','),
    ...normalizedRows.map((row) =>
      headers
        .map((header) => {
          const value = row?.[header] ?? ''
          const cell = String(value).replace(/"/g, '""')
          return `"${cell}"`
        })
        .join(','),
    ),
  ]

  return new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8' })
}

export function exportCsv(rows, filename) {
  downloadBlob(buildCsvBlob(rows), filename)
}

export function buildWorkbookBlob(sheets) {
  const workbook = XLSX.utils.book_new()

  ;(sheets || []).forEach((sheet) => {
    const worksheet = XLSX.utils.json_to_sheet(sheet.rows || [])
    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      slugify(sheet.name || 'Sheet').slice(0, 30) || 'Sheet',
    )
  })

  const workbookArray = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
  return new Blob([workbookArray], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function exportWorkbook(sheets, filename) {
  const blob = buildWorkbookBlob(sheets)
  downloadBlob(blob, filename)
}

