'use client'
import Link from 'next/link'
import { useOptimistic, useRef, useState, useTransition } from 'react'
import { CalendarClock, Phone, Plus } from '@/components/icons'
import { setLeadStage } from '@/app/actions/crm'
import { toast } from '@/components/ui/toast'
import { Button, Select } from '@/components/ui/primitives'
import { LEAD_SOURCES, LEAD_STAGES, LOST_REASONS, STAGE, followupState, type LeadStage } from '@/lib/crm'
import { cn } from '@/lib/utils'

export interface BoardLead { id: string; number: string; company_name: string; contact_person: string | null; phone: string | null; service: string | null; estimated_value: number | null; stage: string; next_followup: string | null; salesperson: string | null; source?: string | null }
// one tint per stage: column wash, header dot and the card's left accent
const TINT: Record<string, [string, string]> = {
  new: ['bg-blue-50/70 dark:bg-blue-500/[.07]', 'bg-blue-500'], contacted: ['bg-amber-50/70 dark:bg-amber-500/[.07]', 'bg-amber-500'],
  site_visit_required: ['bg-sky-50/70 dark:bg-sky-500/[.07]', 'bg-sky-500'], site_visit_completed: ['bg-cyan-50/70 dark:bg-cyan-500/[.07]', 'bg-cyan-500'],
  quotation_preparation: ['bg-violet-50/70 dark:bg-violet-500/[.07]', 'bg-violet-500'], quotation_sent: ['bg-fuchsia-50/60 dark:bg-fuchsia-500/[.07]', 'bg-fuchsia-500'],
  negotiation: ['bg-rose-50/70 dark:bg-rose-500/[.07]', 'bg-rose-500'], follow_up: ['bg-orange-50/70 dark:bg-orange-500/[.07]', 'bg-orange-500'],
  won: ['bg-emerald-50/70 dark:bg-emerald-500/[.07]', 'bg-emerald-500'], lost: ['bg-slate-100/70 dark:bg-slate-500/[.08]', 'bg-slate-400'], on_hold: ['bg-slate-100/70 dark:bg-slate-500/[.08]', 'bg-slate-400'],
}
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')
const money = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n))

/**
 * Kanban pipeline. Drag a card to another column (mouse / touch-pen via HTML5 drag), or use the card's "Move to" menu
 * (keyboard and phones). The move is shown immediately and rolled back with a message if the server refuses it.
 */
export function PipelineBoard({ leads, today, canEdit, hideClosed }: { leads: BoardLead[]; today: string; canEdit: boolean; hideClosed?: boolean }) {
  const [items, move] = useOptimistic(leads, (cur, m: { id: string; stage: string }) => cur.map(l => l.id === m.id ? { ...l, stage: m.stage } : l))
  const [, start] = useTransition()
  const [over, setOver] = useState<string | null>(null)
  const [lostFor, setLostFor] = useState<BoardLead | null>(null)
  const dlg = useRef<HTMLDialogElement>(null)
  const drag = useRef<string | null>(null)

  const apply = (l: BoardLead, stage: string, reason?: string, note?: string) => {
    if (l.stage === stage) return
    if (stage === 'lost' && !reason) { setLostFor(l); dlg.current?.showModal(); return }
    start(async () => {
      move({ id: l.id, stage })
      const r = await setLeadStage(l.id, stage, reason, note)
      if (r?.error) toast(r.error, 'error'); else toast(`${l.company_name}: ${STAGE[stage as LeadStage].label}`)
    })
  }
  const cols = LEAD_STAGES.filter(s => !hideClosed || !['lost', 'on_hold'].includes(s.key))

  return <>
    <div className="relative -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0" role="list" aria-label="Sales pipeline">
      {cols.map(s => { const list = items.filter(l => l.stage === s.key), total = list.reduce((a, l) => a + Number(l.estimated_value ?? 0), 0)
        const [wash, dot] = TINT[s.key] ?? TINT.lost
        return <section key={s.key} role="listitem" aria-label={`${s.label}: ${list.length} leads`}
          onDragOver={e => { if (canEdit && drag.current) { e.preventDefault(); setOver(s.key) } }} onDragLeave={() => setOver(o => o === s.key ? null : o)}
          onDrop={e => { e.preventDefault(); setOver(null); const l = items.find(x => x.id === drag.current); drag.current = null; if (l) apply(l, s.key) }}
          className={cn('flex w-[82vw] max-w-[300px] shrink-0 snap-start flex-col rounded-xl border transition-colors sm:w-[280px]', wash, over === s.key ? 'border-primary ring-2 ring-primary/20' : 'border-border/70')}>
          <header className="px-3.5 pb-2 pt-3">
            <h3 className="flex items-center gap-2 truncate text-[14px] font-semibold"><span className={cn('h-2 w-2 shrink-0 rounded-full', dot)} aria-hidden />{s.label}</h3>
            <p className="mt-0.5 text-xs tabular-nums text-muted">{list.length} lead{list.length === 1 ? '' : 's'}{total ? <> · <span title={`AED ${total.toLocaleString('en-US')}`}>AED {total.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span></> : ''}</p>
          </header>
          <ol className="flex min-h-24 flex-col gap-2.5 px-2.5 pb-2">
            {list.map(l => { const f = followupState(l, today)
              return <li key={l.id} draggable={canEdit} onDragStart={e => { drag.current = l.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', l.id) }} onDragEnd={() => { drag.current = null; setOver(null) }}
                data-row-link className={cn('group rounded-xl border border-border/80 bg-surface p-3.5 text-sm shadow-card transition-[box-shadow,transform,border-color] duration-200 ease-out hover:-translate-y-px hover:border-border-strong/70 hover:shadow-lift', canEdit && 'cursor-grab active:cursor-grabbing')}>
                <Link href={`/leads/${l.id}`} data-row-primary className="block min-w-0 font-semibold leading-snug hover:text-primary" draggable={false}>{l.service || l.company_name}</Link>
                <div className="mt-0.5 truncate text-[13px] text-muted">{l.service ? l.company_name : l.contact_person ?? l.number}</div>
                {(l.source || f === 'overdue' || f === 'today') && <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {l.source && <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[11.5px] font-medium text-muted">{LEAD_SOURCES[l.source] ?? l.source}</span>}
                  {(f === 'overdue' || f === 'today') && <span className={cn('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] font-medium', f === 'overdue' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning')}><CalendarClock size={11} aria-hidden />Follow-up {f === 'overdue' ? 'overdue' : 'today'}</span>}
                </div>}
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="font-bold tabular-nums">{l.estimated_value != null ? `AED ${Number(l.estimated_value).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : <span className="font-normal text-muted">No value yet</span>}</span>
                  {l.next_followup && (f === 'soon' || f === 'later') && <span className="text-xs tabular-nums text-muted" title="Next follow-up">{l.next_followup}</span>}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5 text-xs text-muted">
                  <span className="flex min-w-0 items-center gap-2">{l.salesperson ? <><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-fg" aria-hidden>{initials(l.salesperson)}</span><span className="truncate">{l.salesperson}</span></> : <span className="truncate font-mono">{l.number}</span>}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {l.phone && <a href={`tel:${l.phone.replace(/[^\d+]/g, '')}`} className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-primary" aria-label={`Call ${l.company_name}`}><Phone size={14} aria-hidden /></a>}
                    {canEdit && <label><span className="sr-only">Move {l.company_name} to</span>
                      <select value={l.stage} onChange={e => apply(l, e.target.value)} className="h-7 max-w-[104px] cursor-pointer rounded-md border border-border bg-surface px-1 text-[11.5px] text-fg">
                        {LEAD_STAGES.map(x => <option key={x.key} value={x.key}>{x.key === l.stage ? 'Move to…' : x.label}</option>)}</select></label>}
                  </span>
                </div>
              </li> })}
            {!list.length && <li className="grid min-h-16 place-items-center rounded-xl border border-dashed border-border-strong/60 text-xs text-muted">{canEdit ? 'Drop a lead here' : 'No leads'}</li>}
          </ol>
          {canEdit && <Link href="/leads?new=lead" className="mx-2.5 mb-2.5 mt-auto flex h-9 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium text-primary transition-colors hover:bg-surface/70"><Plus size={14} aria-hidden />Add lead</Link>}
        </section> })}
    </div>

    <dialog ref={dlg} onClose={() => setLostFor(null)} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-border/80 bg-surface p-0 text-start text-fg shadow-pop">
      <form method="dialog" className="space-y-4 p-5" onSubmit={e => {
        const fd = new FormData(e.currentTarget); const reason = String(fd.get('reason') ?? '')
        if (!reason) { e.preventDefault(); return }
        if (lostFor) apply(lostFor, 'lost', reason, String(fd.get('note') ?? ''))
      }}>
        <h2 className="text-[15px] font-semibold">Why was {lostFor?.company_name ?? 'this lead'} lost?</h2>
        <p className="text-sm text-muted">The reason feeds the win / loss analysis by source.</p>
        <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-muted">Reason *</span>
          <Select name="reason" required defaultValue=""><option value="" disabled>Choose…</option>{Object.entries(LOST_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
        <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-muted">Note</span>
          <input name="note" maxLength={500} className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm shadow-field transition-[border-color,box-shadow] hover:border-border-strong focus:border-primary/70 focus:shadow-focus focus-visible:ring-0" placeholder="Optional" /></label>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => dlg.current?.close()}>Cancel</Button><Button type="submit" variant="danger">Mark as lost</Button></div>
      </form>
    </dialog>
  </>
}
