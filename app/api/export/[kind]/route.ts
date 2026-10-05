import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toCsv } from '@/lib/csv'

/** CSV exports. Requires `data.export`; rows come from the caller's own RLS-scoped session, so nobody can export more than they can see. */
export async function GET(_: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser(); if (!user) return new NextResponse('Unauthorized', { status: 401 })
  const { data: perm } = await sb.from('profiles').select('company_id, role').eq('id', user.id).single()
  const { data: allowed } = perm ? await sb.from('role_permissions').select('permission').eq('role', perm.role).eq('permission', 'data.export') : { data: null }
  if (!perm || !allowed?.length) return new NextResponse('Forbidden', { status: 403 })

  let headers: string[], rows: unknown[][]
  if (kind === 'documents') {
    const { data } = await sb.from('documents').select('name,reference_no,issuing_authority,issue_date,expiry_date,status,owner_type,folder,renewal_fee,category:document_categories(name)').is('deleted_at', null).order('expiry_date', { nullsFirst: false }).limit(20000)
    headers = ['Name', 'Category', 'Belongs to', 'Reference', 'Issuing authority', 'Issue date', 'Expiry date', 'Status', 'Folder', 'Renewal fee (AED)']
    rows = (data ?? []).map((d: any) => [d.name, d.category?.name, d.owner_type, d.reference_no, d.issuing_authority, d.issue_date, d.expiry_date, d.status, d.folder, d.renewal_fee])
  } else if (kind === 'employees') {
    const { data } = await sb.from('employees').select('employee_no,full_name,nationality,department,designation,phone,joining_date,status,work_location').order('employee_no').limit(20000)
    headers = ['Employee ID', 'Name', 'Nationality', 'Department', 'Designation', 'Phone', 'Joined', 'Status', 'Location']
    rows = (data ?? []).map(e => [e.employee_no, e.full_name, e.nationality, e.department, e.designation, e.phone, e.joining_date, e.status, e.work_location])
  } else if (kind === 'cheques') {
    const { data } = await sb.from('cheques').select('cheque_no,direction,kind,party_name,bank_name,amount,issue_date,cheque_date,deposit_date,status,purpose').order('cheque_date').limit(20000)
    headers = ['Cheque no.', 'Direction', 'Type', 'Party', 'Bank', 'Amount (AED)', 'Issue date', 'Cheque date', 'Deposit date', 'Status', 'Purpose']
    rows = (data ?? []).map(x => [x.cheque_no, x.direction, x.kind, x.party_name, x.bank_name, x.amount, x.issue_date, x.cheque_date, x.deposit_date, x.status, x.purpose])
  } else if (kind === 'reminder-log') {
    const { data } = await sb.from('notification_logs').select('created_at,channel,template,status,attempts,sandbox,last_error,recipient:notification_recipients(name)').order('created_at', { ascending: false }).limit(20000)
    headers = ['Created', 'Recipient', 'Channel', 'Template', 'Status', 'Attempts', 'Sandbox (not sent)', 'Error']
    rows = (data ?? []).map((l: any) => [l.created_at, l.recipient?.name, l.channel, l.template, l.status, l.attempts, l.sandbox ? 'yes' : 'no', l.last_error])
  } else return new NextResponse('Unknown export', { status: 404 })

  try { await createAdminClient().from('audit_logs').insert({ company_id: perm.company_id, user_id: user.id, action: 'EXPORT', table_name: kind, changes: { rows: rows.length } }) } catch {}
  return new NextResponse(toCsv(headers, rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="saqrflow-${kind}-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } })
}
