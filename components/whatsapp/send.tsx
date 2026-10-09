'use client'
import { startTransition, useActionState, useRef, useState, type ReactNode } from 'react'
import { FileText, Loader2, MessageCircle, X } from 'lucide-react'
import { Alert, Badge, Button, Field, Input, Textarea } from '@/components/ui/primitives'
import { prepareWhatsApp, sendViaWhatsApp } from '@/app/actions/whatsapp'
import type { ActionState } from '@/lib/utils'

type Prep = { kind: string; label: string; party: { type: string; id: string; name: string }; phone: string | null; preview: string; attachment: boolean; mode: 'live' | 'sandbox'; templateReady: boolean; templateStatus: string; windowOpen: boolean; optedOut: boolean }

/**
 * “Send via WhatsApp”: loads the recipient (number auto-filled), the exact message and the PDF that will be attached,
 * shows a preview, then sends through the WhatsApp Business Cloud API. Status is tracked in the history.
 */
export function WhatsAppSend({ kind, recordId, label = 'WhatsApp', variant = 'secondary', size = 'sm', trigger, ariaLabel }: {
  kind: string; recordId: string; label?: string; ariaLabel?: string; variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md' | 'icon'
  /** custom opener (e.g. a menu item) */
  trigger?: (open: () => void) => ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [prep, setPrep] = useState<Prep | null>(null), [loadErr, setLoadErr] = useState<string | null>(null), [loading, setLoading] = useState(false)
  const [custom, setCustom] = useState(false), [text, setText] = useState('')
  const [state, run, pending] = useActionState(sendViaWhatsApp.bind(null, kind, recordId), null as ActionState)
  const [shownState, setShownState] = useState<ActionState>(null)
  const open = async () => {
    ref.current?.showModal(); setLoading(true); setLoadErr(null); setShownState(state)
    const r = await prepareWhatsApp(kind, recordId).catch(() => ({ error: 'Could not prepare the message.' }) as ActionState)
    setLoading(false)
    if (r?.error) { setLoadErr(r.error); setPrep(null); return }
    const p = r!.data as Prep; setPrep(p); setText(p.preview); setCustom(false)
  }
  const result = state !== shownState ? state : null
  const blocked = !prep || prep.optedOut || (!custom && !prep.templateReady)
  return <>
    {trigger ? trigger(open) : <Button type="button" variant={variant} size={size} onClick={open} aria-label={ariaLabel ?? (size === 'icon' ? `Send ${label} via WhatsApp` : undefined)}><MessageCircle size={14} />{size !== 'icon' && label}</Button>}
    <dialog ref={ref} onClick={e => { if (e.target === ref.current) ref.current?.close() }} data-wa-dialog
      className="mx-0 mb-0 mt-auto max-h-[92dvh] w-full max-w-none flex-col rounded-t-xl border border-border bg-surface p-0 text-fg shadow-pop open:flex sm:m-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:max-w-lg sm:rounded-lg">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5 sm:px-5 sm:py-3">
        <h2 className="text-[15px] font-semibold">Send via WhatsApp{prep ? `: ${prep.label}` : ''}</h2>
        <button type="button" aria-label="Close" className="grid h-10 w-10 cursor-pointer place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg sm:h-8 sm:w-8" onClick={() => ref.current?.close()}><X size={18} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
        {loading && <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" />Preparing the message…</p>}
        {loadErr && <Alert tone="red">{loadErr}</Alert>}
        {prep && !loading && <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); if (pending || blocked) return; const fd = new FormData(e.currentTarget); startTransition(() => run(fd)) }}>
          <div className="flex flex-wrap items-center gap-2 text-sm"><span className="min-w-0 flex-1">To <b>{prep.party.name}</b> <span className="text-muted">({prep.party.type})</span></span>
            <Badge tone={prep.mode === 'live' ? 'green' : 'amber'}>{prep.mode === 'live' ? 'Live' : 'Sandbox: not sent'}</Badge></div>
          <Field label="WhatsApp number" hint={prep.phone ? 'from the record; you can change it for this message' : 'no number on the record: enter one with country code'}><Input name="to" type="tel" inputMode="tel" required defaultValue={prep.phone ?? ''} placeholder="+971 50 123 4567" /></Field>
          {prep.optedOut && <Alert tone="red">This number replied STOP and has opted out of WhatsApp messages.</Alert>}
          {!prep.templateReady && !custom && <Alert tone="amber">The “{prep.label}” template is {prep.templateStatus === 'NOT_SUBMITTED' ? 'not submitted to WhatsApp yet' : `${prep.templateStatus.toLowerCase().replace('_', ' ')} at WhatsApp`}. An admin can submit it under Settings → WhatsApp.{prep.windowOpen ? ' The customer messaged you in the last 24 hours, so you can send a custom message instead.' : ''}</Alert>}
          <div><div className="mb-1.5 text-sm font-medium">Preview</div>
            <div className="rounded-lg bg-[#e7f7e1] p-3 text-sm text-[#111] dark:bg-[#1f3b2d] dark:text-[#e9f5ee]" data-wa-preview>
              {prep.attachment && <div className="mb-2 flex items-center gap-2 rounded-md bg-white/70 px-2.5 py-2 text-xs dark:bg-black/20"><FileText size={16} aria-hidden />PDF attached: the {prep.label.toLowerCase()} generated from Averiqo</div>}
              {custom ? <Textarea name="text" rows={5} maxLength={1000} value={text} onChange={e => setText(e.target.value)} aria-label="Custom message" className="bg-white/80 text-[#111]" /> : <p className="whitespace-pre-line break-words">{prep.preview}</p>}
            </div>
            {prep.windowOpen && <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" name="custom" checked={custom} onChange={e => setCustom(e.target.checked)} />Write a custom message (allowed: they messaged you in the last 24 hours)</label>}
            <p className="mt-1.5 text-xs text-muted">ID, passport and bank account numbers are masked automatically; salaries are never written in the message text.</p></div>
          {result?.error && <Alert tone="red">{result.error}</Alert>}
          {result?.ok && result.message && <Alert tone={result.data?.status === 'sandbox' || result.data?.status === 'retry' ? 'amber' : 'green'}>{result.message}</Alert>}
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => ref.current?.close()}>Close</Button>
            <Button type="submit" disabled={pending || blocked}>{pending ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}Send</Button></div>
        </form>}
      </div>
    </dialog>
  </>
}
