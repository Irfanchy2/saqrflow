import 'server-only'
import type { Ctx } from '../auth'
import { createAdminClient } from '../supabase/admin'
import { SIGN_DEFAULTS, type Branding, type PaperDoc, type PaperItem } from '@/components/sales/paper'
import { DEFAULTS, type SalesType } from './docs'
import { TEMPLATE_KINDS } from './template'

export const BRAND_KINDS = ['header', 'header_invoice', 'footer', 'stamp', 'signature', 'logo'] as const
export type BrandKind = (typeof BRAND_KINDS)[number]

export interface SalesSettings { terms: string[]; paymentTerms: string[]; intro: string; closing: string; vatRate: number; dueDays: number; validityDays: number; quoteVat: 'note' | 'add'; followupDays: number[]; requireApproval: boolean }
export async function salesSettings(c: Ctx): Promise<SalesSettings & { raw: Record<string, any> }> {
  const { data } = await c.supabase.from('app_settings').select('key,value').eq('company_id', c.company.id).or('key.like.sales.%,key.like.branding.%,key.like.template.%')   // explicit company filter: also safe for server-side (portal) reads
  const m = Object.fromEntries((data ?? []).map(r => [r.key, r.value]))
  const arr = (v: unknown, d: string[]) => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : d)
  return {
    raw: m,
    terms: arr(m['sales.terms'], DEFAULTS.terms), paymentTerms: arr(m['sales.payment_terms'], DEFAULTS.paymentTerms),
    intro: typeof m['sales.intro'] === 'string' ? m['sales.intro'] : DEFAULTS.intro, closing: typeof m['sales.closing'] === 'string' ? m['sales.closing'] : DEFAULTS.closing,
    vatRate: typeof m['sales.vat_rate'] === 'number' ? m['sales.vat_rate'] : DEFAULTS.vatRate,
    dueDays: typeof m['sales.due_days'] === 'number' ? m['sales.due_days'] : DEFAULTS.dueDays,
    validityDays: typeof m['sales.validity_days'] === 'number' ? m['sales.validity_days'] : DEFAULTS.validityDays,
    quoteVat: m['sales.quote_vat'] === 'add' ? 'add' : 'note',
    followupDays: Array.isArray(m['sales.followup_days']) ? m['sales.followup_days'].filter((n: unknown) => typeof n === 'number' && n > 0 && n <= 365) : DEFAULTS.followupDays,
    requireApproval: m['sales.require_approval'] === true,
  }
}

/** Seal / signature size and placement (Settings → Branding), clamped to print-safe ranges. */
export function signLayout(raw: Record<string, any>) {
  const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d)
  return {
    sealSize: num(raw['branding.seal_size'], SIGN_DEFAULTS.sealSize, 70, 220),
    signatureWidth: num(raw['branding.signature_width'], SIGN_DEFAULTS.signatureWidth, 80, 260),
    signAlign: (['left', 'center', 'right'] as const).find(a => a === raw['branding.sign_align']) ?? SIGN_DEFAULTS.signAlign,
    signSpacing: num(raw['branding.sign_spacing'], SIGN_DEFAULTS.signSpacing, 0, 80),
  }
}

/** Text branding (used when no letterhead image is uploaded, and under the signature). */
export function brandText(raw: Record<string, any>) {
  const t = (k: string, max = 300) => (typeof raw[k] === 'string' && raw[k].trim() ? String(raw[k]).slice(0, max) : null)
  const n = (k: string, d: number, lo: number, hi: number) => (typeof raw[k] === 'number' ? Math.min(hi, Math.max(lo, Math.round(raw[k]))) : d)
  return {
    companyAddress: t('branding.address', 500), companyPhone: t('branding.phone', 80), companyEmail: t('branding.email', 120), companyWebsite: t('branding.website', 120),
    signatoryName: t('branding.signatory_name', 120), signatoryTitle: t('branding.signatory_title', 120),
    brandColor: typeof raw['branding.color'] === 'string' && /^#[0-9a-f]{6}$/i.test(raw['branding.color']) ? raw['branding.color'] : null,
    logoHeight: n('branding.logo_height', 0, 0, 60), logoAlign: (['left', 'center', 'right'] as const).find(a => a === raw['branding.logo_align']) ?? 'center',
  }
}

/** Saved template-builder settings (Settings → Template builder), keyed by document type. */
export function templatesFrom(raw: Record<string, any>) {
  return Object.fromEntries(TEMPLATE_KINDS.filter(k => raw[`template.${k}`] && typeof raw[`template.${k}`] === 'object').map(k => [k, raw[`template.${k}`]]))
}

/** Branding for on-screen rendering: images are served by /api/branding/<kind> (auth + company-scoped, never public). */
export async function brandingFor(c: Ctx): Promise<Branding> {
  const { raw } = await salesSettings(c)
  const url = (k: BrandKind) => (raw[`branding.${k}`] ? `/api/branding/${k}?v=${encodeURIComponent(String(raw[`branding.${k}`]).slice(-12))}` : null)
  return {
    companyName: c.company.name, logo: url('logo'), header: url('header'), headerInvoice: url('header_invoice'), footer: url('footer'), stamp: url('stamp'), signature: url('signature'),
    showHeaderFooter: raw['branding.show_header_footer'] !== false, showStamp: raw['branding.show_stamp'] !== false,
    templates: templatesFrom(raw),
    bankDetails: typeof raw['branding.bank_details'] === 'string' ? raw['branding.bank_details'] : null,
    companyTrn: typeof raw['branding.company_trn'] === 'string' ? raw['branding.company_trn'] : null,
    ...signLayout(raw), ...brandText(raw),
  }
}

/** Raw image bytes for the PDF renderer (downloaded with the service role after the caller passed RLS). */
export async function brandingBytes(c: Ctx): Promise<Partial<Record<BrandKind, { bytes: Uint8Array; png: boolean }>>> {
  const { raw } = await salesSettings(c)
  const admin = createAdminClient(), out: Partial<Record<BrandKind, { bytes: Uint8Array; png: boolean }>> = {}
  await Promise.all(BRAND_KINDS.map(async k => {
    const path = raw[`branding.${k}`]; if (typeof path !== 'string' || !path.startsWith(c.company.id + '/')) return
    const { data } = await admin.storage.from('vault').download(path)
    if (data) out[k] = { bytes: new Uint8Array(await data.arrayBuffer()), png: /\.png$/i.test(path) }
  }))
  return out
}

export interface SalesDoc extends PaperDoc { id: string; status: string; customer_id: string | null; project_id: string | null; quotation_id: string | null; source_invoice_id: string | null; total: number; subtotal: number; vat_amount: number; pdf_document_id: string | null; created_at: string; updated_at: string; external_provider: string | null; approval_status: string | null; approval_note: string | null; approved_by: string | null; revision: number; salesperson_id: string | null }
export async function loadSalesDoc(c: Ctx, id: string) {
  const { data: doc } = await c.supabase.from('invoices').select('*').eq('id', id).eq('company_id', c.company.id).maybeSingle()
  if (!doc) return null
  const [{ data: items }, { data: pays }, { data: related }, { data: project }, { data: customer }] = await Promise.all([
    c.supabase.from('invoice_items').select('*').eq('invoice_id', id).eq('company_id', c.company.id).order('position'),
    doc.doc_type === 'invoice' ? c.supabase.from('payments').select('*').eq('invoice_id', id).eq('company_id', c.company.id).order('paid_on') : Promise.resolve({ data: [] as any[] }),
    c.supabase.from('invoices').select('id,doc_type,number,status,total,issue_date,source_invoice_id,quotation_id').or(`id.eq.${doc.quotation_id ?? '00000000-0000-0000-0000-000000000000'},id.eq.${doc.source_invoice_id ?? '00000000-0000-0000-0000-000000000000'},quotation_id.eq.${id},source_invoice_id.eq.${id}`),
    doc.project_id ? c.supabase.from('projects').select('id,name,code').eq('id', doc.project_id).maybeSingle() : Promise.resolve({ data: null }),
    doc.customer_id ? c.supabase.from('customers').select('id,name').eq('id', doc.customer_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const paid = (pays ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0)
  const credited = (related ?? []).filter((r: any) => r.doc_type === 'credit_note' && r.source_invoice_id === id && !['draft', 'cancelled'].includes(r.status)).reduce((s: number, r: any) => s + Number(r.total), 0)
  const dn = (related ?? []).find((r: any) => r.doc_type === 'delivery_note')
  const against = doc.doc_type === 'credit_note' && doc.source_invoice_id ? (related ?? []).find((r: any) => r.id === doc.source_invoice_id) : null
  return {
    doc: { ...doc, project_name: project?.name ?? null, doc_type: doc.doc_type as SalesType, vat_rate: Number(doc.vat_rate), discount: Number(doc.discount), terms: doc.terms ?? [], payment_terms: doc.payment_terms ?? [], del_no: dn?.number ?? null, against_number: against?.number ?? null } as SalesDoc,
    items: (items ?? []).map((i: any) => ({ ...i, quantity: Number(i.quantity), unit_price: Number(i.unit_price) })) as (PaperItem & { id: string })[],
    payments: (pays ?? []) as any[], paid, credited, related: (related ?? []) as any[], project, customer,
  }
}
