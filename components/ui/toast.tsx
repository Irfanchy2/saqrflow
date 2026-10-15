'use client'
import { useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, Info, X } from '@/components/icons'
import { cn } from '@/lib/utils'
import { AnimatePresence, m } from 'framer-motion'
import { T } from '@/components/motion'

type Tone = 'success' | 'error' | 'info'
interface Toast { id: number; msg: string; tone: Tone }
const EVT = 'saqrflow:toast'

/** Fire-and-forget notification from any client component: toast('Saved'), toast('Failed', 'error'). */
export function toast(msg: string, tone: Tone = 'success') {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVT, { detail: { msg, tone } }))
}

/** Mounted once in the app layout. Polite live region; errors stay longer and are announced assertively. */
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([])
  useEffect(() => {
    let n = 0
    const on = (e: Event) => {
      const { msg, tone } = (e as CustomEvent).detail as Omit<Toast, 'id'>
      const id = ++n
      setItems(x => [...x.slice(-3), { id, msg, tone }])
      setTimeout(() => setItems(x => x.filter(t => t.id !== id)), tone === 'error' ? 7000 : 3500)
    }
    window.addEventListener(EVT, on)
    return () => window.removeEventListener(EVT, on)
  }, [])
  return <div className="no-print pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:end-4 sm:items-end lg:bottom-4">
    <div aria-live="polite" className="sr-only">{items.filter(t => t.tone !== 'error').map(t => t.msg).join('. ')}</div>
    <div aria-live="assertive" className="sr-only">{items.filter(t => t.tone === 'error').map(t => t.msg).join('. ')}</div>
    <AnimatePresence initial={false}>{items.map(t => {
      const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? AlertTriangle : Info
      return <m.div key={t.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: T.fast }} transition={T.base} className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-border/80 bg-surface py-3 pe-3 ps-3 text-[13.5px] shadow-pop">
        <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg', t.tone === 'error' ? 'bg-danger/10 text-danger' : t.tone === 'success' ? 'bg-success/10 text-success' : 'bg-primary-soft text-primary')} aria-hidden><Icon size={16} /></span>
        <span className="flex-1 self-center font-medium leading-snug">{t.msg}</span>
        <button aria-label="Dismiss" className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-muted transition-colors hover:bg-fg/[.05] hover:text-fg" onClick={() => setItems(x => x.filter(y => y.id !== t.id))}><X size={14} /></button>
      </m.div>
    })}</AnimatePresence>
  </div>
}
