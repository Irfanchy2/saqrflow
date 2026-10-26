import { WhatsAppSend } from '@/components/whatsapp/send'
import { showDate } from '@/lib/time'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, CalendarCheck, MapPin, Pencil, QrCode, Trash2 } from '@/components/icons'
import { getCtx } from '@/lib/auth'
import { Badge } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton } from '@/components/ui/action-form'
import { TabStrip } from '@/components/ui/tab-strip'
import { NewSalesButtons } from '@/components/sales/new-buttons'
import { trashRecord } from '@/app/actions/trash'
import { PROJECT_STATUS } from '@/lib/projects'
import { flat } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { ActivityTab, EditProjectForm, FilesTab, FinanceTab, OverviewTab, WorkTab } from './tabs'

export const metadata = { title: 'Project' }

/**
 * Project record. The header and tab bar need one query (the project row); the open tab then loads only its own data in
 * one parallel round, so opening a project never waits for photos, expenses or history it is not showing.
 */
export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/')
  const sp = await flat(searchParams)
  const { data: p } = await c.supabase.from('projects').select('*, customer:customers(id,name)').eq('id', id).maybeSingle()
  if (!p) notFound()
  const fin = c.can('finance.view'), edit = c.can('records.edit'), del = c.can('records.delete')
  const TABS = [['overview', 'Overview'], ...(fin ? [['finance', 'Finance']] : []), ['work', 'Work'], ['files', 'Files & photos'], ['activity', 'Activity']] as [string, string][]
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'overview'
  const st = PROJECT_STATUS[p.status]
  const href = (k: string) => k === 'overview' ? `/projects/${id}` : `/projects/${id}?tab=${k}`

  return <>
    <Link href="/projects" className="mb-1 -ms-1 inline-flex min-h-10 items-center gap-1.5 px-1 text-sm text-muted hover:text-fg sm:mb-3 sm:min-h-0"><ArrowLeft size={14} className="rtl:rotate-180" />Projects</Link>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-[22px] font-semibold leading-tight tracking-[-0.025em] sm:text-[26px]">{p.name}</h1><Badge tone={st.tone}>{st.label}</Badge></div>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          {p.code && <span className="font-mono">{p.code}</span>}
          {p.customer && <Link href={`/parties/${p.customer.id}`} className="hover:text-primary hover:underline">{p.customer.name}</Link>}
          {p.location && <span className="inline-flex items-center gap-1"><MapPin size={13} aria-hidden />{p.location}</span>}
          {(p.start_date || p.expected_completion) && <span className="inline-flex items-center gap-1"><CalendarCheck size={13} aria-hidden />{showDate(p.start_date, '—')} → {p.expected_completion ?? '—'}</span>}
        </div>
        {p.description && <p className="mt-2 max-w-3xl whitespace-pre-line text-sm">{p.description}</p>}
      </div>
      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
        <a href={`/print/qr?type=project&ids=${p.id}`} target="_blank" rel="noopener" className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13.5px] font-medium shadow-key transition-colors hover:bg-surface-2/60 sm:h-10"><QrCode size={14} aria-hidden />QR label</a>
        {edit && p.customer_id && <WhatsAppSend kind="project_update" recordId={p.id} label="Send update" size="md" />}
        {/* its Client dropdown loads the customer list only when the dialog opens */}
        {edit && <DialogButton wide variant="secondary" label="Edit" title="Edit project" icon={<Pencil size={14} />}><EditProjectForm p={p} /></DialogButton>}
        {edit && fin && <NewSalesButtons projectId={id} customerId={p.customer_id ?? undefined} />}
        {del && <ActionButton variant="ghost" size="md" action={trashRecord.bind(null, 'project', id)} confirm={`Move project “${p.name}” to the trash? Its documents, invoices and costs are kept and it can be restored.`}><Trash2 size={14} /><span className="max-sm:sr-only">Delete</span></ActionButton>}
      </div>
    </div>

    {/* section tabs: pills on phones, underline tabs from sm (same pattern as Sales) */}
    <TabStrip label="Project sections" className="mb-5 gap-2 py-0.5 max-sm:-mx-4 max-sm:border-b-0 max-sm:px-4 sm:gap-1 sm:py-0">
      {TABS.map(([k, l]) => { const a = tab === k
        return <Link key={k} href={href(k)} scroll={false} aria-current={a ? 'page' : undefined}
          className={cn('inline-flex h-10 shrink-0 items-center rounded-full border px-4 text-[13.5px] font-medium transition-colors sm:-mb-px sm:h-auto sm:rounded-none sm:border-0 sm:border-b-2 sm:bg-transparent sm:px-3.5 sm:py-2.5 sm:shadow-none',
            a ? 'border-primary bg-primary text-primary-fg shadow-sm sm:border-primary sm:text-primary' : 'border-border bg-surface text-fg/80 active:bg-surface-2 sm:border-transparent sm:text-muted sm:hover:text-fg')}>{l}</Link> })}
    </TabStrip>

    {tab === 'overview' ? <OverviewTab c={c} p={p} />
        : tab === 'finance' ? <FinanceTab c={c} p={p} />
        : tab === 'work' ? <WorkTab c={c} p={p} />
        : tab === 'files' ? <FilesTab c={c} p={p} photosFilter={sp.photos} />
        : <ActivityTab c={c} p={p} />}
  </>
}
