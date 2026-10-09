import type { Ctx } from '@/lib/auth'
import { Badge, Card, CardHeader, Field, Input, Select } from '@/components/ui/primitives'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { savePublicForm, setPublicFormEnabled } from '@/app/actions/forms'
import { baseUrl } from '@/lib/portal'

/** Settings → Public forms: website enquiry / service request forms that create leads. */
export async function PublicFormsSettings({ c }: { c: Ctx }) {
  const [{ data: forms }, { data: subs }] = await Promise.all([
    c.supabase.from('public_forms').select('*').order('created_at'),
    c.supabase.from('public_form_submissions').select('form_id').gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString()).limit(5000),
  ])
  const n = new Map<string, number>(); for (const s of subs ?? []) n.set(s.form_id, (n.get(s.form_id) ?? 0) + 1)
  const base = await baseUrl()
  return <Card id="forms"><CardHeader title="Public forms" sub="Enquiry and service-request forms for your website, WhatsApp bio or QR code. Each submission becomes a lead (source: Website)." />
    <div className="space-y-4 p-4">
      {(forms ?? []).length > 0 && <ul className="divide-y divide-border rounded-md border border-border text-sm">{(forms ?? []).map((f: any) => <li key={f.id} className="space-y-1.5 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 font-medium">{f.title}</span><Badge tone={f.enabled ? 'green' : 'neutral'}>{f.enabled ? 'Live' : 'Off'}</Badge>
          <span className="text-xs text-muted">{n.get(f.id) ?? 0} in 30 days</span>
          <ActionButton variant="ghost" action={setPublicFormEnabled.bind(null, f.id, !f.enabled)}>{f.enabled ? 'Switch off' : 'Switch on'}</ActionButton></div>
        <div className="break-all font-mono text-xs text-muted">{base}/f/{f.slug}</div>
        <details className="text-xs"><summary className="cursor-pointer text-primary">Embed on your website</summary>
          <code className="mt-1 block break-all rounded bg-surface-2 p-2">{`<iframe src="${base}/f/${f.slug}" style="width:100%;min-height:760px;border:0" title="${f.title.replace(/"/g, '')}"></iframe>`}</code></details>
      </li>)}</ul>}
      <ActionForm action={savePublicForm} submit="Publish form" variant="secondary">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title *"><Input name="title" required maxLength={120} placeholder="Request a quotation" /></Field>
          <Field label="Web address *" hint={`${base}/f/…`}><Input name="slug" required pattern="[a-z0-9][a-z0-9\-]{2,39}" maxLength={40} placeholder="alsaqr-quote" /></Field>
          <Field label="Type"><Select name="kind" defaultValue="enquiry"><option value="enquiry">Enquiry (new work)</option><option value="service_request">Service request (repair / maintenance)</option></Select></Field>
          <Field label="Intro text" hint="optional"><Input name="intro" maxLength={1000} /></Field>
        </div></ActionForm>
      <p className="text-xs text-muted">Spam protection: hidden trap field, minimum fill time, 5 submissions per visitor per hour and 200 per form per day.</p>
    </div></Card>
}
