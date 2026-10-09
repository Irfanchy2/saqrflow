'use client'
import { startTransition, useActionState, useState } from 'react'
import { Check, Copy, Loader2, Mail, MessageCircle } from 'lucide-react'
import { Button, Field, Input, Select, Textarea } from '@/components/ui/primitives'
import type { ActionState } from '@/lib/utils'

/** Creates a secure link and shows it once, with copy / WhatsApp / email buttons. */
export function ShareLinkForm({ action, kind, defaultDays = 90, itemsHint, recipient, shareText }: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>; kind: string; defaultDays?: number; itemsHint?: string; recipient?: string; shareText: string
}) {
  const [state, run, pending] = useActionState(action, null)
  const [copied, setCopied] = useState(false)
  const url: string | undefined = state?.data?.url
  const msg = `${shareText}\n${url ?? ''}`
  return <div className="space-y-3">
    {url ? <div className="space-y-2 rounded-md border border-success/30 bg-success/5 p-3">
      <p className="text-sm font-medium text-success">{state?.message}</p>
      <p className="text-xs text-muted">Copy it now: for security only a fingerprint of the link is kept, so it cannot be shown again (you can always create a new one).</p>
      <div className="flex gap-2"><input readOnly value={url} aria-label="Secure link" onFocus={e => e.currentTarget.select()} className="h-10 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 font-mono text-xs" />
        <Button type="button" variant="secondary" onClick={async () => { await navigator.clipboard?.writeText(url).catch(() => {}); setCopied(true) }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}</Button></div>
      <div className="flex flex-wrap gap-2 text-sm">
        <a className="inline-flex items-center gap-1.5 text-primary hover:underline" href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} />Share on WhatsApp</a>
        <a className="inline-flex items-center gap-1.5 text-primary hover:underline" href={`mailto:?subject=${encodeURIComponent(shareText)}&body=${encodeURIComponent(msg)}`}><Mail size={14} />Email</a></div>
    </div> : <form onSubmit={e => { e.preventDefault(); if (pending) return; const fd = new FormData(e.currentTarget); startTransition(() => run(fd)) }} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Recipient name" hint="shown on the page"><Input name="recipient_name" maxLength={120} defaultValue={recipient} /></Field>
        <Field label="Link works for"><Select name="days" defaultValue={String(defaultDays)}>{[7, 14, 30, 90, 180, 365].map(d => <option key={d} value={d}>{d} days</option>)}</Select></Field>
      </div>
      {kind === 'document_request' && <Field label="Documents needed *" hint={itemsHint ?? 'one per line or comma separated'}><Textarea name="items" rows={3} required maxLength={2400} placeholder={'Passport copy\nEmirates ID (both sides)\nVisa page'} /></Field>}
      <Field label="Message" hint="optional, shown at the top of the page"><Textarea name="message" rows={2} maxLength={2000} /></Field>
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending && <Loader2 size={14} className="animate-spin" />}Create secure link</Button>
    </form>}
  </div>
}
