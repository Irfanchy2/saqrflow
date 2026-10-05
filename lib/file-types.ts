// Browser-safe constants (no node: imports) shared by client components and server validation.
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
export const ALLOWED: Record<string, string[]> = {
  'application/pdf': ['pdf'], 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/msword': ['doc'], 'application/vnd.ms-excel': ['xls'],
}
export const ACCEPT_ATTR = Object.values(ALLOWED).flat().map(e => '.' + e).join(',')

