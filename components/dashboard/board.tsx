'use client'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Check, GripVertical, LayoutGrid } from '@/components/icons'
import { toast } from '@/components/ui/toast'
import { saveDashboardLayout } from '@/app/actions/preferences'
import { WIDGETS, type DashboardLayout, type WidgetCol, type WidgetKey } from '@/lib/dashboard-widgets'
import { cn } from '@/lib/utils'

// The dashboard's cards, in the user's own order, movable by dragging. Desktop: a grip appears on hover; any screen:
// "Arrange" shows the grips (big enough for a finger) and stops the cards' own links while arranging. Keyboard: focus a
// grip and use the arrow keys. Cards move within their area; the left and right columns exchange cards, the top area
// (today, key figures) keeps its own. Every move is saved to the user's layout (only theirs), like Customize.

type Zone = WidgetCol
const ZONES: Zone[] = ['top', 'left', 'right']
const zoneOf = (k: WidgetKey, layout: DashboardLayout) => layout.items.find(i => i.key === k)?.col ?? WIDGETS[k].col

/** Wide cards on the left sit side by side in pairs when both are there (the same rule the server used before). */
function spanOf(k: WidgetKey, left: WidgetKey[]) {
  const has = (x: WidgetKey) => left.includes(x)
  const pair: Partial<Record<WidgetKey, [WidgetKey, string]>> = {
    trend: ['funnel', 'lg:col-span-8'], funnel: ['trend', 'lg:col-span-4'], floor: ['road', 'lg:col-span-7'], road: ['floor', 'lg:col-span-5'],
    activity: ['projects', 'lg:col-span-6'], projects: ['activity', 'lg:col-span-6'],
  }
  const p = pair[k]
  return p && has(p[0]) ? p[1] : 'lg:col-span-12'
}

export function ArrangeButton() {
  return <button type="button" onClick={() => window.dispatchEvent(new Event('dashboard:arrange'))} data-arrange
    className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 text-[14px] font-medium shadow-key transition-colors hover:bg-surface-2">
    <LayoutGrid size={15} aria-hidden />Arrange</button>
}

export function DashboardBoard({ layout, nodes, phoneHidden }: { layout: DashboardLayout; nodes: Partial<Record<WidgetKey, ReactNode>>; phoneHidden: WidgetKey[] }) {
  const router = useRouter()
  const initial = () => Object.fromEntries(ZONES.map(z => [z, layout.items.filter(i => !i.hidden && nodes[i.key] && i.col === z).map(i => i.key)])) as Record<Zone, WidgetKey[]>
  const [zones, setZones] = useState<Record<Zone, WidgetKey[]>>(initial)
  const [dragKey, setDragKey] = useState<WidgetKey | null>(null)
  const [arrange, setArrange] = useState(false)
  const zonesRef = useRef(zones); zonesRef.current = zones
  const ghost = useRef<HTMLDivElement | null>(null), drag = useRef<{ key: WidgetKey; dx: number; dy: number; x: number; y: number; sx: number; sy: number; moved: boolean } | null>(null)
  const raf = useRef(0), saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const phoneHid = new Set(phoneHidden)

  useEffect(() => { setZones(initial()) }, [layout])   // eslint-disable-line react-hooks/exhaustive-deps -- a new server layout (Customize, reset) replaces the local order
  useEffect(() => { const on = () => setArrange(a => !a); window.addEventListener('dashboard:arrange', on); return () => window.removeEventListener('dashboard:arrange', on) }, [])

  const save = useCallback((z: Record<Zone, WidgetKey[]>) => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      // the full layout: visible cards in their new place and order, hidden ones kept as they were
      const shown = new Set(ZONES.flatMap(k => z[k]))
      const items = [...ZONES.flatMap(col => z[col].map(key => ({ key, col, hidden: false }))), ...layout.items.filter(i => !shown.has(i.key))]
      const r = await saveDashboardLayout({ items })
      if (r?.error) { toast(r.error, 'error'); setZones(initial()) } else router.refresh()
    }, 450)
  }, [layout]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Moves `key` next to `target` (before or after), or to the end of `zone`. Top cards stay in the top area. */
  const place = useCallback((key: WidgetKey, zone: Zone, target: WidgetKey | null, after: boolean) => {
    const from = ZONES.find(z => zonesRef.current[z].includes(key))!
    if ((from === 'top') !== (zone === 'top')) return false
    const next = Object.fromEntries(ZONES.map(z => [z, zonesRef.current[z].filter(k => k !== key)])) as Record<Zone, WidgetKey[]>
    const list = next[zone], at = target ? list.indexOf(target) : -1
    if (at < 0) list.push(key); else list.splice(after ? at + 1 : at, 0, key)
    if (ZONES.every(z => next[z].join() === zonesRef.current[z].join())) return false
    zonesRef.current = next; setZones(next); return true
  }, [])

  const move = (key: WidgetKey, d: -1 | 1) => {
    const z = ZONES.find(x => zones[x].includes(key))!, i = zones[z].indexOf(key)
    const t = zones[z][i + d]
    if (t) { if (place(key, z, t, d === 1)) save(zonesRef.current) }
    else if (z !== 'top') { const other: Zone = z === 'left' ? 'right' : 'left'; if (place(key, other, d === 1 ? zones[other][0] ?? null : null, false)) save(zonesRef.current) }
  }

  // ── pointer dragging (mouse, pen and touch: the grip has touch-action none) ──
  const onPointerDown = (e: React.PointerEvent, key: WidgetKey) => {
    if (e.button !== 0) return
    const card = (e.currentTarget as HTMLElement).closest('[data-widget]') as HTMLElement
    const r = card.getBoundingClientRect()
    drag.current = { key, dx: e.clientX - r.left, dy: e.clientY - r.top, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false }
    // moves are followed on the window: the card (and its grip) changes place in the page while it is dragged
    const mv = (ev: PointerEvent) => onPointerMove(ev), up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); end() }
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up)
    e.preventDefault()
    const g = card.cloneNode(true) as HTMLDivElement
    g.removeAttribute('data-widget'); g.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'))
    Object.assign(g.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${Math.min(r.height, 420)}px`, overflow: 'hidden', zIndex: '80',
      pointerEvents: 'none', opacity: '0', transform: 'scale(1.02) rotate(.6deg)', transition: 'opacity .12s', boxShadow: '0 24px 60px -18px rgb(0 0 0 / .35)', borderRadius: '16px' })
    g.setAttribute('aria-hidden', 'true'); document.body.appendChild(g); ghost.current = g
    const tick = () => {   // keeps scrolling while the card is held near the top or bottom of the screen
      const d = drag.current; if (!d) return
      if (d.moved) { const edge = 90, v = d.y < edge ? -(edge - d.y) / 4 : d.y > innerHeight - edge ? (d.y - (innerHeight - edge)) / 4 : 0; if (v) { scrollBy(0, v); hover(d.x, d.y) } }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }
  const hover = (x: number, y: number) => {
    const d = drag.current; if (!d) return
    const under = document.elementsFromPoint(x, y)
    // over the card's own placeholder: it is already where it would go
    if (under.some(n => (n as HTMLElement).dataset?.widget === d.key)) return
    const card = under.map(n => (n as HTMLElement).closest?.('[data-widget]') as HTMLElement | null).find(n => n && n.dataset.widget !== d.key)
    if (card) {
      const k = card.dataset.widget as WidgetKey, z = card.dataset.zone as Zone, r = card.getBoundingClientRect(), zr = card.parentElement!.getBoundingClientRect()
      const sideBySide = r.width < zr.width * 0.7   // cards sharing a row compare across, full-width ones up and down
      place(d.key, z, k, sideBySide ? x > r.left + r.width / 2 : y > r.top + r.height / 2)
      return
    }
    const zone = under.map(n => (n as HTMLElement).closest?.('[data-zone-box]') as HTMLElement | null).find(Boolean)
    if (zone) place(d.key, zone.dataset.zoneBox as Zone, null, true)
  }
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current; if (!d) return
    d.x = e.clientX; d.y = e.clientY
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return   // a click on the grip is not a drag
    if (!d.moved) { d.moved = true; setDragKey(d.key); if (ghost.current) ghost.current.style.opacity = '.95'; document.documentElement.classList.add('dragging-card') }
    if (ghost.current) { ghost.current.style.left = `${e.clientX - d.dx}px`; ghost.current.style.top = `${e.clientY - d.dy}px` }
    hover(e.clientX, e.clientY)
  }
  const end = () => {
    const d = drag.current; drag.current = null; cancelAnimationFrame(raf.current)
    ghost.current?.remove(); ghost.current = null; setDragKey(null); document.documentElement.classList.remove('dragging-card')
    if (d?.moved) save(zonesRef.current)
  }

  const zoneCls: Record<Zone, string> = {
    top: 'flex min-w-0 flex-col gap-5 2xl:col-start-1 2xl:row-start-1 [&>*>*>section]:mb-0',
    right: 'grid min-w-0 grid-cols-1 content-start items-start gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:col-start-2 2xl:row-span-2 2xl:row-start-1 2xl:grid-cols-1',
    left: 'grid min-w-0 grid-cols-12 content-start items-stretch gap-5 self-start 2xl:col-start-1 2xl:row-start-2',
  }
  const card = (key: WidgetKey, zone: Zone) => {
    const label = WIDGETS[key].label, dragging = dragKey === key
    return <div key={key} data-widget={key} data-zone={zone}
      className={cn('group/w relative min-w-0', zone === 'left' && cn('col-span-12', spanOf(key, zones.left)), phoneHid.has(key) && 'max-sm:hidden',
        arrange && 'rounded-2xl outline-dashed outline-2 outline-offset-4 outline-border-strong', dragging && 'opacity-40')}>
      <button type="button" aria-label={`Move ${label}: drag, or use the arrow keys`} title="Drag to move"
        onPointerDown={e => onPointerDown(e, key)}
        onKeyDown={e => { const d = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0; if (d) { e.preventDefault(); move(key, d as -1 | 1); requestAnimationFrame(() => (document.querySelector(`[data-widget="${key}"] [data-grip]`) as HTMLElement | null)?.focus()) } }}
        data-grip
        className={cn('absolute left-1/2 top-1 z-20 -translate-x-1/2 cursor-grab touch-none select-none items-center justify-center rounded-full border border-border bg-surface/95 text-muted shadow-key backdrop-blur transition-opacity hover:text-fg active:cursor-grabbing',
          arrange ? 'flex h-9 w-16 opacity-100' : 'hidden h-6 w-11 opacity-0 focus-visible:flex focus-visible:opacity-100 [@media(hover:hover)]:flex [@media(hover:hover)]:group-hover/w:opacity-100')}>
        <GripVertical size={arrange ? 18 : 14} className="rotate-90" aria-hidden /></button>
      <div className={cn('h-full', arrange && 'pointer-events-none select-none')} inert={arrange || undefined}>{nodes[key]}</div>
    </div>
  }

  return <>
    {arrange && <div className="sticky top-2 z-30 mb-4 flex items-center gap-3 rounded-2xl border border-primary/25 bg-primary-soft px-4 py-2.5 text-[13.5px] text-primary shadow-card" role="status" data-arrange-bar>
      <span className="min-w-0 flex-1">Drag a card by its handle to move it. Changes are saved for you.</span>
      <button type="button" onClick={() => setArrange(false)} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-primary px-4 font-semibold text-primary-fg"><Check size={15} aria-hidden />Done</button></div>}
    <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-rows-[auto_1fr]" data-board>
      {(['top', 'right', 'left'] as Zone[]).map(z => <div key={z} data-zone-box={z} className={cn(zoneCls[z], z === 'top' && zones.top.every(k => phoneHid.has(k)) && 'max-sm:hidden',
        dragKey && z !== 'top' && 'min-h-24 rounded-2xl outline-dashed outline-1 outline-offset-8 outline-border')}>{zones[z].map(k => card(k, z))}</div>)}
    </div>
  </>
}
