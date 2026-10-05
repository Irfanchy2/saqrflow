import { daysBetween } from './time'

export type DocStatus = 'valid' | 'expiring_soon' | 'expired' | 'no_expiry' | 'renewal_in_progress' | 'cancelled'
export const EXPIRING_SOON_DAYS = 30

export function daysRemaining(expiry: string | null | undefined, today: string): number | null {
  return expiry ? daysBetween(today, expiry) : null
}

/** Status shown in the UI. Expiry always wins over the manually-set "renewal in progress" flag for already-expired docs. */
export function effectiveStatus(doc: { expiry_date?: string | null; status?: string | null }, today: string): DocStatus {
  if (doc.status === 'cancelled') return 'cancelled'
  const d = daysRemaining(doc.expiry_date, today)
  if (d === null) return 'no_expiry'
  if (d < 0) return 'expired'
  if (doc.status === 'renewal_in_progress') return 'renewal_in_progress'
  return d <= EXPIRING_SOON_DAYS ? 'expiring_soon' : 'valid'
}

export const STATUS_LABEL: Record<DocStatus, string> = {
  valid: 'Valid', expiring_soon: 'Expiring soon', expired: 'Expired', no_expiry: 'No expiry',
  renewal_in_progress: 'Renewal in progress', cancelled: 'Cancelled',
}
