import { Laptop, Smartphone } from 'lucide-react'
import { Badge, Td, Th } from '@/components/ui/primitives'
import { ActionButton } from '@/components/ui/action-form'
import { revokeOtherSessions, revokeSession } from '@/app/actions/platform'
import { deviceLabel, sessionIdFromJwt } from '@/lib/device'
import type { Ctx } from '@/lib/auth'

export const LOGIN_EVENT: Record<string, { label: string; tone: 'green' | 'red' | 'neutral' | 'amber' | 'blue' }> = {
  sign_in: { label: 'Signed in', tone: 'green' }, sign_in_failed: { label: 'Wrong password', tone: 'red' }, mfa_verified: { label: 'Two-step code accepted', tone: 'green' },
  mfa_failed: { label: 'Wrong two-step code', tone: 'red' }, sign_out: { label: 'Signed out', tone: 'neutral' }, session_revoked: { label: 'Device signed out', tone: 'amber' }, sessions_revoked: { label: 'Other devices signed out', tone: 'amber' },
}
export const ACTIVE_DAYS = 30
export const fmtWhen = (d: string, tz: string) => new Date(d).toLocaleString('en-GB', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const mobile = (ua: string | null) => /iPhone|Android|iPad|Mobile/.test(ua ?? '')

/** Your devices (sessions seen in the last 30 days) and your recent sign-in history. */
export async function MySessions({ c }: { c: Ctx }) {
  const since = new Date(Date.now() - ACTIVE_DAYS * 864e5).toISOString()
  const [{ data: sessions }, { data: events }, { data: { session } }] = await Promise.all([
    c.supabase.from('user_sessions').select('id,ip,user_agent,created_at,last_seen_at').eq('user_id', c.userId).is('revoked_at', null).gte('last_seen_at', since).order('last_seen_at', { ascending: false }).limit(20),
    c.supabase.from('login_events').select('id,event,ip,user_agent,detail,created_at').eq('user_id', c.userId).order('created_at', { ascending: false }).limit(15),
    c.supabase.auth.getSession(),
  ])
  const current = sessionIdFromJwt(session?.access_token)
  const failed = (events ?? []).filter(e => e.event === 'sign_in_failed' || e.event === 'mfa_failed').length
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">Signed-in devices</h3>
      {(sessions ?? []).some(s => s.id !== current) && <ActionButton variant="secondary" action={revokeOtherSessions.bind(null, undefined)} confirm="Sign out every other device? They will need your password (and two-step code) again.">Sign out all other devices</ActionButton>}</div>
    <ul className="divide-y divide-border rounded-md border border-border" data-sessions>{(sessions ?? []).map(s => { const Icon = mobile(s.user_agent) ? Smartphone : Laptop
      return <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
        <Icon size={16} className="shrink-0 text-muted" aria-hidden />
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span>{deviceLabel(s.user_agent)}</span>{s.id === current && <Badge tone="blue">This device</Badge>}</div>
          <div className="text-xs text-muted">{s.ip ?? 'IP unknown'} · signed in {fmtWhen(s.created_at, c.company.timezone)} · last active {fmtWhen(s.last_seen_at, c.company.timezone)}</div></div>
        {s.id !== current && <ActionButton variant="ghost" action={revokeSession.bind(null, s.id)} confirm="Sign out this device?">Sign out</ActionButton>}
      </li> })}
      {!(sessions ?? []).length && <li className="px-3 py-2.5 text-muted">No other activity recorded yet.</li>}</ul>
    <div><h3 className="mb-2 flex flex-wrap items-center gap-2 font-medium">Recent sign-in activity{failed > 0 && <Badge tone="red">{failed} failed attempt(s)</Badge>}</h3>
      <div className="overflow-x-auto rounded-md border border-border"><table className="w-full min-w-[520px]"><thead><tr><Th>When</Th><Th>What</Th><Th>Device</Th><Th>IP</Th></tr></thead>
        <tbody>{(events ?? []).map(e => <tr key={e.id}><Td className="whitespace-nowrap text-xs tabular-nums text-muted">{fmtWhen(e.created_at, c.company.timezone)}</Td>
          <Td><Badge tone={LOGIN_EVENT[e.event]?.tone}>{LOGIN_EVENT[e.event]?.label ?? e.event}</Badge>{e.detail && <span className="ms-2 text-xs text-muted">{e.detail}</span>}</Td>
          <Td className="text-xs">{e.user_agent ? deviceLabel(e.user_agent) : '—'}</Td><Td className="font-mono text-xs">{e.ip ?? '—'}</Td></tr>)}
          {!(events ?? []).length && <tr><Td colSpan={4} className="text-muted">Nothing recorded yet. Sign-ins are recorded from now on.</Td></tr>}</tbody></table></div>
      <p className="mt-2 text-xs text-muted">Something you don’t recognise? Sign out the device, change your password and turn on two-step verification below.</p></div>
  </div>
}
