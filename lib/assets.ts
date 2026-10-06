// Vehicles & Assets: shared constants + pure helpers (unit-tested).
import { daysBetween } from './time'

export const ASSET_STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' | 'blue' }> = {
  active: { label: 'Active', tone: 'green' }, in_maintenance: { label: 'In maintenance', tone: 'amber' }, out_of_service: { label: 'Out of service', tone: 'red' },
  sold: { label: 'Sold', tone: 'neutral' }, disposed: { label: 'Disposed', tone: 'neutral' },
}
export const EQUIPMENT_KINDS: Record<string, string> = { equipment: 'Equipment', machinery: 'Machinery', tool: 'Tool', office: 'Office equipment', other: 'Other' }
export const VEHICLE_TYPES = ['Pickup', 'Truck', 'Van', 'Car', 'Bus', 'Crane truck', 'Forklift', 'Trailer', 'Motorcycle', 'Other']
export const EMIRATES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah']
export const ASSET_CATEGORIES = ['Welding Machine', 'Generator', 'Drilling Machine', 'Compressor', 'Cutting Machine', 'Grinding Machine', 'Scaffolding', 'Office Equipment', 'Company Equipment', 'Other']
export const VEHICLE_DOCS = { mulkiya: 'Mulkiya / Registration', insurance: 'Insurance', inspection: 'Inspection', maintenance: 'Maintenance', registration: 'Registration', other: 'Other' } as const
export const ASSET_DOCS = { invoice: 'Purchase invoice', warranty: 'Warranty', maintenance: 'Maintenance', manual: 'Manual / certificate', other: 'Other' } as const

export interface AssetDates { registration_expiry?: string | null; insurance_expiry?: string | null; inspection_expiry?: string | null; warranty_expiry?: string | null; next_service_date?: string | null; kind?: string }
/** Upcoming / overdue dates for an asset, soonest first. These same dates feed the reminder engine (reminder_sources). */
export function assetDeadlines(a: AssetDates, today: string) {
  const out: { key: string; label: string; date: string; days: number }[] = []
  const add = (key: string, label: string, date?: string | null) => { if (date) out.push({ key, label, date, days: daysBetween(today, date) }) }
  add('registration', a.kind === 'vehicle' ? 'Mulkiya / registration' : 'Registration', a.registration_expiry)
  add('insurance', 'Insurance', a.insurance_expiry)
  add('inspection', 'Inspection', a.inspection_expiry)
  add('warranty', 'Warranty', a.warranty_expiry)
  add('service', 'Maintenance due', a.next_service_date)
  return out.sort((x, y) => x.days - y.days)
}
export const MAINT_KINDS: Record<string, string> = { service: 'Service', repair: 'Repair', inspection: 'Inspection', other: 'Other' }
export const deadlineTone = (days: number) => (days < 0 ? 'red' : days <= 30 ? 'amber' : 'green') as 'red' | 'amber' | 'green'
