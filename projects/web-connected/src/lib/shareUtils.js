import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { downloadBlob } from './exportUtils'

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return btoa(binary)
}

export async function shareBlob(blob, filename, title) {
  if (!blob) {
    throw new Error('Share sathi file generate zali nahi.')
  }

  if (Capacitor.isNativePlatform()) {
    const base64Data = await blobToBase64(blob)
    const result = await Filesystem.writeFile({
      path: filename,
      data: base64Data,
      directory: Directory.Cache,
    })

    await Share.share({
      title,
      text: title,
      url: result.uri,
      dialogTitle: title,
    })

    return
  }

  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' })

  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({
      title,
      files: [file],
      text: title,
    })
    return
  }

  downloadBlob(blob, filename)
}

export async function shareFileUri(uri, filename, title) {
  if (!uri) {
    throw new Error('Share sathi file uri unavailable aahe.')
  }

  if (Capacitor.isNativePlatform()) {
    await Share.share({
      title,
      text: title,
      url: uri,
      dialogTitle: title,
    })
    return
  }

  throw new Error('shareFileUri is intended for native runtime.')
}

export async function saveBlobToDevice(blob, filename) {
  if (!blob) {
    throw new Error('Save sathi file generate zali nahi.')
  }

  if (Capacitor.isNativePlatform()) {
    const base64Data = await blobToBase64(blob)
    const result = await Filesystem.writeFile({
      path: filename,
      data: base64Data,
      directory: Directory.Documents,
      recursive: true,
    })

    return result.uri
  }

  downloadBlob(blob, filename)
  return filename
}

export function openBlobInNewTab(blob) {
  if (!blob) {
    throw new Error('Preview sathi file generate zali nahi.')
  }

  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function applyPrintPageStyle({ orientation = 'portrait', pageSize = 'a4' } = {}) {
  const normalizedOrientation = orientation === 'landscape' ? 'landscape' : 'portrait'
  const normalizedPageSize = String(pageSize || 'a4').toUpperCase()
  const styleId = 'report-print-page-style'
  const existingStyle = document.getElementById(styleId)

  existingStyle?.remove()

  const style = document.createElement('style')
  style.id = styleId
  style.media = 'print'
  style.textContent = `@page { size: ${normalizedPageSize} ${normalizedOrientation}; margin: 8mm; }`
  document.head.appendChild(style)

  let cleanedUp = false
  const cleanup = () => {
    if (cleanedUp) {
      return
    }

    cleanedUp = true
    style.remove()
  }

  window.addEventListener('afterprint', cleanup, { once: true })
  window.setTimeout(cleanup, 2000)
  return cleanup
}

export function printElementInBrowser(element, options = {}) {
  if (!element) {
    throw new Error('Print sathi report preview sapadla nahi.')
  }

  applyPrintPageStyle(options)
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        window.print()
      }, 60)
    })
  })
}

export function printBlobInBrowser(blob) {
  if (!blob) {
    throw new Error('Print sathi file generate zali nahi.')
  }

  const url = URL.createObjectURL(blob)
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.src = url
  document.body.appendChild(iframe)

  iframe.onload = () => {
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()

    window.setTimeout(() => {
      document.body.removeChild(iframe)
      URL.revokeObjectURL(url)
    }, 2000)
  }
}
