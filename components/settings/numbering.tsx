import { Hash } from 'lucide-react'
import type { Ctx } from '@/lib/auth'
import { Badge, Card, CardHeader, Field, Input, Select } from '@/components/ui/primitives'
import { ActionForm } from '@/components/ui/action-form'
import { saveNumbering } from '@/app/actions/numbering'
import { DOC_META, type SalesType } from '@/lib/sales/docs'

const TYPES: (SalesType | 'project')[] = ['quotation', 'invoice', 'delivery_note', 'purchase_order', 'credit_note', 'receipt', 'project']
const META = (t: SalesType | 'project') => t === 'project' ? { label: 'Project reference', plural: 'Project references', short: 'PRJ' } : DOC_META[t]
const preview = (f: { prefix: string; fixed_digits: string; seq_pad: number; next_seq: number; year_separator: string; include_year?: boolean }, year: string) =>
  `${f.prefix}${f.fixed_digits}${String(f.next_seq).padStart(f.seq_pad, '0')}${f.include_year === false ? '' : f.year_separator + year}`

/** Settings → Document numbering: AS00{number}/{year} for quotations; other documents keep the standard format until configured. */
export async function NumberingSettings({ c }: { c: Ctx }) {
  const { data } = await c.supabase.from('document_number_formats').select('*')
  const year = c.today.slice(0, 4)
  return <Card className="lg:col-span-2" id="numbering">
    <CardHeader title="Document numbering" sub="Format: prefix + fixed digits + running number + separator + year. The running number never repeats; existing numbers are never changed." action={<Hash size={15} className="text-muted" aria-hidden />} />
    <div className="divide-y divide-border">{TYPES.map(t => {
      const f = (data ?? []).find(r => r.doc_type === t)
      const std = `${META(t).short}-${year}-0001`
      return <details key={t} open={t === 'quotation'} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-surface-2/50 [&::-webkit-details-marker]:hidden">
          <span className="w-36 font-medium">{META(t).label}</span>
          <code className="rounded bg-surface-2 px-2 py-0.5 text-xs">{f ? preview(f, year) : std}</code>
          <span className="ms-auto">{f ? <Badge tone="blue">Custom</Badge> : <Badge>Standard</Badge>}</span>
        </summary>
        <div className="px-4 pb-4">
          <ActionForm action={saveNumbering.bind(null, t)} resetOnSuccess={false} submit="Save numbering">
            {t === 'quotation' ? <input type="hidden" name="enabled" value="on" /> : <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={!!f} />Use a custom format for {META(t).plural.toLowerCase()} (unticked = standard {std})</label>}
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Field label="Prefix"><Input name="prefix" maxLength={12} defaultValue={f?.prefix ?? 'AS'} /></Field>
              <Field label="Fixed digits"><Input name="fixed_digits" maxLength={6} inputMode="numeric" defaultValue={f?.fixed_digits ?? '00'} /></Field>
              <Field label="Next number" hint="the next document gets this"><Input name="next_seq" type="number" min={1} defaultValue={f?.next_seq ?? 1} /></Field>
              <Field label="Min. digits"><Input name="seq_pad" type="number" min={1} max={10} defaultValue={f?.seq_pad ?? 5} /></Field>
              <Field label="Year separator"><Select name="year_separator" defaultValue={f?.year_separator ?? '/'}><option value="/">/ (AS0025180/{year})</option><option value="-">- (AS0025180-{year})</option><option value="">none</option></Select></Field>
              <div className="flex flex-col justify-end gap-1 pb-1 text-sm"><label className="flex items-center gap-2"><input type="checkbox" name="include_year" defaultChecked={f ? f.include_year !== false : true} />Add the year</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="yearly_reset" defaultChecked={!!f?.yearly_reset} />Restart at 1 each year</label></div>
            </div>
          </ActionForm>
        </div>
      </details>
    })}</div>
  </Card>
}
