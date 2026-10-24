'use client'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, Loader2, LogOut } from '@/components/icons'
import { toast } from '@/components/ui/toast'
import { punch } from '@/app/actions/me'
import { cn } from '@/lib/utils'

/** Today's check-in / check-out: one large button; the time is taken on the server, never from the phone. */
export function PunchButton({ kind }: { kind: 'in' | 'out' }) {
  const [busy, start] = useTransition(), router = useRouter()
  const go = () => start(async () => {
    const r = await punch(kind)
    if (r?.error) toast(r.error, 'error'); else { toast(r?.message ?? 'Saved.'); router.refresh() }
  })
  return <button type="button" onClick={go} disabled={busy} data-punch={kind}
    className={cn('inline-flex h-14 w-full cursor-pointer items-center justify-center gap-2.5 rounded-2xl text-[16px] font-semibold shadow-solid transition-transform duration-150 active:scale-[.98] disabled:opacity-60',
      kind === 'in' ? 'arc text-white' : 'bg-ink text-ink-fg')}>
    {busy ? <Loader2 size={20} className="animate-spin" aria-hidden /> : kind === 'in' ? <Clock size={20} aria-hidden /> : <LogOut size={20} aria-hidden />}
    {kind === 'in' ? 'Check in' : 'Check out'}</button>
}
