// Vehicles & Assets: shared constants + pure helpers (unit-tested).
import { daysBetween } from './time'

// one status vocabulary for vehicles and equipment (Archived is separate: archived_at, so the status is kept on restore)
export const ASSET_STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' | 'blue' }> = {
  active: { label: 'Active', tone: 'green' }, assigned: { label: 'Assigned', tone: 'blue' }, available: { label: 'Available', tone: 'green' },
  in_maintenance: { label: 'Maintenance', tone: 'amber' }, in_repair: { label: 'Repair', tone: 'amber' }, out_of_service: { label: 'Out of service', tone: 'red' },
  retired: { label: 'Retired', tone: 'neutral' }, sold: { label: 'Sold', tone: 'neutral' }, disposed: { label: 'Disposed', tone: 'neutral' },
}
export const ASSET_STATUS_KEYS = Object.keys(ASSET_STATUS) as [string, ...string[]]
export const CONDITIONS: Record<string, string> = { new: 'New', good: 'Good', fair: 'Fair', poor: 'Poor', damaged: 'Damaged' }
export const EQUIPMENT_KINDS: Record<string, string> = { equipment: 'Equipment', machinery: 'Machinery', tool: 'Tool', office: 'Office equipment', other: 'Other' }
export const VEHICLE_TYPES = ['Pickup', 'Truck', 'Van', 'Car', 'Bus', 'Crane truck', 'Forklift', 'Trailer', 'Motorcycle', 'Other']
export const EMIRATES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah']
export const ASSET_CATEGORIES = ['Welding Machine', 'Generator', 'Air Compressor', 'Cutting Machine', 'Grinding Equipment', 'Drill Machine', 'Power Tools', 'Workshop Equipment', 'Scaffolding', 'Office Computer', 'Printer', 'Company Equipment', 'Other']
export const VEHICLE_DOCS = { mulkiya: 'Mulkiya', insurance: 'Vehicle insurance', inspection: 'Inspection', registration: 'Registration', repair: 'Repair document', maintenance: 'Service record', other: 'Other' } as const
export const ASSET_DOCS = { invoice: 'Purchase invoice', warranty: 'Warranty', certificate: 'Certification / calibration', maintenance: 'Service record', repair: 'Repair document', manual: 'Manual', other: 'Other' } as const

export interface AssetDates { registration_expiry?: string | null; insurance_expiry?: string | null; inspection_expiry?: string | null; warranty_expiry?: string | null; next_service_date?: string | null; kind?: string }
/** Upcoming / overdue dates for an asset, soonest first. These same dates feed the reminder engine (reminder_sources). */
export function assetDeadlines(a: AssetDates, today: string) {
  const out: { key: string; label: string; date: string; days: number }[] = []
  const add = (key: string, label: string, date?: string | null) => { if (date) out.push({ key, label, date, days: daysBetween(today, date) }) }
  add('registration', a.kind === 'vehicle' ? 'Mulkiya / registration' : 'Registration', a.registration_expiry)
  add('insurance', 'Insurance', a.insurance_expiry)
  add('inspection', 'Inspection', a.inspection_expiry)
  add('warranty', 'Warranty', a.warranty_expiry)
  add('service', a.kind === 'vehicle' ? 'Service due' : 'Maintenance due', a.next_service_date)
  return out.sort((x, y) => x.days - y.days)
}
export const MAINT_KINDS: Record<string, string> = { service: 'Service', repair: 'Repair', inspection: 'Inspection', other: 'Other' }
export const deadlineTone = (days: number) => (days < 0 ? 'red' : days <= 30 ? 'amber' : 'green') as 'red' | 'amber' | 'green'

/** km left until the next mileage-based service (null when either number is unknown) */
export const kmToService = (a: { current_mileage?: number | null; next_service_km?: number | null }) =>
  a.current_mileage != null && a.next_service_km != null ? a.next_service_km - a.current_mileage : null
