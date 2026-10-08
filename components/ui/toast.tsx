'use client'
import { useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

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
    {items.map(t => {
      const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? AlertTriangle : Info
      return <div key={t.id} className={cn('toast-in pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border bg-surface px-3.5 py-3 text-sm shadow-lg',
        t.tone === 'error' ? 'border-danger/40' : t.tone === 'success' ? 'border-success/40' : 'border-border')}>
        <Icon size={17} className={cn('mt-0.5 shrink-0', t.tone === 'error' ? 'text-danger' : t.tone === 'success' ? 'text-success' : 'text-primary')} aria-hidden />
        <span className="flex-1">{t.msg}</span>
        <button aria-label="Dismiss" className="cursor-pointer rounded p-0.5 text-muted hover:text-fg" onClick={() => setItems(x => x.filter(y => y.id !== t.id))}><X size={14} /></button>
      </div>
    })}
  </div>
}
