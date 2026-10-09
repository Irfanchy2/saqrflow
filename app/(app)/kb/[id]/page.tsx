import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, History, Pin } from 'lucide-react'
import { PrintButton } from '@/components/print-button'
import { getCtx } from '@/lib/auth'
import { Badge, Card, CardHeader } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { KbBody, KbFields } from '@/components/service/kb'
import { saveKbArticle } from '@/app/actions/service'
import { trashRecord } from '@/app/actions/trash'
import { flat } from '@/lib/queries'

export const metadata = { title: 'Article' }

export default async function KbArticlePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params; const sp = await flat(searchParams)
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const c = await getCtx()
  const { data: a } = await c.supabase.from('kb_articles').select('*').eq('id', id).maybeSingle()
  if (!a) notFound()
  const edit = c.can('records.edit')
  const [{ data: people }, { data: versions }, { data: cats }] = await Promise.all([
    c.supabase.from('profiles').select('id,full_name'),
    edit ? c.supabase.from('kb_article_versions').select('id,version,title,body,edited_by,created_at').eq('article_id', id).order('version', { ascending: false }).limit(50) : Promise.resolve({ data: [] as any[] }),
    c.supabase.from('kb_articles').select('category').limit(2000),
  ])
  const who = new Map((people ?? []).map(p => [p.id, p.full_name as string]))
  const fmt = (d: string) => new Date(d).toLocaleString('en-GB', { timeZone: c.company.timezone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const old = sp.v ? (versions ?? []).find((v: any) => String(v.version) === sp.v) : null
  return <>
    <Link href="/kb" className="no-print mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft size={14} className="rtl:rotate-180" />Knowledge base</Link>
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h1 className="text-xl font-semibold tracking-tight">{a.pinned && <Pin size={15} className="me-1.5 inline text-primary" aria-label="Pinned" />}{old ? old.title : a.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted"><Badge>{a.category}</Badge>{a.status === 'draft' && <Badge tone="amber">Draft</Badge>}
            <span>Version {old ? old.version : a.version} · updated {fmt(old ? old.created_at : a.updated_at)} by {who.get((old ? old.edited_by : a.updated_by) ?? '') ?? '—'}</span>
            {(a.tags ?? []).map((t: string) => <Link key={t} href={`/kb?q=${encodeURIComponent(t)}`} className="text-xs text-primary hover:underline">#{t}</Link>)}</div></div>
        <div className="no-print flex flex-wrap gap-2">
          {edit && !old && <DialogButton wide variant="secondary" label="Edit" title="Edit article"><ActionForm action={saveKbArticle.bind(null, id)} resetOnSuccess={false} submit="Save new version"><KbFields a={a} categories={(cats ?? []).map(x => x.category)} /></ActionForm></DialogButton>}
          <PrintButton />
          {c.can('records.delete') && !old && <ActionButton size="md" variant="ghost" action={trashRecord.bind(null, 'kb_article', id)} confirm="Move this article to the trash?">Delete</ActionButton>}
        </div>
      </div>
      {old && <div className="no-print mb-4 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm">You are viewing version {old.version}. <Link href={`/kb/${id}`} className="font-medium text-primary hover:underline">Back to the current version</Link></div>}
      <Card className="p-5 sm:p-6"><KbBody body={old ? old.body : a.body} /></Card>
      {edit && (versions ?? []).length > 0 && <Card className="no-print mt-5"><CardHeader title="Earlier versions" action={<History size={15} className="text-muted" aria-hidden />} />
        <ul className="divide-y divide-border text-sm">{(versions ?? []).map((v: any) => <li key={v.id}><Link href={`/kb/${id}?v=${v.version}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-2/50">
          <span className="min-w-0 truncate">Version {v.version} · {v.title}</span><span className="shrink-0 text-xs text-muted">{fmt(v.created_at)} · {who.get(v.edited_by ?? '') ?? '—'}</span></Link></li>)}</ul></Card>}
    </div>
  </>
}
