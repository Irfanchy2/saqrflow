// Browser side of turbo receipt scanning: the server loads its OCR models while the camera is open, and the photo is made
// smaller on the phone before it is sent (a 4 MB photo becomes ~300 KB: much quicker on mobile data). The original photo
// is still the one attached to the expense when it is saved.

let warmedAt = 0
/** Ask the server to load the OCR models now (at most once every two minutes). Never throws. */
export function warmScan() {
  if (Date.now() - warmedAt < 120_000) return
  warmedAt = Date.now()
  fetch('/api/expenses/scan', { method: 'GET', cache: 'no-store' }).catch(() => { warmedAt = 0 })
}

const SHRINKABLE = new Set(['image/jpeg', 'image/png', 'image/webp'])
/**
 * A JPEG copy of the photo at most `maxSide` px on its long side, turned upright. Small photos, PDFs and anything the
 * browser cannot decode (e.g. HEIC outside Safari) are returned unchanged, so the scan never fails because of this.
 */
export async function shrinkForScan(file: File, maxSide = 2200, quality = 0.86): Promise<File> {
  if (!SHRINKABLE.has(file.type) || typeof createImageBitmap !== 'function') return file
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
    if (scale === 1 && file.size < 1_500_000) { bmp.close(); return file }
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale)
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d'); if (!ctx) { bmp.close(); return file }
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bmp, 0, 0, w, h); bmp.close()
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch { return file }
}
