import { Capacitor } from '@capacitor/core'
import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { Toast } from '@capacitor/toast'
import {
  buildCsvBlob,
  buildJsonBlob,
  buildWorkbookBlob,
  exportCsv,
  exportJson,
  exportWorkbook,
} from '../../lib/exportUtils'
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
  fitToSinglePage = false,
  maxPages = 2,
  renderWidthPx = 1400,
  pdfSections = null,
  jsonData,
  csvRows,
  workbookSheets,
}) {
  const { profile } = useAuth()
  const [busyAction, setBusyAction] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const nativePlatform = Capacitor.isNativePlatform()

  async function runAsyncAction(label, action) {
    try {
      setBusyAction(label)
      setErrorMessage('')
      await action()
    } catch (error) {
      setErrorMessage(error?.message || 'Action failed.')
      throw error
    } finally {
      setBusyAction('')
    }
  }

  async function notifyNative(message) {
    if (!nativePlatform) {
      return
    }
    await Toast.show({
      text: message,
      duration: 'short',
    })
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
      fitToSinglePage,
      maxPages,
      renderWidthPx,
      sections: pdfSections,
      ...options,
    })
  }

  async function handlePreviewPdf() {
    await runAsyncAction('preview', async () => {
      const blob = await buildPdfBlob()

      if (nativePlatform) {
        const uri = await saveBlobToDevice(blob, `${filenameBase}.pdf`)
        await shareFileUri(uri, `${filenameBase}.pdf`, `${filenameBase} (Preview)`)
        setStatusMessage('PDF ready to share.')
        await notifyNative('PDF ready to share.')
      } else {
        openBlobInNewTab(blob)
        setStatusMessage('PDF preview opened.')
      }

      await recordSnapshot('preview_pdf')
    })
  }

  async function handlePdf() {
    await runAsyncAction('pdf', async () => {
      const blob = await buildPdfBlob()
      const savedUri = await saveBlobToDevice(blob, `${filenameBase}.pdf`)
      if (nativePlatform) {
        setStatusMessage(`PDF saved: ${savedUri}`)
        await notifyNative('PDF saved')
      } else {
        setStatusMessage('PDF downloaded.')
      }
      await recordSnapshot('save_pdf')
    })
  }

  async function handlePrintPdf() {
    await runAsyncAction('print', async () => {
      const blob = await buildPdfBlob()
      if (nativePlatform) {
        const uri = await saveBlobToDevice(blob, `${filenameBase}.pdf`)
        await shareFileUri(uri, `${filenameBase}.pdf`, `${filenameBase} (Print)`)
        setStatusMessage('PDF ready to share.')
        await notifyNative('PDF ready to share.')
      } else {
        printBlobInBrowser(blob)
        setStatusMessage('Print dialog opened.')
      }

      await recordSnapshot('print_pdf')
    })
  }

  async function handleShare() {
    await runAsyncAction('share', async () => {
      const blob = await buildPdfBlob()
      await shareBlob(blob, `${filenameBase}.pdf`, filenameBase)
      setStatusMessage('PDF ready to share.')
      await notifyNative('PDF ready to share.')
      await recordSnapshot('share_pdf')
    })
  }

  async function handleJsonExport() {
    await runAsyncAction('json', async () => {
      if (nativePlatform) {
        const blob = buildJsonBlob(jsonData)
        const uri = await saveBlobToDevice(blob, `${filenameBase}.json`)
        await shareFileUri(uri, `${filenameBase}.json`, `${filenameBase} JSON`)
        setStatusMessage('JSON saved and ready to share.')
        await notifyNative('JSON saved')
      } else {
        exportJson(jsonData, `${filenameBase}.json`)
        setStatusMessage('JSON downloaded.')
      }
      await recordSnapshot('json')
    })
  }

  async function handleCsvExport() {
    await runAsyncAction('csv', async () => {
      if (nativePlatform) {
        const blob = buildCsvBlob(csvRows)
        const uri = await saveBlobToDevice(blob, `${filenameBase}.csv`)
        await shareFileUri(uri, `${filenameBase}.csv`, `${filenameBase} CSV`)
        setStatusMessage('CSV saved and ready to share.')
        await notifyNative('CSV saved')
      } else {
        exportCsv(csvRows, `${filenameBase}.csv`)
        setStatusMessage('CSV downloaded.')
      }
      await recordSnapshot('csv')
    })
  }

  async function handleExcelExport() {
    await runAsyncAction('excel', async () => {
      if (nativePlatform) {
        const blob = buildWorkbookBlob(workbookSheets)
        const uri = await saveBlobToDevice(blob, `${filenameBase}.xlsx`)
        await shareFileUri(uri, `${filenameBase}.xlsx`, `${filenameBase} Excel`)
        setStatusMessage('Excel saved and ready to share.')
        await notifyNative('Excel saved')
      } else {
        exportWorkbook(workbookSheets, `${filenameBase}.xlsx`)
        setStatusMessage('Excel downloaded.')
      }
      await recordSnapshot('excel')
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
        onClick={() => void handleJsonExport()}
        disabled={busyAction === 'json'}
      >
        {busyAction === 'json' ? 'Preparing...' : 'JSON'}
      </button>
      <button
        type="button"
        className="ghost-light-button"
        data-report-action="export-csv"
        onClick={() => void handleCsvExport()}
        disabled={busyAction === 'csv'}
      >
        {busyAction === 'csv' ? 'Preparing...' : 'CSV'}
      </button>
      <button
        type="button"
        className="ghost-light-button"
        data-report-action="export-excel"
        onClick={() => void handleExcelExport()}
        disabled={busyAction === 'excel'}
      >
        {busyAction === 'excel' ? 'Preparing...' : 'Excel'}
      </button>
      {statusMessage ? <span className="muted-copy">{statusMessage}</span> : null}
      {errorMessage ? <span className="text-danger">{errorMessage}</span> : null}
    </div>
  )
}
