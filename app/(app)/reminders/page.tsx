import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BellRing, Play, Plus, Send, UserPlus } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { flat } from '@/lib/queries'
import { Alert, Badge, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Td, Th, TableWrap, Textarea, type Tone } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { createReminder, toggleReminder, addRecipient, setOptIn, setRecipientActive, sendTest, runNow, retryLog } from '@/app/actions/reminders'
import { whatsappStatus } from '@/lib/reminders/mode'
import { parseSettings } from '@/lib/reminders/settings'
import { nextOccurrence, nextTriggerDate } from '@/lib/reminders/schedule'
import { formatAed, formatLongDate } from '@/lib/time'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Smart Reminders' }
const TABS = [['upcoming', 'Upcoming'], ['custom', 'Custom reminders'], ['recipients', 'Recipients'], ['log', 'Delivery log']] as const
const STATUS_TONE: Record<string, Tone> = { queued: 'neutral', sending: 'blue', retry: 'amber', sent: 'blue', delivered: 'green', read: 'green', failed: 'red', skipped: 'neutral', sandbox: 'amber' }

export default async function Reminders({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('reminders.create')) redirect('/'); const sp = await flat(searchParams)
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'upcoming'
  const wa = await whatsappStatus(c.company.id)
  const admin = c.can('settings.manage')

  return <>
    <PageHeader title="Smart Reminders" sub="Automatic WhatsApp, email and in-app reminders for expiries, cheques and custom events."
      actions={admin ? <ActionButton action={runNow} variant="secondary" size="md"><Play size={14} />Run reminder check now</ActionButton> : undefined} />
    <div className="mb-5"><Alert tone={wa.mode === 'live' ? 'green' : 'amber'}><b>{wa.mode === 'live' ? 'WhatsApp: LIVE' : 'WhatsApp: SANDBOX'}</b> — {wa.reason}
      {wa.mode === 'sandbox' && ' Messages are recorded in the log but never sent, and are never reported as delivered.'}
      {' '}Email: <b>{wa.emailLive ? 'live' : 'sandbox'}</b>. The scheduler runs automatically (see README → Scheduler); you do not need to open this page.</Alert></div>
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border">{TABS.map(([k, l]) => <Link key={k} href={`/reminders?tab=${k}`} className={cn('-mb-px border-b-2 px-4 py-2 text-sm', tab === k ? 'border-primary font-medium text-primary' : 'border-transparent text-muted hover:text-fg')}>{l}</Link>)}</div>
    {tab === 'upcoming' && <Upcoming c={c} />}{tab === 'custom' && <Custom c={c} />}{tab === 'recipients' && <Recipients c={c} wa={wa.mode} />}{tab === 'log' && <Log c={c} sp={sp} />}</>
}
type C = Awaited<ReturnType<typeof getCtx>>

async function Upcoming({ c }: { c: C }) {
  const [{ data: st }, { data: src }] = await Promise.all([c.supabase.from('app_settings').select('key,value'), c.supabase.from('reminder_sources').select('*').order('due_date').limit(300)])
  const s = parseSettings(st ?? [])
  const rows = (src ?? []).map((r: any) => ({ ...r, occ: nextOccurrence(r.due_date, c.today, { ...s, offsets: r.offsets ?? s.offsets }), next: nextTriggerDate(r.due_date, c.today, r.offsets ?? s.offsets) })).filter(r => r.occ || r.next)
  return <Card><CardHeader title="Reminder schedule" sub={`Default timing: ${s.offsets!.join(' / ')} days before; overdue every ${s.overdueEveryDays} days (max ${s.overdueMax}). Change in Settings.`} />
    {!rows.length ? <EmptyState icon={BellRing} title="Nothing scheduled" body="Add documents with expiry dates, cheques, or custom reminders and they appear here." /> :
      <TableWrap><thead className="border-b border-border"><tr><Th>Item</Th><Th>Type</Th><Th>Due</Th><Th>Current stage</Th><Th>Next reminder on</Th></tr></thead><tbody className="divide-y divide-border">
        {rows.map((r: any) => <tr key={`${r.source_type}${r.source_id}`} className="hover:bg-surface-2/50"><Td><Link href={r.link} className="font-medium hover:text-primary">{r.title}</Link>{r.subject && <div className="text-xs text-muted">{r.subject}</div>}{r.amount != null && <div className="text-xs text-muted">{formatAed(r.amount)}</div>}</Td>
          <Td><Badge>{r.source_type}</Badge></Td><Td className="tabular-nums">{formatLongDate(r.due_date)}</Td>
          <Td>{r.occ ? <Badge tone={r.occ.kind === 'overdue' ? 'red' : r.occ.kind === 'due' ? 'amber' : 'blue'}>{r.occ.kind === 'overdue' ? `overdue #${r.occ.key.split(':')[1]}` : `${r.occ.offset}-day mark reached`}</Badge> : <span className="text-muted">before first reminder</span>}</Td>
          <Td className="tabular-nums text-muted">{r.next ? formatLongDate(r.next) : '—'}</Td></tr>)}</tbody></TableWrap>}</Card>
}

async function Custom({ c }: { c: C }) {
  const { data } = await c.supabase.from('reminders').select('*').order('due_date')
  return <Card><CardHeader title="Custom reminders & recurring tasks" action={<DialogButton size="sm" label="New reminder" icon={<Plus size={14} />} title="New custom reminder">
    <ActionForm action={createReminder} submit="Create reminder"><Field label="What should we remind you about? *"><Input name="title" required maxLength={200} placeholder="e.g. Machinery service – plasma cutter" /></Field>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Due date *"><Input type="date" name="due_date" required /></Field><Field label="Repeats"><Select name="recurrence"><option value="none">Does not repeat</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></Select></Field></div>
      <Field label="Remind me … days before" hint="Comma-separated. Blank = company default (90, 60, 30, 15, 7, 3, 1, 0)."><Input name="offsets" placeholder="30, 7, 1, 0" /></Field><Field label="Notes"><Textarea name="notes" /></Field></ActionForm></DialogButton>} />
    {!data?.length ? <EmptyState icon={BellRing} title="No custom reminders" body="Use these for contract renewals, machinery maintenance, project milestones or anything else with a date." /> :
      <TableWrap><thead className="border-b border-border"><tr><Th>Title</Th><Th>Due</Th><Th>Repeats</Th><Th>Days before</Th><Th /></tr></thead><tbody className="divide-y divide-border">
        {data.map(r => <tr key={r.id} className={!r.enabled ? 'opacity-50' : ''}><Td><div className="font-medium">{r.title}</div><div className="text-xs text-muted">{r.notes}</div></Td><Td className="tabular-nums">{r.due_date}</Td><Td className="capitalize text-muted">{r.recurrence}</Td><Td className="text-muted">{r.offsets?.join(', ') ?? 'default'}</Td>
          <Td><ActionButton action={toggleReminder.bind(null, r.id, !r.enabled)} variant="ghost">{r.enabled ? 'Pause' : 'Resume'}</ActionButton></Td></tr>)}</tbody></TableWrap>}</Card>
}

async function Recipients({ c, wa }: { c: C; wa: 'live' | 'sandbox' }) {
  const [{ data }, { data: people }] = await Promise.all([c.supabase.from('notification_recipients').select('*').order('created_at'), c.supabase.from('profiles').select('id,full_name').eq('is_active', true).order('full_name')])
  const admin = c.can('settings.manage')
  const optTone: Record<string, Tone> = { opted_in: 'green', pending: 'amber', opted_out: 'red' }
  return <Card><CardHeader title="Who receives reminders" sub="WhatsApp is only used for recipients who have opted in. Replying STOP opts out automatically." action={admin ? <DialogButton wide size="sm" label="Add recipient" icon={<UserPlus size={14} />} title="Add notification recipient">
    <ActionForm action={addRecipient} submit="Add recipient"><div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name *"><Input name="name" required /></Field><Field label="Linked user"><Select name="user_id" defaultValue=""><option value="">— none —</option>{people?.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</Select></Field>
      <Field label="WhatsApp number" hint="UAE numbers like 050 123 4567 are converted automatically."><Input name="whatsapp_number" inputMode="tel" /></Field><Field label="Email"><Input name="email" type="email" /></Field>
      <Field label="Quiet hours from"><Input type="time" name="quiet_start" /></Field><Field label="Quiet hours until"><Input type="time" name="quiet_end" /></Field></div>
      <fieldset className="grid gap-2 text-sm sm:grid-cols-3"><legend className="mb-1 font-medium">Channels</legend>
        {[['in_app', 'In-app', true], ['whatsapp', 'WhatsApp', false], ['email', 'Email', false]].map(([k, l, d]) => <label key={k as string} className="flex items-center gap-2"><input type="checkbox" name={`ch_${k}`} defaultChecked={d as boolean} />{l as string}</label>)}</fieldset>
      <fieldset className="grid gap-2 text-sm sm:grid-cols-3"><legend className="mb-1 font-medium">Receive</legend>
        <label className="flex items-center gap-2"><input type="checkbox" name="hr_alerts" defaultChecked />Employee &amp; HR alerts</label><label className="flex items-center gap-2"><input type="checkbox" name="cheque_alerts" defaultChecked />Cheque &amp; payment alerts</label><label className="flex items-center gap-2"><input type="checkbox" name="digest" />Daily summary</label></fieldset></ActionForm></DialogButton> : undefined} />
    {!data?.length ? <EmptyState title="No recipients" body="Add yourself and your managers." /> :
      <TableWrap><thead className="border-b border-border"><tr><Th>Recipient</Th><Th>Channels</Th><Th>WhatsApp consent</Th><Th>Quiet hours</Th><Th>Test</Th>{admin && <Th />}</tr></thead><tbody className="divide-y divide-border">
        {data.map(r => <tr key={r.id} className={!r.is_active ? 'opacity-50' : ''}><Td><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{r.whatsapp_number ?? r.email ?? '—'}{r.receives_digest && ' · daily summary'}</div></Td>
          <Td><div className="flex flex-wrap gap-1">{r.channels.map((x: string) => <Badge key={x}>{x.replace('_', '-')}</Badge>)}</div></Td>
          <Td>{r.whatsapp_number ? <Badge tone={optTone[r.whatsapp_opt_in]}>{r.whatsapp_opt_in.replace('_', '-')}</Badge> : <span className="text-muted">—</span>}
            {admin && r.whatsapp_number && (r.whatsapp_opt_in !== 'opted_in' ? <DialogButton size="sm" variant="ghost" label="Record opt-in" title={`Record WhatsApp opt-in – ${r.name}`}>
              <ActionForm action={setOptIn.bind(null, r.id, 'opted_in')} submit="Record opt-in"><label className="flex items-start gap-2 text-sm"><input type="checkbox" name="consent" className="mt-0.5" />I confirm {r.name} agreed to receive WhatsApp messages from this business (e.g. verbally, in writing, or by replying START).</label></ActionForm></DialogButton>
              : <ActionForm action={setOptIn.bind(null, r.id, 'opted_out')} hideSubmit={false} submit="Mark opted out" variant="secondary" className="mt-1"><span /></ActionForm>)}</Td>
          <Td className="text-muted">{r.quiet_start ? `${r.quiet_start.slice(0, 5)}–${r.quiet_end.slice(0, 5)}` : '—'}</Td>
          <Td><div className="flex flex-col gap-1">{r.channels.map((ch: string) => <ActionButton key={ch} action={sendTest.bind(null, r.id, ch as any)} variant="ghost"><Send size={12} />{ch.replace('_', '-')}</ActionButton>)}</div></Td>
          {admin && <Td><ActionButton action={setRecipientActive.bind(null, r.id, !r.is_active)} variant="ghost">{r.is_active ? 'Deactivate' : 'Activate'}</ActionButton></Td>}</tr>)}</tbody></TableWrap>}
    {wa === 'sandbox' && <p className="border-t border-border px-4 py-3 text-xs text-muted">Sandbox mode: tests are logged but not sent.</p>}</Card>
}

async function Log({ c, sp }: { c: C; sp: Record<string, string | undefined> }) {
  let q = c.supabase.from('notification_logs').select('*, recipient:notification_recipients(name)', { count: 'exact' }).order('created_at', { ascending: false }).limit(60)
  if (sp.status) q = q.eq('status', sp.status); if (sp.channel) q = q.eq('channel', sp.channel)
  const { data, count } = await q
  const { data: all } = await c.supabase.from('notification_logs').select('status,cost_estimate,channel').gte('created_at', c.today.slice(0, 7) + '-01').limit(5000)
  const by = (s: string) => (all ?? []).filter(x => x.status === s).length
  const cost = (all ?? []).filter(x => x.channel === 'whatsapp' && ['sent', 'delivered', 'read'].includes(x.status)).reduce((a, x) => a + Number(x.cost_estimate ?? 0), 0)
  const hasCost = (all ?? []).some(x => x.cost_estimate != null)
  const cls = 'h-9 rounded-md border border-border bg-surface px-3 text-sm'
  return <>
    <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{[['Sandbox', by('sandbox')], ['Sent', by('sent')], ['Delivered', by('delivered') + by('read')], ['Failed', by('failed')], ['Retrying', by('retry')], ['Skipped', by('skipped')]].map(([l, n]) => <Card key={l as string} className="p-3"><div className="text-xs text-muted">{l} (this month)</div><div className="text-xl font-semibold tabular-nums">{n}</div></Card>)}</div>
    {hasCost ? <p className="mb-3 text-sm text-muted">Estimated WhatsApp cost this month: <b>{formatAed(cost)}</b> (based on the per-message price in Settings; actual charges come from Meta).</p> : <p className="mb-3 text-xs text-muted">Add a per-message price in Settings to see estimated WhatsApp cost.</p>}
    <form className="mb-3 flex gap-2"><input type="hidden" name="tab" value="log" /><select name="channel" defaultValue={sp.channel ?? ''} className={cls}><option value="">All channels</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="in_app">In-app</option></select>
      <select name="status" defaultValue={sp.status ?? ''} className={cls}><option value="">All statuses</option>{Object.keys(STATUS_TONE).map(s => <option key={s}>{s}</option>)}</select><button className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-fg">Filter</button></form>
    <Card className="overflow-hidden"><CardHeader title="Delivery log" sub={`${count ?? 0} message(s)`} />
      {!data?.length ? <EmptyState title="No messages yet" body="Messages appear here as soon as the first reminder is queued." /> :
        <TableWrap><thead className="border-b border-border"><tr><Th>When</Th><Th>Recipient</Th><Th>Channel</Th><Th>Message</Th><Th>Status</Th><Th>Attempts</Th><Th /></tr></thead><tbody className="divide-y divide-border">
          {data.map((l: any) => <tr key={l.id}><Td className="whitespace-nowrap text-xs tabular-nums text-muted">{l.created_at.slice(0, 16).replace('T', ' ')}</Td><Td>{l.recipient?.name ?? '—'}</Td><Td><Badge>{l.channel.replace('_', '-')}</Badge></Td>
            <Td className="max-w-[260px] truncate text-muted" title={l.params?.document ?? l.params?.type ?? l.template}>{l.params?.document ?? l.params?.type ?? l.template.replace('_', ' ')}</Td>
            <Td><Badge tone={STATUS_TONE[l.status]}>{l.status}</Badge>{l.sandbox && <div className="text-[11px] text-warning">not sent</div>}{l.last_error && <div className="mt-1 max-w-[260px] text-xs text-danger">{l.last_error}</div>}</Td>
            <Td className="tabular-nums text-muted">{l.attempts}/{l.max_attempts}</Td>
            <Td>{l.status === 'failed' && c.can('settings.manage') && <ActionButton action={retryLog.bind(null, l.id)} variant="ghost">Retry</ActionButton>}</Td></tr>)}</tbody></TableWrap>}</Card></>
}
