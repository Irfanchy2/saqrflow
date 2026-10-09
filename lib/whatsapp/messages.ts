// "Send via WhatsApp" message types (pure; unit-tested). Each type is a WhatsApp utility template named averiqo_<kind>:
// a PDF document header (where the type has a document) and a body whose {placeholders} become Meta's {{1}}, {{2}} …
// Only the whitelisted placeholders below can appear in a message — never ID / passport numbers, IBANs or salaries.

export type PartyType = 'customer' | 'supplier' | 'employee'
export interface KindDef { label: string; party: PartyType; pdf: boolean; vars: string[]; body: string; sample: Record<string, string> }

const COMPANY = 'Al Saqr Al Ahmar'
export const KINDS: Record<string, KindDef> = {
  quotation: { label: 'Quotation', party: 'customer', pdf: true, vars: ['customer', 'number', 'amount', 'valid_until', 'company'],
    body: 'Dear {customer}, please find attached our quotation {number} for {amount}, valid until {valid_until}. We look forward to working with you. {company}',
    sample: { customer: 'ABC Contracting LLC', number: 'AS-002600/2026', amount: 'AED 12,500.00', valid_until: '09 Nov 2026', company: COMPANY } },
  invoice: { label: 'Tax invoice', party: 'customer', pdf: true, vars: ['customer', 'number', 'amount', 'due_date', 'company'],
    body: 'Dear {customer}, please find attached tax invoice {number} for {amount}, due on {due_date}. Thank you for your business. {company}',
    sample: { customer: 'ABC Contracting LLC', number: 'INV-610', amount: 'AED 13,125.00', due_date: '09 Nov 2026', company: COMPANY } },
  delivery_note: { label: 'Delivery note', party: 'customer', pdf: true, vars: ['customer', 'number', 'company'],
    body: 'Dear {customer}, please find attached delivery note {number}. Kindly check the delivered items. {company}',
    sample: { customer: 'ABC Contracting LLC', number: 'DL-1300', company: COMPANY } },
  receipt: { label: 'Payment receipt', party: 'customer', pdf: true, vars: ['customer', 'amount', 'date', 'reference', 'company'],
    body: 'Dear {customer}, we have received your payment of {amount} on {date} ({reference}). The receipt is attached. Thank you. {company}',
    sample: { customer: 'ABC Contracting LLC', amount: 'AED 5,000.00', date: '09 Oct 2026', reference: 'INV-610', company: COMPANY } },
  payslip: { label: 'Salary payslip', party: 'employee', pdf: true, vars: ['employee', 'period', 'company'],
    body: 'Dear {employee}, your payslip for {period} is attached. Please keep it for your records. {company}',
    sample: { employee: 'Mohammed Iqbal', period: 'September 2026', company: COMPANY } },
  statement: { label: 'Customer statement', party: 'customer', pdf: true, vars: ['customer', 'date', 'balance', 'company'],
    body: 'Dear {customer}, please find attached your statement of account as of {date}. Balance: {balance}. {company}',
    sample: { customer: 'ABC Contracting LLC', date: '09 Oct 2026', balance: 'AED 20,000.00', company: COMPANY } },
  payment_reminder: { label: 'Payment reminder', party: 'customer', pdf: true, vars: ['customer', 'number', 'amount', 'due_date', 'company'],
    body: 'Dear {customer}, this is a friendly reminder that invoice {number} has {amount} outstanding, due on {due_date}. The invoice is attached. Please ignore this if already paid. {company}',
    sample: { customer: 'ABC Contracting LLC', number: 'INV-610', amount: 'AED 8,125.00', due_date: '01 Oct 2026', company: COMPANY } },
  quotation_followup: { label: 'Quotation follow-up', party: 'customer', pdf: true, vars: ['customer', 'number', 'company'],
    body: 'Dear {customer}, we are following up on our quotation {number} (attached). Please let us know if you have any questions or would like to proceed. {company}',
    sample: { customer: 'ABC Contracting LLC', number: 'AS-002600/2026', company: COMPANY } },
  document_expiry: { label: 'Document expiry reminder', party: 'employee', pdf: false, vars: ['employee', 'document', 'expiry_date', 'company'],
    body: 'Dear {employee}, your {document} expires on {expiry_date}. Please contact the office to start the renewal. {company}',
    sample: { employee: 'Mohammed Iqbal', document: 'Residence visa', expiry_date: '20 Oct 2026', company: COMPANY } },
  cheque_reminder: { label: 'Cheque reminder', party: 'customer', pdf: false, vars: ['customer', 'cheque', 'amount', 'date', 'company'],
    body: 'Dear {customer}, a reminder that cheque {cheque} for {amount} is dated {date}. Please ensure funds are available. {company}',
    sample: { customer: 'ABC Contracting LLC', cheque: 'ending 4417', amount: 'AED 18,450.00', date: '14 Oct 2026', company: COMPANY } },
  project_update: { label: 'Project update', party: 'customer', pdf: false, vars: ['customer', 'project', 'progress', 'status', 'company'],
    body: 'Dear {customer}, an update on {project}: fabrication and site work are {progress} complete. Current status: {status}. {company}',
    sample: { customer: 'ABC Contracting LLC', project: 'Villa 214 staircase', progress: '60% / 20%', status: 'Active', company: COMPANY } },
}
export const KIND_KEYS = Object.keys(KINDS)
export const metaName = (kind: string) => `averiqo_${kind}`

/** {placeholders} that appear in a body, in order of first appearance (only the ones the kind allows). */
export function placeholders(kind: string, body: string): string[] {
  const allowed = new Set(KINDS[kind]?.vars ?? []), out: string[] = []
  for (const m of body.matchAll(/\{([a-z_]+)\}/g)) if (allowed.has(m[1]) && !out.includes(m[1])) out.push(m[1])
  return out
}
/** Problems with an edited body (unknown placeholders, length, Meta's formatting rules). */
export function bodyProblems(kind: string, body: string): string[] {
  const p: string[] = [], allowed = new Set(KINDS[kind]?.vars ?? [])
  for (const m of body.matchAll(/\{([a-z_]+)\}/g)) if (!allowed.has(m[1])) p.push(`{${m[1]}} is not available here. Use: ${[...allowed].map(v => `{${v}}`).join(' ')}`)
  if (body.trim().length < 10) p.push('The message is too short.')
  if (body.length > 900) p.push('Keep the message under 900 characters.')
  if (/\{[a-z_]+\}\s*$/.test(body.trim()) && !/\{company\}\s*$/.test(body.trim())) p.push('WhatsApp does not allow a message to end with a variable other than the company name; add a word after it.')
  if (/^\s*\{/.test(body)) p.push('WhatsApp does not allow a message to start with a variable.')
  return [...new Set(p)]
}
/** Meta template body: {name} → {{n}} in order. */
export function toMetaBody(kind: string, body: string): { text: string; order: string[] } {
  const order = placeholders(kind, body)
  return { text: body.replace(/\{([a-z_]+)\}/g, (all, v) => (order.includes(v) ? `{{${order.indexOf(v) + 1}}}` : all)), order }
}

/** Values are flattened and long digit runs masked (IDs, accounts, card numbers) before they reach a message. */
export function safeValue(v: unknown, max = 120): string {
  const s = String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max)
  return (s.replace(/\bAE\d{2}[\d ]{15,30}\b/gi, 'IBAN ••••').replace(/\d{8,}/g, m => '•'.repeat(m.length - 4) + m.slice(-4)) || '-')
}
export function fill(kind: string, body: string, values: Record<string, string>) {
  return body.replace(/\{([a-z_]+)\}/g, (all, v) => (KINDS[kind]?.vars.includes(v) ? safeValue(values[v]) : all))
}
/** Free text typed for a message inside the 24-hour window: same masking, length-limited to a WhatsApp caption. */
export function safeFreeText(s: string) {
  return s.replace(/\r/g, '').replace(/\bAE\d{2}[\d ]{15,30}\b/gi, 'IBAN ••••').replace(/\b784[- ]?\d{4}[- ]?\d{7}[- ]?\d\b/g, '784-••••-•••••••-•').replace(/\d{12,}/g, m => '•'.repeat(m.length - 4) + m.slice(-4)).trim().slice(0, 1000)
}
export const maskPhone = (p?: string | null) => (p ? `${p.slice(0, 5)} ••• ${p.slice(-3)}` : '—')
export const WINDOW_MS = 24 * 3600_000
