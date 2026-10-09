import Link from 'next/link'
import { BookOpen, Pin, Plus } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { flat, sanitizeQ } from '@/lib/queries'
import { Badge, Card, EmptyState, LinkButton, PageHeader } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { KbFields } from '@/components/service/kb'
import { saveKbArticle } from '@/app/actions/service'
import { formatShortDate } from '@/lib/time'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Knowledge base' }

/** Internal knowledge base: SOPs, safety rules, how-tos. Everyone in the company reads; editors write (every edit is versioned). */
export default async function KbPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); const sp = await flat(searchParams)
  const term = sanitizeQ(sp.q), edit = c.can('records.edit')
  let q = c.supabase.from('kb_articles').select('id,title,category,tags,status,pinned,updated_at,body').order('pinned', { ascending: false }).order('category').order('title').limit(500)
  if (term) q = q.or(`title.ilike.%${term}%,body.ilike.%${term}%,category.ilike.%${term}%`)
  if (sp.category) q = q.eq('category', sp.category)
  const [{ data: rows }, { data: all }] = await Promise.all([q, c.supabase.from('kb_articles').select('category').limit(2000)])
  const cats = [...new Set((all ?? []).map(r => r.category))].sort()
  const add = edit ? <DialogButton wide label="New article" title="New knowledge base article" icon={<Plus size={15} />} openParam="kb"><ActionForm action={saveKbArticle.bind(null, null)} submit="Save article"><KbFields categories={cats} /></ActionForm></DialogButton> : undefined
  const snippet = (b: string) => { const s = b.replace(/^#+\s*/gm, '').replace(/^\s*([-*•]|\d+[.)])\s+/gm, '').replace(/\s+/g, ' ').trim(); return s.length > 160 ? s.slice(0, 160) + '…' : s }
  return <>
    <PageHeader title="Knowledge base" sub="Standard procedures, safety rules and how-tos for the whole team." actions={add} />
    <div className="mb-4 flex flex-wrap gap-1.5">{['', ...cats].map(k => <Link key={k || 'all'} href={k ? `/kb?category=${encodeURIComponent(k)}` : '/kb'} aria-current={(sp.category ?? '') === k ? 'page' : undefined}
      className={cn('rounded-full border px-3 py-1 text-sm', (sp.category ?? '') === k ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted hover:text-fg')}>{k || 'All'}</Link>)}</div>
    <Card>
      <form className="flex flex-wrap gap-2 border-b border-border p-3">{sp.category && <input type="hidden" name="category" value={sp.category} />}
        <input name="q" type="search" defaultValue={sp.q} aria-label="Search articles" placeholder="Search titles and content…" className="h-9 min-w-48 flex-1 rounded-md border border-border bg-surface px-3 text-sm" />
        <button className="h-9 cursor-pointer rounded-md border border-border bg-surface px-3 text-sm">Search</button>{term && <LinkButton href="/kb" variant="ghost">Clear</LinkButton>}</form>
      {!(rows ?? []).length ? <EmptyState icon={BookOpen} title={term ? 'No articles match' : 'No articles yet'} body={term ? undefined : 'Write down how the team does things: welding procedures, site safety, vehicle checks, how to raise a quotation.'} />
        : <ul className="divide-y divide-border">{(rows ?? []).map((a: any) => <li key={a.id}><Link href={`/kb/${a.id}`} className="block px-4 py-3 hover:bg-surface-2/50">
          <div className="flex flex-wrap items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate font-medium">{a.pinned && <Pin size={13} className="me-1 inline text-primary" aria-label="Pinned" />}{a.title}</span>
            {a.status === 'draft' && <Badge tone="amber">Draft</Badge>}<Badge>{a.category}</Badge><span className="text-xs tabular-nums text-muted">{formatShortDate(a.updated_at.slice(0, 10))}</span></div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{snippet(a.body)}</p></Link></li>)}</ul>}
    </Card>
  </>
}
