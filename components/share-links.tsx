import type { Ctx } from '@/lib/auth'
import { Badge, Card, CardHeader } from '@/components/ui/primitives'
import { ActionButton } from '@/components/ui/action-form'
import { createShareLink, revokeShareLink } from '@/app/actions/links'
import { LINK_KINDS, type LinkKind } from '@/lib/portal'
import { ShareLinkForm } from './share-link-form'

const COL = { customer: 'customer_id', supplier: 'supplier_id', employee: 'employee_id', invoice: 'invoice_id' } as const

/** Secure links issued for one record (portal, document request, accept / reject), with create and switch-off. */
export async function ShareLinks({ c, kind, target, targetId, title, sub, shareText, recipient, className }: {
  c: Ctx; kind: LinkKind; target: keyof typeof COL; targetId: string; title?: string; sub: string; shareText: string; recipient?: string; className?: string
}) {
  if (!c.can('records.edit') || (kind !== 'document_request' && !c.can('finance.view'))) return null
  const { data: links } = await c.supabase.from('share_links').select('id,created_at,expires_at,revoked_at,last_used_at,use_count,recipient_name,items').eq('kind', kind).eq(COL[target], targetId).order('created_at', { ascending: false }).limit(10)
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: c.company.timezone })
  const now = Date.now()
  return <Card className={className}><CardHeader title={title ?? LINK_KINDS[kind]} sub={sub} />
    <div className="space-y-4 p-4">
      <ShareLinkForm action={createShareLink.bind(null, kind, target, targetId)} kind={kind} defaultDays={kind === 'quote_response' ? 30 : kind === 'document_request' ? 14 : 90} recipient={recipient} shareText={shareText} />
      {(links ?? []).length > 0 && <ul className="divide-y divide-border rounded-md border border-border text-sm">{(links ?? []).map(l => {
        const state = l.revoked_at ? ['Switched off', 'neutral'] : new Date(l.expires_at).getTime() < now ? ['Expired', 'neutral'] : ['Active', 'green']
        return <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
          <span className="min-w-0 flex-1"><span className="block truncate">{l.recipient_name || 'Link'} · created {fmt(l.created_at)}</span>
            <span className="block text-xs text-muted">{l.revoked_at ? `switched off ${fmt(l.revoked_at)}` : `until ${fmt(l.expires_at)}`} · {l.use_count ? `used ${l.use_count}× , last ${fmt(l.last_used_at!)}` : 'not opened yet'}{l.items?.length ? ` · ${l.items.length} document${l.items.length === 1 ? '' : 's'} requested` : ''}</span></span>
          <Badge tone={state[1] as any}>{state[0]}</Badge>
          {state[0] === 'Active' && <ActionButton variant="ghost" action={revokeShareLink.bind(null, l.id)} confirm="Switch this link off? It stops working immediately.">Switch off</ActionButton>}
        </li> })}</ul>}
    </div></Card>
}
