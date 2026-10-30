'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { checkShareNumber, logShare, prepareShare, saveShareNumber, type SharePrep } from '@/app/actions/share'
import { logSalesEvent } from '@/app/actions/sales'
import { Modal } from '@/components/ui/dialog'
import { Alert, Button, Field, Input, Textarea } from '@/components/ui/primitives'
import { AlertTriangle, Check, CheckCircle2, Copy, Download, ExternalLink, FileText, Info, Loader2, MessageCircle, Paperclip, Pencil, RefreshCw, Share2, ShieldCheck } from '@/components/icons'
import { prettyPhone, waChatLink } from '@/lib/whatsapp/share'
import { canShareFiles, copyText, loadPdf, shareDocumentViaWhatsApp, touchDevice, withParam } from '@/lib/whatsapp/native-share'
import { cn } from '@/lib/utils'

/**
 * "Share via WhatsApp" (free, no WhatsApp Business API): shows who it goes to (name, ID and number from their profile), the
 * document and the message, then hands over to the user's own WhatsApp. Phones: the PDF file itself goes to the phone's share
 * menu (Web Share API); computers that cannot share files: the PDF downloads, the chat opens with the message and the sheet
 * says plainly that the PDF must be attached by hand. Nothing is sent by Averiqo and nothing is
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
  const [text, setText] = useState(''), [busy, setBusy] = useState<string | null>(null), [done, setDone] = useState<null | 'native' | 'link' | 'text' | 'download'>(null)
  // the PDF file for the share menu: 'checking' while it is fetched, 'ready' to share, 'unsupported' (this browser cannot share
  // files: manual attach), 'failed' (could not load a real PDF: retry or manual attach)
  const [fileState, setFileState] = useState<'checking' | 'ready' | 'unsupported' | 'failed'>('checking'), [fileErr, setFileErr] = useState<string | null>(null)
  const [touch, setTouch] = useState(false), [shareErr, setShareErr] = useState<string | null>(null), [copied, setCopied] = useState<null | 'ok' | 'manual'>(null)
  const file = useRef<File | null>(null), alive = useRef(true), msgRef = useRef<HTMLTextAreaElement>(null)

  const fetchFile = (p: SharePrep) => {
    setFileState('checking'); setFileErr(null); file.current = null
    // fetched now, so the share menu opens straight from the tap (browsers allow it only right after a tap)
    loadPdf(p.pdfUrl, p.filename).then(f => {
      if (!alive.current) return
      if (!canShareFiles(f)) { setFileState('unsupported'); return }
      file.current = f; setFileState('ready')
    }).catch((e: Error) => { if (alive.current) { setFileState('failed'); setFileErr(e.message) } })
  }
  useEffect(() => {
    alive.current = true
    prepareShare(kind, recordId).then(r => {
      if (!alive.current) return
      if (r?.error || !r?.data) { setErr(r?.error ?? 'Could not prepare this document.'); return }
      const p = r.data as SharePrep; setPrep(p); setPhone(p.phone); setText(p.message); setAlso(p.sameNumberAs); setEditing(!p.phone); setTyped(p.storedInvalid ?? '')
      setTouch(touchDevice())
      if (canShareFiles()) fetchFile(p); else setFileState('unsupported')
    }).catch(() => alive.current && setErr('Could not prepare this document.'))
    return () => { alive.current = false }
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
  /** Copies the message. Where the clipboard is blocked, selects it so it can be copied by hand. */
  const copyMessage = () => {
    copyText(text).then(() => alive.current && setCopied('ok'), () => { msgRef.current?.focus(); msgRef.current?.select(); setCopied('manual') })
  }
  const shareNative = async () => {
    const f = file.current; if (!f) return
    setShareErr(null); setBusy('native')
    const r = await shareDocumentViaWhatsApp({ file: f, message: text })   // the PDF only; the message goes on the clipboard
    setBusy(null)
    if (r === 'shared') { log('native_share'); setDone('native') }
    else if (r === 'blocked') setShareErr('The browser blocked the share menu. Tap "Share PDF" again.')
    else if (r === 'failed') setShareErr('This device could not share the PDF file. Use "Download PDF" and attach it in WhatsApp with the paperclip.')
  }
  const download = () => { const a = document.createElement('a'); a.href = prep.pdfUrl; a.download = prep.filename; document.body.appendChild(a); a.click(); a.remove() }
  const canNative = fileState === 'checking' || fileState === 'ready'
  const phoneFlow = canNative && touch                       // phones and tablets: the PDF goes through the share menu
  /** Phones: opens the chat with the message only (the PDF goes through "Share PDF"). Computers: downloads the PDF to attach by hand, then opens the chat. */
  const openChat = () => {
    if (!phone) return
    if (!phoneFlow) download()
    window.open(waChatLink(phone, text), '_blank', 'noopener,noreferrer')
    log('whatsapp_link'); setDone(phoneFlow ? (done === 'native' ? 'native' : 'text') : 'link')
  }
  const first = prep.party.name.split(' ')[0]
  const who = <b className="font-medium text-fg">{prep.party.name}</b>

  return <div className="flex flex-col gap-4" data-share-sheet data-share-kind={prep.kind} data-share-mode={phoneFlow ? 'phone' : 'manual'} data-share-file={fileState}>
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
      <a href={withParam(prep.pdfUrl, 'view=1')} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-primary hover:bg-primary-soft">Preview<ExternalLink size={13} aria-hidden /></a>
    </section>
    <iframe src={withParam(prep.pdfUrl, 'view=1')} title={`Preview: ${prep.docLabel}`} className="hidden h-72 w-full rounded-lg border border-border bg-white sm:block" data-share-preview />

    {/* message */}
    <div className="flex flex-col gap-1.5">
      <Field label="Message"><Textarea ref={msgRef} value={text} onChange={e => { setText(e.target.value); setCopied(null) }} rows={7} maxLength={1000} className="text-[14px] leading-relaxed" data-share-message /></Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={copyMessage} data-share-copy>{copied === 'ok' ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}{copied === 'ok' ? 'Message copied' : 'Copy message'}</Button>
        {copied === 'manual' && <span className="text-[12px] text-muted" role="status">Copying is blocked here: the message is selected, copy it with your keyboard or long-press.</span>}
      </div>
    </div>

    {/* how the PDF reaches WhatsApp on this device (said before anything is tapped, never claimed when it cannot happen) */}
    {!done && <div className="flex items-start gap-2.5 rounded-xl bg-surface-2/70 px-3.5 py-3 text-[13px] leading-relaxed ring-1 ring-inset ring-border/70" data-share-how>
      {phoneFlow ? <><Share2 size={16} className="mt-0.5 shrink-0 text-[#128c46] dark:text-[#5fd68f]" aria-hidden />
        <span><b className="font-semibold">The PDF goes into WhatsApp as a file.</b> Tap &quot;Share PDF to WhatsApp&quot;, choose WhatsApp, then {who}&apos;s chat. The message is copied for you: paste it as the caption, because some phones do not carry text along with a file.</span></>
        : <><Paperclip size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
        <span><b className="font-semibold">This browser cannot attach the PDF to WhatsApp automatically.</b> &quot;Download PDF &amp; open chat&quot; saves {prep.filename} and opens {who}&apos;s chat with the message. In WhatsApp, click the paperclip, choose Document, pick the downloaded PDF, then send.
          {fileState === 'ready' ? ' Or use "Share PDF…" to send the file through an app on this computer.' : ''}</span></>}
    </div>}
    {fileState === 'failed' && <div className="flex flex-wrap items-center gap-2 rounded-xl bg-warning/[.08] px-3.5 py-2.5 text-[12.5px] text-warning ring-1 ring-inset ring-warning/20" data-share-file-error role="alert">
      <AlertTriangle size={14} className="shrink-0" aria-hidden /><span className="min-w-0 flex-1">The PDF could not be prepared for the share menu: {fileErr} Download it and attach it by hand, or try again.</span>
      <Button type="button" size="sm" variant="secondary" onClick={() => fetchFile(prep)} data-share-retry><RefreshCw size={13} aria-hidden />Try again</Button></div>}
    {shareErr && <Alert tone="amber">{shareErr}</Alert>}

    {done ? <div className="flex items-start gap-2.5 rounded-xl bg-success/[.07] px-3.5 py-3 text-[13.5px] ring-1 ring-inset ring-success/20" data-share-done role="status">
      <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" aria-hidden />
      <div>{done === 'native' ? <><b className="font-semibold">The PDF was passed to the share menu.</b> If you chose WhatsApp, the file is in the chat you picked: make sure it is {prep.party.name}&apos;s, paste the message as the caption (it is copied), then press send.</>
        : done === 'link' ? <><b className="font-semibold">WhatsApp opened for {prep.party.name} with the message.</b> The PDF is not attached yet: {prep.filename} was downloaded. Attach it in the chat with the paperclip (Document), check the message, then send.</>
        : done === 'text' ? <><b className="font-semibold">WhatsApp opened for {prep.party.name} with the message only.</b> The PDF is not attached: tap &quot;Share PDF to WhatsApp&quot; to send the file.</>
        : <>PDF downloaded ({prep.filename}).</>}
        <span className="mt-1 block text-[12px] text-muted">Averiqo does not know whether the message was sent. Nothing is marked as sent or paid.</span></div></div>
      : <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted" data-share-verify><ShieldCheck size={15} className="mt-px shrink-0" aria-hidden />
        <span>WhatsApp opens on this device and nothing is sent until you press send there. Check the chat is <b className="font-medium text-fg">{prep.party.name}</b>{phone ? <> ({prettyPhone(phone)})</> : null}.
          {prep.portalLink ? ` ${first} can also open it in the Employee Portal (sign-in required).` : ''}</span></p>}

    {prep.lastShare.count > 0 && <p className="text-[12px] text-muted" data-share-history>Opened in WhatsApp {prep.lastShare.count} time{prep.lastShare.count === 1 ? '' : 's'} before{prep.lastShare.at ? `, last ${new Date(prep.lastShare.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${prep.lastShare.by ? ` by ${prep.lastShare.by}` : ''}` : ''}.</p>}

    <div className="form-actions flex flex-col-reverse gap-2 border-t border-border/80 pt-3 sm:flex-row sm:justify-end">
      <Button type="button" variant="ghost" onClick={() => { download(); log('download'); if (!done) setDone('download') }} data-share-download><Download size={15} aria-hidden />Download PDF</Button>
      {canNative && <Button type="button" variant={phoneFlow ? 'primary' : 'secondary'} onClick={shareNative} disabled={fileState !== 'ready' || !!busy || editing}
        className={cn('h-11 sm:h-10', phoneFlow && 'bg-[#1fae57] text-white hover:bg-[#189a4c]')} data-share-native>
        {busy === 'native' || fileState === 'checking' ? <Loader2 size={15} className="animate-spin" /> : <Share2 size={16} aria-hidden />}{fileState === 'checking' ? 'Preparing PDF…' : phoneFlow ? 'Share PDF to WhatsApp' : 'Share PDF…'}</Button>}
      <Button type="button" variant={phoneFlow ? 'secondary' : 'primary'} onClick={openChat} disabled={!phone || editing} className={cn('h-11 sm:h-10', !phoneFlow && 'bg-[#1fae57] text-white hover:bg-[#189a4c]')} data-share-open>
        <MessageCircle size={16} aria-hidden />{phoneFlow ? 'Open chat with message (text only)' : 'Download PDF & open chat'}</Button>
    </div>
    {phoneFlow && <p className="-mt-2 flex items-start gap-1.5 text-[12px] text-muted"><Info size={13} className="mt-px shrink-0" aria-hidden />A chat link can only carry text. To send the message as its own text after the PDF, use &quot;Open chat with message&quot;.</p>}
  </div>
}
