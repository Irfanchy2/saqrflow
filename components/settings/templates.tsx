import { FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Ctx } from '@/lib/auth'
import { Badge, Card, CardHeader, Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { deleteTemplate, saveTemplate } from '@/app/actions/catalog'

function Fields({ t }: { t?: Record<string, any> }) {
  return <div className="grid gap-4">
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Template name *"><Input name="name" required maxLength={120} defaultValue={t?.name ?? ''} placeholder="e.g. Supply & installation" /></Field>
      <Field label="Type"><Select name="kind" defaultValue={t?.kind ?? 'terms'}><option value="terms">Terms & conditions</option><option value="payment">Payment terms</option></Select></Field></div>
    <Field label="Clauses *" hint="One clause per line — numbered automatically on the document"><Textarea name="lines" rows={8} defaultValue={(t?.lines ?? []).join('\n')} /></Field>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_default" defaultChecked={!!t?.is_default} />Use for new quotations by default</label>
  </div>
}
/** Settings → Document templates: reusable T&C / payment-term sets the quotation creator inserts and edits per document. */
export async function TemplatesSettings({ c }: { c: Ctx }) {
  const { data } = await c.supabase.from('terms_templates').select('*').order('kind').order('name')
  return <Card id="templates"><CardHeader title="Document templates" sub="Terms & conditions and payment terms — e.g. Steel fabrication, Installation, Supply only, Maintenance, Project contract"
    action={<DialogButton wide size="sm" label="New template" title="New template" icon={<Plus size={14} />}><ActionForm action={saveTemplate.bind(null, null)} submit="Save template"><Fields /></ActionForm></DialogButton>} />
    {!(data ?? []).length ? <p className="px-4 py-5 text-sm text-muted">No templates yet. New quotations use the default terms below until you add one.</p>
      : <ul className="divide-y divide-border">{(data ?? []).map((t: any) => <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
        <FileText size={15} className="shrink-0 text-muted" aria-hidden /><span className="min-w-0 flex-1"><span className="font-medium">{t.name}</span><span className="block text-xs text-muted">{t.kind === 'terms' ? 'Terms & conditions' : 'Payment terms'} · {t.lines.length} clause{t.lines.length === 1 ? '' : 's'}</span></span>
        {t.is_default && <Badge tone="blue">Default</Badge>}
        <DialogButton wide size="sm" variant="ghost" label={<><Pencil size={13} /><span className="sr-only">Edit {t.name}</span></>} title={`Edit ${t.name}`}><ActionForm action={saveTemplate.bind(null, t.id)} resetOnSuccess={false}><Fields t={t} /></ActionForm></DialogButton>
        <ActionButton variant="ghost" action={deleteTemplate.bind(null, t.id)} confirm={`Delete template “${t.name}”? Documents already created keep their text.`}><Trash2 size={13} /><span className="sr-only">Delete</span></ActionButton></li>)}</ul>}
  </Card>
}
