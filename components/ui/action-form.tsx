'use client'
import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { Loader2 } from 'lucide-react'
import { Button, Alert } from './primitives'
import { useDialog } from './dialog'
import { toast } from './toast'
import type { ActionState } from '@/lib/utils'

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>
const PendingCtx = createContext<boolean | null>(null)
/** A dropped connection or server crash becomes a message on the form (nothing typed is lost) instead of an error page. */
function guard<A extends unknown[]>(fn: (...a: A) => Promise<ActionState>) {
  return async (...a: A): Promise<ActionState> => {
    try { return await fn(...a) } catch (e) {
      if (String((e as any)?.digest ?? (e as Error)?.message ?? '').includes('NEXT_REDIRECT')) throw e
      return { error: typeof navigator !== 'undefined' && !navigator.onLine ? 'You are offline. Reconnect and try again. Your entries are still here.' : 'The request did not complete (network or server problem). Please try again. Your entries are still here.' }
    }
  }
}

/** <form> bound to a server action with pending / error / success states. Closes the surrounding dialog on success. */
export function ActionForm({ action, children, submit: label = 'Save', className, resetOnSuccess = true, variant = 'primary', hideSubmit, idempotent }: {
  action: Action; children: ReactNode; submit?: string; className?: string; resetOnSuccess?: boolean; variant?: 'primary' | 'danger' | 'secondary'; hideSubmit?: boolean
  /** adds a per-submission idempotency key: a double click or a network retry is recorded once (server must honour `idempotency_key`) */
  idempotent?: boolean
}) {
  const [state, run, pending] = useActionState(guard(action), null)
  const { close } = useDialog()
  const ref = useRef<HTMLFormElement>(null)
  const [idem, setIdem] = useState(() => (idempotent ? crypto.randomUUID() : ''))
  useEffect(() => {
    if (state?.ok) { if (resetOnSuccess) ref.current?.reset(); if (state.message) toast(state.message); if (idempotent) setIdem(crypto.randomUUID()); close() }
  }, [state, close, resetOnSuccess, idempotent])
  // field errors from the server are shown on the matching inputs; the form is NOT cleared after a failed save
  useEffect(() => {
    const f = ref.current; if (!f) return
    f.querySelectorAll('[aria-invalid="true"][data-server-error]').forEach(el => { el.removeAttribute('aria-invalid'); el.removeAttribute('data-server-error') })
    for (const k of Object.keys(state?.fieldErrors ?? {})) {
      const el = f.elements.namedItem(k)
      if (el instanceof HTMLElement) { el.setAttribute('aria-invalid', 'true'); el.setAttribute('data-server-error', '') }
    }
    const first = f.querySelector('[data-server-error]') as HTMLElement | null; first?.focus()
  }, [state])
  // Submitted via onSubmit (not <form action>): React 19 auto-resets uncontrolled forms after every action, which would wipe
  // what the user typed after a FAILED save. Here fields are only reset on success (resetOnSuccess); re-submits while pending are ignored.
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (pending) return
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null)
    startTransition(() => run(fd))
  }
  return <PendingCtx.Provider value={pending}><form ref={ref} onSubmit={submit} className={className ?? 'flex flex-col gap-4'}>
    {idempotent && <input type="hidden" name="idempotency_key" value={idem} />}
    {children}
    {state?.error && <Alert tone="red">{state.error}{state.fieldErrors && Object.keys(state.fieldErrors).length > 1 && <ul className="mt-1 list-disc ps-5 text-xs">{Object.entries(state.fieldErrors).map(([k, m]) => <li key={k}>{m}</li>)}</ul>}</Alert>}
    {state?.ok && state.message && <Alert tone="green">{state.message}</Alert>}
    {!hideSubmit && <div className="flex justify-end gap-2 pt-1"><Button type="submit" variant={variant} disabled={pending} aria-busy={pending}>{pending && <Loader2 size={14} className="animate-spin" />}{label}</Button></div>}
  </form></PendingCtx.Provider>
}

/** One-click server action button (e.g. "Mark cleared", "Run now"). */
export function ActionButton({ action, children, confirm, variant = 'secondary', size = 'sm', className }: {
  action: () => Promise<ActionState>; children: ReactNode; confirm?: string; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; className?: string
}) {
  const [state, run, pending] = useActionState(guard(async () => { const r = await action(); if (r?.error) toast(r.error, 'error'); return r }), null)
  return <form action={run} onSubmit={e => { if (confirm && !window.confirm(confirm)) e.preventDefault() }} className="inline-flex items-center gap-2">
    <Button type="submit" variant={variant} size={size} disabled={pending} className={className}>{pending && <Loader2 size={13} className="animate-spin" />}{children}</Button>
    {state?.error && <span className="text-xs text-danger">{state.error}</span>}
    {state?.ok && state.message && <span className="text-xs text-success">{state.message}</span>}
  </form>
}

/** Submit button for a custom ActionForm layout (hideSubmit): shows a spinner while the action runs. */
export function SubmitButton({ children, variant = 'secondary' }: { children: ReactNode; variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  const ctx = useContext(PendingCtx), status = useFormStatus()
  const pending = ctx ?? status.pending
  return <Button type="submit" variant={variant} disabled={pending}>{pending && <Loader2 size={14} className="animate-spin" />}{children}</Button>
}
