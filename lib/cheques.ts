import { addDays, daysBetween, endOfMonth } from './time'

export type ChequeStatus = 'received' | 'issued' | 'scheduled' | 'deposited' | 'presented' | 'cleared' | 'returned' | 'cancelled'
export type Direction = 'incoming' | 'outgoing'
export interface ChequeLike { direction: Direction; status: ChequeStatus; amount: number | string; cheque_date: string }

// Must match cheque_transition_ok() in SQL – parity is asserted in tests/db.
export const TRANSITIONS: Record<Direction, Partial<Record<ChequeStatus, ChequeStatus[]>>> = {
  incoming: {
    received: ['scheduled', 'deposited', 'cancelled'], scheduled: ['deposited', 'cancelled'],
    deposited: ['cleared', 'returned'], returned: ['deposited', 'cancelled'],
  },
  outgoing: {
    issued: ['scheduled', 'presented', 'cleared', 'returned', 'cancelled'],
    scheduled: ['presented', 'cleared', 'returned', 'cancelled'],
    presented: ['cleared', 'returned'], returned: ['issued', 'cancelled'],
  },
}
export const canTransition = (dir: Direction, from: ChequeStatus, to: ChequeStatus) =>
  from === to || !!TRANSITIONS[dir][from]?.includes(to)
export const nextStatuses = (dir: Direction, from: ChequeStatus) => TRANSITIONS[dir][from] ?? []

/** Statuses in which the cheque is still a live commitment (counts toward totals and reminders). */
export const OPEN: ChequeStatus[] = ['received', 'issued', 'scheduled', 'deposited', 'presented']
/** Not yet sent to the bank – if the cheque date has passed, someone must act. */
export const PRE_BANK: ChequeStatus[] = ['received', 'issued', 'scheduled']
/** Handed to the bank – waiting for manual confirmation of clearing. */
export const AWAITING_CLEARANCE: ChequeStatus[] = ['deposited', 'presented']

const sum = (xs: ChequeLike[]) => Math.round(xs.reduce((a, c) => a + Number(c.amount), 0) * 100) / 100

export function summarizeCheques(cheques: ChequeLike[], today: string) {
  const open = cheques.filter(c => OPEN.includes(c.status))
  const weekEnd = addDays(today, 6)            // today + next 6 days = 7-day window
  const monthEnd = endOfMonth(today)
  const preBank = open.filter(c => PRE_BANK.includes(c.status))
  const inRange = (c: ChequeLike, to: string) => c.cheque_date >= today && c.cheque_date <= to
  const incoming = open.filter(c => c.direction === 'incoming'), outgoing = open.filter(c => c.direction === 'outgoing')
  return {
    incomingTotal: sum(incoming), incomingCount: incoming.length,
    outgoingTotal: sum(outgoing), outgoingCount: outgoing.length,
    dueThisWeek: preBank.filter(c => inRange(c, weekEnd)),
    dueThisMonth: preBank.filter(c => inRange(c, monthEnd)),
    overdue: preBank.filter(c => c.cheque_date < today),
    awaitingClearance: open.filter(c => AWAITING_CLEARANCE.includes(c.status)),
    returned: cheques.filter(c => c.status === 'returned'),
    netPosition: Math.round((sum(incoming) - sum(outgoing)) * 100) / 100,
  }
}
export const daysUntil = (chequeDate: string, today: string) => daysBetween(today, chequeDate)
