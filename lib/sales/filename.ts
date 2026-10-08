import { DOC_META, type SalesType } from './docs'

/** Filesystem-safe part: no / \ : * ? " < > | or control chars, spaces → hyphens, max 60 chars. */
export const safePart = (s: string | null | undefined) =>
  (s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/[^\w.\-؀-ۿ ]+/g, '')
    .trim().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60)

/**
 * Quotation:     AS0025180-2026_ABC-Contracting_Quotation.pdf
 * Invoice:       INV-2026-0001_ABC-Contracting.pdf
 * Delivery note: DN-2026-0001_Villa-22-Fujairah.pdf  (project name, else customer)
 */
export function salesPdfName(d: { doc_type: SalesType; number: string; customer_name?: string | null; project_name?: string | null; revision?: number | null }): string {
  const num = safePart(d.number) || 'document'
  const rev = d.revision ? `_Rev${d.revision}` : ''
  const who = safePart(d.doc_type === 'delivery_note' ? d.project_name || d.customer_name : d.customer_name)
  const kind = d.doc_type === 'quotation' ? '_Quotation' : d.doc_type === 'credit_note' ? '_Credit-Note' : ''
  return `${num}${rev}${who ? `_${who}` : ''}${kind}.pdf`
}
export const docLabel = (t: SalesType) => DOC_META[t].label
