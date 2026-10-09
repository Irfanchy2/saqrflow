'use client'
import { startTransition, useActionState, useState, type ReactNode } from 'react'
import { Check, Copy, KeyRound, Loader2 } from 'lucide-react'
import { Alert, Button } from '@/components/ui/primitives'
import type { ActionState } from '@/lib/utils'

/** A form whose result carries a secret (API key, signing secret) that is displayed exactly once, with a copy button. */
export function SecretOnceForm({ action, children, submit, variant = 'primary' }: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>; children?: ReactNode; submit: string; variant?: 'primary' | 'secondary'
}) {
  const [state, run, pending] = useActionState(action, null)
  const [copied, setCopied] = useState(false)
  const secret: string | undefined = state?.data?.secret
  if (secret) return <div className="space-y-2 rounded-md border border-success/30 bg-success/5 p-3" role="status">
    <p className="flex items-center gap-1.5 text-sm font-medium text-success"><KeyRound size={14} aria-hidden />{state?.message}</p>
    <div className="flex gap-2"><input readOnly value={secret} aria-label={state?.data?.label ?? 'Secret'} onFocus={e => e.currentTarget.select()} className="h-10 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 font-mono text-xs" data-secret />
      <Button type="button" variant="secondary" onClick={async () => { await navigator.clipboard?.writeText(secret).catch(() => {}); setCopied(true) }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}</Button></div>
    <p className="text-xs text-muted">Store it in your password manager or the other system’s settings. Close this window when done.</p>
  </div>
  return <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); if (pending) return; const fd = new FormData(e.currentTarget); startTransition(() => run(fd)) }}>
    {children}
    {state?.error && <Alert tone="red">{state.error}</Alert>}
    <div className="flex justify-end"><Button type="submit" variant={variant} disabled={pending}>{pending && <Loader2 size={14} className="animate-spin" />}{submit}</Button></div>
  </form>
}
