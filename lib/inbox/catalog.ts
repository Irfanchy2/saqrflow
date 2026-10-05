// UAE business document catalogue used by both classification engines.
// `category` must match a seeded document_categories name (see 0003_rpc.sql) — or it is created on first filing.

export type OwnerKind = 'company' | 'employee' | 'customer' | 'supplier' | 'project' | 'vehicle'
export type FieldKey =
  | 'holder_name' | 'company_name' | 'document_number' | 'issue_date' | 'expiry_date' | 'date_of_birth'
  | 'nationality' | 'employer' | 'profession' | 'issuing_authority' | 'license_type' | 'trn'
  | 'landlord' | 'tenant' | 'property' | 'amount' | 'customer_name' | 'plate_number'
  | 'supplier_name' | 'project_name' | 'po_number' | 'employee_id'

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
  { key: 'government_approval', label: 'Government Approval', owner: 'company', category: 'Government Permit', categoryScope: 'company', hasExpiry: true,
    strong: [r('no\\s*objection\\s*certificate'), r('\\bNOC\\b'), r('approval\\s*letter'), r('government\\s*(approval|permit)')],
    weak: [r('approval'), r('authority'), r('permit')],
    path: ['Company', '{company}', 'Company Documents', 'Government Approval'] },
  { key: 'company_contract', label: 'Company Contract', owner: 'company', category: 'Company Contract', categoryScope: 'company', hasExpiry: true,
    strong: [r('(service|maintenance|supply|framework|subcontract)\\s*(agreement|contract)'), r('memorandum\\s*of\\s*(understanding|association)')],
    weak: [r('first\\s*party'), r('second\\s*party'), r('term\\s*of\\s*(the\\s*)?agreement'), r('governing\\s*law')],
    path: ['Company', '{company}', 'Company Documents', 'Contracts'] },
  { key: 'company_certificate', label: 'Company Certificate', owner: 'company', category: 'Company Certificate', categoryScope: 'company', hasExpiry: true,
    strong: [r('\\bISO\\s*\\d{4,5}'), r('certificate\\s*of\\s*(registration|incorporation|conformity)'), r('quality\\s*management\\s*system')],
    weak: [r('certif'), r('valid\\s*until')],
    path: ['Company', '{company}', 'Company Documents', 'Certificates'] },
  { key: 'bank_document', label: 'Bank Document', owner: 'company', category: 'Bank Document', categoryScope: 'company', hasExpiry: false,
    strong: [r('(bank|account)\\s*statement'), r('statement\\s*of\\s*account'), r('debit\\s*advice|credit\\s*advice'), r('swift\\s*(copy|confirmation)')],
    weak: [r('\\biban\\b'), r('opening\\s*balance'), r('closing\\s*balance'), r('\\bbank\\b')],
    path: ['Company', '{company}', 'Finance', 'Bank Documents'] },
  { key: 'cheque', label: 'Cheque', owner: 'company', category: 'Cheque Copy', categoryScope: 'company', hasExpiry: false,
    strong: [r('pay\\s+(to\\s+the\\s+order\\s+of|against\\s+this\\s+cheque)'), r('\\bcheque\\s*(no|number)'), r('ادفعوا\\s*بموجب\\s*هذا\\s*الشيك')],
    weak: [r('dirhams'), r('a/c\\s*payee'), r('\\bbank\\b'), r('only')],
    path: ['Company', '{company}', 'Finance', 'Cheques'] },
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
    strong: [r('labou?r\\s*contract'), r('عقد\\s*عمل'), r('ministry\\s*of\\s*human\\s*resources')],
    weak: [r('basic\\s*(salary|wage)'), r('probation'), r('first\\s*party'), r('second\\s*party'), r('employer'), r('working\\s*hours')],
    path: ['Employees', '{employee}', 'Employment', 'Labour Contract'] },
  { key: 'medical_insurance', label: 'Medical Insurance', owner: 'employee', category: 'Medical Insurance', categoryScope: 'employee', hasExpiry: true,
    strong: [r('medical\\s*insurance'), r('health\\s*insurance'), r('health\\s*card'), r('insurance\\s*card')],
    weak: [r('member\\s*(id|no|name)'), r('network'), r('policy'), r('insured\\s*member'), r('\\bTPA\\b')],
    path: ['Employees', '{employee}', 'Documents', 'Insurance'] },
  { key: 'employment_contract', label: 'Employment Contract', owner: 'employee', category: 'Employment Contract', categoryScope: 'employee', hasExpiry: false,
    strong: [r('employment\\s*(contract|agreement)'), r('offer\\s*letter'), r('letter\\s*of\\s*appointment')],
    weak: [r('basic\\s*(salary|wage)'), r('probation'), r('notice\\s*period'), r('designation'), r('joining\\s*date')],
    path: ['Employees', '{employee}', 'Employment', 'Employment Contract'] },
  { key: 'safety_certificate', label: 'Safety Certificate', owner: 'employee', category: 'Safety / Training Certificate', categoryScope: 'employee', hasExpiry: true,
    strong: [r('safety\\s*(training|induction|passport|certificate)'), r('\\bIOSH\\b|\\bNEBOSH\\b'), r('working\\s*at\\s*height'), r('first\\s*aid\\s*certificate')],
    weak: [r('hse'), r('safety'), r('certificate')],
    path: ['Employees', '{employee}', 'Documents', 'Safety Certificate'] },
  { key: 'training_certificate', label: 'Safety / Training Certificate', owner: 'employee', category: 'Safety / Training Certificate', categoryScope: 'employee', hasExpiry: true,
    strong: [r('certificate\\s*of\\s*(completion|training|competency)'), r('welding\\s*(procedure|qualification|certificate)'), r('training\\s*certificate')],
    weak: [r('certificate'), r('trainee'), r('course')],
    path: ['Employees', '{employee}', 'Documents', 'Training Certificate'] },
  // ── vehicles ──
  { key: 'vehicle_registration', label: 'Vehicle Registration (Mulkiya)', owner: 'vehicle', category: 'Vehicle Registration (Mulkiya)', categoryScope: 'vehicle', hasExpiry: true,
    strong: [r('vehicle\\s*(registration|licen[cs]e)'), r('mulkiya'), r('ملكية'), r('traffic\\s*plate'), r('chassis\\s*(no|number)')],
    weak: [r('plate\\s*(no|number)'), r('traffic'), r('model\\s*year'), r('engine\\s*(no|number)'), r('insurance\\s*expiry')],
    path: ['Vehicles', '{vehicle}', 'Registration'] },
  { key: 'vehicle_insurance', label: 'Vehicle Insurance', owner: 'vehicle', category: 'Vehicle Insurance', categoryScope: 'vehicle', hasExpiry: true,
    strong: [r('motor\\s*(insurance|policy)'), r('vehicle\\s*insurance'), r('comprehensive\\s*(cover|insurance)'), r('third\\s*party\\s*liability')],
    weak: [r('policy\\s*(no|number)'), r('chassis'), r('plate'), r('insured')],
    path: ['Vehicles', '{vehicle}', 'Insurance'] },
  { key: 'inspection_certificate', label: 'Vehicle Inspection Certificate', owner: 'vehicle', category: 'Vehicle Inspection', categoryScope: 'vehicle', hasExpiry: true,
    strong: [r('vehicle\\s*(inspection|testing|passing)'), r('tasjeel'), r('technical\\s*inspection'), r('test\\s*certificate')],
    weak: [r('plate'), r('chassis'), r('passed')],
    path: ['Vehicles', '{vehicle}', 'Inspection'] },
  { key: 'maintenance_document', label: 'Vehicle Maintenance Record', owner: 'vehicle', category: 'Vehicle Maintenance', categoryScope: 'vehicle', hasExpiry: false,
    strong: [r('job\\s*card'), r('service\\s*(invoice|report|record)'), r('maintenance\\s*(record|report)')],
    weak: [r('odometer|mileage|\\bkm\\b'), r('oil\\s*change'), r('spare\\s*parts'), r('plate')],
    path: ['Vehicles', '{vehicle}', 'Maintenance'] },
  // ── projects ──
  { key: 'project_contract', label: 'Project Contract', owner: 'project', category: 'Project Contract', categoryScope: 'other', hasExpiry: false,
    strong: [r('(sub)?contract\\s*agreement\\s*for'), r('letter\\s*of\\s*award'), r('scope\\s*of\\s*works?.*contract'), r('project\\s*contract')],
    weak: [r('contract\\s*(sum|value|price)'), r('retention'), r('variation'), r('project')],
    path: ['Projects', '{project}', 'Contracts'] },
  { key: 'drawing', label: 'Drawing', owner: 'project', category: 'Drawings', categoryScope: 'other', hasExpiry: false,
    strong: [r('shop\\s*drawing'), r('drawing\\s*(no|number|title)'), r('\\bdwg\\b'), r('general\\s*arrangement')],
    weak: [r('scale\\s*1\\s*:'), r('revision|\\brev\\b'), r('drawn\\s*by'), r('checked\\s*by'), r('elevation|section|plan\\s*view')],
    path: ['Projects', '{project}', 'Drawings'] },
  { key: 'site_document', label: 'Site Document', owner: 'project', category: 'Site Documents', categoryScope: 'other', hasExpiry: false,
    strong: [r('site\\s*(report|instruction|inspection\\s*report|visit\\s*report)'), r('method\\s*statement'), r('inspection\\s*request'), r('work\\s*permit\\s*to\\s*work|permit\\s*to\\s*work')],
    weak: [r('site'), r('consultant'), r('contractor')],
    path: ['Projects', '{project}', 'Site Documents'] },
  // ── suppliers ──
  { key: 'supplier_invoice', label: 'Supplier Invoice', owner: 'supplier', category: 'Supplier Invoice', categoryScope: 'other', hasExpiry: false,
    strong: [r('supplier\\s*invoice'), r('purchase\\s*invoice'), r('bill\\s*from')],
    weak: [r('tax\\s*invoice'), r('\\bVAT\\b'), r('amount\\s*due'), r('remit\\s*to')],
    path: ['Suppliers', '{supplier}', 'Invoices'] },
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
  { key: 'receipt', label: 'Receipt', owner: 'customer', category: 'Receipt', categoryScope: 'other', hasExpiry: false,
    strong: [r('payment\\s*receipt'), r('receipt\\s*voucher'), r('official\\s*receipt'), r('received\\s*with\\s*thanks')],
    weak: [r('received\\s*from'), r('the\\s*sum\\s*of'), r('cash|cheque')],
    path: ['Customers', '{customer}', 'Receipts'] },
  { key: 'credit_note', label: 'Credit Note', owner: 'customer', category: 'Credit Note', categoryScope: 'other', hasExpiry: false,
    strong: [r('credit\\s*note'), r('إشعار\\s*دائن')],
    weak: [r('original\\s*invoice'), r('\\bVAT\\b'), r('refund')],
    path: ['Customers', '{customer}', 'Credit Notes'] },
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
  customer_name: 'Customer', plate_number: 'Plate number', supplier_name: 'Supplier', project_name: 'Project', po_number: 'PO number', employee_id: 'Employee ID',
}
