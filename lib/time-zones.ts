// Time zones offered by the dashboard clock. The common ones for UAE / GCC businesses and their teams come first;
// search covers every zone the runtime knows.
export const ZONES: [tz: string, place: string][] = [
  ['Asia/Dubai', 'Dubai, UAE'], ['Asia/Riyadh', 'Riyadh, Saudi Arabia'], ['Asia/Qatar', 'Doha, Qatar'], ['Asia/Bahrain', 'Manama, Bahrain'],
  ['Asia/Kuwait', 'Kuwait City, Kuwait'], ['Asia/Muscat', 'Muscat, Oman'], ['Africa/Cairo', 'Cairo, Egypt'], ['Asia/Karachi', 'Karachi, Pakistan'],
  ['Asia/Kolkata', 'India'], ['Asia/Dhaka', 'Dhaka, Bangladesh'], ['Asia/Kathmandu', 'Kathmandu, Nepal'], ['Asia/Manila', 'Manila, Philippines'],
  ['Asia/Singapore', 'Singapore'], ['Europe/Istanbul', 'Istanbul, Türkiye'], ['Europe/London', 'London, UK'], ['America/New_York', 'New York, USA'],
]

export const placeOf = (tz: string) => ZONES.find(z => z[0] === tz)?.[1] ?? tz.split('/').pop()!.replace(/_/g, ' ')

export function allZones(): string[] {
  try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone') } catch { return ZONES.map(z => z[0]) }
}
export const isZone = (tz: string) => tz === 'UTC' || allZones().includes(tz) || ZONES.some(z => z[0] === tz)
