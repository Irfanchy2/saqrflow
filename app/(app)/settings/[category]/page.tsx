import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCtx } from '@/lib/auth'
import { ArrowLeft, ArrowUpRight } from '@/components/icons'
import { CATEGORIES } from '@/lib/settings/catalog'
import { categoriesFor } from '@/lib/settings/perms'
import { CategoryIcon } from '@/components/settings/hub/icon'
import { CategorySections } from '@/components/settings/hub/sections'
import { UnsavedGuard } from '@/components/settings/hub/unsaved-guard'
import { cn } from '@/lib/utils'

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params
  const cat = CATEGORIES.find(x => x.id === category)
  return { title: cat ? `${cat.title} · Settings` : 'Settings' }
}

/** One settings category: its own page (deep-linkable, browser back works), with only the sections this user may see. */
export default async function SettingsCategory({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params
  const c = await getCtx()
  const cats = categoriesFor(c), cat = cats.find(x => x.id === category)
  if (!cat) notFound()   // unknown, or not allowed for this user's role
  const jump = cat.sections.length > 2
  return <div className="mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
    {/* desktop: the other categories stay one click away */}
    <nav aria-label="Settings categories" className="hidden lg:block">
      <div className="sticky top-20">
        <Link href="/settings" className="mb-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted hover:bg-surface-2 hover:text-fg"><ArrowLeft size={14} className="rtl:rotate-180" />All settings</Link>
        <ul className="space-y-0.5 text-sm">
          {cats.map(x => <li key={x.id}><Link href={`/settings/${x.id}`} aria-current={x.id === cat.id ? 'page' : undefined}
            className={cn('flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors', x.id === cat.id ? 'bg-primary-soft font-medium text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
            <CategoryIcon name={x.icon} size={16} className={x.id === cat.id ? 'text-primary' : undefined} /><span className="truncate">{x.short}</span></Link></li>)}
        </ul>
      </div>
    </nav>

    <div className="min-w-0 max-w-4xl">
      <Link href="/settings" className="-ms-1 mb-3 inline-flex min-h-10 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-primary lg:hidden" data-settings-back><ArrowLeft size={16} className="rtl:rotate-180" />Settings</Link>
      <nav aria-label="Breadcrumb" className="mb-2 hidden items-center gap-1.5 text-[13px] text-muted lg:flex"><Link href="/settings" className="hover:text-fg">Settings</Link><span aria-hidden className="text-muted/60">›</span><span className="text-fg">{cat.title}</span></nav>
      <header className="mb-5 flex items-start gap-3.5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><CategoryIcon name={cat.icon} size={22} /></span>
        <div className="min-w-0"><h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] sm:text-[28px]">{cat.title}</h1>
          <p className="mt-1 text-[13.5px] text-muted">{cat.desc}</p></div>
      </header>

      {jump && <nav aria-label={`${cat.title} sections`} className="sticky top-16 z-10 -mx-4 mb-5 border-b border-border bg-bg/95 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        <ul className="tabstrip flex gap-2 overflow-x-auto text-sm lg:flex-wrap lg:overflow-visible">
          {cat.sections.map(s => <li key={s.id} className="shrink-0"><a href={`#${s.id}`} className="flex h-9 items-center rounded-full border border-border bg-surface px-3.5 text-fg/80 transition-colors hover:bg-surface-2 active:bg-surface-2">{s.title}</a></li>)}
        </ul></nav>}

      <UnsavedGuard>
        <div className="flex flex-col gap-5" data-settings-category={cat.id}>
          <CategorySections c={c} cat={cat} />
          {cat.links && cat.links.length > 0 && <section aria-label="More pages" className="grid gap-3 sm:grid-cols-2">
            {cat.links.map(l => <Link key={l.href} href={l.href} className="group flex items-start gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-primary/35 hover:bg-surface-2">
              <div className="min-w-0 flex-1"><div className="font-medium">{l.title}</div><div className="mt-0.5 text-[13px] text-muted">{l.desc}</div></div>
              <ArrowUpRight size={16} className="mt-0.5 shrink-0 text-muted group-hover:text-primary" aria-hidden /></Link>)}
          </section>}
        </div>
      </UnsavedGuard>
    </div>
  </div>
}
