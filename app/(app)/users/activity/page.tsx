import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Laptop, Smartphone } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { Badge, Card, CardHeader, Metrics, PageHeader, Select, StatCard, Td, Th } from '@/components/ui/primitives'
import { ActionButton } from '@/components/ui/action-form'
import { revokeOtherSessions, revokeSession } from '@/app/actions/platform'
import { deviceLabel } from '@/lib/device'
import { ACTIVE_DAYS, LOGIN_EVENT, fmtWhen } from '@/components/settings/sessions'

export const metadata = { title: 'Sign-in activity' }
const UUID = /^[0-9a-f-]{36}$/i

/** User managers: who is signed in where, failed sign-ins, and the sign-in history of every user in the company. */
export default async function SignInActivity({ searchParams }: { searchParams: Promise<{ user?: string; event?: string }> }) {
  const c = await getCtx(); if (!c.can('users.manage')) redirect('/')
  const sp = await searchParams, user = sp.user && UUID.test(sp.user) ? sp.user : undefined, event = sp.event && sp.event in LOGIN_EVENT ? sp.event : undefined
  const since = new Date(Date.now() - ACTIVE_DAYS * 864e5).toISOString(), week = new Date(Date.now() - 7 * 864e5).toISOString()
  let ev = c.supabase.from('login_events').select('id,user_id,email,event,ip,user_agent,detail,created_at').eq('company_id', c.company.id).order('created_at', { ascending: false }).limit(200)
  if (user) ev = ev.eq('user_id', user); if (event) ev = ev.eq('event', event)
  let ss = c.supabase.from('user_sessions').select('id,user_id,ip,user_agent,created_at,last_seen_at').eq('company_id', c.company.id).is('revoked_at', null).gte('last_seen_at', since).order('last_seen_at', { ascending: false }).limit(200)
  if (user) ss = ss.eq('user_id', user)
  const [{ data: events }, { data: sessions }, { data: people }, failed] = await Promise.all([ev, ss, c.supabase.from('profiles').select('id,full_name').order('full_name'),
    c.supabase.from('login_events').select('id', { count: 'exact', head: true }).eq('company_id', c.company.id).in('event', ['sign_in_failed', 'mfa_failed']).gte('created_at', week)])
  const who = new Map((people ?? []).map(p => [p.id, p.full_name as string]))
  const byUser = new Map<string, number>(); for (const s of sessions ?? []) byUser.set(s.user_id, (byUser.get(s.user_id) ?? 0) + 1)
  return <>
    <Link href="/users" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft size={14} className="rtl:rotate-180" />User management</Link>
    <PageHeader title="Sign-in activity" sub={`Signed-in devices (active in the last ${ACTIVE_DAYS} days) and the sign-in history of everyone in ${c.company.name}.`} />
    <Metrics cols={3} className="mb-5"><StatCard label="Signed-in devices" value={(sessions ?? []).length} /><StatCard label="People signed in" value={byUser.size} />
      <StatCard label="Failed attempts (7 days)" value={failed.count ?? 0} tone={(failed.count ?? 0) > 0 ? 'red' : 'neutral'} href="/users/activity?event=sign_in_failed" /></Metrics>
    <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
      <label className="text-sm"><span className="mb-1 block text-xs text-muted">Person</span><Select name="user" defaultValue={user ?? ''} className="w-56"><option value="">Everyone</option>{(people ?? []).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</Select></label>
      <label className="text-sm"><span className="mb-1 block text-xs text-muted">Event</span><Select name="event" defaultValue={event ?? ''} className="w-56"><option value="">All events</option>{Object.entries(LOGIN_EVENT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></label>
      <button className="h-11 rounded-md border border-border px-3 text-sm hover:bg-surface-2 sm:h-9">Filter</button></form>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] [&>*]:min-w-0">
      <Card><CardHeader title="Signed-in devices" sub="Signing a device out takes effect on its next click." />
        <ul className="divide-y divide-border text-sm">{(sessions ?? []).map(s => { const Icon = /iPhone|Android|iPad|Mobile/.test(s.user_agent ?? '') ? Smartphone : Laptop
          return <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5"><Icon size={16} className="shrink-0 text-muted" aria-hidden />
            <div className="min-w-0 flex-1"><div className="font-medium">{who.get(s.user_id) ?? 'Former user'}</div><div className="text-xs text-muted">{deviceLabel(s.user_agent)} · {s.ip ?? 'IP unknown'} · last active {fmtWhen(s.last_seen_at, c.company.timezone)}</div></div>
            {s.user_id !== c.userId && <ActionButton variant="ghost" action={revokeSession.bind(null, s.id)} confirm={`Sign out ${who.get(s.user_id) ?? 'this user'} on this device?`}>Sign out</ActionButton>}</li> })}
          {!(sessions ?? []).length && <li className="px-4 py-3 text-muted">No signed-in devices recorded.</li>}</ul>
        {user && user !== c.userId && (byUser.get(user) ?? 0) > 0 && <div className="border-t border-border p-4"><ActionButton variant="secondary" action={revokeOtherSessions.bind(null, user)} confirm={`Sign ${who.get(user)} out everywhere?`}>Sign {who.get(user)} out everywhere</ActionButton></div>}</Card>
      <Card><CardHeader title="History" sub="Latest 200 entries" />
        <div className="overflow-x-auto"><table className="w-full min-w-[640px]"><thead><tr><Th>When</Th><Th>Person</Th><Th>What</Th><Th>Device</Th><Th>IP</Th></tr></thead>
          <tbody>{(events ?? []).map(e => <tr key={e.id}><Td className="whitespace-nowrap text-xs tabular-nums text-muted">{fmtWhen(e.created_at, c.company.timezone)}</Td>
            <Td>{e.user_id ? <Link href={`/users/activity?user=${e.user_id}`} className="hover:text-primary">{who.get(e.user_id) ?? 'Former user'}</Link> : <span className="text-muted">{e.email}</span>}</Td>
            <Td><Badge tone={LOGIN_EVENT[e.event]?.tone}>{LOGIN_EVENT[e.event]?.label ?? e.event}</Badge>{e.detail && <span className="ms-2 text-xs text-muted">{e.detail}</span>}</Td>
            <Td className="text-xs">{e.user_agent ? deviceLabel(e.user_agent) : '—'}</Td><Td className="font-mono text-xs">{e.ip ?? '—'}</Td></tr>)}
            {!(events ?? []).length && <tr><Td colSpan={5} className="text-muted">Nothing recorded yet.</Td></tr>}</tbody></table></div></Card>
    </div></>
}
