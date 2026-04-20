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
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })

  downloadBlob(blob, filename)
}

export function exportCsv(rows, filename) {
  const normalizedRows = Array.isArray(rows) ? rows : []

  if (!normalizedRows.length) {
    downloadBlob(new Blob([''], { type: 'text/csv;charset=utf-8' }), filename)
    return
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

  downloadBlob(
    new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8' }),
    filename,
  )
}

export function exportWorkbook(sheets, filename) {
  const workbook = XLSX.utils.book_new()

  sheets.forEach((sheet) => {
    const worksheet = XLSX.utils.json_to_sheet(sheet.rows || [])
    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      slugify(sheet.name || 'Sheet').slice(0, 30) || 'Sheet',
    )
  })

  XLSX.writeFile(workbook, filename)
}

