import { Capacitor } from '@capacitor/core'
import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { exportCsv, exportJson, exportWorkbook } from '../../lib/exportUtils'
import { exportElementToPdf } from '../../lib/reportPdf'
import {
  openBlobInNewTab,
  printBlobInBrowser,
  saveBlobToDevice,
  shareBlob,
  shareFileUri,
} from '../../lib/shareUtils'
import { saveReportSnapshot } from '../../lib/unifiedDataService'

export default function ReportActions({
  documentRef,
  filenameBase,
  orientation = 'portrait',
  pageSize = 'a4',
  jsonData,
  csvRows,
  workbookSheets,
}) {
  const { profile } = useAuth()
  const [busyAction, setBusyAction] = useState('')
  const nativePlatform = Capacitor.isNativePlatform()
  const stampedFilenameBase = `${filenameBase}-${new Date().toISOString().slice(0, 10)}`

  async function runAsyncAction(label, action) {
    try {
      setBusyAction(label)
      await action()
    } finally {
      setBusyAction('')
    }
  }

  async function recordSnapshot(exportType) {
    await saveReportSnapshot(
      {
        reportType: jsonData?.title || filenameBase,
        filenameBase,
        exportType,
        orientation,
        title: jsonData?.title || filenameBase,
        substationLabel:
          jsonData?.metadata?.find?.(([label]) => label === 'Substation')?.[1] || '',
        monthLabel:
          jsonData?.metadata?.find?.(([label]) => label === 'Month')?.[1] || '',
        metadata: jsonData?.metadata || [],
      },
      profile,
    )
  }

  async function buildPdfBlob(options = {}) {
    return exportElementToPdf(documentRef.current, {
      orientation,
      pageSize,
      ...options,
    })
  }

  async function handlePreviewPdf() {
    await runAsyncAction('preview', async () => {
      const blob = await buildPdfBlob()

      if (nativePlatform) {
        const uri = await saveBlobToDevice(blob, `${stampedFilenameBase}.pdf`)
        window.open(uri, '_blank')
      } else {
        openBlobInNewTab(blob)
      }

      await recordSnapshot('preview_pdf')
    })
  }

  async function handlePdf() {
    await runAsyncAction('pdf', async () => {
      const blob = await buildPdfBlob()
      await saveBlobToDevice(blob, `${stampedFilenameBase}.pdf`)
      await recordSnapshot('save_pdf')
    })
  }

  async function handlePrintPdf() {
    await runAsyncAction('print', async () => {
      const blob = await buildPdfBlob()
      if (nativePlatform) {
        const uri = await saveBlobToDevice(blob, `${stampedFilenameBase}.pdf`)
        await shareFileUri(uri, `${stampedFilenameBase}.pdf`, `${filenameBase} (Print)`)
      } else {
        printBlobInBrowser(blob)
      }

      await recordSnapshot('print_pdf')
    })
  }

  async function handleShare() {
    await runAsyncAction('share', async () => {
      const blob = await buildPdfBlob()
      await shareBlob(blob, `${stampedFilenameBase}.pdf`, filenameBase)
      await recordSnapshot('share_pdf')
    })
  }

  return (
    <div className="report-actions">
      <button
        type="button"
        className="ghost-light-button"
        data-report-action="preview-pdf"
        onClick={() => void handlePreviewPdf()}
        disabled={busyAction === 'preview'}
      >
        {busyAction === 'preview' ? 'Opening...' : 'Preview PDF'}
      </button>
      <button
        type="button"
        className="ghost-light-button"
        data-report-action="print-pdf"
        onClick={() => void handlePrintPdf()}
        disabled={busyAction === 'print'}
      >
        {busyAction === 'print'
          ? nativePlatform
            ? 'Preparing...'
            : 'Opening print...'
          : nativePlatform
            ? 'Print / Share PDF'
            : 'Print'}
      </button>
      <button
        type="button"
        className="primary-button"
        data-report-action="save-pdf"
        onClick={() => void handlePdf()}
        disabled={busyAction === 'pdf'}
      >
        {busyAction === 'pdf' ? 'Preparing PDF...' : 'Save PDF'}
      </button>
      <button
        type="button"
        className="ghost-light-button"
        data-report-action="share-pdf"
        onClick={() => void handleShare()}
        disabled={busyAction === 'share'}
      >
        {busyAction === 'share' ? 'Sharing...' : 'Share'}
      </button>
      <button
        type="button"
        className="ghost-light-button"
        data-report-action="export-json"
        onClick={() => {
          exportJson(jsonData, `${filenameBase}.json`)
          void recordSnapshot('json')
        }}
      >
        JSON
      </button>
      <button
        type="button"
        className="ghost-light-button"
        data-report-action="export-csv"
        onClick={() => {
          exportCsv(csvRows, `${filenameBase}.csv`)
          void recordSnapshot('csv')
        }}
      >
        CSV
      </button>
      <button
        type="button"
        className="ghost-light-button"
        data-report-action="export-excel"
        onClick={() => {
          exportWorkbook(workbookSheets, `${filenameBase}.xlsx`)
          void recordSnapshot('excel')
        }}
      >
        Excel
      </button>
    </div>
  )
}
