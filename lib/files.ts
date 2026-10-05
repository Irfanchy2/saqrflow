import { createHash } from 'node:crypto'

import { ALLOWED, MAX_UPLOAD_BYTES } from './file-types'
export { ALLOWED, ACCEPT_ATTR, MAX_UPLOAD_BYTES } from './file-types'

/** Detect the real type from magic bytes for formats we can sniff; returns null if unknown. */
export function sniffMime(buf: Uint8Array): string | null {
  const h = (...b: number[]) => b.every((x, i) => buf[i] === x)
  if (h(0x25, 0x50, 0x44, 0x46)) return 'application/pdf'
  if (h(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (h(0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (h(0x52, 0x49, 0x46, 0x46) && buf[8] === 0x57 && buf[9] === 0x45) return 'image/webp'
  if (h(0x50, 0x4b, 0x03, 0x04)) return 'application/zip'           // docx / xlsx container
  if (h(0xd0, 0xcf, 0x11, 0xe0)) return 'application/x-ole'         // legacy doc / xls
  return null
}
const SNIFF_COMPAT: Record<string, string[]> = {
  'application/zip': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  'application/x-ole': ['application/msword', 'application/vnd.ms-excel'],
}

export type UploadCheck = { ok: true; mime: string; ext: string } | { ok: false; error: string }
export function validateUpload(file: { name: string; size: number; type: string }, head?: Uint8Array): UploadCheck {
  if (file.size <= 0) return { ok: false, error: 'The file is empty.' }
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: `File is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).` }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const mime = Object.keys(ALLOWED).find(m => ALLOWED[m].includes(ext))
  if (!mime) return { ok: false, error: `.${ext || '?'} files are not allowed. Allowed: PDF, JPG, PNG, WEBP, DOC(X), XLS(X).` }
  if (file.type && file.type !== 'application/octet-stream' && file.type !== mime && !(mime === 'image/jpeg' && file.type === 'image/jpg'))
    return { ok: false, error: 'File extension does not match its content type.' }
  if (head) {
    const real = sniffMime(head)
    const compatible = real === mime || (real && SNIFF_COMPAT[real]?.includes(mime))
    if (!compatible) return { ok: false, error: 'File content does not match its extension.' }
  }
  return { ok: true, mime, ext }
}
export const sha256Hex = (buf: Uint8Array) => createHash('sha256').update(buf).digest('hex')
export function safeFileName(name: string): string {
  return name.normalize('NFKD').replace(/[^\w.\- ]+/g, '_').replace(/\.{2,}/g, '.').replace(/^\.+/, '').slice(-120) || 'file'
}
export const storagePath = (companyId: string, docId: string, version: number, fileName: string) =>
  `${companyId}/${docId}/v${version}-${safeFileName(fileName)}`
