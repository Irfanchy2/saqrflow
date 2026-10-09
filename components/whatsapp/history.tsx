import Link from 'next/link'
import { MessageCircle, Paperclip } from 'lucide-react'
import type { Ctx } from '@/lib/auth'
import { Badge, Card, CardHeader } from '@/components/ui/primitives'
import { KINDS, maskPhone } from '@/lib/whatsapp/messages'

const TONE: Record<string, 'green' | 'blue' | 'amber' | 'red' | 'neutral'> = { read: 'green', delivered: 'green', sent: 'blue', sandbox: 'amber', queued: 'neutral', sending: 'neutral', retry: 'amber', failed: 'red', skipped: 'neutral' }
const LABEL: Record<string, string> = { read: 'Read', delivered: 'Delivered', sent: 'Sent', sandbox: 'Sandbox (not sent)', queued: 'Queued', sending: 'Sending', retry: 'Retrying', failed: 'Failed', skipped: 'Skipped' }

/** WhatsApp messages sent to this customer / supplier / employee, with delivery status (from WhatsApp's receipts). */
export async function WhatsAppHistory({ c, partyType, partyId, action }: { c: Ctx; partyType: 'customer' | 'supplier' | 'employee'; partyId: string; action?: React.ReactNode }) {
  const { data } = await c.supabase.from('notification_logs').select('id,kind,status,to_number,created_at,sent_at,delivered_at,last_error,attachment_name,body_text,params,freeform')
    .eq('party_type', partyType).eq('party_id', partyId).order('created_at', { ascending: false }).limit(30)
  const fmt = (d: string) => new Date(d).toLocaleString('en-GB', { timeZone: c.company.timezone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  return <Card data-wa-history><CardHeader title="WhatsApp" sub="Documents and messages sent from Averiqo, with delivery status" action={action ?? <MessageCircle size={15} className="text-muted" aria-hidden />} />
    {!(data ?? []).length ? <p className="px-4 py-4 text-sm text-muted">Nothing sent by WhatsApp yet.</p> :
      <ul className="divide-y divide-border text-sm">{(data ?? []).map((m: any) => <li key={m.id} className="space-y-1 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 font-medium">{KINDS[m.kind]?.label ?? m.kind}{m.freeform ? ' (custom message)' : ''}</span><Badge tone={TONE[m.status]}>{LABEL[m.status] ?? m.status}</Badge></div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted"><span>{fmt(m.created_at)}</span><span>to {maskPhone(m.to_number)}</span>
          {m.delivered_at && <span>delivered {fmt(m.delivered_at)}</span>}{m.attachment_name && <span className="inline-flex items-center gap-1"><Paperclip size={11} aria-hidden />{m.attachment_name}</span>}
          {m.params?._link && <Link href={m.params._link} className="text-primary hover:underline">open record</Link>}</div>
        {m.last_error && m.status !== 'sent' && <p className="text-xs text-danger">{m.last_error}</p>}
        {m.body_text && <details className="text-xs"><summary className="cursor-pointer text-muted">Message</summary><p className="mt-1 whitespace-pre-line break-words">{m.body_text}</p></details>}
      </li>)}</ul>}</Card>
}
