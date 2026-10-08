'use client'
import Link from 'next/link'
import { useOptimistic, useRef, useState, useTransition } from 'react'
import { CalendarClock, Phone } from 'lucide-react'
import { setLeadStage } from '@/app/actions/crm'
import { toast } from '@/components/ui/toast'
import { Button, Select } from '@/components/ui/primitives'
import { LEAD_STAGES, LOST_REASONS, STAGE, followupState, type LeadStage } from '@/lib/crm'
import { cn } from '@/lib/utils'

export interface BoardLead { id: string; number: string; company_name: string; contact_person: string | null; phone: string | null; service: string | null; estimated_value: number | null; stage: string; next_followup: string | null; salesperson: string | null }
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
        return <section key={s.key} role="listitem" aria-label={`${s.label}: ${list.length} leads`}
          onDragOver={e => { if (canEdit && drag.current) { e.preventDefault(); setOver(s.key) } }} onDragLeave={() => setOver(o => o === s.key ? null : o)}
          onDrop={e => { e.preventDefault(); setOver(null); const l = items.find(x => x.id === drag.current); drag.current = null; if (l) apply(l, s.key) }}
          className={cn('flex w-[82vw] max-w-[300px] shrink-0 snap-start flex-col sm:w-[272px] rounded-lg border bg-surface-2/40 transition-colors', over === s.key ? 'border-primary bg-primary-soft/40' : 'border-border')}>
          <header className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2">
            <h3 className="truncate text-[13px] font-semibold">{s.label} <span className="font-normal text-muted tabular-nums">{list.length}</span></h3>
            <span className="text-xs tabular-nums text-muted" title={`AED ${total.toLocaleString('en-US')}`}>{total ? `AED ${money(total)}` : ''}</span>
          </header>
          <ol className="flex min-h-24 flex-col gap-2 p-2">
            {list.map(l => { const f = followupState(l, today)
              return <li key={l.id} draggable={canEdit} onDragStart={e => { drag.current = l.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', l.id) }} onDragEnd={() => { drag.current = null; setOver(null) }}
                className={cn('group rounded-md border border-border bg-surface p-2.5 text-sm shadow-sm', canEdit && 'cursor-grab active:cursor-grabbing')}>
                <Link href={`/leads/${l.id}`} className="block min-w-0 font-medium leading-snug hover:text-primary" draggable={false}>{l.company_name}</Link>
                {l.service && <div className="mt-0.5 line-clamp-2 text-xs text-muted">{l.service}</div>}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  {l.estimated_value != null && <span className="font-medium tabular-nums text-fg">AED {Number(l.estimated_value).toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>}
                  {l.next_followup && f !== 'none' && <span className={cn('inline-flex items-center gap-1 tabular-nums', f === 'overdue' ? 'font-medium text-danger' : f === 'today' ? 'font-medium text-warning' : '')}><CalendarClock size={12} aria-hidden />{f === 'overdue' ? 'Overdue' : f === 'today' ? 'Today' : l.next_followup}</span>}
                  {l.phone && <a href={`tel:${l.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 hover:text-primary" aria-label={`Call ${l.company_name}`}><Phone size={12} aria-hidden />Call</a>}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2 text-2xs text-muted">
                  <span className="truncate font-mono">{l.number}{l.salesperson ? ` · ${l.salesperson}` : ''}</span>
                  {canEdit && <label className="shrink-0"><span className="sr-only">Move {l.company_name} to</span>
                    <select value={l.stage} onChange={e => apply(l, e.target.value)} className="h-6 max-w-[112px] cursor-pointer rounded border border-border bg-surface px-1 text-2xs text-fg">
                      {LEAD_STAGES.map(x => <option key={x.key} value={x.key}>{x.key === l.stage ? 'Move to…' : x.label}</option>)}</select></label>}
                </div>
              </li> })}
            {!list.length && <li className="grid min-h-16 place-items-center rounded-md border border-dashed border-border text-xs text-muted">{canEdit ? 'Drop a lead here' : 'No leads'}</li>}
          </ol>
        </section> })}
    </div>

    <dialog ref={dlg} onClose={() => setLostFor(null)} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-border bg-surface p-0 text-fg shadow-pop">
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
          <input name="note" maxLength={500} className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm" placeholder="Optional" /></label>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => dlg.current?.close()}>Cancel</Button><Button type="submit" variant="danger">Mark as lost</Button></div>
      </form>
    </dialog>
  </>
}
