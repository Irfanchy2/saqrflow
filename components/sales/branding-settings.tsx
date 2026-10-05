import { ImageIcon } from 'lucide-react'
import type { Ctx } from '@/lib/auth'
import { brandingFor, salesSettings } from '@/lib/sales/data'
import { Badge, Card, CardHeader, Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { removeBranding, saveSalesSettings, uploadBranding } from '@/app/actions/sales'

const KINDS = [
  { k: 'header', label: 'Letterhead (quotation & delivery note)', hint: 'Wide PNG/JPG, ~1600×250 px' },
  { k: 'header_invoice', label: 'Letterhead (tax invoice)', hint: 'Optional — falls back to the letterhead above' },
  { k: 'footer', label: 'Footer', hint: 'Contact strip printed at the bottom of every page' },
  { k: 'stamp', label: 'Company stamp', hint: 'Transparent PNG works best' },
  { k: 'signature', label: 'Authorised signature', hint: 'Transparent PNG works best' },
] as const

/** Settings → Branding & documents. Images live in private storage and are only served to signed-in staff. */
export async function BrandingSettings({ c }: { c: Ctx }) {
  const [b, s] = await Promise.all([brandingFor(c), salesSettings(c)])
  const url: Record<string, string | null | undefined> = { header: b.header, header_invoice: b.headerInvoice, footer: b.footer, stamp: b.stamp, signature: b.signature }
  return <Card className="lg:col-span-2">
    <CardHeader title="Branding & sales documents" sub="Letterhead, stamp, signature and default wording for quotations, tax invoices and delivery notes."
      action={<Badge tone={b.header ? 'green' : 'amber'}>{b.header ? 'Letterhead set' : 'No letterhead yet'}</Badge>} />
    <div className="grid gap-6 p-4 xl:grid-cols-2">
      <div className="space-y-3">
        <p className="text-xs text-muted">Stamp and signature images are private: stored in your company’s storage, never in the code or a public link, and only shown to signed-in staff.</p>
        {KINDS.map(k => <div key={k.k} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
          <div className="grid h-14 w-28 shrink-0 place-items-center overflow-hidden rounded-md border border-dashed border-border bg-white">
            {url[k.k] ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={url[k.k]!} alt={k.label} className="max-h-12 max-w-[104px] object-contain" /> : <ImageIcon size={18} className="text-neutral-400" aria-hidden />}
          </div>
          <div className="min-w-0 flex-1"><div className="text-sm font-medium">{k.label}</div><div className="text-xs text-muted">{k.hint}</div></div>
          <ActionForm action={uploadBranding} submit={url[k.k] ? 'Replace' : 'Upload'} variant="secondary" className="flex items-center gap-2">
            <input type="hidden" name="kind" value={k.k} />
            <input type="file" name="file" accept="image/png,image/jpeg" required aria-label={`${k.label} image`} className="w-44 text-xs file:me-2 file:cursor-pointer file:rounded file:border-0 file:bg-surface-2 file:px-2 file:py-1" />
          </ActionForm>
          {url[k.k] && <ActionButton variant="ghost" action={removeBranding.bind(null, k.k)} confirm={`Remove the ${k.label.toLowerCase()}?`}>Remove</ActionButton>}
        </div>)}
      </div>
      <ActionForm action={saveSalesSettings} resetOnSuccess={false} submit="Save document settings">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="VAT rate (%)"><Input name="vat_rate" type="number" min={0} max={100} step="0.01" defaultValue={s.vatRate} required /></Field>
          <Field label="Invoice due (days)"><Input name="due_days" type="number" min={0} max={365} defaultValue={s.dueDays} required /></Field>
          <Field label="Quote valid (days)"><Input name="validity_days" type="number" min={1} max={365} defaultValue={s.validityDays} required /></Field>
        </div>
        <Field label="Company TRN" hint="Printed on tax invoices (15 digits)"><Input name="company_trn" inputMode="numeric" defaultValue={b.companyTrn ?? ''} /></Field>
        <Field label="Bank details on invoices" hint="Account name, bank, IBAN — printed on the invoice for customers to pay you"><Textarea name="bank_details" rows={3} defaultValue={b.bankDetails ?? ''} /></Field>
        <Field label="Quotation opening"><Textarea name="intro" rows={2} defaultValue={s.intro} /></Field>
        <Field label="Quotation closing note"><Textarea name="closing" rows={2} defaultValue={s.closing} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Default terms" hint="One per line"><Textarea name="terms" rows={3} defaultValue={s.terms.join('\n')} /></Field>
          <Field label="Default payment terms" hint="One per line"><Textarea name="payment_terms" rows={3} defaultValue={s.paymentTerms.join('\n')} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="show_header_footer" defaultChecked={b.showHeaderFooter} />Print letterhead and footer (turn off for pre-printed paper)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="show_stamp" defaultChecked={b.showStamp} />Add stamp and signature to quotations and delivery notes</label>
        <fieldset className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-4"><legend className="px-1 text-sm font-medium">Seal &amp; signature on the document</legend>
          <Field label="Seal size (px)" hint="70–220 · 140 ≈ 37 mm"><Input name="seal_size" type="number" min={70} max={220} defaultValue={b.sealSize} required /></Field>
          <Field label="Signature width (px)" hint="80–260 · 160 ≈ 42 mm"><Input name="signature_width" type="number" min={80} max={260} defaultValue={b.signatureWidth} required /></Field>
          <Field label="Horizontal alignment"><Select name="sign_align" defaultValue={b.signAlign}><option value="right">Right</option><option value="center">Centre</option><option value="left">Left</option></Select></Field>
          <Field label="Space above (px)" hint="0–80"><Input name="sign_spacing" type="number" min={0} max={80} defaultValue={b.signSpacing} required /></Field>
          <p className="text-xs text-muted sm:col-span-4">Images keep their proportions (never stretched). The preview, print view and PDF all use these sizes.</p>
        </fieldset>
      </ActionForm>
    </div>
  </Card>
}
