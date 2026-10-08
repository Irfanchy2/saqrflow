import { notFound, redirect } from 'next/navigation'
import { getCtx } from '@/lib/auth'
import { brandingFor } from '@/lib/sales/data'
import { ReportPaper } from '@/components/crm/report-paper'
import { PrintButton } from '@/components/print-button'
import { flat } from '@/lib/queries'
import { opsFiles, PHOTO_ROLES } from '@/lib/ops'
import { VISIT_STATUS } from '@/lib/crm'
import { formatLongDate } from '@/lib/time'

export const dynamic = 'force-dynamic'
const KINDS = ['site_visit', 'site_report'] as const
const dmy = (iso?: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : null)

export async function generateMetadata({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params
  if (!KINDS.includes(kind as any) || !/^[0-9a-f-]{36}$/i.test(id)) return {}
  const c = await getCtx()
  const { data } = await c.supabase.from(kind === 'site_visit' ? 'site_visits' : 'daily_site_reports').select('number').eq('id', id).maybeSingle()
  return data ? { title: { absolute: `${kind === 'site_visit' ? 'Site_Visit_Report' : 'Daily_Site_Report'}_${data.number}` } } : {}
}

/** Printable / save-as-PDF A4 report with the company letterhead, findings and photo thumbnails. */
export default async function PrintReport({ params, searchParams }: { params: Promise<{ kind: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { kind, id } = await params
  if (!KINDS.includes(kind as any) || !/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/')
  const sp = await flat(searchParams)
  const [branding, media] = await Promise.all([brandingFor(c), opsFiles(c, kind as 'site_visit' | 'site_report', id)])
  const photos = media.photos.slice(0, 18).map(p => ({ src: `/api/documents/${p.id}/thumb?w=640`, caption: p.notes ?? PHOTO_ROLES[p.role] ?? 'Photo' }))
  let paper: React.ReactNode, label: string
  if (kind === 'site_visit') {
    const { data: v } = await c.supabase.from('site_visits').select('*, lead:leads(company_name,number,phone), customer:customers(name,phone), project:projects(name,code), employee:employees(full_name)').eq('id', id).maybeSingle()
    if (!v) notFound()
    const { data: prep } = v.prepared_by ? await c.supabase.from('profiles').select('full_name').eq('id', v.prepared_by).maybeSingle() : { data: null }
    label = `Site visit report ${v.number}`
    paper = <ReportPaper branding={branding} title="SITE VISIT REPORT" className="shadow-pop print:shadow-none"
      left={[['Customer', v.customer?.name ?? v.lead?.company_name], ['Project', v.project ? `${v.project.name}${v.project.code ? ` (${v.project.code})` : ''}` : null], ['Site', v.location], ['Contact', [v.contact_person, v.contact_phone].filter(Boolean).join(' · ') || null], ['Attendees', v.attendees]]}
      right={[['Report No', v.number], ['Visit date', dmy(v.scheduled_date)], ['Time', v.scheduled_time?.slice(0, 5)], ['Engineer', v.employee?.full_name], ['Status', VISIT_STATUS[v.status]?.label], ['Lead ref', v.lead?.number]]}
      sections={[{ heading: 'Customer requirements', text: v.requirements }, { heading: 'Measurements', text: v.measurements }, { heading: 'Site notes', text: v.notes }, { heading: 'Recommendations', text: v.recommendations }, { heading: 'Follow-up action', text: v.followup_action }]}
      photos={photos} signatures={[`Prepared by${prep?.full_name ? `: ${prep.full_name}` : ''}`, 'Customer / site representative']} />
  } else {
    const { data: r } = await c.supabase.from('daily_site_reports').select('*, project:projects(name,code,customer:customers(name)), work_order:work_orders(number,title), supervisor:employees!daily_site_reports_supervisor_id_fkey(full_name)').eq('id', id).maybeSingle()
    if (!r) notFound()
    const { data: att } = await c.supabase.from('site_report_attendance').select('employee:employees(full_name,designation)').eq('report_id', id)
    label = `Daily site report ${r.number}`
    paper = <ReportPaper branding={branding} title="DAILY SITE REPORT" className="shadow-pop print:shadow-none"
      left={[['Project', r.project ? `${r.project.name}${r.project.code ? ` (${r.project.code})` : ''}` : null], ['Customer', r.project?.customer?.name], ['Site', r.site], ['Work order', r.work_order ? `${r.work_order.number}: ${r.work_order.title}` : null]]}
      right={[['Report No', r.number], ['Date', dmy(r.report_date)], ['Supervisor', r.supervisor?.full_name], ['Progress', r.progress != null ? `${r.progress}%` : null], ['Weather', r.weather], ['Manpower', att?.length ? String(att.length) : null]]}
      sections={[{ heading: 'Work completed', text: r.work_done }, { heading: 'Planned for next day', text: r.work_planned }, { heading: 'Issues', text: r.issues }, { heading: 'Delays', text: r.delays },
        { heading: 'Safety observations', text: r.safety_notes }, { heading: 'Customer instructions', text: r.customer_instructions }, { heading: 'Materials delivered', text: r.materials_delivered }, { heading: 'Equipment used', text: r.equipment_used }, { heading: 'Notes', text: r.notes }]}
      table={{ heading: 'Attendance', cols: ['#', 'Name', 'Designation'], rows: (att ?? []).map((a: any, i: number) => [String(i + 1), a.employee?.full_name ?? '', a.employee?.designation ?? '']) }}
      photos={photos} signatures={['Site supervisor', 'Project manager', 'Client representative']} />
  }
  return <div className="print-sheet min-h-screen bg-neutral-200 py-8 print:py-0">
    <div className="no-print mx-auto mb-4 flex max-w-[794px] flex-wrap items-center justify-between gap-2 px-2 text-sm text-neutral-700"><span>{label}. A4; turn on “Background graphics”. Printed {formatLongDate(c.today)}.</span><PrintButton auto={sp.auto === '1'} /></div>
    {paper}
  </div>
}
