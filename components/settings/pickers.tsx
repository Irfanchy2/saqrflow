import Link from 'next/link'

export type RecipientOpt = { id: string; name: string; email: string | null; whatsapp_number: string | null; whatsapp_opt_in: string; user_id: string | null; is_active: boolean }
export const CHANNEL_LABEL: Record<string, string> = { in_app: 'In-app (bell)', email: 'Email', whatsapp: 'WhatsApp' }

/** Checkbox list of reminder recipients (managed under Reminders → Recipients), with what each can receive. */
export function RecipientPicker({ recipients, selected = [] }: { recipients: RecipientOpt[]; selected?: string[] }) {
  const active = recipients.filter(r => r.is_active)
  if (!active.length) return <p className="text-sm text-muted">No recipients yet. Add people under <Link href="/reminders?tab=recipients" className="text-primary hover:underline">Reminders → Recipients</Link> first.</p>
  return <fieldset><legend className="mb-1.5 text-sm font-medium">Send to *</legend>
    <div className="grid gap-1.5 sm:grid-cols-2">{active.map(r => {
      const can = [r.user_id && 'in-app', r.email && 'email', r.whatsapp_number && r.whatsapp_opt_in === 'opted_in' && 'WhatsApp'].filter(Boolean).join(', ')
      return <label key={r.id} className="flex min-w-0 items-start gap-2 rounded-md border border-border px-2.5 py-2 text-sm hover:bg-surface-2">
        <input type="checkbox" name="recipients" value={r.id} defaultChecked={selected.includes(r.id)} className="mt-0.5" />
        <span className="min-w-0"><span className="block truncate">{r.name}</span><span className="block text-xs text-muted">{can || 'no channel set up'}</span></span></label>
    })}</div></fieldset>
}

export function ChannelPicker({ selected = ['in_app'] }: { selected?: string[] }) {
  return <fieldset><legend className="mb-1.5 text-sm font-medium">Channels *</legend>
    <div className="flex flex-wrap gap-x-5 gap-y-2">{Object.entries(CHANNEL_LABEL).map(([k, l]) =>
      <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name="channels" value={k} defaultChecked={selected.includes(k)} />{l}</label>)}</div>
    <p className="mt-1 text-xs text-muted">Each person only gets the channels they can receive. WhatsApp needs their opt-in and an approved Meta template.</p></fieldset>
}

export async function loadRecipients(sb: any): Promise<RecipientOpt[]> {
  const { data } = await sb.from('notification_recipients').select('id,name,email,whatsapp_number,whatsapp_opt_in,user_id,is_active').order('name')
  return (data ?? []) as RecipientOpt[]
}
