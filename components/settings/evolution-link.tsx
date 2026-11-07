'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, QrCode, RefreshCw, Smartphone } from '@/components/icons'
import { Alert, Button } from '@/components/ui/primitives'
import { evolutionLinkState, linkEvolution, unlinkEvolution } from '@/app/actions/evolution'
import type { ActionState } from '@/lib/utils'

type Phase = { kind: 'idle' } | { kind: 'loading' } | { kind: 'qr'; qr: string | null; pairingCode: string | null } | { kind: 'open' } | { kind: 'error'; message: string }

/**
 * Link a WhatsApp number to the Evolution API instance: shows the QR code from the server, checks every 3 seconds whether
 * the phone scanned it, and asks for a fresh code every 40 seconds (WhatsApp codes expire quickly).
 */
export function EvolutionLink({ configured, initialState }: { configured: boolean; initialState: string | null }) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>(initialState === 'open' ? { kind: 'open' } : { kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const timers = useRef<number[]>([])
  const stop = () => { timers.current.forEach(t => window.clearInterval(t)); timers.current = [] }
  useEffect(() => stop, [])

  const start = async () => {
    stop(); setPhase({ kind: 'loading' })
    const r: ActionState = await linkEvolution().catch(() => ({ error: 'Could not reach the server.' }))
    if (r?.error || !r?.data) { setPhase({ kind: 'error', message: r?.error ?? 'Could not start linking.' }); return }
    if (r.data.state === 'open') { setPhase({ kind: 'open' }); router.refresh(); return }
    setPhase({ kind: 'qr', qr: r.data.qr, pairingCode: r.data.pairingCode })
    let hasQr = !!r.data.qr, polls = 0
    const refreshQr = async () => {
      const q = await linkEvolution().catch(() => null)
      if (q?.data?.state === 'open') { stop(); setPhase({ kind: 'open' }); router.refresh() }
      else if (q?.data?.qr) { hasQr = true; setPhase({ kind: 'qr', qr: q.data.qr, pairingCode: q.data.pairingCode }) }
    }
    timers.current.push(window.setInterval(async () => {
      polls++
      const s = await evolutionLinkState().catch(() => null)
      if (s?.data?.state === 'open') { stop(); setPhase({ kind: 'open' }); router.refresh(); return }
      // the server can take a few seconds to receive the first code from WhatsApp: keep asking until it shows
      if (!hasQr && polls % 2 === 0) await refreshQr()
      if (!hasQr && polls >= 40) { stop(); setPhase({ kind: 'error', message: 'The server did not get a QR code from WhatsApp. Check that the server has internet access, then try again.' }) }
    }, 3000))
    timers.current.push(window.setInterval(refreshQr, 40000))
  }
  const unlink = async () => {
    if (!window.confirm('Unlink this WhatsApp number? Averiqo stops sending until a number is linked again.')) return
    setBusy(true); const r: ActionState = await unlinkEvolution().catch(() => ({ error: 'Could not reach the server.' })); setBusy(false)
    if (r?.error) { setPhase({ kind: 'error', message: r.error }); return }
    stop(); setPhase({ kind: 'idle' }); router.refresh()
  }

  if (!configured) return <p className="text-sm text-muted">Save the server URL, instance name and API key first, then link the phone here.</p>
  return <div className="space-y-3" data-evo-link data-evo-phase={phase.kind}>
    {phase.kind === 'open' && <div className="flex flex-wrap items-center gap-3">
      <span className="inline-flex items-center gap-2 text-sm font-medium text-success"><CheckCircle2 size={16} weight="fill" />WhatsApp is linked</span>
      <Button type="button" variant="ghost" size="sm" onClick={unlink} disabled={busy}>{busy && <Loader2 size={13} className="animate-spin" />}Unlink number</Button>
    </div>}
    {(phase.kind === 'idle' || phase.kind === 'error') && <Button type="button" size="sm" onClick={start}><QrCode size={14} />Link WhatsApp</Button>}
    {phase.kind === 'error' && <Alert tone="red">{phase.message}</Alert>}
    {phase.kind === 'loading' && <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" />Asking the server for a QR code…</p>}
    {phase.kind === 'qr' && <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="grid h-60 w-60 shrink-0 place-items-center rounded-lg border border-border bg-white p-2">
        {phase.qr ? <img src={phase.qr} alt="WhatsApp link QR code" width={224} height={224} data-evo-qr /> : <Loader2 size={20} className="animate-spin text-[#555]" />}
      </div>
      <div className="space-y-3 text-sm text-muted">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>Open <b className="text-fg">WhatsApp</b> on the company phone.</li>
          <li>Tap <b className="text-fg">Settings → Linked devices → Link a device</b>.</li>
          <li>Point the phone at this code.</li>
          {phase.pairingCode && <li>Or use “Link with phone number instead” and enter <b className="font-mono text-fg">{phase.pairingCode}</b>.</li>}
        </ol>
        <p className="flex items-center gap-2" role="status"><Loader2 size={13} className="shrink-0 animate-spin" />Waiting for the phone… the code refreshes by itself.</p>
        <Button type="button" variant="ghost" size="sm" onClick={start}><RefreshCw size={13} />New code</Button>
      </div>
    </div>}
    <p className="flex items-start gap-2 text-xs text-muted"><Smartphone size={14} className="mt-0.5 shrink-0" />Keep the phone charged and online with internet. If it is logged out of WhatsApp, link it again here.</p>
  </div>
}
