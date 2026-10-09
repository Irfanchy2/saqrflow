import { Card, Field, Input, Textarea } from '@/components/ui/primitives'
import { LinkGone, PublicShell } from '@/components/public/shell'
import { PublicForm } from '@/components/public/public-form'
import { createAdminClient } from '@/lib/supabase/admin'
import { SERVICES } from '@/lib/crm'
import { publicEnquiry } from '@/app/actions/public'

export const metadata = { title: 'Contact us' }

/** Public enquiry / service request form (Settings → Public forms). Creates a lead; protected against spam (see publicEnquiry). */
export default async function PublicFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug)) return <LinkGone what="form" />
  const admin = createAdminClient()
  const { data: form } = await admin.from('public_forms').select('id,company_id,kind,title,intro,enabled').eq('slug', slug).maybeSingle()
  if (!form || !form.enabled) return <LinkGone what="form" />
  const { data: co } = await admin.from('companies').select('name').eq('id', form.company_id).maybeSingle()
  const service = form.kind === 'service_request'
  return <PublicShell isPublic company={co?.name ?? ''} title={form.title} sub={form.intro ?? (service ? 'Tell us what needs repair or maintenance. We reply within one working day.' : 'Tell us about your project. We reply within one working day.')}>
    <Card className="p-4"><PublicForm action={publicEnquiry.bind(null, slug)} submit={service ? 'Send service request' : 'Send enquiry'}>
      {/* honeypot: hidden from people, filled by bots */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your name *"><Input name="name" required minLength={2} maxLength={120} autoComplete="name" /></Field>
        <Field label="Company"><Input name="company" maxLength={200} autoComplete="organization" /></Field>
        <Field label="Phone / WhatsApp *"><Input name="phone" type="tel" required minLength={7} maxLength={40} autoComplete="tel" inputMode="tel" /></Field>
        <Field label="Email"><Input name="email" type="email" maxLength={200} autoComplete="email" /></Field>
        <Field label="Location"><Input name="location" maxLength={300} placeholder="e.g. Mussafah, Abu Dhabi" /></Field>
        <Field label={service ? 'Item / system' : 'Service'}><Input name="service" maxLength={300} list="services" placeholder={service ? 'e.g. Sliding gate motor' : 'e.g. Staircase'} /></Field>
      </div>
      <datalist id="services">{SERVICES.map(s => <option key={s} value={s} />)}</datalist>
      <Field label={service ? 'What is the problem? *' : 'What do you need? *'}><Textarea name="message" required minLength={5} maxLength={3000} rows={5} /></Field>
      <p className="text-xs text-muted">We use these details only to reply to your request.</p>
    </PublicForm></Card>
  </PublicShell>
}
