// Browser side of the free "Share via WhatsApp": the one place that turns a document's PDF endpoint into a real PDF file and
// hands it to the device's share menu (Web Share API). Used by the share sheet for every document type.
// A wa.me chat link can only carry text, so where files cannot be shared the PDF has to be attached by hand: callers must
// say so, never claim the PDF was attached.

/** Can this browser hand files to the device's share menu (Android Chrome and the installed app, iPhone Safari, some
 *  desktops)? Pass the real file to check that exact file. */
export function canShareFiles(f?: File) {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
  try { return navigator.canShare({ files: [f ?? new File(['%PDF-'], 'check.pdf', { type: 'application/pdf' })] }) } catch { return false }
}
/** Phones and tablets (touch-first): sharing the file is the main action there. */
export const touchDevice = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
export const withParam = (url: string, q: string) => `${url}${url.includes('?') ? '&' : '?'}${q}`

/** The document's own PDF (the endpoint Download uses), as a File. Refuses anything that is not a real PDF, such as a
 *  sign-in page after the session ended, so a broken file is never handed to WhatsApp. */
export async function loadPdf(url: string, filename: string): Promise<File> {
  const res = await fetch(withParam(url, 'share=1'), { credentials: 'same-origin', cache: 'no-store' })
  if (!res.ok) throw new Error(res.status === 403 || res.status === 404 ? 'You do not have access to this document.' : 'The PDF could not be generated.')
  const blob = await res.blob()
  const head = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer())
  if (!/application\/pdf/i.test(res.headers.get('content-type') ?? '') || head !== '%PDF-') throw new Error('The server did not return a PDF. You may have been signed out.')
  return new File([blob], /\.pdf$/i.test(filename) ? filename : `${filename}.pdf`, { type: 'application/pdf', lastModified: Date.now() })
}

export type ShareOutcome = 'shared' | 'cancelled' | 'blocked' | 'failed'
/**
 * Opens the share menu with the PDF file. Call it straight from the tap (no await before it): browsers allow the share
 * menu only right after a tap. Only the file is shared: with text as well, WhatsApp on some phones (iPhone, some Android
 * versions) sends the text and drops the file, so the message goes on the clipboard to paste as the caption.
 * "shared" means an app was chosen in the share menu, not that WhatsApp sent anything.
 */
export async function shareDocumentViaWhatsApp({ file, message }: { file: File; message?: string }): Promise<ShareOutcome> {
  if (message) copyText(message).catch(() => {})            // not awaited: waiting here can use up the tap
  try { await navigator.share({ files: [file] }); return 'shared' }
  catch (e) { const n = (e as Error)?.name; return n === 'AbortError' ? 'cancelled' : n === 'NotAllowedError' ? 'blocked' : 'failed' }
}

/** Puts text on the clipboard; rejects where the browser blocks it (the caller then lets the user copy it by hand). */
export function copyText(text: string): Promise<void> {
  try { const w = navigator.clipboard?.writeText(text); return w ?? Promise.reject(new Error('no clipboard')) } catch (e) { return Promise.reject(e) }
}
