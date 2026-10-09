import { CalendarClock } from 'lucide-react'
import type { Ctx } from '@/lib/auth'
import { Badge, Card, CardHeader, Field, Input, Select } from '@/components/ui/primitives'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { DialogButton } from '@/components/ui/dialog'
import { deleteSchedule, saveReportSchedule, sendReportNow, setScheduleEnabled } from '@/app/actions/platform'
import { SECTIONS, WEEKDAYS, describeSchedule } from '@/lib/report-periods'
import { CHANNEL_LABEL, ChannelPicker, RecipientPicker, loadRecipients, type RecipientOpt } from './pickers'

function ScheduleFields({ s, recipients }: { s?: any; recipients: RecipientOpt[] }) {
  return <>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Report name *" className="sm:col-span-2"><Input name="name" required maxLength={120} defaultValue={s?.name} placeholder="Weekly business summary" /></Field>
      <Field label="How often *"><Select name="frequency" defaultValue={s?.frequency ?? 'weekly'}><option value="weekly">Weekly</option><option value="monthly">Monthly</option></Select></Field>
      <Field label="Weekly: send on" hint="covers the previous 7 days"><Select name="weekday" defaultValue={String(s?.weekday ?? 1)}>{WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</Select></Field>
      <Field label="Monthly: send on day" hint="1–28; covers the previous month"><Input name="month_day" type="number" min="1" max="28" defaultValue={s?.month_day ?? 1} /></Field>
    </div>
    <fieldset><legend className="mb-1.5 text-sm font-medium">Include *</legend>
      <div className="grid gap-1.5 sm:grid-cols-2">{Object.entries(SECTIONS).map(([k, l]) =>
        <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name="sections" value={k} defaultChecked={s ? s.sections.includes(k) : ['sales', 'collections', 'receivables'].includes(k)} />{l}</label>)}</div></fieldset>
    <ChannelPicker selected={s?.channels ?? ['email']} />
    <RecipientPicker recipients={recipients} selected={s?.recipient_ids} />
  </>
}

/** Settings → Scheduled reports: weekly / monthly summaries by email, WhatsApp or in-app. */
export async function ScheduledReports({ c }: { c: Ctx }) {
  const [{ data: rows }, recipients] = await Promise.all([c.supabase.from('report_schedules').select('*').order('created_at'), loadRecipients(c.supabase)])
  const name = new Map(recipients.map(r => [r.id, r.name]))
  return <Card id="schedules"><CardHeader title="Scheduled reports" sub="Weekly or monthly summaries of sales, collections, expenses, receivables, leads and service, sent with the morning run (about 8:00)."
    action={<DialogButton wide size="sm" variant="secondary" label="Schedule a report" title="Schedule a report" icon={<CalendarClock size={14} />}>
      <ActionForm action={saveReportSchedule.bind(null, null)} submit="Save schedule"><ScheduleFields recipients={recipients} /></ActionForm></DialogButton>} />
    <div className="p-4">{!(rows ?? []).length ? <p className="text-sm text-muted">No reports scheduled. Example: every Monday, email the owner and accountant last week’s sales, collections and receivables.</p> :
      <ul className="divide-y divide-border rounded-md border border-border text-sm">{(rows ?? []).map((s: any) => <li key={s.id} className="space-y-1.5 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 font-medium">{s.name}</span><Badge tone={s.enabled ? 'green' : 'neutral'}>{s.enabled ? 'On' : 'Off'}</Badge>
          <ActionButton variant="ghost" action={sendReportNow.bind(null, s.id)}>Send now</ActionButton>
          <DialogButton wide size="sm" variant="ghost" label="Edit" title={`Edit: ${s.name}`}><ActionForm action={saveReportSchedule.bind(null, s.id)} submit="Save schedule" resetOnSuccess={false}><ScheduleFields s={s} recipients={recipients} /></ActionForm></DialogButton>
          <ActionButton variant="ghost" action={setScheduleEnabled.bind(null, s.id, !s.enabled)}>{s.enabled ? 'Pause' : 'Resume'}</ActionButton>
          <ActionButton variant="ghost" action={deleteSchedule.bind(null, s.id)} confirm="Remove this schedule?">Remove</ActionButton></div>
        <p className="text-muted">{describeSchedule(s)} · {s.sections.map((x: string) => SECTIONS[x as keyof typeof SECTIONS]?.split(' (')[0]).join(', ')}</p>
        <p className="text-xs text-muted">{s.channels.map((ch: string) => CHANNEL_LABEL[ch]).join(', ')} to {s.recipient_ids.map((id: string) => name.get(id) ?? 'a removed recipient').join(', ')} · {s.last_sent_at ? `last sent ${new Date(s.last_sent_at).toLocaleString('en-GB', { timeZone: c.company.timezone, dateStyle: 'medium', timeStyle: 'short' })}` : 'not sent yet'}</p>
      </li>)}</ul>}
      <p className="mt-3 text-xs text-muted">WhatsApp carries the headline figures (template <code>saqrflow_scheduled_report</code>); email and in-app carry the full report. Delivery is listed under Reminders → Delivery log.</p></div></Card>
}
