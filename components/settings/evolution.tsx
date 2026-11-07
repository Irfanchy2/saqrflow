import { Alert, Badge, Card, CardHeader, Field, Input } from '@/components/ui/primitives'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { clearEvolutionKey, saveEvolution } from '@/app/actions/evolution'
import { testWhatsAppConnection } from '@/app/actions/whatsapp'
import { companyWhatsApp } from '@/lib/whatsapp/outbox'
import { evoState } from '@/lib/whatsapp/evolution'
import type { ReminderSettings } from '@/lib/reminders/settings'
import type { WaStatus } from '@/lib/reminders/mode'
import { EvolutionLink } from './evolution-link'

/** Settings → WhatsApp via Evolution API (self-hosted): a normal WhatsApp number linked by QR code, no Meta templates. */
export async function EvolutionSettings({ companyId, s, wa }: { companyId: string; s: ReminderSettings; wa: WaStatus }) {
  const on = s.whatsappProvider === 'evolution'
  const { cfg } = await companyWhatsApp(companyId)
  const st = cfg.evolution ? await evoState(cfg.evolution, 4000) : null
  const state = st && 'state' in st ? st.state : null
  const badge = !on ? <Badge>Off</Badge> : state === 'open' ? <Badge tone={wa.mode === 'live' ? 'green' : 'amber'}>{wa.mode === 'live' ? 'Linked · live' : 'Linked · sandbox'}</Badge> : <Badge tone="amber">Not linked</Badge>
  return <Card id="evolution"><CardHeader title="WhatsApp via Evolution API (self-hosted)" sub="Send from a normal WhatsApp or WhatsApp Business number, linked by QR code like WhatsApp Web. No Meta templates or 24-hour window." action={badge} />
    <div className="grid gap-6 p-4 lg:grid-cols-2">
      <div className="space-y-4">
        <ActionForm action={saveEvolution} resetOnSuccess={false}>
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="use_evolution" defaultChecked={on} />Send WhatsApp messages through Evolution API (instead of the Meta Cloud API)</label>
          <Field label="Server URL" hint="Your Evolution API server, e.g. https://wa.yourcompany.com"><Input name="evolution_url" type="url" inputMode="url" autoComplete="off" defaultValue={s.evolutionUrl ?? ''} placeholder="https://wa.yourcompany.com" /></Field>
          <Field label="Instance name" hint="Any short name; Averiqo creates it on the server when you link the phone."><Input name="evolution_instance" autoComplete="off" defaultValue={s.evolutionInstance ?? ''} placeholder="alsaqr-main" /></Field>
          <Field label="API key" hint={wa.hasEvolutionKey ? 'A key is stored. Leave blank to keep it. Keys are encrypted and never shown again.' : 'The AUTHENTICATION_API_KEY of your server.'}><Input name="evolution_key" type="password" autoComplete="off" placeholder={wa.hasEvolutionKey ? '••••••••••••' : ''} /></Field>
        </ActionForm>
        <div className="flex flex-wrap gap-2">
          {on && <ActionButton action={testWhatsAppConnection} variant="secondary">Test connection</ActionButton>}
          {wa.hasEvolutionKey && <ActionButton action={clearEvolutionKey} variant="ghost" confirm="Remove the stored Evolution API key and switch Evolution API off?">Remove stored key</ActionButton>}
        </div>
        {on && st && 'error' in st && !st.missing && <Alert tone="amber">{st.error}</Alert>}
        {s.whatsappMode === 'sandbox' && on && <Alert tone="amber">“Force sandbox mode” is on in the Meta section below, so nothing is sent for real until you switch it off.</Alert>}
      </div>
      <div className="space-y-4 text-sm">
        <h3 className="font-medium">Link the phone</h3>
        <EvolutionLink configured={on && !!cfg.evolution} initialState={state} />
        <details className="rounded-md border border-border p-3"><summary className="cursor-pointer font-medium">Before you start</summary>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
            <li>Evolution API is open-source software you host yourself (Docker on a VPS, Railway, Render…). It cannot run on Vercel because it keeps a permanent WhatsApp connection open.</li>
            <li>It connects through WhatsApp Web, which WhatsApp does not officially support for businesses. Use a dedicated number and avoid bulk messaging to people who did not ask for it, or the number can be banned.</li>
            <li>Delivery receipts and STOP replies arrive automatically: Averiqo sets the server’s webhook to its own address with a secret header when you link the phone.</li>
          </ul></details>
      </div>
    </div></Card>
}
