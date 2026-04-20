import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

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

function createRenderSandbox(element) {
  const sandbox = document.createElement('div')
  sandbox.setAttribute('data-report-render-sandbox', 'true')
  sandbox.style.position = 'fixed'
  sandbox.style.left = '-200vw'
  sandbox.style.top = '0'
  sandbox.style.width = '1600px'
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
  clone.style.width = 'fit-content'

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

async function renderCanvas(element) {
  const { clone, cleanup } = createRenderSandbox(element)

  try {
    await waitForReportAssets(clone)

    const width = Math.max(Math.ceil(clone.scrollWidth || 0), Math.ceil(clone.clientWidth || 0), 1)
    const height = Math.max(Math.ceil(clone.scrollHeight || 0), Math.ceil(clone.clientHeight || 0), 1)

    clone.style.width = `${width}px`

    return await html2canvas(clone, {
      backgroundColor: '#ffffff',
      scale: 2,
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
        clonedReport.style.width = `${width}px`
        clonedReport.style.boxShadow = 'none'
        clonedReport.style.display = 'block'
        clonedReport.style.visibility = 'visible'
      },
    })
  } finally {
    cleanup()
  }
}

export async function exportElementToPdf(element, options = {}) {
  if (!element) {
    throw new Error('Report preview sapadla nahi.')
  }

  const orientation = options.orientation || 'portrait'
  const format = options.pageSize || 'a4'
  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format,
    compress: true,
  })

  const canvas = await renderCanvas(element)
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const pxPerMm = canvas.width / pageWidth
  const pageHeightPx = Math.max(Math.floor(pageHeight * pxPerMm), 1)

  let pageIndex = 0

  for (let offsetY = 0; offsetY < canvas.height; offsetY += pageHeightPx) {
    const sliceHeightPx = Math.min(pageHeightPx, canvas.height - offsetY)
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
    pdf.addImage(imageData, 'PNG', 0, 0, pageWidth, sliceHeightMm, undefined, 'FAST')
    pageIndex += 1
  }

  if (options.filename) {
    pdf.save(options.filename)
  }

  return pdf.output('blob')
}
