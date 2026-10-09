import type { Ctx } from '@/lib/auth'
import { Badge, Card, CardHeader, Field, Input, Textarea } from '@/components/ui/primitives'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { refreshWaTemplates, saveWaTemplate, submitWaTemplate } from '@/app/actions/whatsapp'
import { KINDS, fill, metaName } from '@/lib/whatsapp/messages'
import { loadTemplates } from '@/lib/whatsapp/outbox'

const TONE: Record<string, 'green' | 'amber' | 'red' | 'neutral'> = { APPROVED: 'green', PENDING: 'amber', IN_APPEAL: 'amber', REJECTED: 'red', PAUSED: 'red', DISABLED: 'red' }

/** Settings → WhatsApp message templates: editable text per message type, preview with sample data, WhatsApp approval. */
export async function WhatsAppTemplates({ c, live }: { c: Ctx; live: boolean }) {
  const tpls = await loadTemplates(c.supabase, c.company.id)
  return <Card id="wa-templates"><CardHeader title="WhatsApp message templates" sub="The text sent with each “Send via WhatsApp”. Use the {placeholders} shown; values are filled in from the record. WhatsApp must approve each template before it can be sent to customers."
    action={live ? <ActionButton variant="secondary" action={refreshWaTemplates}>Check status</ActionButton> : <Badge tone="amber">Sandbox</Badge>} />
    <ul className="divide-y divide-border">{Object.entries(KINDS).map(([k, d]) => { const t = tpls[k], st = t.meta?.status, edited = !!t.submitted && t.submitted.body !== t.body
      return <li key={k} className="px-4 py-3" data-wa-template={k}><details>
        <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm"><span className="min-w-0 flex-1 font-medium">{d.label}</span>
          {d.pdf && <Badge>PDF attached</Badge>}<Badge tone={st ? TONE[st] ?? 'neutral' : 'neutral'}>{st ? st.toLowerCase().replace('_', ' ') : live ? 'not submitted' : 'sandbox'}</Badge>{edited && <Badge tone="amber">edited, resubmit</Badge>}</summary>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <ActionForm action={saveWaTemplate.bind(null, k)} submit="Save text" resetOnSuccess={false}>
            <Field label="Message" hint={`Available: ${d.vars.map(v => `{${v}}`).join(' ')}`}><Textarea name="body" rows={5} maxLength={900} defaultValue={t.body} /></Field>
            <Field label="Language code" hint="as approved in WhatsApp, e.g. en, en_US, ar"><Input name="language" defaultValue={t.language} maxLength={5} className="w-28" /></Field>
          </ActionForm>
          <div className="space-y-2 text-sm"><div className="text-xs font-medium text-muted">Preview with sample data</div>
            <div className="whitespace-pre-line rounded-lg bg-[#e7f7e1] p-3 text-[#111] dark:bg-[#1f3b2d] dark:text-[#e9f5ee]">{d.pdf && <div className="mb-2 text-xs opacity-75">[PDF document]</div>}{fill(k, t.body, d.sample)}</div>
            <p className="text-xs text-muted">WhatsApp name: <code>{metaName(k)}</code> · category Utility{d.pdf ? ' · document header' : ''}</p>
            {t.meta?.reason && <p className="text-xs text-danger">Rejected: {t.meta.reason}</p>}
            {live && <ActionButton variant="secondary" action={submitWaTemplate.bind(null, k)}>{t.meta ? 'Resubmit to WhatsApp' : 'Submit to WhatsApp for approval'}</ActionButton>}
          </div></div></details></li> })}</ul>
    <p className="px-4 pb-4 text-xs text-muted">Inside the 24 hours after a customer messages you, a custom message can be sent instead of the template. ID, passport, IBAN and card numbers are masked; salaries never appear in message text.</p>
  </Card>
}
