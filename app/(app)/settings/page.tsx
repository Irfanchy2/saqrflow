import { getCtx } from '@/lib/auth'
import { Alert, Badge, Card, CardHeader, Field, Input, PageHeader, Select } from '@/components/ui/primitives'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { MfaSetup } from '@/components/mfa-setup'
import { clearWhatsAppToken, saveCompany, saveReminderSettings, saveWhatsApp, setLocale } from '@/app/actions/admin'
import { parseSettings } from '@/lib/reminders/settings'
import { whatsappStatus } from '@/lib/reminders/mode'
import { TEMPLATE_META, templateBody } from '@/lib/whatsapp/templates'
import { LOCALE_NAMES, LOCALES } from '@/lib/i18n'

export const metadata = { title: 'Settings' }
export default async function Settings() {
  const c = await getCtx(); const admin = c.can('settings.manage')
  const { data: st } = await c.supabase.from('app_settings').select('key,value'); const s = parseSettings(st ?? [])
  const wa = admin ? await whatsappStatus(c.company.id) : null
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://YOUR-APP-URL'
  return <><PageHeader title="Settings" sub={`${c.company.name} · ${c.company.timezone} · ${c.company.currency}`} />
    <div className="grid gap-5 lg:grid-cols-2">
      <Card><CardHeader title="Your account" /><div className="space-y-5 p-4 text-sm">
        <div><div className="text-xs text-muted">Signed in as</div><div>{c.email} · <span className="capitalize">{c.profile.role.replace('_', ' ')}</span></div></div>
        <ActionForm action={setLocale} submit="Save language" resetOnSuccess={false}><Field label="Interface language" hint="Arabic (right-to-left) and Bengali currently translate navigation and chrome only; page content is English."><Select name="locale" defaultValue={c.profile.locale}>{LOCALES.map(l => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}</Select></Field></ActionForm>
        <div><h3 className="mb-2 font-medium">Two-step verification</h3><MfaSetup /></div></div></Card>

      {admin && <Card><CardHeader title="Company" /><div className="p-4"><ActionForm action={saveCompany} resetOnSuccess={false}>
        <Field label="Company name"><Input name="name" defaultValue={c.company.name} required /></Field><Field label="Trade name"><Input name="trade_name" /></Field>
        <p className="text-xs text-muted">Time zone: {c.company.timezone} · Currency: {c.company.currency} (fixed in this version).</p></ActionForm></div></Card>}

      {admin && <Card><CardHeader title="Reminder schedule" sub="Applies to every document, cheque and reminder unless overridden on the item or category." /><div className="p-4"><ActionForm action={saveReminderSettings} resetOnSuccess={false}>
        <Field label="Remind … days before" hint="Comma-separated. 0 = on the due date."><Input name="offsets" defaultValue={s.offsets!.join(', ')} /></Field>
        <div className="grid gap-4 sm:grid-cols-3"><Field label="Overdue: repeat every (days)"><Input type="number" name="overdue_every" min="0" max="90" defaultValue={s.overdueEveryDays} /></Field><Field label="Max overdue reminders"><Input type="number" name="overdue_max" min="0" max="52" defaultValue={s.overdueMax} /></Field><Field label="Daily summary hour"><Input type="number" name="digest_hour" min="0" max="23" defaultValue={s.digestHour} /></Field></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="digest" defaultChecked={s.digestEnabled} />Send the daily summary to recipients who opted in</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="fallback" defaultChecked={s.emailFallback} />Email fallback when a WhatsApp message fails permanently</label></ActionForm></div></Card>}

      {admin && wa && <Card className="lg:col-span-2"><CardHeader title="WhatsApp Business Platform (Meta Cloud API)" action={<Badge tone={wa.mode === 'live' ? 'green' : 'amber'}>{wa.mode === 'live' ? 'Live' : 'Sandbox'}</Badge>} />
        <div className="grid gap-6 p-4 lg:grid-cols-2"><div className="space-y-4">
          <Alert tone={wa.mode === 'live' ? 'green' : 'amber'}>{wa.reason}</Alert>
          <ActionForm action={saveWhatsApp} resetOnSuccess={false}>
            <Field label="Phone number ID"><Input name="phone_number_id" defaultValue={s.phoneNumberId ?? wa.phoneNumberId ?? ''} inputMode="numeric" /></Field>
            <Field label="WhatsApp Business Account ID"><Input name="waba_id" defaultValue={s.wabaId ?? ''} inputMode="numeric" /></Field>
            <Field label="Access token" hint={wa.hasToken ? 'A token is configured. Leave blank to keep it. Tokens are encrypted at rest and never shown again.' : 'Use a permanent System User token. Alternatively set WHATSAPP_ACCESS_TOKEN as a server environment variable.'}><Input name="token" type="password" autoComplete="off" placeholder={wa.hasToken ? '••••••••••••' : ''} /></Field>
            <Field label="Estimated cost per message (AED)" hint="Optional – only used to show an estimate in the delivery log."><Input name="cost" type="number" step="0.0001" min="0" defaultValue={s.whatsappCostPerMessage ?? ''} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sandbox" defaultChecked={s.whatsappMode === 'sandbox'} />Force sandbox mode (never send real messages)</label></ActionForm>
          <ActionButton action={clearWhatsAppToken} variant="ghost" confirm="Remove the stored WhatsApp token?">Remove stored token</ActionButton></div>
          <div className="space-y-3 text-sm"><h3 className="font-medium">Webhook (delivery receipts &amp; STOP replies)</h3>
            <p className="text-muted">In Meta → WhatsApp → Configuration set:</p>
            <dl className="space-y-1 rounded-md bg-surface-2 p-3 font-mono text-xs"><div>Callback URL: <b className="select-all">{appUrl}/api/webhooks/whatsapp</b></div><div>Verify token: the value of <b>WHATSAPP_VERIFY_TOKEN</b></div><div>Subscribe to field: <b>messages</b></div></dl>
            <p className="text-muted">The server also needs <code>WHATSAPP_APP_SECRET</code> to verify signatures; unsigned requests are rejected.</p>
            <h3 className="pt-2 font-medium">Message templates to approve in Meta</h3>
            {(Object.keys(TEMPLATE_META) as (keyof typeof TEMPLATE_META)[]).map(k => <details key={k} className="rounded-md border border-border p-2"><summary className="cursor-pointer font-mono text-xs">{TEMPLATE_META[k].metaName} <span className="text-muted">({TEMPLATE_META[k].language}, utility)</span></summary><pre className="mt-2 whitespace-pre-wrap text-xs text-muted">{templateBody(k)}</pre></details>)}</div></div></Card>}
    </div></>
}
