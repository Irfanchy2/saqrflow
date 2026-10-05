import 'server-only'

/** Text layer of a PDF (digital PDFs). Scanned PDFs / images return '' → need OCR (Claude engine) or manual review. */
export async function extractText(buf: Uint8Array, mime: string): Promise<string> {
  if (mime !== 'application/pdf') return ''
  try {
    const { getDocumentProxy, extractText: pdfText } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buf))
    const { text } = await pdfText(pdf, { mergePages: false })
    return (Array.isArray(text) ? text.join('\n') : String(text)).slice(0, 200_000)
  } catch { return '' }
}
