import Link from 'next/link'
import { getCtx } from '@/lib/auth'
import { PageHeader } from '@/components/ui/primitives'
import { ChevronRight } from '@/components/icons'
import { searchIndex } from '@/lib/settings/catalog'
import { categoriesFor } from '@/lib/settings/perms'
import { CategoryIcon } from '@/components/settings/hub/icon'
import { SettingsSearch } from '@/components/settings/hub/search'
import { LegacySettingsHash } from '@/components/settings/hub/legacy-hash'

export const metadata = { title: 'Settings' }

/** Settings Hub: heading, search and one card per category. The forms themselves live on the category pages. */
export default async function Settings() {
  const c = await getCtx()
  const cats = categoriesFor(c)
  return <div className="mx-auto w-full max-w-6xl">
    <LegacySettingsHash />
    <PageHeader title="Settings" sub={`Everything that shapes how Averiqo works for ${c.company.name}. Pick a category, or search for a setting.`} />
    <SettingsSearch items={searchIndex(cats)}>
      <nav aria-label="Settings categories">
        <ul className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4" data-settings-cards>
          {cats.map(cat => {
            const parts = [...cat.sections.map(s => s.title), ...(cat.links ?? []).map(l => l.title)]
            return <li key={cat.id} className="min-w-0">
              {/* narrow phones: a compact row; from 400 px: a card (2 columns on phones, 3–4 on wide screens) */}
              <Link href={`/settings/${cat.id}`} data-category={cat.id}
                className="group relative flex h-full min-h-[72px] items-center gap-3.5 rounded-2xl border border-border bg-surface p-3.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-[border-color,box-shadow,transform] duration-200 hover:border-primary/35 hover:shadow-[0_6px_20px_-8px_rgb(0_0_0/0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.985] motion-reduce:transform-none motion-reduce:transition-none min-[400px]:min-h-[148px] min-[400px]:flex-col min-[400px]:items-stretch min-[400px]:gap-0 min-[400px]:p-4 sm:p-5">
                <div className="flex shrink-0 items-start justify-between gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary transition-colors group-hover:bg-primary group-hover:text-primary-fg"><CategoryIcon name={cat.icon} size={20} /></span>
                  <ChevronRight size={16} className="mt-1 hidden shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary rtl:rotate-180 rtl:group-hover:-translate-x-0.5 min-[400px]:block" aria-hidden />
                </div>
                <div className="min-w-0 flex-1 min-[400px]:mt-3 min-[400px]:flex min-[400px]:flex-col">
                  <h2 className="text-[15px] font-semibold leading-snug tracking-[-0.01em] sm:text-base">{cat.title}</h2>
                  <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted min-[400px]:mt-1">{cat.desc}</p>
                  <p className="mt-auto hidden truncate pt-3 text-xs text-muted/80 min-[400px]:block" title={parts.join(' · ')}>{parts.join(' · ')}</p>
                </div>
                <ChevronRight size={16} className="shrink-0 text-muted rtl:rotate-180 min-[400px]:hidden" aria-hidden />
              </Link></li>
          })}
        </ul>
      </nav>
    </SettingsSearch>
  </div>
}
