'use client'
import { useActionState, useEffect, useRef, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Button, Alert } from './primitives'
import { useDialog } from './dialog'
import type { ActionState } from '@/lib/utils'

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>

/** <form> bound to a server action with pending / error / success states. Closes the surrounding dialog on success. */
export function ActionForm({ action, children, submit = 'Save', className, resetOnSuccess = true, variant = 'primary', hideSubmit }: {
  action: Action; children: ReactNode; submit?: string; className?: string; resetOnSuccess?: boolean; variant?: 'primary' | 'danger' | 'secondary'; hideSubmit?: boolean
}) {
  const [state, run, pending] = useActionState(action, null)
  const { close } = useDialog()
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => { if (state?.ok) { if (resetOnSuccess) ref.current?.reset(); close() } }, [state, close, resetOnSuccess])
  return <form ref={ref} action={run} className={className ?? 'flex flex-col gap-4'}>
    {children}
    {state?.error && <Alert tone="red">{state.error}</Alert>}
    {state?.ok && state.message && <Alert tone="green">{state.message}</Alert>}
    {!hideSubmit && <div className="flex justify-end gap-2 pt-1"><Button type="submit" variant={variant} disabled={pending}>{pending && <Loader2 size={14} className="animate-spin" />}{submit}</Button></div>}
  </form>
}

/** One-click server action button (e.g. "Mark cleared", "Run now"). */
export function ActionButton({ action, children, confirm, variant = 'secondary', size = 'sm', className }: {
  action: () => Promise<ActionState>; children: ReactNode; confirm?: string; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; className?: string
}) {
  const [state, run, pending] = useActionState(async () => action(), null)
  return <form action={run} onSubmit={e => { if (confirm && !window.confirm(confirm)) e.preventDefault() }} className="inline-flex items-center gap-2">
    <Button type="submit" variant={variant} size={size} disabled={pending} className={className}>{pending && <Loader2 size={13} className="animate-spin" />}{children}</Button>
    {state?.error && <span className="text-xs text-danger">{state.error}</span>}
    {state?.ok && state.message && <span className="text-xs text-success">{state.message}</span>}
  </form>
}
