// Revision snapshots + a human summary of what changed between two versions of a sales document.
import { fmtMoney } from './money'

export const SNAPSHOT_FIELDS = [
  'number', 'doc_type', 'issue_date', 'due_date', 'valid_until', 'customer_id', 'customer_name', 'attention', 'customer_address', 'customer_trn', 'customer_phone', 'customer_email',
  'project_id', 'site', 'subject', 'reference', 'lpo_ref', 'intro', 'closing', 'receiver_name', 'vehicle_no', 'vat_rate', 'discount', 'discount_type', 'discount_value',
  'show_total', 'apply_vat', 'terms', 'payment_terms', 'subtotal', 'vat_amount', 'total', 'status', 'revision',
] as const
export const SNAPSHOT_ITEM_FIELDS = ['id', 'description', 'materials', 'quantity', 'unit', 'unit_price', 'vat_category', 'discount_pct'] as const

export interface Snapshot { doc: Record<string, unknown>; items: Record<string, unknown>[] }
export function snapshotOf(doc: Record<string, any>, items: Record<string, any>[]): Snapshot {
  return {
    doc: Object.fromEntries(SNAPSHOT_FIELDS.map(k => [k, doc[k] ?? null])),
    items: items.map(i => Object.fromEntries(SNAPSHOT_ITEM_FIELDS.map(k => [k, i[k] ?? null]))),
  }
}

const LABEL: Record<string, string> = {
  issue_date: 'Date', due_date: 'Due date', valid_until: 'Validity', customer_name: 'Customer', attention: 'Attention', customer_address: 'Address',
  customer_trn: 'Customer TRN', customer_phone: 'Phone', customer_email: 'Email', project_id: 'Project', site: 'Site', subject: 'Subject', reference: 'Reference',
  lpo_ref: 'LPO', intro: 'Opening text', closing: 'Closing note', receiver_name: 'Receiver', vehicle_no: 'Vehicle', vat_rate: 'VAT rate', discount: 'Discount',
  show_total: 'Total row', apply_vat: 'VAT on quotation', terms: 'Terms & conditions', payment_terms: 'Payment terms',
}
const norm = (v: unknown) => (v === undefined || v === '' ? null : Array.isArray(v) ? JSON.stringify(v) : typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) ? Number(v) : v)

/** e.g. ["Total 26,250.00 → 27,300.00", "Line 3 added", "Terms & conditions changed"] — empty when nothing material changed */
export function diffSnapshots(a: Snapshot, b: Snapshot): string[] {
  const out: string[] = []
  for (const [k, l] of Object.entries(LABEL)) if (norm(a.doc[k]) !== norm(b.doc[k])) out.push(`${l} changed`)
  const ai = new Map<string, Record<string, unknown>>(a.items.map((x, i) => [String(x.id ?? `#${i}`), { ...x, n: i + 1 }])), seen = new Set<string>()
  b.items.forEach((x, i) => {
    const prev = x.id ? ai.get(String(x.id)) : undefined
    if (!prev) { out.push(`Line ${i + 1} added`); return }
    seen.add(String(x.id))
    const changed = SNAPSHOT_ITEM_FIELDS.filter(f => f !== 'id' && norm(prev[f]) !== norm(x[f]))
    if (changed.length) out.push(`Line ${i + 1}: ${changed.map(f => f === 'unit_price' ? 'rate' : f === 'discount_pct' ? 'discount' : f.replace('_', ' ')).join(', ')} changed`)
  })
  for (const [id, x] of ai) if (!seen.has(id)) out.push(`Line ${(x as any).n} removed`)
  if (norm(a.doc.total) !== norm(b.doc.total)) out.unshift(`Total ${fmtMoney(a.doc.total as number)} → ${fmtMoney(b.doc.total as number)}`)
  return out.slice(0, 30)
}
