import type { Tone } from '@/components/ui/primitives'

export const APPROVAL_TYPES = ['quotation', 'purchase_order', 'invoice', 'credit_note', 'expense', 'cheque', 'other'] as const
export type ApprovalType = (typeof APPROVAL_TYPES)[number]
export const SALES_APPROVAL_TYPES: ApprovalType[] = ['quotation', 'purchase_order', 'invoice', 'credit_note']

export const APPROVAL_TYPE_LABEL: Record<ApprovalType, string> = {
  quotation: 'Quotation', purchase_order: 'Purchase order', invoice: 'Tax invoice', credit_note: 'Credit note', expense: 'Expense', cheque: 'Outgoing cheque', other: 'Other request',
}
export const APPROVAL_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'amber' }, approved: { label: 'Approved', tone: 'green' }, rejected: { label: 'Rejected', tone: 'red' },
  changes_requested: { label: 'Changes requested', tone: 'blue' }, cancelled: { label: 'Cancelled', tone: 'neutral' },
}

/** Where the record behind a request lives. */
export function approvalLink(t: string, id: string | null, ref?: string | null): string | null {
  if (!id) return null
  if ((SALES_APPROVAL_TYPES as string[]).includes(t)) return `/invoices/${id}`
  if (t === 'expense') return ref ? `/expenses?q=${encodeURIComponent(ref)}` : '/expenses'
  if (t === 'cheque') return ref ? `/cheques?view=list&q=${encodeURIComponent(ref)}` : '/cheques?view=list'
  return null
}

/** Sales documents are decided by sales approvers too; everything else needs approvals.decide. */
export const canDecide = (t: string, can: (p: any) => boolean) => can('approvals.decide') || ((SALES_APPROVAL_TYPES as string[]).includes(t) && can('sales.approve'))
