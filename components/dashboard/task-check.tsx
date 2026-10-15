'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { setTaskStatus } from '@/app/actions/operations'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

/** Tick a task off from the dashboard: marks it completed (same action as the Tasks page), then refreshes the list. */
export function TaskCheck({ id, title }: { id: string; title: string }) {
  const [done, setDone] = useState(false), [pending, start] = useTransition(), router = useRouter()
  return <button type="button" role="checkbox" aria-checked={done} aria-label={`Mark “${title}” as done`} disabled={pending || done} data-row-stop
    onClick={() => { setDone(true); start(async () => { const r = await setTaskStatus(id, 'completed'); if (r?.error) { setDone(false); toast(r.error, 'error') } else { toast('Task completed'); router.refresh() } }) }}
    className={cn('grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-md border-[1.5px] transition-colors', done ? 'border-success bg-success text-white' : 'border-border-strong hover:border-primary')}>
    {done && <Check size={13} strokeWidth={3} aria-hidden />}</button>
}
