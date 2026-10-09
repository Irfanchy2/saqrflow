// Import wizard: what can be imported, which columns each target has, and best-guess column mapping (pure; unit-tested).

export type FieldSpec = { key: string; label: string; required?: boolean; hint?: string; aliases: string[] }
export type EntitySpec = { label: string; noun: string; list: string; trash: string | null; dupe: string; perm: 'records.edit'; sensitive?: boolean; fields: FieldSpec[] }

const party = (who: string): FieldSpec[] => [
  { key: 'name', label: `${who} name`, required: true, aliases: ['name', 'company', 'company name', `${who.toLowerCase()}`, `${who.toLowerCase()} name`, 'account', 'party'] },
  { key: 'contact_person', label: 'Contact person', aliases: ['contact', 'contact person', 'contact name', 'attention', 'attn'] },
  { key: 'phone', label: 'Phone', aliases: ['phone', 'mobile', 'tel', 'telephone', 'phone number', 'mobile number', 'contact number'] },
  { key: 'whatsapp', label: 'WhatsApp', aliases: ['whatsapp', 'whatsapp number', 'wa'] },
  { key: 'email', label: 'Email', aliases: ['email', 'e-mail', 'email address', 'mail'] },
  { key: 'trn', label: 'TRN (VAT no.)', hint: '15 digits', aliases: ['trn', 'trn no', 'vat', 'vat no', 'vat number', 'tax no', 'tax number', 'tax registration number'] },
  { key: 'address', label: 'Address', aliases: ['address', 'location', 'city', 'full address'] },
  { key: 'notes', label: 'Notes', aliases: ['notes', 'remarks', 'comments', 'comment'] },
]

export const IMPORT_ENTITIES: Record<string, EntitySpec> = {
  customers: { label: 'Customers', noun: 'customers', list: '/parties', trash: 'customer', dupe: 'name', perm: 'records.edit', fields: [...party('Customer'), { key: 'credit_days', label: 'Credit days', hint: 'whole days', aliases: ['credit days', 'credit', 'payment terms', 'terms days'] }] },
  suppliers: { label: 'Suppliers', noun: 'suppliers', list: '/parties?tab=suppliers', trash: 'supplier', dupe: 'name', perm: 'records.edit', fields: party('Supplier') },
  catalog_items: { label: 'Products & services', noun: 'items', list: '/catalog', trash: null, dupe: 'name', perm: 'records.edit', fields: [
    { key: 'name', label: 'Item name', required: true, aliases: ['name', 'item', 'item name', 'product', 'service', 'description of item'] },
    { key: 'description', label: 'Description', aliases: ['description', 'details', 'specification', 'specs'] },
    { key: 'unit', label: 'Unit', hint: 'e.g. Nos, m, kg, LS', aliases: ['unit', 'uom', 'units'] },
    { key: 'rate', label: 'Rate (AED)', aliases: ['rate', 'price', 'unit price', 'default rate', 'selling price', 'amount'] },
    { key: 'vat_category', label: 'VAT', hint: 'standard / zero / exempt / out of scope', aliases: ['vat', 'vat category', 'tax', 'vat type'] },
    { key: 'category', label: 'Category', aliases: ['category', 'group', 'type'] },
    { key: 'notes', label: 'Notes', aliases: ['notes', 'remarks'] },
  ] },
  employees: { label: 'Employees', noun: 'employees', list: '/employees', trash: 'employee', dupe: 'employee_no', perm: 'records.edit', sensitive: true, fields: [
    { key: 'employee_no', label: 'Employee ID', required: true, aliases: ['employee no', 'employee id', 'emp no', 'emp id', 'staff id', 'id', 'code'] },
    { key: 'full_name', label: 'Full name', required: true, aliases: ['full name', 'name', 'employee name', 'name en', 'employee'] },
    { key: 'nationality', label: 'Nationality', aliases: ['nationality', 'country'] },
    { key: 'department', label: 'Department', aliases: ['department', 'dept', 'division'] },
    { key: 'designation', label: 'Designation', aliases: ['designation', 'job title', 'position', 'title', 'profession'] },
    { key: 'phone', label: 'Phone', aliases: ['phone', 'mobile', 'tel'] },
    { key: 'joining_date', label: 'Joining date', hint: 'YYYY-MM-DD or DD/MM/YYYY', aliases: ['joining date', 'joined', 'date of joining', 'doj', 'start date'] },
    { key: 'work_location', label: 'Work location', aliases: ['work location', 'location', 'site'] },
  ] },
  leads: { label: 'Leads (CRM)', noun: 'leads', list: '/leads', trash: 'lead', dupe: 'company_name', perm: 'records.edit', fields: [
    { key: 'company_name', label: 'Company / client', required: true, aliases: ['company', 'company name', 'client', 'customer', 'name', 'lead'] },
    { key: 'contact_person', label: 'Contact person', aliases: ['contact', 'contact person', 'contact name'] },
    { key: 'phone', label: 'Phone', aliases: ['phone', 'mobile', 'tel', 'contact number'] },
    { key: 'email', label: 'Email', aliases: ['email', 'e-mail'] },
    { key: 'location', label: 'Location', aliases: ['location', 'site', 'area', 'city', 'emirate'] },
    { key: 'service', label: 'Service / scope', aliases: ['service', 'scope', 'requirement', 'work', 'enquiry', 'description'] },
    { key: 'source', label: 'Source', hint: 'website, google, referral, walk in, tender…', aliases: ['source', 'lead source', 'channel', 'how heard'] },
    { key: 'estimated_value', label: 'Estimated value (AED)', aliases: ['estimated value', 'value', 'budget', 'amount', 'expected value'] },
    { key: 'notes', label: 'Notes', aliases: ['notes', 'remarks', 'comments'] },
  ] },
}
export type ImportEntity = keyof typeof IMPORT_ENTITIES
export const MAX_ROWS = 2000

export const normHeader = (h: string) => h.toLowerCase().replace(/[_\-./]+/g, ' ').replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim()

/** Column index per field (or -1). Exact alias matches first, then "contains"; each column is used once. */
export function guessMapping(entity: string, headers: string[]): Record<string, number> {
  const spec = IMPORT_ENTITIES[entity]; if (!spec) return {}
  const hs = headers.map(normHeader), used = new Set<number>(), out: Record<string, number> = {}
  for (const pass of ['exact', 'contains'] as const)
    for (const f of spec.fields) {
      if (out[f.key] !== undefined && out[f.key] >= 0) continue
      const names = [normHeader(f.key), normHeader(f.label), ...f.aliases.map(normHeader)]
      const i = hs.findIndex((h, j) => !used.has(j) && h && (pass === 'exact' ? names.includes(h) : names.some(n => n.length > 3 && (h.includes(n) || n.includes(h) && h.length > 3))))
      if (i >= 0) { out[f.key] = i; used.add(i) } else if (pass === 'contains') out[f.key] = out[f.key] ?? -1
    }
  return out
}

/** Excel serial, YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY → YYYY-MM-DD; '' → null; anything else → 'bad'. */
export function parseDate(s?: string): string | null | 'bad' {
  const v = (s ?? '').trim()
  if (!v) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(v)
  if (m) { const [, d, mo, y] = m; if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return 'bad'; return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}` }
  if (/^\d{5}(\.\d+)?$/.test(v)) return new Date(Date.UTC(1899, 11, 30 + Math.floor(Number(v)))).toISOString().slice(0, 10)
  return 'bad'
}
/** "AED 12,500.50" → 12500.5; '' → null; not a number → NaN. */
export function parseAmount(s?: string): number | null {
  const v = (s ?? '').replace(/aed|dhs?|,|\s/gi, '')
  if (!v) return null
  return /^-?\d+(\.\d+)?$/.test(v) ? Math.round(Number(v) * 100) / 100 : NaN
}
export function parseVat(s?: string): 'standard' | 'zero' | 'exempt' | 'out_of_scope' | null {
  const t = (s ?? '').toLowerCase().trim()
  if (!t || /standard|^5\s*%?$/.test(t)) return 'standard'
  if (/zero|^0\s*%?$/.test(t)) return 'zero'
  if (/exempt/.test(t)) return 'exempt'
  if (/out|scope|^no$|none/.test(t)) return 'out_of_scope'
  return null
}
const SOURCES = ['website', 'google', 'facebook', 'instagram', 'whatsapp', 'referral', 'existing_customer', 'walk_in', 'tender', 'cold_call', 'other'] as const
export function parseSource(s?: string): (typeof SOURCES)[number] {
  const t = (s ?? '').toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '')
  if ((SOURCES as readonly string[]).includes(t)) return t as (typeof SOURCES)[number]
  if (/web|site|online/.test(t)) return 'website'
  if (/refer/.test(t)) return 'referral'
  if (/walk/.test(t)) return 'walk_in'
  if (/cold|call/.test(t)) return 'cold_call'
  if (/existing|repeat|old_client/.test(t)) return 'existing_customer'
  if (/fb|face/.test(t)) return 'facebook'
  if (/insta/.test(t)) return 'instagram'
  if (/wa|whats/.test(t)) return 'whatsapp'
  return 'other'
}
