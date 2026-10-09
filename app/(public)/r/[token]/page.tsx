import { CheckCircle2, Circle } from 'lucide-react'
import { Card, CardHeader, Field, Input, Select } from '@/components/ui/primitives'
import { LinkGone, PublicShell } from '@/components/public/shell'
import { PublicForm } from '@/components/public/public-form'
import { logLinkEvent, resolveLink } from '@/lib/portal'
import { ACCEPT_ATTR } from '@/lib/files'
import { publicUpload } from '@/app/actions/public'

export const metadata = { title: 'Document request' }

/** Upload page for requested documents. Files go to the company's Smart Inbox for review; nothing uploaded here is shown back. */
export default async function DocumentRequestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const r = await resolveLink(token, 'document_request')
  if (!r) return <LinkGone what="request" />
  await logLinkEvent(r, 'opened')
  // which requested items already have at least one file (names only, never the files themselves)
  const { data: ev } = await r.admin.from('share_link_events').select('detail').eq('link_id', r.link.id).eq('event', 'uploaded').limit(200)
  const got = new Set(r.link.items.filter(it => (ev ?? []).some(e => (e.detail ?? '').includes(` · ${it} · `))))
  return <PublicShell company={r.company.name} title={r.link.title || 'Documents requested'} sub={r.link.recipient_name ? `For ${r.link.recipient_name}` : undefined}>
    {r.link.message && <Card className="whitespace-pre-line p-4 text-sm">{r.link.message}</Card>}
    <Card><CardHeader title="What we need" sub={`Link valid until ${new Date(r.link.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: r.company.timezone })}`} />
      <ul className="divide-y divide-border text-sm">{r.link.items.map(it => <li key={it} className="flex items-center gap-2 px-4 py-2.5">
        {got.has(it) ? <CheckCircle2 size={16} className="text-success" aria-label="received" /> : <Circle size={16} className="text-muted" aria-label="not yet received" />}<span>{it}</span>{got.has(it) && <span className="ms-auto text-xs text-success">received</span>}</li>)}</ul></Card>
    <Card><CardHeader title="Upload" sub="PDF or clear photos (JPG / PNG). Up to 10 files at a time." />
      <div className="p-4"><PublicForm action={publicUpload.bind(null, token, 'document_request')} submit="Send files" keepOnSuccess>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Your name *"><Input name="name" required minLength={2} maxLength={120} defaultValue={r.link.recipient_name ?? ''} autoComplete="name" /></Field>
          <Field label="Document *"><Select name="item" required defaultValue={r.link.items.find(i => !got.has(i)) ?? r.link.items[0]}>{r.link.items.map(i => <option key={i} value={i}>{i}</option>)}</Select></Field>
        </div>
        <Field label="File(s) *"><input name="file" type="file" required multiple accept={ACCEPT_ATTR} className="block w-full text-sm" /></Field>
      </PublicForm></div></Card>
  </PublicShell>
}
