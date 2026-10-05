// UAE business document catalogue used by both classification engines.
// `category` must match a seeded document_categories name (see 0003_rpc.sql) — or it is created on first filing.

export type OwnerKind = 'company' | 'employee' | 'customer' | 'vehicle'
export type FieldKey =
  | 'holder_name' | 'company_name' | 'document_number' | 'issue_date' | 'expiry_date' | 'date_of_birth'
  | 'nationality' | 'employer' | 'profession' | 'issuing_authority' | 'license_type' | 'trn'
  | 'landlord' | 'tenant' | 'property' | 'amount' | 'customer_name' | 'plate_number'

export interface DocTypeDef {
  key: string
  label: string
  owner: OwnerKind
  category: string
  categoryScope: 'company' | 'employee' | 'vehicle' | 'other'
  hasExpiry: boolean
  /** strong cues: almost decisive on their own (weight 3) */
  strong: RegExp[]
  /** weak cues: supporting evidence (weight 1) */
  weak: RegExp[]
  /** destination shown to the user, e.g. ["Employees", "{owner}", "Visa"] */
  path: string[]
}

const r = (s: string) => new RegExp(s, 'i')

export const DOC_TYPES: DocTypeDef[] = [
  // ── company ──
  { key: 'trade_license', label: 'Trade License', owner: 'company', category: 'Trade License', categoryScope: 'company', hasExpiry: true,
    strong: [r('trade\\s*licen[cs]e'), r('commercial\\s*licen[cs]e'), r('رخصة\\s*تجارية'), r('professional\\s*licen[cs]e'), r('industrial\\s*licen[cs]e')],
    weak: [r('licen[cs]e\\s*(no|number)'), r('economic\\s*development'), r('dubai\\s*economy'), r('legal\\s*type'), r('activities'), r('licen[cs]ee')],
    path: ['Company', '{company}', 'Company Documents', 'Trade License'] },
  { key: 'establishment_card', label: 'Establishment Card', owner: 'company', category: 'Establishment Card', categoryScope: 'company', hasExpiry: true,
    strong: [r('establishment\\s*card'), r('بطاقة\\s*المنشأة'), r('establishment\\s*(no|number)')],
    weak: [r('immigration'), r('identity\\s*(and|&)\\s*citizenship')],
    path: ['Company', '{company}', 'Company Documents', 'Establishment Card'] },
  { key: 'chamber_certificate', label: 'Chamber of Commerce Certificate', owner: 'company', category: 'Chamber of Commerce Certificate', categoryScope: 'company', hasExpiry: true,
    strong: [r('chamber\\s*of\\s*commerce'), r('غرفة\\s*التجارة')],
    weak: [r('membership\\s*(no|number|certificate)'), r('member\\s*since')],
    path: ['Company', '{company}', 'Company Documents', 'Chamber Certificate'] },
  { key: 'vat_certificate', label: 'VAT Registration Certificate', owner: 'company', category: 'VAT Registration Certificate', categoryScope: 'company', hasExpiry: false,
    strong: [r('value\\s*added\\s*tax'), r('vat\\s*registration'), r('tax\\s*registration\\s*certificate')],
    weak: [r('federal\\s*tax\\s*authority'), r('\\bTRN\\b'), r('tax\\s*registration\\s*number')],
    path: ['Company', '{company}', 'Tax Documents', 'VAT Certificate'] },
  { key: 'corporate_tax_certificate', label: 'Corporate Tax Registration', owner: 'company', category: 'Corporate Tax Registration', categoryScope: 'company', hasExpiry: false,
    strong: [r('corporate\\s*tax')],
    weak: [r('federal\\s*tax\\s*authority'), r('tax\\s*period')],
    path: ['Company', '{company}', 'Tax Documents', 'Corporate Tax Certificate'] },
  { key: 'ejari', label: 'Ejari Certificate', owner: 'company', category: 'Ejari / Tenancy Contract', categoryScope: 'company', hasExpiry: true,
    strong: [r('\\bejari\\b'), r('إيجاري')],
    weak: [r('dubai\\s*land\\s*department'), r('real\\s*estate\\s*regulatory'), r('contract\\s*(no|number)')],
    path: ['Company', '{company}', 'Company Documents', 'Ejari'] },
  { key: 'tenancy_contract', label: 'Tenancy Contract', owner: 'company', category: 'Office & Workshop Tenancy', categoryScope: 'company', hasExpiry: true,
    strong: [r('tenancy\\s*contract'), r('lease\\s*agreement'), r('rental\\s*agreement'), r('عقد\\s*إيجار')],
    weak: [r('landlord'), r('lessor'), r('lessee'), r('\\btenant\\b'), r('annual\\s*rent'), r('premises'), r('plot\\s*(no|number)')],
    path: ['Company', '{company}', 'Company Documents', 'Tenancy Contract'] },
  { key: 'company_insurance', label: 'Company Insurance', owner: 'company', category: 'Company Insurance', categoryScope: 'company', hasExpiry: true,
    strong: [r('(workmen|workers).?s?\\s*compensation'), r('contractors?\\s*all\\s*risk'), r('public\\s*liability'), r('property\\s*insurance'), r('fire\\s*insurance')],
    weak: [r('policy\\s*(no|number)'), r('insured'), r('sum\\s*insured'), r('period\\s*of\\s*insurance'), r('premium')],
    path: ['Company', '{company}', 'Company Documents', 'Insurance'] },
  { key: 'municipality_approval', label: 'Municipality Approval', owner: 'company', category: 'Municipality Approval', categoryScope: 'company', hasExpiry: true,
    strong: [r('municipality'), r('بلدية')],
    weak: [r('approval'), r('permit'), r('building')],
    path: ['Company', '{company}', 'Company Documents', 'Municipality Approval'] },
  { key: 'civil_defence', label: 'Civil Defence Certificate', owner: 'company', category: 'Government Permit', categoryScope: 'company', hasExpiry: true,
    strong: [r('civil\\s*defen[cs]e')],
    weak: [r('fire\\s*safety'), r('certificate')],
    path: ['Company', '{company}', 'Company Documents', 'Government Permit'] },
  { key: 'bank_letter', label: 'Bank Letter', owner: 'company', category: 'Bank Letter', categoryScope: 'company', hasExpiry: false,
    strong: [r('to\\s*whom\\s*it\\s*may\\s*concern.*\\bbank\\b'), r('bank\\s*(reference|confirmation)\\s*letter'), r('account\\s*confirmation')],
    weak: [r('\\bbank\\b'), r('\\biban\\b'), r('branch')],
    path: ['Company', '{company}', 'Company Documents', 'Bank Letter'] },
  // ── employee ──
  { key: 'passport', label: 'Passport', owner: 'employee', category: 'Passport', categoryScope: 'employee', hasExpiry: true,
    strong: [r('^\\s*passport\\b'), r('P<[A-Z]{3}'), r('passport\\s*(no|number)\\s*[:#]?\\s*[A-Z]{1,2}\\d{6,8}\\b'), r('republic\\s*of.*passport')],
    weak: [r('passport'), r('nationality'), r('date\\s*of\\s*birth'), r('place\\s*of\\s*birth'), r('\\bsex\\b'), r('given\\s*names?'), r('surname')],
    path: ['Employees', '{employee}', 'Documents', 'Passport'] },
  { key: 'emirates_id', label: 'Emirates ID', owner: 'employee', category: 'Emirates ID', categoryScope: 'employee', hasExpiry: true,
    strong: [r('emirates\\s*id'), r('identity\\s*card'), r('بطاقة\\s*الهوية'), r('\\b784-?\\d{4}-?\\d{7}-?\\d\\b')],
    weak: [r('id\\s*number'), r('nationality'), r('federal\\s*authority\\s*for\\s*identity'), r('\\bICP\\b')],
    path: ['Employees', '{employee}', 'Documents', 'Emirates ID'] },
  { key: 'residence_visa', label: 'Residence Visa', owner: 'employee', category: 'Residence Visa', categoryScope: 'employee', hasExpiry: true,
    strong: [r('residence\\s*(visa|permit)'), r('residen(ce|t)\\s*visa'), r('إقامة'), r('entry\\s*permit')],
    weak: [r('\\bvisa\\b'), r('u\\.?i\\.?d'), r('file\\s*(no|number)'), r('sponsor'), r('profession'), r('place\\s*of\\s*issue')],
    path: ['Employees', '{employee}', 'Documents', 'Visa'] },
  { key: 'work_permit', label: 'Work Permit', owner: 'employee', category: 'Work Permit', categoryScope: 'employee', hasExpiry: true,
    strong: [r('work\\s*permit'), r('labou?r\\s*card'), r('تصريح\\s*عمل'), r('electronic\\s*work\\s*permit')],
    weak: [r('human\\s*resources'), r('\\bmohre\\b'), r('person\\s*code'), r('establishment')],
    path: ['Employees', '{employee}', 'Employment', 'Work Permit'] },
  { key: 'labour_contract', label: 'Labour Contract', owner: 'employee', category: 'Labour Contract', categoryScope: 'employee', hasExpiry: true,
    strong: [r('employment\\s*contract'), r('labou?r\\s*contract'), r('عقد\\s*عمل'), r('offer\\s*letter')],
    weak: [r('basic\\s*(salary|wage)'), r('probation'), r('first\\s*party'), r('second\\s*party'), r('employer'), r('working\\s*hours')],
    path: ['Employees', '{employee}', 'Employment', 'Labour Contract'] },
  { key: 'medical_insurance', label: 'Medical Insurance', owner: 'employee', category: 'Medical Insurance', categoryScope: 'employee', hasExpiry: true,
    strong: [r('medical\\s*insurance'), r('health\\s*insurance'), r('health\\s*card'), r('insurance\\s*card')],
    weak: [r('member\\s*(id|no|name)'), r('network'), r('policy'), r('insured\\s*member'), r('\\bTPA\\b')],
    path: ['Employees', '{employee}', 'Documents', 'Insurance'] },
  { key: 'training_certificate', label: 'Safety / Training Certificate', owner: 'employee', category: 'Safety / Training Certificate', categoryScope: 'employee', hasExpiry: true,
    strong: [r('certificate\\s*of\\s*(completion|training|competency)'), r('safety\\s*(training|induction)'), r('welding\\s*(procedure|qualification|certificate)'), r('\\bIOSH\\b|\\bNEBOSH\\b')],
    weak: [r('certificate'), r('trainee'), r('course')],
    path: ['Employees', '{employee}', 'Documents', 'Training Certificate'] },
  // ── vehicles ──
  { key: 'vehicle_registration', label: 'Vehicle Registration (Mulkiya)', owner: 'vehicle', category: 'Vehicle Registration (Mulkiya)', categoryScope: 'vehicle', hasExpiry: true,
    strong: [r('vehicle\\s*(registration|licen[cs]e)'), r('mulkiya'), r('ملكية'), r('traffic\\s*plate'), r('chassis\\s*(no|number)')],
    weak: [r('plate\\s*(no|number)'), r('traffic'), r('model\\s*year'), r('engine\\s*(no|number)'), r('insurance\\s*expiry')],
    path: ['Vehicles', '{vehicle}', 'Registration'] },
  // ── customer / sales documents (filed into the vault + linked to the customer; full module = Phase 2) ──
  { key: 'tax_invoice', label: 'Tax Invoice', owner: 'customer', category: 'Customer Invoice', categoryScope: 'other', hasExpiry: false,
    strong: [r('tax\\s*invoice'), r('فاتورة\\s*ضريبية'), r('invoice\\s*(no|number|#)')],
    weak: [r('bill\\s*to'), r('\\bVAT\\b'), r('sub\\s*-?\\s*total'), r('amount\\s*due'), r('\\bqty\\b|quantity'), r('due\\s*date')],
    path: ['Customers', '{customer}', 'Invoices'] },
  { key: 'quotation', label: 'Quotation', owner: 'customer', category: 'Customer Quotation', categoryScope: 'other', hasExpiry: false,
    strong: [r('\\bquotation\\b'), r('عرض\\s*سعر'), r('\\bQT-\\d')],
    weak: [r('valid\\s*for'), r('\\bqty\\b|quantity'), r('unit\\s*price|rate'), r('terms\\s*and\\s*conditions')],
    path: ['Customers', '{customer}', 'Quotations'] },
  { key: 'delivery_note', label: 'Delivery Note', owner: 'customer', category: 'Customer Delivery Note', categoryScope: 'other', hasExpiry: false,
    strong: [r('delivery\\s*note'), r('delivery\\s*order'), r('\\bDN-\\d'), r('إشعار\\s*تسليم')],
    weak: [r('received\\s*by'), r('delivered\\s*(to|by)'), r('receiver'), r('\\bqty\\b|quantity')],
    path: ['Customers', '{customer}', 'Delivery Notes'] },
  { key: 'purchase_order', label: 'Purchase Order', owner: 'customer', category: 'Purchase Order', categoryScope: 'other', hasExpiry: false,
    strong: [r('purchase\\s*order'), r('\\bP\\.?O\\.?\\s*(no|number)')],
    weak: [r('supplier'), r('delivery\\s*date'), r('\\bqty\\b|quantity')],
    path: ['Customers', '{customer}', 'Purchase Orders'] },
]

export const UNKNOWN_TYPE = 'unknown'
export const typeDef = (key: string | null | undefined) => DOC_TYPES.find(t => t.key === key)
export const FIELD_LABELS: Record<FieldKey, string> = {
  holder_name: 'Holder name', company_name: 'Company', document_number: 'Document number', issue_date: 'Issue date', expiry_date: 'Expiry date',
  date_of_birth: 'Date of birth', nationality: 'Nationality', employer: 'Employer', profession: 'Profession', issuing_authority: 'Issuing authority',
  license_type: 'Licence type', trn: 'TRN', landlord: 'Landlord', tenant: 'Tenant', property: 'Property', amount: 'Amount (AED)',
  customer_name: 'Customer', plate_number: 'Plate number',
}
