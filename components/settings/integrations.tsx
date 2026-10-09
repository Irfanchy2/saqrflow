import { KeyRound, Webhook } from 'lucide-react'
import type { Ctx } from '@/lib/auth'
import { Badge, Card, CardHeader, Field, Input, Select, Td, Th } from '@/components/ui/primitives'
import { ActionButton } from '@/components/ui/action-form'
import { DialogButton } from '@/components/ui/dialog'
import { SecretOnceForm } from '@/components/secret-once-form'
import { createApiKey, deleteWebhook, revokeApiKey, rotateWebhookSecret, saveWebhook, sendTestWebhook, setWebhookEnabled } from '@/app/actions/platform'
import { SCOPES } from '@/lib/api'
import { EVENTS, eventGroups } from '@/lib/events'
import { baseUrl } from '@/lib/portal'

const when = (d: string | null, tz: string) => (d ? new Date(d).toLocaleString('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }) : '—')
const TONE: Record<string, 'green' | 'amber' | 'red' | 'neutral' | 'blue'> = { sent: 'green', retry: 'amber', failed: 'red', pending: 'blue', sending: 'blue' }

/** Settings → API & webhooks: read-only API keys (scoped, expiring) and signed outgoing webhooks with a delivery log. */
export async function Integrations({ c }: { c: Ctx }) {
  const [{ data: keys }, { data: hooks }, { data: log }, base] = await Promise.all([
    c.supabase.from('api_keys').select('id,name,prefix,scopes,expires_at,revoked_at,last_used_at,use_count,created_at').order('created_at', { ascending: false }),
    c.supabase.from('webhook_endpoints').select('*').order('created_at'),
    c.supabase.from('webhook_deliveries').select('id,endpoint_id,event,status,attempts,response_status,response_ms,last_error,created_at,next_attempt_at').order('created_at', { ascending: false }).limit(15),
    baseUrl(),
  ])
  const url = new Map((hooks ?? []).map((h: any) => [h.id, h.url as string]))
  const now = Date.now()
  return <Card id="integrations"><CardHeader title="API & webhooks" sub="Connect Averiqo to your accounting software, website or automation tools. The API is read-only; webhooks push changes as they happen." />
    <div className="space-y-6 p-4 text-sm">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-1.5 font-medium"><KeyRound size={14} aria-hidden />API keys</h3>
          <DialogButton size="sm" variant="secondary" label="Create API key" title="Create an API key">
            <SecretOnceForm action={createApiKey} submit="Create key">
              <Field label="Name *" hint="who or what uses it"><Input name="name" required maxLength={80} placeholder="Accounting sync" /></Field>
              <fieldset><legend className="mb-1.5 text-sm font-medium">May read *</legend><div className="grid gap-1.5 sm:grid-cols-2">{Object.entries(SCOPES).map(([k, l]) =>
                <label key={k} className="flex items-center gap-2"><input type="checkbox" name="scopes" value={k} />{l}</label>)}</div></fieldset>
              <Field label="Expires after"><Select name="days" defaultValue="365"><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option><option value="730">2 years</option><option value="0">Never</option></Select></Field>
            </SecretOnceForm></DialogButton></div>
        {!(keys ?? []).length ? <p className="text-muted">No API keys. Keys are shown once when created; only a fingerprint is stored.</p> :
          <div className="overflow-x-auto rounded-md border border-border"><table className="w-full min-w-[640px]"><thead><tr><Th>Name</Th><Th>Key</Th><Th>Can read</Th><Th>Last used</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>{(keys ?? []).map((k: any) => { const expired = k.expires_at && new Date(k.expires_at).getTime() < now, live = !k.revoked_at && !expired
              return <tr key={k.id}><Td>{k.name}</Td><Td className="font-mono text-xs">{k.prefix}…</Td><Td className="text-xs">{k.scopes.map((s: string) => SCOPES[s as keyof typeof SCOPES] ?? s).join(', ')}</Td>
                <Td className="text-xs text-muted">{k.last_used_at ? `${when(k.last_used_at, c.company.timezone)} (${k.use_count})` : 'never'}</Td>
                <Td><Badge tone={live ? 'green' : 'neutral'}>{k.revoked_at ? 'Revoked' : expired ? 'Expired' : k.expires_at ? `Until ${new Date(k.expires_at).toLocaleDateString('en-GB', { dateStyle: 'medium' })}` : 'Active'}</Badge></Td>
                <Td>{live && <ActionButton variant="ghost" action={revokeApiKey.bind(null, k.id)} confirm={`Revoke “${k.name}”? Anything using it stops working.`}>Revoke</ActionButton>}</Td></tr> })}</tbody></table></div>}
        <details className="rounded-md border border-border p-3"><summary className="cursor-pointer text-primary">How to call the API</summary>
          <div className="mt-2 space-y-2 text-xs text-muted"><p>Resources: <code>customers</code>, <code>invoices</code>, <code>quotations</code>, <code>payments</code>, <code>projects</code>, <code>leads</code>, <code>tickets</code>. Oldest first, up to 100 per page; pass <code>next_cursor</code> back as <code>?cursor=</code>. Optional <code>?created_after=2026-01-01</code>.</p>
            <code className="block break-all rounded bg-surface-2 p-2">curl -H &quot;Authorization: Bearer avq_…&quot; {base}/api/v1/invoices?limit=50</code>
            <code className="block break-all rounded bg-surface-2 p-2">curl -H &quot;Authorization: Bearer avq_…&quot; {base}/api/v1/customers/&lt;id&gt;</code></div></details>
      </section>

      <section className="space-y-3 border-t border-border pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-1.5 font-medium"><Webhook size={14} aria-hidden />Webhooks</h3>
          <DialogButton wide size="sm" variant="secondary" label="Add webhook" title="Add a webhook endpoint">
            <SecretOnceForm action={saveWebhook} submit="Add webhook">
              <Field label="Endpoint URL *" hint="https only; must answer 2xx within 8 seconds"><Input name="url" type="url" required maxLength={500} placeholder="https://example.com/hooks/averiqo" /></Field>
              <Field label="Description" hint="optional"><Input name="description" maxLength={200} placeholder="Zapier: new customers to Google Sheets" /></Field>
              <fieldset><legend className="mb-1.5 text-sm font-medium">Send these events *</legend>
                <label className="mb-2 flex items-center gap-2 font-medium"><input type="checkbox" name="events" value="*" />Everything (current and future events)</label>
                <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">{eventGroups().map(([g, list]) => <div key={g}><div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{g}</div>
                  {list.map(([k, d]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" name="events" value={k} />{d.label}</label>)}</div>)}</div></fieldset>
            </SecretOnceForm></DialogButton></div>
        {!(hooks ?? []).length ? <p className="text-muted">No webhooks. Each delivery is a signed JSON POST (header <code>X-Averiqo-Signature</code>), retried for up to 15 hours.</p> :
          <ul className="divide-y divide-border rounded-md border border-border">{(hooks ?? []).map((h: any) => <li key={h.id} className="space-y-1.5 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 break-all font-mono text-xs">{h.url}</span>
              <Badge tone={!h.enabled ? 'neutral' : h.failure_count ? 'amber' : 'green'}>{!h.enabled ? 'Off' : h.failure_count ? `${h.failure_count} failing` : 'Active'}</Badge></div>
            {h.description && <p>{h.description}</p>}
            <p className="text-xs text-muted">{h.events.includes('*') ? 'All events' : h.events.map((e: string) => EVENTS[e]?.label ?? e).join(', ')} · secret …{h.secret_hint} · last success {when(h.last_success_at, c.company.timezone)}{h.last_status ? ` · last HTTP ${h.last_status}` : ''}</p>
            {h.disabled_reason && <p className="text-xs text-warning">{h.disabled_reason}</p>}
            <div className="flex flex-wrap gap-1">
              <ActionButton variant="ghost" action={sendTestWebhook.bind(null, h.id)}>Send test</ActionButton>
              <ActionButton variant="ghost" action={setWebhookEnabled.bind(null, h.id, !h.enabled)}>{h.enabled ? 'Switch off' : 'Switch on'}</ActionButton>
              <DialogButton size="sm" variant="ghost" label="New secret" title="Replace the signing secret"><SecretOnceForm action={rotateWebhookSecret.bind(null, h.id)} submit="Replace secret" variant="secondary"><p className="text-sm text-muted">The current secret stops working immediately. Update the receiving system with the new one.</p></SecretOnceForm></DialogButton>
              <ActionButton variant="ghost" action={deleteWebhook.bind(null, h.id)} confirm="Remove this webhook and its delivery history?">Remove</ActionButton></div>
          </li>)}</ul>}
        {(log ?? []).length > 0 && <div><h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Recent deliveries</h4>
          <div className="overflow-x-auto rounded-md border border-border"><table className="w-full min-w-[640px]"><thead><tr><Th>Time</Th><Th>Event</Th><Th>Endpoint</Th><Th>Result</Th><Th>Details</Th></tr></thead>
            <tbody>{(log ?? []).map((d: any) => <tr key={d.id}><Td className="whitespace-nowrap text-xs tabular-nums text-muted">{when(d.created_at, c.company.timezone)}</Td><Td className="text-xs">{d.event === 'ping' ? 'Test ping' : EVENTS[d.event]?.label ?? d.event}</Td>
              <Td className="max-w-[220px] truncate font-mono text-xs" title={url.get(d.endpoint_id)}>{url.get(d.endpoint_id)}</Td><Td><Badge tone={TONE[d.status] ?? 'neutral'}>{d.status}</Badge></Td>
              <Td className="text-xs text-muted">{[d.response_status && `HTTP ${d.response_status}`, d.response_ms != null && `${d.response_ms} ms`, d.attempts > 1 && `${d.attempts} attempts`, d.status === 'retry' && `next ${when(d.next_attempt_at, c.company.timezone)}`, d.last_error].filter(Boolean).join(' · ') || '—'}</Td></tr>)}</tbody></table></div></div>}
        <details className="rounded-md border border-border p-3"><summary className="cursor-pointer text-primary">Verify the signature</summary>
          <div className="mt-2 space-y-2 text-xs text-muted"><p>Header <code>X-Averiqo-Signature: t=&lt;unix time&gt;,v1=&lt;hex&gt;</code>. Compute HMAC-SHA256 of <code>&lt;t&gt;.&lt;raw request body&gt;</code> with your signing secret and compare with <code>v1</code> (constant-time). Reject requests whose <code>t</code> is more than 5 minutes old. <code>X-Averiqo-Event</code> names the event; <code>X-Averiqo-Delivery</code> is unique per delivery (use it to ignore repeats).</p>
            <code className="block whitespace-pre-wrap break-all rounded bg-surface-2 p-2">{`{ "id": "evt_123", "type": "quotation.accepted", "created_at": "…", "data": { "id": "…", "number": "AS-002600/2026", "party": "…", "amount": 52500, "url": "${base}/invoices/…" } }`}</code></div></details>
      </section>
    </div></Card>
}
