import { cn } from '@/lib/utils'

/*
 * Navigation skeletons (shown by components/layout/nav-pending the moment a link is tapped). They keep the real layout
 * of what is coming (header, KPI strip, list or record cards) so nothing jumps when the page arrives, and carry
 * data-skeleton for tests.
 */
const Bar = ({ className }: { className?: string }) => <span aria-hidden className={cn('skeleton block', className)} />

function Header({ back }: { back?: boolean }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div className="min-w-0 space-y-2.5">{back && <Bar className="h-4 w-24" />}<Bar className="h-7 w-56 sm:w-72" /><Bar className="hidden h-4 w-80 sm:block" /></div>
    <div className="flex gap-2"><Bar className="h-10 w-24 rounded-lg" /><Bar className="h-10 w-32 rounded-lg" /></div>
  </div>
}
function Kpis({ n = 4 }: { n?: number }) {
  return <div className="-mx-4 mb-5 flex gap-3 overflow-hidden px-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:px-0 lg:grid-cols-4">
    {Array.from({ length: n }, (_, i) => <div key={i} className="w-[46%] min-w-[158px] shrink-0 rounded-xl border border-border/80 bg-surface p-4 shadow-card sm:w-auto">
      <div className="flex items-center gap-3"><Bar className="h-10 w-10 rounded-xl" /><Bar className="h-3.5 w-24" /></div><Bar className="mt-3 h-6 w-28" /><Bar className="mt-2 h-3 w-20" /></div>)}
  </div>
}
function Rows({ n = 6 }: { n?: number }) {
  return <ul className="divide-y divide-border">{Array.from({ length: n }, (_, i) => <li key={i} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
    <Bar className="h-10 w-10 shrink-0 rounded-xl" /><div className="min-w-0 flex-1 space-y-2"><Bar className="h-4 w-2/5" /><Bar className="h-3 w-3/5" /></div><Bar className="h-5 w-16 rounded-md" /></li>)}</ul>
}
const Card = ({ className, children }: { className?: string; children: React.ReactNode }) => <div className={cn('overflow-hidden rounded-xl border border-border/80 bg-surface shadow-card', className)}>{children}</div>

/** A list page: title + actions, KPI strip, tabs, a search row and list rows. */
export function ListSkeleton() {
  return <div data-skeleton aria-busy="true" aria-label="Loading">
    <Header /><Kpis />
    <div className="mb-4 flex gap-4 border-b border-border pb-2.5">{[64, 72, 56, 80].map(w => <span key={w} aria-hidden className="skeleton block h-4" style={{ width: w }} />)}</div>
    <Card><div className="border-b border-border p-3"><Bar className="h-10 w-full rounded-lg sm:w-80" /></div><Rows /></Card>
    <span className="sr-only">Loading…</span>
  </div>
}

/** A record page (project, customer, employee…): back link, title, KPI strip, then two columns of cards. */
export function DetailSkeleton() {
  return <div data-skeleton aria-busy="true" aria-label="Loading">
    <Header back /><Kpis />
    <div className="mb-4 flex gap-2">{[88, 72, 64, 72].map((w, i) => <span key={i} aria-hidden className="skeleton block h-9 rounded-full" style={{ width: w }} />)}</div>
    <div className="grid gap-5 xl:grid-cols-3">
      <Card className="xl:col-span-2"><div className="space-y-2 px-5 pb-3 pt-[18px]"><Bar className="h-4 w-40" /><Bar className="h-3 w-56" /></div><Rows n={4} /></Card>
      <Card><div className="space-y-4 p-5">{[0, 1, 2, 3].map(i => <div key={i} className="space-y-2"><Bar className="h-3 w-32" /><Bar className="h-2 w-full rounded-full" /></div>)}</div></Card>
    </div>
    <span className="sr-only">Loading…</span>
  </div>
}

/** The quotation / invoice / delivery note builder: toolbar, form sections, A4 preview. */
export function EditorSkeleton() {
  return <div data-skeleton aria-busy="true" aria-label="Loading" className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
    <div className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3 sm:px-6"><Bar className="h-9 w-9 rounded-lg" /><Bar className="h-5 w-48" /><span className="ms-auto flex gap-2"><Bar className="h-9 w-20 rounded-lg" /><Bar className="h-9 w-9 rounded-lg" /></span></div>
    <div className="grid gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(380px,520px)_1fr]">
      <div className="space-y-4">{[0, 1, 2].map(i => <Card key={i}><div className="space-y-3 p-4"><Bar className="h-4 w-32" />{[0, 1].map(j => <Bar key={j} className="h-10 w-full rounded-lg" />)}</div></Card>)}</div>
      <div className="hidden lg:block"><Bar className="mx-auto aspect-[1/1.414] w-full max-w-[640px] rounded-md" /></div>
    </div>
    <span className="sr-only">Loading…</span>
  </div>
}
