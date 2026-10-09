'use server'
import { getCtx } from '@/lib/auth'
import { sanitizeQ } from '@/lib/queries'
import { DOC_META, type SalesType } from '@/lib/sales/docs'

export type PaletteHit = { href: string; label: string; hint: string }

/** Ctrl+K live results: a few matching records per type, read with the user's own session (RLS + permissions). */
export async function paletteSearch(raw: string): Promise<PaletteHit[]> {
  try {
    const q = sanitizeQ(raw); if (q.length < 2) return []
    const c = await getCtx(), like = `%${q}%`, none = Promise.resolve({ data: [] as any[] }), fin = c.can('finance.view'), dv = c.can('documents.view')
    const [sales, cust, proj, leads, emps, tickets, assets] = await Promise.all([
      fin ? c.supabase.from('invoices').select('id,doc_type,number,customer_name').is('deleted_at', null).or(`number.ilike.${like},customer_name.ilike.${like},subject.ilike.${like}`).order('issue_date', { ascending: false }).limit(4) : none,
      dv ? c.supabase.from('customers').select('id,name,phone').or(`name.ilike.${like},phone.ilike.${like},trn.ilike.${like}`).limit(3) : none,
      dv ? c.supabase.from('projects').select('id,name,code').or(`name.ilike.${like},code.ilike.${like}`).limit(3) : none,
      c.can('crm.view') ? c.supabase.from('leads').select('id,number,company_name').or(`number.ilike.${like},company_name.ilike.${like}`).limit(3) : none,
      c.supabase.from('employees').select('id,full_name,employee_no').or(`full_name.ilike.${like},employee_no.ilike.${like}`).limit(3),
      c.supabase.from('service_tickets').select('id,number,title').or(`number.ilike.${like},title.ilike.${like}`).limit(3),
      dv ? c.supabase.from('assets').select('id,name,plate_or_serial').or(`name.ilike.${like},plate_or_serial.ilike.${like}`).limit(3) : none,
    ])
    return [
      ...(sales.data ?? []).map((x: any) => ({ href: `/invoices/${x.id}`, label: `${x.number} · ${x.customer_name ?? '—'}`, hint: DOC_META[x.doc_type as SalesType]?.label ?? 'Document' })),
      ...(cust.data ?? []).map((x: any) => ({ href: `/parties/${x.id}`, label: x.name, hint: 'Customer' })),
      ...(proj.data ?? []).map((x: any) => ({ href: `/projects/${x.id}`, label: [x.code, x.name].filter(Boolean).join(' · '), hint: 'Project' })),
      ...(leads.data ?? []).map((x: any) => ({ href: `/leads/${x.id}`, label: `${x.number} · ${x.company_name}`, hint: 'Lead' })),
      ...(emps.data ?? []).map((x: any) => ({ href: `/employees/${x.id}`, label: `${x.full_name} · ${x.employee_no}`, hint: 'Employee' })),
      ...(tickets.data ?? []).map((x: any) => ({ href: `/tickets/${x.id}`, label: `${x.number} · ${x.title}`, hint: 'Service ticket' })),
      ...(assets.data ?? []).map((x: any) => ({ href: `/assets/${x.id}`, label: [x.name, x.plate_or_serial].filter(Boolean).join(' · '), hint: 'Vehicle / asset' })),
    ].slice(0, 14)
  } catch { return [] }
}
