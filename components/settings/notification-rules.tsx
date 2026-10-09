import { BellPlus } from 'lucide-react'
import type { Ctx } from '@/lib/auth'
import { Badge, Card, CardHeader, Field, Input, Select } from '@/components/ui/primitives'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { DialogButton } from '@/components/ui/dialog'
import { deleteRule, saveNotificationRule, setRuleEnabled } from '@/app/actions/platform'
import { EVENTS, eventGroups } from '@/lib/events'
import { formatAed } from '@/lib/time'
import { CHANNEL_LABEL, ChannelPicker, RecipientPicker, loadRecipients, type RecipientOpt } from './pickers'

function RuleFields({ r, recipients }: { r?: any; recipients: RecipientOpt[] }) {
  return <>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Rule name *"><Input name="name" required maxLength={120} defaultValue={r?.name} placeholder="Big quotation accepted" /></Field>
      <Field label="When *"><Select name="event" required defaultValue={r?.event ?? ''}><option value="" disabled>Choose an event…</option>
        {eventGroups().map(([g, list]) => <optgroup key={g} label={g}>{list.map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}</optgroup>)}</Select></Field>
      <Field label="Only if the amount is at least (AED)" hint="optional; for events with an amount"><Input name="min_amount" type="number" min="0" step="0.01" defaultValue={r?.min_amount ?? ''} placeholder="e.g. 50000" /></Field>
    </div>
    <ChannelPicker selected={r?.channels} />
    <RecipientPicker recipients={recipients} selected={r?.recipient_ids} />
  </>
}

/** Settings → Notification rules: "when X happens (and amount ≥ N), tell these people on these channels". */
export async function NotificationRules({ c }: { c: Ctx }) {
  const [{ data: rules }, recipients] = await Promise.all([c.supabase.from('notification_rules').select('*').order('created_at'), loadRecipients(c.supabase)])
  const name = new Map(recipients.map(r => [r.id, r.name]))
  return <Card id="rules"><CardHeader title="Notification rules" sub="Your own alerts on top of the standard reminders: pick an event, an optional minimum amount, who is told and how."
    action={<DialogButton wide size="sm" variant="secondary" label="New rule" title="New notification rule" icon={<BellPlus size={14} />}>
      <ActionForm action={saveNotificationRule.bind(null, null)} submit="Create rule"><RuleFields recipients={recipients} /></ActionForm></DialogButton>} />
    <div className="p-4">{!(rules ?? []).length ? <p className="text-sm text-muted">No rules yet. Example: when a quotation over AED 50,000 is accepted, WhatsApp the owner and email the accountant.</p> :
      <ul className="divide-y divide-border rounded-md border border-border text-sm">{(rules ?? []).map((r: any) => <li key={r.id} className="space-y-1.5 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 font-medium">{r.name}</span><Badge tone={r.enabled ? 'green' : 'neutral'}>{r.enabled ? 'On' : 'Off'}</Badge>
          <DialogButton wide size="sm" variant="ghost" label="Edit" title={`Edit rule: ${r.name}`}><ActionForm action={saveNotificationRule.bind(null, r.id)} submit="Save rule" resetOnSuccess={false}><RuleFields r={r} recipients={recipients} /></ActionForm></DialogButton>
          <ActionButton variant="ghost" action={setRuleEnabled.bind(null, r.id, !r.enabled)}>{r.enabled ? 'Switch off' : 'Switch on'}</ActionButton>
          <ActionButton variant="ghost" action={deleteRule.bind(null, r.id)} confirm="Remove this rule?">Remove</ActionButton></div>
        <p className="text-muted">When <b className="font-medium text-fg">{EVENTS[r.event]?.label ?? r.event}</b>{r.min_amount !== null && <> and the amount is at least <b className="font-medium text-fg">{formatAed(r.min_amount)}</b></>} → {r.channels.map((ch: string) => CHANNEL_LABEL[ch]).join(', ')} to {r.recipient_ids.map((id: string) => name.get(id) ?? 'a removed recipient').join(', ')}</p>
        <p className="text-xs text-muted">{r.fire_count ? `Triggered ${r.fire_count} time(s), last ${new Date(r.last_fired_at).toLocaleString('en-GB', { timeZone: c.company.timezone, dateStyle: 'medium', timeStyle: 'short' })}` : 'Not triggered yet'}</p>
      </li>)}</ul>}
      <p className="mt-3 text-xs text-muted">Alerts go out within seconds of the change (in-app and email; WhatsApp needs the approved <code>saqrflow_event_alert</code> template). Every message is listed under Reminders → Delivery log.</p></div></Card>
}
