import { Hash } from 'lucide-react'
import type { Ctx } from '@/lib/auth'
import { Badge, Card, CardHeader, Field, Input, Select } from '@/components/ui/primitives'
import { ActionForm } from '@/components/ui/action-form'
import { saveNumbering } from '@/app/actions/numbering'
import { DOC_META, type SalesType } from '@/lib/sales/docs'
import { formatNumber, type NumberFormat } from '@/lib/numbering'
import { NumberPreview } from './number-preview'

const TYPES: (SalesType | 'project')[] = ['quotation', 'invoice', 'delivery_note', 'purchase_order', 'credit_note', 'receipt', 'project']
const META = (t: SalesType | 'project') => t === 'project' ? { label: 'Project reference', plural: 'Project references', short: 'PRJ' } : DOC_META[t]
type Fmt = NumberFormat & { next_seq: number; yearly_reset?: boolean }
// suggested values when a format is first switched on (quotation / invoice / delivery note match the company defaults)
const DEFAULTS: Partial<Record<SalesType | 'project', Fmt>> = {
  quotation: { prefix: 'AS', number_separator: '-', fixed_digits: '', seq_pad: 6, next_seq: 2600, year_separator: '/', include_year: true, year_format: 'yyyy' },
  invoice: { prefix: 'INV', number_separator: '-', fixed_digits: '', seq_pad: 1, next_seq: 610, year_separator: '/', include_year: false, year_format: 'yyyy' },
  delivery_note: { prefix: 'DL', number_separator: '-', fixed_digits: '', seq_pad: 1, next_seq: 1300, year_separator: '/', include_year: false, year_format: 'yyyy' },
}
const suggest = (t: SalesType | 'project'): Fmt => DEFAULTS[t] ?? { prefix: META(t).short, number_separator: '-', fixed_digits: '', seq_pad: 4, next_seq: 1, year_separator: '/', include_year: false, year_format: 'yyyy' }

/** Settings → Document numbering: AS00{number}/{year} for quotations; other documents keep the standard format until configured. */
export async function NumberingSettings({ c }: { c: Ctx }) {
  const { data } = await c.supabase.from('document_number_formats').select('*')
  const year = c.today.slice(0, 4), yr = Number(year)
  return <Card id="numbering">
    <CardHeader title="Document numbering" sub="Format: prefix + separator + running number + year. New documents use the latest format; the running number never repeats and existing numbers are never changed." action={<Hash size={15} className="text-muted" aria-hidden />} />
    <div className="divide-y divide-border">{TYPES.map(t => {
      const f = (data ?? []).find(r => r.doc_type === t) as Fmt | undefined, d = f ?? suggest(t)
      const std = `${META(t).short}-${year}-0001`
      return <details key={t} open={t === 'quotation'} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-surface-2/50 [&::-webkit-details-marker]:hidden">
          <span className="w-36 font-medium">{META(t).label}</span>
          <code className="rounded bg-surface-2 px-2 py-0.5 text-xs">{f ? formatNumber(f, f.next_seq, yr) : std}</code>
          <span className="ms-auto">{f ? <Badge tone="blue">Custom</Badge> : <Badge>Standard</Badge>}</span>
        </summary>
        <div className="px-4 pb-4">
          <ActionForm action={saveNumbering.bind(null, t)} resetOnSuccess={false} submit="Save numbering">
            {t === 'quotation' ? <input type="hidden" name="enabled" value="on" /> : <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={!!f} />Use a custom format for {META(t).plural.toLowerCase()} (unticked = standard {std})</label>}
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <Field label="Prefix"><Input name="prefix" maxLength={12} defaultValue={d.prefix} /></Field>
              <Field label="Separator" hint="between prefix and number"><Select name="number_separator" defaultValue={d.number_separator ?? ''}><option value="-">-</option><option value="/">/</option><option value=".">.</option><option value="">none</option></Select></Field>
              <Field label="Starting number" hint="the next new document gets this"><Input name="next_seq" type="number" min={1} defaultValue={d.next_seq} /></Field>
              <Field label="Min. digits" hint="pads with zeros, e.g. 6 → 002600"><Input name="seq_pad" type="number" min={1} max={10} defaultValue={d.seq_pad} /></Field>
              <Field label="Fixed digits" hint="optional, always printed"><Input name="fixed_digits" maxLength={6} inputMode="numeric" defaultValue={d.fixed_digits} /></Field>
              <Field label="Year format"><Select name="year_format" defaultValue={d.include_year === false ? 'none' : d.year_format === 'yy' ? 'yy' : 'yyyy'}><option value="yyyy">{year} (YYYY)</option><option value="yy">{year.slice(2)} (YY)</option><option value="none">No year</option></Select></Field>
              <Field label="Year separator"><Select name="year_separator" defaultValue={d.year_separator ?? '/'}><option value="/">/ (…/{year})</option><option value="-">- (…-{year})</option><option value="">none</option></Select></Field>
              <div className="flex flex-col justify-end gap-1 pb-1 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" name="yearly_reset" defaultChecked={!!f?.yearly_reset} />Restart at 1 each year</label></div>
            </div>
            <NumberPreview year={yr} initial={formatNumber(d, d.next_seq, yr)} />
            <p className="text-xs text-muted">Numbers already used are skipped automatically, so a document number is never issued twice.</p>
          </ActionForm>
        </div>
      </details>
    })}</div>
  </Card>
}
