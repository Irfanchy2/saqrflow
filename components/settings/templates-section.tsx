import type { Ctx } from '@/lib/auth'
import { Card, CardHeader } from '@/components/ui/primitives'
import { brandingFor } from '@/lib/sales/data'
import { TemplateBuilder } from './template-builder'

/** Settings → Template builder (server part: loads the real branding and saved templates). */
export async function TemplateBuilderSection({ c }: { c: Ctx }) {
  const b = await brandingFor(c)
  const { templates, ...branding } = b
  return <Card id="builder"><CardHeader title="Template builder" sub="Choose what quotations, tax invoices and delivery notes show: title, details, column names, seal and signature, bank details and a footer note." />
    <TemplateBuilder branding={branding} saved={templates ?? {}} today={c.today} /></Card>
}
