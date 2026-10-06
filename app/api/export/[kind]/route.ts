import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toCsv } from '@/lib/csv'
import { writeXlsx } from '@/lib/xlsx'
import { can, type Role } from '@/lib/permissions'

type Sb = Awaited<ReturnType<typeof createClient>>
type Def = { title: string; perm?: 'finance.view' | 'employees.view' | 'documents.view'; run: (sb: Sb, today: string) => Promise<[string[], unknown[][]]> }
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
const sales = (t: string): Def['run'] => async sb => {
  const { data } = await sb.from('invoices').select('number,status,issue_date,due_date,valid_until,customer_name,customer_trn,subject,site,lpo_ref,subtotal,discount,vat_amount,total,project:projects(name)').eq('doc_type', t).order('issue_date', { ascending: false }).limit(20000)
  return [['Number', 'Status', 'Date', t === 'quotation' ? 'Valid until' : 'Due date', 'Customer', 'Customer TRN', 'Subject', 'Project', 'Site', 'LPO', 'Subtotal', 'Discount', 'VAT', 'Total (AED)'],
    (data ?? []).map((r: any) => [r.number, r.status, r.issue_date, t === 'quotation' ? r.valid_until : r.due_date, r.customer_name, r.customer_trn, r.subject, r.project?.name, r.site, r.lpo_ref, num(r.subtotal), num(r.discount), num(r.vat_amount), num(r.total)])]
}
const DEFS: Record<string, Def> = {
  documents: { title: 'Documents', perm: 'documents.view', run: async sb => { const { data } = await sb.from('documents').select('name,reference_no,issuing_authority,issue_date,expiry_date,status,owner_type,folder,renewal_fee,category:document_categories(name)').is('deleted_at', null).order('expiry_date', { nullsFirst: false }).limit(20000)
    return [['Name', 'Category', 'Belongs to', 'Reference', 'Issuing authority', 'Issue date', 'Expiry date', 'Status', 'Folder', 'Renewal fee (AED)'], (data ?? []).map((d: any) => [d.name, d.category?.name, d.owner_type, d.reference_no, d.issuing_authority, d.issue_date, d.expiry_date, d.status, d.folder, num(d.renewal_fee)])] } },
  'expiry-report': { title: 'Expiry report', run: async (sb, today) => { const { data } = await sb.from('reminder_sources').select('due_date,title,subject,category,owner_type,source_type').gte('due_date', today.slice(0, 4) + '-01-01').order('due_date').limit(20000)
    return [['Due / expiry date', 'Item', 'Employee / party', 'Category', 'Type', 'Status'], (data ?? []).map((r: any) => [r.due_date, r.title, r.subject, r.category, r.source_type, r.due_date < today ? 'Expired / overdue' : 'Upcoming'])] } },
  employees: { title: 'Employees', perm: 'employees.view', run: async sb => { const { data } = await sb.from('employees').select('employee_no,full_name,nationality,department,designation,phone,joining_date,status,work_location').order('employee_no').limit(20000)
    return [['Employee ID', 'Name', 'Nationality', 'Department', 'Designation', 'Phone', 'Joined', 'Status', 'Location'], (data ?? []).map(e => [e.employee_no, e.full_name, e.nationality, e.department, e.designation, e.phone, e.joining_date, e.status, e.work_location])] } },
  cheques: { title: 'Cheques', perm: 'finance.view', run: async sb => { const { data } = await sb.from('cheques').select('cheque_no,direction,kind,party_name,bank_name,amount,issue_date,cheque_date,deposit_date,status,purpose,invoice:invoices(number)').order('cheque_date').limit(20000)
    return [['Cheque no.', 'Direction', 'Type', 'Party', 'Bank', 'Amount (AED)', 'Issue date', 'Cheque date', 'Deposit date', 'Status', 'Purpose', 'Invoice'], (data ?? []).map((x: any) => [x.cheque_no, x.direction, x.kind, x.party_name, x.bank_name, num(x.amount), x.issue_date, x.cheque_date, x.deposit_date, x.status, x.purpose, x.invoice?.number])] } },
  customers: { title: 'Customers', run: async sb => { const { data } = await sb.from('customers').select('name,contact_person,phone,whatsapp,email,trn,address,credit_days,opening_balance,notes').order('name').limit(20000)
    return [['name', 'contact_person', 'phone', 'whatsapp', 'email', 'trn', 'address', 'credit_days', 'opening_balance', 'notes'], (data ?? []).map((r: any) => [r.name, r.contact_person, r.phone, r.whatsapp, r.email, r.trn, r.address, r.credit_days, num(r.opening_balance), r.notes])] } },
  suppliers: { title: 'Suppliers', run: async sb => { const { data } = await sb.from('suppliers').select('name,contact_person,phone,whatsapp,email,trn,address,notes').order('name').limit(20000)
    return [['name', 'contact_person', 'phone', 'whatsapp', 'email', 'trn', 'address', 'notes'], (data ?? []).map((r: any) => [r.name, r.contact_person, r.phone, r.whatsapp, r.email, r.trn, r.address, r.notes])] } },
  quotations: { title: 'Quotations', perm: 'finance.view', run: sales('quotation') },
  invoices: { title: 'Tax invoices', perm: 'finance.view', run: sales('invoice') },
  'delivery-notes': { title: 'Delivery notes', perm: 'finance.view', run: sales('delivery_note') },
  payments: { title: 'Payments', perm: 'finance.view', run: async sb => { const { data } = await sb.from('payments').select('paid_on,amount,method,reference,bank_name,invoice:invoices(number,customer_name),customer:customers(name)').order('paid_on', { ascending: false }).limit(20000)
    return [['Date', 'Amount (AED)', 'Method', 'Reference', 'Bank', 'Invoice', 'Customer'], (data ?? []).map((p: any) => [p.paid_on, num(p.amount), p.method, p.reference, p.bank_name, p.invoice?.number ?? 'On account', p.invoice?.customer_name ?? p.customer?.name])] } },
  expenses: { title: 'Expenses', perm: 'finance.view', run: async sb => { const { data } = await sb.from('project_expenses').select('spent_on,category,description,supplier_name,amount,vat_amount,payment_method,reference,project:projects(name)').order('spent_on', { ascending: false }).limit(20000)
    return [['Date', 'Category', 'Description', 'Supplier', 'Amount (AED)', 'VAT', 'Payment', 'Reference', 'Project'], (data ?? []).map((e: any) => [e.spent_on, e.category, e.description, e.supplier_name, num(e.amount), num(e.vat_amount), e.payment_method, e.reference, e.project?.name])] } },
  vehicles: { title: 'Vehicles', perm: 'documents.view', run: async sb => { const { data } = await sb.from('assets').select('name,plate_or_serial,plate_emirate,vehicle_type,make,model,model_year,mulkiya_no,registration_expiry,insurance_provider,insurance_expiry,inspection_expiry,next_service_date,status,employee:employees(full_name)').eq('kind', 'vehicle').is('archived_at', null).order('name').limit(20000)
    return [['Vehicle', 'Plate', 'Emirate', 'Type', 'Make', 'Model', 'Year', 'Mulkiya no.', 'Registration expiry', 'Insurer', 'Insurance expiry', 'Inspection', 'Next service', 'Status', 'Driver'], (data ?? []).map((a: any) => [a.name, a.plate_or_serial, a.plate_emirate, a.vehicle_type, a.make, a.model, a.model_year, a.mulkiya_no, a.registration_expiry, a.insurance_provider, a.insurance_expiry, a.inspection_expiry, a.next_service_date, a.status, a.employee?.full_name])] } },
  assets: { title: 'Assets', perm: 'documents.view', run: async sb => { const { data } = await sb.from('assets').select('name,asset_code,category,kind,serial_no,purchase_date,purchase_price,supplier_name,location,warranty_expiry,last_service_date,next_service_date,status,employee:employees(full_name)').neq('kind', 'vehicle').is('archived_at', null).order('name').limit(20000)
    return [['Asset', 'Asset ID', 'Category', 'Type', 'Serial', 'Purchased', 'Cost (AED)', 'Supplier', 'Location', 'Warranty', 'Last maintenance', 'Next maintenance', 'Status', 'Assigned to'], (data ?? []).map((a: any) => [a.name, a.asset_code, a.category, a.kind, a.serial_no, a.purchase_date, num(a.purchase_price), a.supplier_name, a.location, a.warranty_expiry, a.last_service_date, a.next_service_date, a.status, a.employee?.full_name])] } },
  catalog: { title: 'Catalog', perm: 'finance.view', run: async sb => { const { data } = await sb.from('catalog_items').select('name,description,unit,rate,vat_category,category,notes,active').order('name').limit(20000)
    return [['name', 'description', 'unit', 'rate', 'vat_category', 'category', 'notes', 'active'], (data ?? []).map((r: any) => [r.name, r.description, r.unit, num(r.rate), r.vat_category, r.category, r.notes, r.active ? 'yes' : 'no'])] } },
  'reminder-log': { title: 'Reminder log', run: async sb => { const { data } = await sb.from('notification_logs').select('created_at,channel,template,status,attempts,sandbox,last_error,recipient:notification_recipients(name)').order('created_at', { ascending: false }).limit(20000)
    return [['Created', 'Recipient', 'Channel', 'Template', 'Status', 'Attempts', 'Sandbox (not sent)', 'Error'], (data ?? []).map((l: any) => [l.created_at, l.recipient?.name, l.channel, l.template, l.status, l.attempts, l.sandbox ? 'yes' : 'no', l.last_error])] } },
}

/** CSV or Excel exports (?format=xlsx). Requires `data.export`; rows come from the caller's own RLS-scoped session. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  const def = DEFS[kind]; if (!def) return new NextResponse('Unknown export', { status: 404 })
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser(); if (!user) return new NextResponse('Your session has expired — sign in again.', { status: 401 })
  const { data: me } = await sb.from('profiles').select('company_id, role, company:companies(timezone)').eq('id', user.id).single()
  if (!me || !can(me.role as Role, 'data.export') || (def.perm && !can(me.role as Role, def.perm))) return new NextResponse('You do not have permission to export this list.', { status: 403 })
  const tz = (me.company as any)?.timezone ?? 'Asia/Dubai'
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
  const [headers, rows] = await def.run(sb, today)
  try { await createAdminClient().from('audit_logs').insert({ company_id: me.company_id, user_id: user.id, action: 'EXPORT', table_name: kind, changes: { rows: rows.length } }) } catch {}
  const xlsx = req.nextUrl.searchParams.get('format') === 'xlsx', name = `saqrflow-${kind}-${today}.${xlsx ? 'xlsx' : 'csv'}`
  const body = xlsx ? writeXlsx(def.title, headers, rows) : toCsv(headers, rows)
  return new NextResponse(body as BodyInit, { headers: { 'Content-Type': xlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } })
}
