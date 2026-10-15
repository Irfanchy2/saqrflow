import 'server-only'
import { cache } from 'react'
import type { Ctx } from './auth'
import { projectFinancials, projectPaymentSummary } from './projects'

/*
 * Project page data, split by what each tab needs. Every loader is wrapped in React `cache`, so a figure that two parts of
 * one render need (the KPI row and the Finance tab, say) is fetched once. All queries filter by project_id (indexed).
 */

/** Sales documents, payments against them, advances on account and costs: everything the money figures are made of. */
export const projectMoney = cache(async (c: Ctx, id: string, contract: number | string | null) => {
  const [{ data: sales }, { data: invPays }, { data: adv }, { data: exps }] = await Promise.all([
    c.supabase.from('invoices').select('id,doc_type,number,status,total,vat_amount,issue_date,created_at').eq('project_id', id).order('issue_date', { ascending: false }),
    // payments against this project's invoices (same sum as invoice_balances.paid, without scanning every payment)
    c.supabase.from('payments').select('id,amount,paid_on,method,reference,notes,created_at,invoice_id,invoice:invoices!inner(id,number,project_id)').eq('invoice.project_id', id).order('paid_on', { ascending: false }).limit(300),
    c.supabase.from('payments').select('id,amount,paid_on,method,reference,notes,created_at,invoice_id,invoice:invoices(id,number)').eq('project_id', id).order('paid_on', { ascending: false }).limit(300),
    c.supabase.from('project_expenses').select('amount,category').eq('project_id', id).limit(5000),
  ])
  const paid = new Map<string, number>()
  for (const x of invPays ?? []) paid.set(x.invoice_id as string, (paid.get(x.invoice_id as string) ?? 0) + Number(x.amount))
  const f = projectFinancials(contract, (sales ?? []).map((s: any) => ({ ...s, paid: paid.get(s.id) ?? 0 })), exps ?? [])
  // project payments = advances on account (this project) + payments against its invoices (an applied advance is both: listed once)
  const advIds = new Set((adv ?? []).map((a: any) => a.id))
  const pays = [...new Map([...(adv ?? []), ...(invPays ?? [])].map((x: any) => [x.id, { ...x, advance: advIds.has(x.id) }])).values()]
    .sort((a: any, b: any) => b.paid_on.localeCompare(a.paid_on) || b.created_at.localeCompare(a.created_at))
  const ps = projectPaymentSummary(f.value, f.received, (adv ?? []).filter((a: any) => !a.invoice_id).reduce((s: number, a: any) => s + Number(a.amount), 0))
  return { sales: (sales ?? []) as any[], paid, f, ps, pays: pays as any[] }
})

/** Choices for the pickers on the project tabs that show forms inline (team, tasks). Dialogs fetch theirs from /api/options. */
export const employeeOptions = cache(async (c: Ctx) => ((await c.supabase.from('employees').select('id,full_name').neq('status', 'archived').order('full_name').limit(1000)).data ?? []).map((e: any) => ({ id: e.id as string, name: e.full_name as string })))
export const userOptions = cache(async (c: Ctx) => ((await c.supabase.from('profiles').select('id,full_name').eq('is_active', true).order('full_name')).data ?? []).map((u: any) => ({ id: u.id as string, name: u.full_name as string })))

/** Files and photos linked to the project (owned, or related through the Smart Inbox). */
export const projectFiles = cache(async (c: Ctx, id: string) => {
  const [{ data: owned }, { data: rel }] = await Promise.all([
    c.supabase.from('documents').select('id,name,folder,notes,issue_date,created_at,version:document_versions!documents_current_version_fk(mime_type)').eq('owner_type', 'project').eq('owner_id', id).is('deleted_at', null).order('created_at', { ascending: false }).limit(300),
    c.supabase.from('document_relationships').select('role,document:documents(id,name,folder,created_at,deleted_at)').eq('related_type', 'project').eq('related_id', id).limit(200),
  ])
  const photos = (owned ?? []).filter((d: any) => String(d.version?.mime_type ?? '').startsWith('image/') && /\/Photos\//.test(d.folder ?? ''))
  const files = new Map<string, any>()
  for (const d of owned ?? []) if (!photos.includes(d)) files.set(d.id, d)
  for (const r of rel ?? []) { const d: any = r.document; if (d && !d.deleted_at && !files.has(d.id) && !photos.some((x: any) => x.id === d.id) && !String(r.role).startsWith('photo')) files.set(d.id, { ...d, role: r.role }) }
  return { photos: photos as any[], files }
})
