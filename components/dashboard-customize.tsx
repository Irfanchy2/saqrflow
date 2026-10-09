'use client'
import { useRef, useState, useTransition } from 'react'
import { ArrowDown, ArrowUp, LayoutGrid, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { toast } from '@/components/ui/toast'
import { saveDashboardLayout } from '@/app/actions/preferences'
import { WIDGETS, type DashboardLayout, type WidgetCol } from '@/lib/dashboard-widgets'

/** "Customize" dialog: show / hide each dashboard widget, choose its column and its order. Saved per user. */
export function DashboardCustomize({ layout, available }: { layout: DashboardLayout; available: string[] }) {
  const dlg = useRef<HTMLDialogElement>(null), [items, setItems] = useState(layout.items), [pending, start] = useTransition()
  const shown = items.filter(i => available.includes(i.key))
  const move = (key: string, d: -1 | 1) => setItems(xs => {
    const i = xs.findIndex(x => x.key === key), same = xs.map((x, n) => [x, n] as const).filter(([x]) => x.col === xs[i].col && available.includes(x.key)).map(([, n]) => n)
    const p = same.indexOf(i), j = same[p + d]; if (j === undefined) return xs
    const out = [...xs]; [out[i], out[j]] = [out[j], out[i]]; return out
  })
  const set = (key: string, patch: Partial<{ col: WidgetCol; hidden: boolean }>) => setItems(xs => xs.map(x => (x.key === key ? { ...x, ...patch } : x)))
  const save = (l: DashboardLayout | null) => start(async () => { const r = await saveDashboardLayout(l); toast(r?.error ?? r?.message ?? 'Saved', r?.error ? 'error' : 'success'); if (!r?.error) dlg.current?.close() })
  const cols: [WidgetCol, string][] = [['top', 'Top'], ['left', 'Left column'], ['right', 'Right column']]
  return <>
    <Button variant="secondary" onClick={() => { setItems(layout.items); dlg.current?.showModal() }}><LayoutGrid size={15} />Customize</Button>
    <dialog ref={dlg} onClick={e => { if (e.target === dlg.current) dlg.current?.close() }} className="mx-0 mb-0 mt-auto max-h-[92dvh] w-full max-w-none flex-col rounded-t-xl border border-border bg-surface p-0 text-fg shadow-pop open:flex sm:m-auto sm:w-[calc(100%-2rem)] sm:max-w-lg sm:rounded-lg">
      <div className="border-b border-border px-5 py-3"><h2 className="text-[15px] font-semibold">Customize dashboard</h2><p className="text-xs text-muted">Only you see this layout. Widgets you have no access to are not listed.</p></div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{cols.map(([col, label]) => { const list = shown.filter(i => i.col === col); return list.length ? <div key={col} className="mb-4 last:mb-0">
        <h3 className="mb-1.5 text-xs font-medium text-muted">{label}</h3>
        <ul className="divide-y divide-border rounded-md border border-border">{list.map((it, n) => <li key={it.key} className="flex items-center gap-2 px-3 py-2 text-sm">
          <label className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" checked={!it.hidden} onChange={e => set(it.key, { hidden: !e.target.checked })} /><span className="truncate">{WIDGETS[it.key].label}</span></label>
          {col !== 'top' && <select aria-label={`Column for ${WIDGETS[it.key].label}`} value={it.col} onChange={e => set(it.key, { col: e.target.value as WidgetCol })} className="h-9 rounded-md border border-border bg-surface px-2 text-xs"><option value="left">Left</option><option value="right">Right</option></select>}
          <button type="button" aria-label={`Move ${WIDGETS[it.key].label} up`} disabled={n === 0} onClick={() => move(it.key, -1)} className="grid h-9 w-9 cursor-pointer place-items-center rounded-md text-muted hover:bg-surface-2 disabled:opacity-30"><ArrowUp size={15} /></button>
          <button type="button" aria-label={`Move ${WIDGETS[it.key].label} down`} disabled={n === list.length - 1} onClick={() => move(it.key, 1)} className="grid h-9 w-9 cursor-pointer place-items-center rounded-md text-muted hover:bg-surface-2 disabled:opacity-30"><ArrowDown size={15} /></button>
        </li>)}</ul></div> : null })}</div>
      <div className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button variant="ghost" disabled={pending} onClick={() => save(null)}>Reset to default</Button>
        <div className="flex gap-2"><Button variant="secondary" onClick={() => dlg.current?.close()}>Cancel</Button><Button disabled={pending} onClick={() => save({ items })}>{pending && <Loader2 size={14} className="animate-spin" />}Save</Button></div>
      </div>
    </dialog>
  </>
}
