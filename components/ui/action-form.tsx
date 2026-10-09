'use client'
import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { Loader2 } from 'lucide-react'
import { Button, Alert } from './primitives'
import { useDialog } from './dialog'
import { toast } from './toast'
import type { ActionState } from '@/lib/utils'
import { clearDraft, draftAge, readDraft, writeDraft } from '@/lib/drafts'

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
export function ActionForm({ action, children, submit: label = 'Save', className, resetOnSuccess = true, variant = 'primary', hideSubmit, idempotent, draftKey }: {
  action: Action; children: ReactNode; submit?: string; className?: string; resetOnSuccess?: boolean; variant?: 'primary' | 'danger' | 'secondary'; hideSubmit?: boolean
  /** adds a per-submission idempotency key: a double click or a network retry is recorded once (server must honour `idempotency_key`) */
  idempotent?: boolean
  /** keeps what was typed on this device until it is saved (offline / closed tab); restored next time the form opens */
  draftKey?: string
}) {
  const [state, run, pending] = useActionState(guard(action), null)
  const { close } = useDialog()
  const ref = useRef<HTMLFormElement>(null)
  const [idem, setIdem] = useState(() => (idempotent ? crypto.randomUUID() : ''))
  useEffect(() => {
    if (state?.ok) { if (draftKey) { clearDraft(`form:${draftKey}`); setRestored(null) } if (resetOnSuccess) ref.current?.reset(); if (state.message) toast(state.message); if (idempotent) setIdem(crypto.randomUUID()); close() }
  }, [state, close, resetOnSuccess, idempotent, draftKey])
  // offline drafts: restore once on mount, then save (debounced) on every edit
  const [restored, setRestored] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // a save that ends in a redirect never returns a state: if the form goes away while that submit is in flight without an
  // error, the draft has been saved and is cleared
  const inFlight = useRef(false)
  useEffect(() => { if (state) inFlight.current = false }, [state])
  useEffect(() => () => { if (draftKey && inFlight.current) clearDraft(`form:${draftKey}`) }, [draftKey])
  useEffect(() => {
    const f = ref.current; if (!draftKey || !f) return
    const d = readDraft<[string, string][]>(`form:${draftKey}`); if (!d?.data?.length) return
    const seen = new Map<string, number>()
    for (const el of Array.from(f.elements) as HTMLInputElement[]) {
      if (!el.name || ['hidden', 'file', 'password', 'submit', 'button'].includes(el.type) || el.name === 'idempotency_key') continue
      const vals = d.data.filter(([k]) => k === el.name).map(([, v]) => v)
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = vals.includes(el.value || 'on')
      else { const i = seen.get(el.name) ?? 0; if (vals[i] !== undefined) el.value = vals[i]; seen.set(el.name, i + 1) }
    }
    setRestored(d.at)
  }, [draftKey])
  const remember = () => {
    const f = ref.current; if (!draftKey || !f) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const pairs: [string, string][] = []
      for (const el of Array.from(f.elements) as HTMLInputElement[]) {
        if (!el.name || ['hidden', 'file', 'password', 'submit', 'button'].includes(el.type) || el.name === 'idempotency_key') continue
        if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) continue
        pairs.push([el.name, el.type === 'checkbox' || el.type === 'radio' ? (el.value || 'on') : el.value])
      }
      if (pairs.some(([, v]) => v.trim())) writeDraft(`form:${draftKey}`, pairs); else clearDraft(`form:${draftKey}`)
    }, 400)
  }
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
    if (timer.current) clearTimeout(timer.current)
    inFlight.current = true
    startTransition(() => run(fd))
  }
  return <PendingCtx.Provider value={pending}><form ref={ref} onSubmit={submit} onInput={draftKey ? remember : undefined} onChange={draftKey ? remember : undefined} className={className ?? 'flex flex-col gap-4'}>
    {idempotent && <input type="hidden" name="idempotency_key" value={idem} />}
    {restored && <div className="flex flex-wrap items-center gap-2 rounded-md bg-primary/5 px-3 py-1.5 text-xs" data-draft-restored>
      <span className="flex-1">Restored what you typed on this device ({draftAge(restored)}).</span>
      <button type="button" className="cursor-pointer text-primary hover:underline" onClick={() => { clearDraft(`form:${draftKey}`); ref.current?.reset(); setRestored(null) }}>Discard</button></div>}
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
