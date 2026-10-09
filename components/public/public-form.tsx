'use client'
import { startTransition, useActionState, useEffect, useRef, type ReactNode } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import type { ActionState } from '@/lib/utils'

/** Form for public pages: shows the server's answer; on success the form is replaced by the confirmation. */
export function PublicForm({ action, submit, children, variant = 'primary', keepOnSuccess, className, encType }: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>; submit: ReactNode; children: ReactNode; variant?: 'primary' | 'secondary' | 'danger'; keepOnSuccess?: boolean; className?: string; encType?: string
}) {
  const [state, run, pending] = useActionState(action, null)
  const t = useRef<HTMLInputElement>(null)
  useEffect(() => { if (t.current && !t.current.value) t.current.value = String(Date.now()) }, [])
  if (state?.ok && !keepOnSuccess) return <p role="status" className="flex items-start gap-2 rounded-md border border-success/30 bg-success/5 p-3 text-sm text-success"><CheckCircle2 size={16} className="mt-0.5 shrink-0" />{state.message}</p>
  // onSubmit (not <form action>): React 19 clears uncontrolled fields after every action, which would wipe the visitor's input after a refusal
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); if (pending) return; const fd = new FormData(e.currentTarget); startTransition(() => run(fd)) }
  return <form onSubmit={onSubmit} className={className ?? 'space-y-3'} encType={encType}>
    <input ref={t} type="hidden" name="t" />
    {children}
    {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    {state?.ok && keepOnSuccess && <p role="status" className="text-sm text-success">{state.message}</p>}
    <Button type="submit" variant={variant} disabled={pending}>{pending && <Loader2 size={14} className="animate-spin" />}{submit}</Button>
  </form>
}
