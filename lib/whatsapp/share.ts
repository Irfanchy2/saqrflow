// Free WhatsApp sharing ("Share via WhatsApp"): the message the user's own WhatsApp opens with. Pure and unit-tested.
// Separate from the Cloud API templates (lib/whatsapp/messages.ts): no Meta approval, nothing is sent by the server.
// Only the whitelisted {placeholders} below can be filled; salary amounts appear only where a template asks for {amount}.
import { safeValue } from './messages'

export type ShareKind = 'payslip' | 'salary_receipt' | 'quotation' | 'invoice' | 'delivery_note' | 'payment_reminder'
export interface ShareDef { label: string; party: 'employee' | 'customer'; vars: string[]; body: string }

export const SHARE: Record<ShareKind, ShareDef> = {
  payslip: { label: 'Employee payslip', party: 'employee', vars: ['employee', 'period', 'company'],
    body: 'Dear {employee},\n\nPlease find your payslip for {period}.\n\nCompany: {company}\nSalary period: {period}\n\nKindly review the attached document.\n\nThank you,\n{company}' },
  salary_receipt: { label: 'Salary payment receipt', party: 'employee', vars: ['employee', 'amount', 'date', 'reference', 'company'],
    body: 'Dear {employee},\n\nYour salary payment of {amount} dated {date} has been recorded.\n\nPlease find your payment receipt attached.\n\nThank you,\n{company}' },
  quotation: { label: 'Quotation', party: 'customer', vars: ['customer', 'number', 'amount', 'valid_until', 'company'],
    body: 'Dear {customer},\n\nPlease find attached our quotation {number} for {amount}, valid until {valid_until}.\n\nWe look forward to working with you.\n\n{company}' },
  invoice: { label: 'Tax invoice', party: 'customer', vars: ['customer', 'number', 'amount', 'due_date', 'company'],
    body: 'Dear {customer},\n\nPlease find attached tax invoice {number} for {amount}, due on {due_date}.\n\nThank you for your business.\n\n{company}' },
  delivery_note: { label: 'Delivery note', party: 'customer', vars: ['customer', 'number', 'company'],
    body: 'Dear {customer},\n\nPlease find attached delivery note {number}. Kindly check the delivered items.\n\n{company}' },
  payment_reminder: { label: 'Payment reminder', party: 'customer', vars: ['customer', 'number', 'balance', 'due_date', 'company'],
    body: 'Dear {customer},\n\nThis is a friendly reminder that invoice {number} has {balance} outstanding, due on {due_date}. The invoice is attached.\n\nPlease ignore this message if it is already paid.\n\n{company}' },
}
export const SHARE_KINDS = Object.keys(SHARE) as ShareKind[]
export const isShareKind = (k: string): k is ShareKind => k in SHARE
export const shareSettingKey = (k: ShareKind) => `whatsapp.share.${k}`

/** Problems with an edited message: unknown placeholders, empty or too long. */
export function shareBodyProblems(kind: ShareKind, body: string): string[] {
  const allowed = new Set(SHARE[kind].vars), p: string[] = []
  for (const m of body.matchAll(/\{([a-z_]+)\}/g)) if (!allowed.has(m[1])) p.push(`{${m[1]}} is not available here. Use: ${SHARE[kind].vars.map(v => `{${v}}`).join(' ')}`)
  if (body.trim().length < 10) p.push('The message is too short.')
  if (body.length > 1000) p.push('Keep the message under 1,000 characters.')
  return [...new Set(p)]
}

/** The message with its values filled in (each value flattened and long digit runs masked). Unknown placeholders stay as typed. */
export function fillShare(kind: ShareKind, body: string, values: Record<string, string | null | undefined>): string {
  const allowed = SHARE[kind].vars
  return body.replace(/\r/g, '').replace(/\{([a-z_]+)\}/g, (all, v) => (allowed.includes(v) ? safeValue(values[v] ?? '-') : all)).trim()
}

/** wa.me link for an E.164 number (+9715…) with the message. */
export const waChatLink = (e164: string, text: string) => `https://wa.me/${e164.replace(/^\+/, '')}?text=${encodeURIComponent(text)}`

/** "+971 50 123 4567" for reading a number back before sharing (UAE mobile grouping; other numbers in threes). */
export function prettyPhone(e164: string | null | undefined): string {
  if (!e164) return ''
  const m = /^\+971(5\d)(\d{3})(\d{4})$/.exec(e164)
  if (m) return `+971 ${m[1]} ${m[2]} ${m[3]}`
  const cc = /^\+(\d{1,3})(\d+)$/.exec(e164); if (!cc) return e164
  return `+${cc[1]} ${cc[2].replace(/(\d{3})(?=\d)/g, '$1 ')}`
}
