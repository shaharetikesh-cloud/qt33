import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

const REPORT_RENDER_SCALE = 2
const PDF_MARGIN_MM = {
  left: 25.4,   // 1.0 inch
  right: 12.7,  // 0.5 inch
  top: 12.7,    // 0.5 inch
  bottom: 12.7, // 0.5 inch
}

const DEFAULT_RENDER_WIDTH_PX = 1400

async function waitForReportAssets(element) {
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready
    } catch {
      // Font readiness is a best-effort hint for stable capture.
    }
  }

  const images = Array.from(element.querySelectorAll('img'))

  await Promise.all(
    images.map(
      (image) =>
        new Promise((resolve) => {
          if (image.complete) {
            resolve()
            return
          }

          image.addEventListener('load', resolve, { once: true })
          image.addEventListener('error', resolve, { once: true })
        }),
    ),
  )

  await new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
}

function createRenderSandbox(element, options = {}) {
  const sourceRect = element.getBoundingClientRect()
  const requestedWidth = Number(options.renderWidthPx || 0)
  const sandboxWidth = Math.max(
    Math.ceil(sourceRect.width || 0),
    Number.isFinite(requestedWidth) && requestedWidth > 0 ? requestedWidth : DEFAULT_RENDER_WIDTH_PX,
  )
  const sandbox = document.createElement('div')
  sandbox.setAttribute('data-report-render-sandbox', 'true')
  sandbox.style.position = 'fixed'
  sandbox.style.left = '-200vw'
  sandbox.style.top = '0'
  sandbox.style.width = `${sandboxWidth}px`
  sandbox.style.padding = '0'
  sandbox.style.margin = '0'
  sandbox.style.background = '#ffffff'
  sandbox.style.zIndex = '-1'
  sandbox.style.pointerEvents = 'none'
  sandbox.style.opacity = '1'
  sandbox.style.display = 'block'
  sandbox.style.visibility = 'visible'

  const clone = element.cloneNode(true)
  clone.style.display = 'block'
  clone.style.visibility = 'visible'
  clone.style.position = 'static'
  clone.style.margin = '0'
  clone.style.maxWidth = 'none'
  clone.style.width = '100%'

  sandbox.appendChild(clone)
  document.body.appendChild(sandbox)

  return {
    sandbox,
    clone,
    cleanup() {
      sandbox.remove()
    },
  }
}

async function renderCanvas(element, options = {}) {
  const { clone, cleanup } = createRenderSandbox(element, options)

  try {
    await waitForReportAssets(clone)

    const width = Math.max(Math.ceil(clone.scrollWidth || 0), Math.ceil(clone.clientWidth || 0), 1)
    const height = Math.max(Math.ceil(clone.scrollHeight || 0), Math.ceil(clone.clientHeight || 0), 1)
    const cloneRect = clone.getBoundingClientRect()
    const rowAnchors = Array.from(
      clone.querySelectorAll('tbody tr, .report-table tr, .daily-log-entry-table tr, [data-report-row="true"]'),
    )
      .map((row) => {
        const rowRect = row.getBoundingClientRect()
        return Math.max(Math.floor((rowRect.top - cloneRect.top) * REPORT_RENDER_SCALE), 0)
      })
      .filter((value) => Number.isFinite(value))

    clone.style.width = `${width}px`

    const canvas = await html2canvas(clone, {
      backgroundColor: '#ffffff',
      scale: REPORT_RENDER_SCALE,
      useCORS: true,
      logging: false,
      width,
      height,
      windowWidth: width,
      windowHeight: height,
      scrollX: 0,
      scrollY: 0,
      onclone: (clonedDocument) => {
        const clonedReport = clonedDocument.querySelector('[data-report-document="true"]')

        if (!clonedReport) {
          return
        }

        clonedReport.style.margin = '0'
        clonedReport.style.maxWidth = 'none'
        clonedReport.style.width = '100%'
        clonedReport.style.boxShadow = 'none'
        clonedReport.style.display = 'block'
        clonedReport.style.visibility = 'visible'
      },
    })

    return {
      canvas,
      rowAnchors,
    }
  } finally {
    cleanup()
  }
}

function buildPageSlices(totalHeightPx, pageHeightPx, rowAnchors = [], maxPages = Number.POSITIVE_INFINITY) {
  const slices = []
  let offsetY = 0
  const minSlicePx = Math.floor(pageHeightPx * 0.6)
  const sortedAnchors = [...new Set(rowAnchors)].sort((left, right) => left - right)

  while (offsetY < totalHeightPx) {
    if (slices.length >= maxPages - 1) {
      slices.push({
        offsetY,
        sliceHeightPx: totalHeightPx - offsetY,
      })
      break
    }

    const targetBottom = Math.min(offsetY + pageHeightPx, totalHeightPx)
    if (targetBottom >= totalHeightPx) {
      slices.push({
        offsetY,
        sliceHeightPx: totalHeightPx - offsetY,
      })
      break
    }

    const candidateBreak = sortedAnchors
      .filter((anchor) => anchor > offsetY + 10 && anchor < targetBottom)
      .pop()

    const effectiveBottom =
      candidateBreak && candidateBreak - offsetY >= minSlicePx
        ? candidateBreak
        : targetBottom

    slices.push({
      offsetY,
      sliceHeightPx: Math.max(effectiveBottom - offsetY, 1),
    })
    offsetY = effectiveBottom
  }

  return slices
}

function appendCanvasToPdf(pdf, canvas, options = {}) {
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const marginLeft = Number(options.marginLeftMm ?? PDF_MARGIN_MM.left)
  const marginRight = Number(options.marginRightMm ?? PDF_MARGIN_MM.right)
  const marginTop = Number(options.marginTopMm ?? PDF_MARGIN_MM.top)
  const marginBottom = Number(options.marginBottomMm ?? PDF_MARGIN_MM.bottom)
  const contentWidth = Math.max(pageWidth - marginLeft - marginRight, 10)
  const contentHeight = Math.max(pageHeight - marginTop - marginBottom, 10)

  if (options.fitToSinglePage) {
    const imageData = canvas.toDataURL('image/png')
    const ratio = Math.min(contentWidth / canvas.width, contentHeight / canvas.height)
    const drawWidth = canvas.width * ratio
    const drawHeight = canvas.height * ratio
    const offsetX = marginLeft + (contentWidth - drawWidth) / 2
    const offsetY = marginTop + (contentHeight - drawHeight) / 2
    pdf.addImage(imageData, 'PNG', offsetX, offsetY, drawWidth, drawHeight, undefined, 'FAST')
    return
  }

  const maxPages = Math.max(1, Number(options.maxPages || Number.POSITIVE_INFINITY))
  const pxPerMm = canvas.width / contentWidth
  const pageHeightPx = Math.max(Math.floor(contentHeight * pxPerMm), 1)
  const slices = buildPageSlices(canvas.height, pageHeightPx, options.rowAnchors || [], maxPages)

  let pageIndex = 0
  for (const slice of slices) {
    const { offsetY, sliceHeightPx } = slice
    const pageCanvas = document.createElement('canvas')
    pageCanvas.width = canvas.width
    pageCanvas.height = sliceHeightPx

    const context = pageCanvas.getContext('2d')
    if (!context) {
      throw new Error('PDF page render context available nahi.')
    }

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
    context.drawImage(
      canvas,
      0,
      offsetY,
      canvas.width,
      sliceHeightPx,
      0,
      0,
      pageCanvas.width,
      pageCanvas.height,
    )

    if (pageIndex > 0) {
      pdf.addPage()
    }

    const imageData = pageCanvas.toDataURL('image/png')
    const sliceHeightMm = sliceHeightPx / pxPerMm
    pdf.addImage(
      imageData,
      'PNG',
      marginLeft,
      marginTop,
      contentWidth,
      sliceHeightMm,
      undefined,
      'FAST',
    )
    pageIndex += 1
  }
}

export async function exportElementToPdf(element, options = {}) {
  if (!element) {
    throw new Error('Report preview sapadla nahi.')
  }

  const sections = Array.isArray(options.sections) ? options.sections.filter(Boolean) : []

  if (sections.length) {
    const firstSection = sections[0]
    const firstOrientation = firstSection.orientation || options.orientation || 'portrait'
    const firstFormat = firstSection.pageSize || options.pageSize || 'a4'
    const pdf = new jsPDF({
      orientation: firstOrientation,
      unit: 'mm',
      format: firstFormat,
      compress: true,
    })

    for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
      const section = sections[sectionIndex]
      const sectionElement = section.selector ? element.querySelector(section.selector) : element
      if (!sectionElement) {
        continue
      }
      const sectionOrientation = section.orientation || options.orientation || 'portrait'
      const sectionFormat = section.pageSize || options.pageSize || 'a4'
      if (sectionIndex > 0) {
        pdf.addPage(sectionFormat, sectionOrientation)
      }
      const { canvas, rowAnchors } = await renderCanvas(sectionElement, {
        renderWidthPx: section.renderWidthPx || options.renderWidthPx,
      })
      appendCanvasToPdf(pdf, canvas, {
        ...options,
        ...section,
        rowAnchors,
      })
    }
    if (options.filename) {
      pdf.save(options.filename)
    }
    return pdf.output('blob')
  }

  const orientation = options.orientation || 'portrait'
  const format = options.pageSize || 'a4'
  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format,
    compress: true,
  })
  const { canvas, rowAnchors } = await renderCanvas(element, {
    renderWidthPx: options.renderWidthPx,
  })
  appendCanvasToPdf(pdf, canvas, {
    ...options,
    rowAnchors,
  })

  if (options.filename) {
    pdf.save(options.filename)
  }

  return pdf.output('blob')
}
