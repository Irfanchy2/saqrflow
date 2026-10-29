'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { checkShareNumber, logShare, prepareShare, saveShareNumber, type SharePrep } from '@/app/actions/share'
import { logSalesEvent } from '@/app/actions/sales'
import { Modal } from '@/components/ui/dialog'
import { Alert, Button, Field, Input, Textarea } from '@/components/ui/primitives'
import { AlertTriangle, CheckCircle2, Download, ExternalLink, FileText, Loader2, MessageCircle, Pencil, Share2, ShieldCheck } from '@/components/icons'
import { prettyPhone, waChatLink } from '@/lib/whatsapp/share'
import { cn } from '@/lib/utils'

/** Can this device hand a PDF file to its share sheet (Android / iPhone)? Desktop browsers use the WhatsApp chat link. */
function nativeFileShare() {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function' || typeof matchMedia === 'undefined') return false
  try { return matchMedia('(pointer: coarse)').matches && navigator.canShare({ files: [new File(['%PDF'], 'check.pdf', { type: 'application/pdf' })] }) } catch { return false }
}

/**
 * "Share via WhatsApp" (free, no WhatsApp Business API): shows who it goes to (name, ID and number from their profile), the
 * document and the message, then hands over to the user's own WhatsApp. Phones: the PDF goes to the phone's share sheet;
 * computers: the PDF downloads and the employee's chat opens with the message. Nothing is sent by Averiqo and nothing is
 * marked as sent: the person sharing checks the chat and presses send.
 */
export function ShareSheet({ kind, recordId, label = 'Share via WhatsApp', variant = 'secondary', size = 'sm', trigger, iconOnly }: {
  kind: string; recordId: string; label?: string; variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md'; iconOnly?: boolean
  trigger?: (open: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const show = () => setOpen(true)
  return <>
    {trigger ? trigger(show) : <Button type="button" variant={variant} size={size} onClick={show} data-share={kind} data-row-stop aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined}>
      <MessageCircle size={14} aria-hidden />{!iconOnly && label}</Button>}
    {open && <ShareModal kind={kind} recordId={recordId} onClose={() => setOpen(false)} />}
  </>
}

/** The same sheet opened from anywhere (a menu item, a success panel): render it while it should be open. */
export function ShareModal({ kind, recordId, onClose }: { kind: string; recordId: string; onClose: () => void }) {
  return <Modal title="Share via WhatsApp" onClose={onClose}><Sheet kind={kind} recordId={recordId} /></Modal>
}

function Sheet({ kind, recordId }: { kind: string; recordId: string }) {
  const [prep, setPrep] = useState<SharePrep | null>(null), [err, setErr] = useState<string | null>(null)
  const [phone, setPhone] = useState<string | null>(null), [editing, setEditing] = useState(false), [typed, setTyped] = useState('')
  const [numErr, setNumErr] = useState<string | null>(null), [numNote, setNumNote] = useState<string | null>(null), [also, setAlso] = useState<string[]>([])
  const [text, setText] = useState(''), [busy, setBusy] = useState<string | null>(null), [done, setDone] = useState<null | 'native' | 'link' | 'download'>(null)
  const [native, setNative] = useState(false), file = useRef<File | null>(null), [fileReady, setFileReady] = useState(false)
  useEffect(() => {
    let live = true
    prepareShare(kind, recordId).then(r => {
      if (!live) return
      if (r?.error || !r?.data) { setErr(r?.error ?? 'Could not prepare this document.'); return }
      const p = r.data as SharePrep; setPrep(p); setPhone(p.phone); setText(p.message); setAlso(p.sameNumberAs); setEditing(!p.phone); setTyped(p.storedInvalid ?? '')
      const n = nativeFileShare(); setNative(n)
      // phones: fetch the PDF now, so the share sheet opens straight from the tap (browsers allow it only right after a tap)
      if (n) fetch(p.pdfUrl, { credentials: 'same-origin' }).then(res => (res.ok ? res.blob() : Promise.reject())).then(b => { if (live) { file.current = new File([b], p.filename, { type: 'application/pdf' }); setFileReady(true) } }).catch(() => live && setNative(false))
    }).catch(() => live && setErr('Could not prepare this document.'))
    return () => { live = false }
  }, [kind, recordId])

  if (err) return <Alert tone="red">{err}</Alert>
  if (!prep) return <p className="flex items-center gap-2 py-6 text-sm text-muted" data-share-loading><Loader2 size={15} className="animate-spin" />Preparing the document…</p>

  const log = (method: 'native_share' | 'whatsapp_link' | 'download') => {
    void logShare(prep.kind, prep.recordId, method, prep.party.id, phone)
    if (prep.party.type === 'customer' && method !== 'download') void logSalesEvent(prep.recordId, 'whatsapp')
  }
  const applyNumber = async (save: boolean) => {
    setNumErr(null); setNumNote(null); setBusy(save ? 'save' : 'use')
    const r = save ? await saveShareNumber(prep.party.type, prep.party.id, typed) : await checkShareNumber(prep.party.type === 'employee' ? prep.party.id : null, typed)
    setBusy(null)
    if (r?.error) { setNumErr(r.error); return }
    setPhone(r!.data!.phone); setEditing(false); setAlso(r!.data!.sameNumberAs ?? [])
    setNumNote(save ? `Saved to ${prep.party.name}'s profile.` : `Using this number for this share only. ${prep.party.name}'s profile is unchanged.`)
  }
  const shareNative = async () => {
    if (!file.current) return
    try {
      setBusy('native')
      try { await navigator.clipboard?.writeText(text) } catch { /* some apps drop the caption: the message is also on the clipboard */ }
      await navigator.share({ files: [file.current], text, title: prep.docLabel })
      log('native_share'); setDone('native')
    } catch (e) { if ((e as Error)?.name !== 'AbortError') setErr('This phone could not share the file. Use "Download PDF" and attach it in WhatsApp.') }
    finally { setBusy(null) }
  }
  const download = () => { const a = document.createElement('a'); a.href = prep.pdfUrl; a.download = prep.filename; document.body.appendChild(a); a.click(); a.remove() }
  const openChat = () => {
    if (!phone) return
    download()                                               // the PDF to attach
    window.open(waChatLink(phone, text), '_blank', 'noopener,noreferrer')
    log('whatsapp_link'); setDone('link')
  }
  const first = prep.party.name.split(' ')[0]

  return <div className="flex flex-col gap-4" data-share-sheet data-share-kind={prep.kind}>
    {/* who */}
    <section className="rounded-xl bg-surface-2/70 p-4 ring-1 ring-inset ring-border/70" data-share-recipient>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#1fae57]/12 text-[14px] font-semibold text-[#128c46] dark:text-[#5fd68f]" aria-hidden>{prep.party.name.split(' ').map(w => w[0]).slice(0, 2).join('')}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-snug" data-share-name>{prep.party.name}</div>
          <div className="text-[12.5px] text-muted">{prep.party.type === 'employee' ? `Employee ${prep.party.code}` : 'Customer'}</div>
          {!editing && phone && <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="font-tech text-[15px] font-semibold tabular-nums tracking-[0.01em]" data-share-phone>{prettyPhone(phone)}</span>
            <span className="text-[12px] text-muted">{numNote ? '' : prep.phoneSource === 'whatsapp' ? 'WhatsApp number on the profile' : 'contact number on the profile'}</span>
            <button type="button" onClick={() => { setTyped(phone); setEditing(true) }} className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-full px-2 text-[12.5px] font-medium text-primary hover:bg-primary-soft"><Pencil size={12} aria-hidden />Change</button>
          </div>}
        </div>
      </div>
      {editing && <div className="mt-3 flex flex-col gap-2" data-share-number-edit>
        {!phone && <p className="text-[13px] text-warning">{prep.storedInvalid ? `The number on the profile (${prep.storedInvalid}) is not a valid WhatsApp number.` : `No WhatsApp number is saved for ${prep.party.name}.`} Enter it with the country code.</p>}
        <Field label="WhatsApp number"><Input type="tel" inputMode="tel" autoComplete="off" value={typed} onChange={e => setTyped(e.target.value)} placeholder="+971 50 123 4567" aria-invalid={!!numErr} /></Field>
        {numErr && <p role="alert" className="text-[12.5px] text-danger">{numErr}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => applyNumber(false)} disabled={!typed.trim() || !!busy}>{busy === 'use' && <Loader2 size={13} className="animate-spin" />}Use for this share</Button>
          {prep.canSaveNumber && <Button type="button" size="sm" variant="ghost" onClick={() => applyNumber(true)} disabled={!typed.trim() || !!busy}>{busy === 'save' && <Loader2 size={13} className="animate-spin" />}Save to {first}&apos;s profile</Button>}
          {phone && <Button type="button" size="sm" variant="ghost" onClick={() => { setEditing(false); setNumErr(null) }}>Cancel</Button>}
        </div>
      </div>}
      {numNote && <p className="mt-2 text-[12.5px] text-muted" data-share-number-note>{numNote}</p>}
      {also.length > 0 && <div className="mt-3 flex items-start gap-2 rounded-lg bg-warning/[.08] px-3 py-2 text-[12.5px] text-warning ring-1 ring-inset ring-warning/20" data-share-duplicate>
        <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden /><span>This number is also saved for {also.join(', ')}. Make sure it is {prep.party.name}&apos;s own number.</span></div>}
    </section>

    {/* what */}
    <section className="flex items-center gap-3 rounded-xl border border-border/80 p-3.5" data-share-doc>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-danger/[.08] text-danger" aria-hidden><FileText size={19} /></span>
      <div className="min-w-0 flex-1"><div className="truncate text-[14px] font-semibold">{prep.docLabel}</div><div className="truncate text-[12.5px] text-muted">{prep.docDetail} · {prep.filename}</div></div>
      <a href={`${prep.pdfUrl}?view=1`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-primary hover:bg-primary-soft">Preview<ExternalLink size={13} aria-hidden /></a>
    </section>
    <iframe src={`${prep.pdfUrl}?view=1`} title={`Preview: ${prep.docLabel}`} className="hidden h-72 w-full rounded-lg border border-border bg-white sm:block" data-share-preview />

    {/* message */}
    <Field label="Message"><Textarea value={text} onChange={e => setText(e.target.value)} rows={7} maxLength={1000} className="text-[14px] leading-relaxed" data-share-message /></Field>

    {done ? <div className="flex items-start gap-2.5 rounded-xl bg-success/[.07] px-3.5 py-3 text-[13.5px] ring-1 ring-inset ring-success/20" data-share-done role="status">
      <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" aria-hidden />
      <div>{done === 'link' ? <><b className="font-semibold">WhatsApp opened for {prep.party.name}.</b> The PDF ({prep.filename}) was downloaded: attach it in the chat with the paperclip, check the message, then send.</>
        : done === 'native' ? <><b className="font-semibold">Handed to WhatsApp.</b> Make sure you picked {prep.party.name}&apos;s chat before sending.</>
        : <>PDF downloaded.</>}
        <span className="mt-1 block text-[12px] text-muted">Averiqo does not know whether the message was sent. Nothing is marked as sent or paid.</span></div></div>
      : <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted" data-share-verify><ShieldCheck size={15} className="mt-px shrink-0" aria-hidden />
        <span>WhatsApp opens on this device and nothing is sent until you press send there. Check the chat is <b className="font-medium text-fg">{prep.party.name}</b>{phone ? <> ({prettyPhone(phone)})</> : null}.
          {prep.portalLink ? ` ${first} can also open it in the Employee Portal (sign-in required).` : ''}</span></p>}

    {prep.lastShare.count > 0 && <p className="text-[12px] text-muted" data-share-history>Opened in WhatsApp {prep.lastShare.count} time{prep.lastShare.count === 1 ? '' : 's'} before{prep.lastShare.at ? `, last ${new Date(prep.lastShare.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${prep.lastShare.by ? ` by ${prep.lastShare.by}` : ''}` : ''}.</p>}

    <div className="form-actions flex flex-col-reverse gap-2 border-t border-border/80 pt-3 sm:flex-row sm:justify-end">
      <Button type="button" variant="ghost" onClick={() => { download(); log('download'); if (!done) setDone('download') }} data-share-download><Download size={15} aria-hidden />Download PDF</Button>
      {native ? <Button type="button" onClick={shareNative} disabled={!fileReady || !!busy || editing} className="h-11 bg-[#1fae57] text-white hover:bg-[#189a4c] sm:h-10" data-share-native>
        {busy === 'native' || !fileReady ? <Loader2 size={15} className="animate-spin" /> : <Share2 size={16} aria-hidden />}{fileReady ? 'Share PDF to WhatsApp' : 'Preparing PDF…'}</Button> : null}
      <Button type="button" variant={native ? 'secondary' : 'primary'} onClick={openChat} disabled={!phone || editing} className={cn('h-11 sm:h-10', !native && 'bg-[#1fae57] text-white hover:bg-[#189a4c]')} data-share-open>
        <MessageCircle size={16} aria-hidden />{native ? 'Open chat with message' : 'Download PDF & open chat'}</Button>
    </div>
  </div>
}
