import { getCtx } from '@/lib/auth'
import { Alert, Badge, Card, CardHeader, Field, Input, PageHeader, Select } from '@/components/ui/primitives'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { MfaSetup } from '@/components/mfa-setup'
import { clearWhatsAppToken, saveCompany, saveReminderSettings, saveWhatsApp, setLocale } from '@/app/actions/admin'
import { parseSettings } from '@/lib/reminders/settings'
import { whatsappStatus } from '@/lib/reminders/mode'
import { TEMPLATE_META, templateBody } from '@/lib/whatsapp/templates'
import { LOCALE_NAMES, LOCALES } from '@/lib/i18n'
import { BrandingSettings } from '@/components/sales/branding-settings'
import { NumberingSettings } from '@/components/settings/numbering'
import { AiAutomation } from '@/components/settings/ai-automation'
import { TemplatesSettings } from '@/components/settings/templates'
import { TemplateBuilderSection } from '@/components/settings/templates-section'
import { DataBackup } from '@/components/settings/data-backup'
import { ApprovalRules } from '@/components/settings/approval-rules'
import { CustomFieldsSettings } from '@/components/settings/custom-fields'
import { PublicFormsSettings } from '@/components/settings/public-forms'
import { NotificationRules } from '@/components/settings/notification-rules'
import { ScheduledReports } from '@/components/settings/scheduled-reports'
import { Integrations } from '@/components/settings/integrations'
import { MySessions } from '@/components/settings/sessions'
import { WhatsAppTemplates } from '@/components/settings/whatsapp-templates'
import { testWhatsAppConnection } from '@/app/actions/whatsapp'
import Link from 'next/link'

export const metadata = { title: 'Settings' }
export default async function Settings() {
  const c = await getCtx(); const admin = c.can('settings.manage')
  const { data: st } = await c.supabase.from('app_settings').select('key,value'); const s = parseSettings(st ?? [])
  const wa = admin ? await whatsappStatus(c.company.id) : null
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://YOUR-APP-URL'
  // order follows how a business sets Averiqo up: who we are → how documents look → how they are numbered → who gets told → integrations → data
  const sections: [string, string, boolean][] = [['company', 'Company, tax & currency', admin], ['branding', 'Branding & document layout', admin], ['builder', 'Template builder', admin], ['templates', 'Terms templates', admin], ['numbering', 'Numbering', admin], ['approvals', 'Approvals', admin], ['custom', 'Custom fields & statuses', admin], ['forms', 'Public forms', admin],
    ['notifications', 'Notifications', admin], ['rules', 'Notification rules', admin], ['schedules', 'Scheduled reports', admin], ['whatsapp', 'WhatsApp', admin && !!wa], ['wa-templates', 'WhatsApp templates', admin && !!wa], ['ai', 'AI & OCR', admin],
    ['integrations', 'API & webhooks', admin], ['account', 'Account & security', true], ['data', 'Data & backup', true]]
  return <><PageHeader title="Settings" sub={`${c.company.name} · ${c.company.timezone} · ${c.company.currency}`} />
    <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
    <nav aria-label="Settings sections" className="lg:sticky lg:top-20 lg:self-start">
      <ul className="flex gap-1 overflow-x-auto pb-1 text-sm lg:flex-col lg:overflow-visible lg:pb-0">
        {sections.filter(x => x[2]).map(([id, l]) => <li key={id} className="shrink-0"><a href={`#${id}`} className="block rounded-md px-2.5 py-1.5 text-muted hover:bg-surface-2 hover:text-fg">{l}</a></li>)}
      </ul>
      {(c.can('users.manage') || c.can('records.delete') || c.can('audit.view')) && <ul className="mt-3 hidden border-t border-border pt-3 text-sm lg:block">
        {c.can('users.manage') && <li><Link href="/users" className="block rounded-md px-2.5 py-1.5 text-muted hover:bg-surface-2 hover:text-fg">Users & permissions</Link></li>}
        {c.can('audit.view') && <li><Link href="/audit" className="block rounded-md px-2.5 py-1.5 text-muted hover:bg-surface-2 hover:text-fg">Audit log</Link></li>}
        {c.can('records.delete') && <li><Link href="/trash" className="block rounded-md px-2.5 py-1.5 text-muted hover:bg-surface-2 hover:text-fg">Trash</Link></li>}</ul>}
    </nav>
    <div className="flex min-w-0 max-w-4xl flex-col gap-5 [&>*]:scroll-mt-20">
      {admin && <Card id="company"><CardHeader title="Company, tax & currency" sub="The legal company name prints on quotations, invoices and delivery notes." /><div className="p-4"><ActionForm action={saveCompany} resetOnSuccess={false}>
        <Field label="Company name"><Input name="name" defaultValue={c.company.name} required /></Field><Field label="Trade name"><Input name="trade_name" /></Field>
        <p className="text-xs text-muted">Time zone: {c.company.timezone} · Currency: {c.company.currency} (fixed in this version).</p></ActionForm></div></Card>}




      {admin && <BrandingSettings c={c} />}

      {admin && <TemplateBuilderSection c={c} />}
      {admin && <TemplatesSettings c={c} />}

      {admin && <NumberingSettings c={c} />}
      {admin && <ApprovalRules c={c} />}
      {admin && <CustomFieldsSettings c={c} />}
      {admin && <PublicFormsSettings c={c} />}

      {admin && <Card id="notifications"><CardHeader title="Notifications and reminder schedule" sub="Applies to every document, cheque and reminder unless overridden on the item or category." /><div className="p-4"><ActionForm action={saveReminderSettings} resetOnSuccess={false}>
        <Field label="Remind … days before" hint="Comma-separated. 0 = on the due date."><Input name="offsets" defaultValue={s.offsets!.join(', ')} /></Field>
        <div className="grid gap-4 sm:grid-cols-3"><Field label="Overdue: repeat every (days)"><Input type="number" name="overdue_every" min="0" max="90" defaultValue={s.overdueEveryDays} /></Field><Field label="Max overdue reminders"><Input type="number" name="overdue_max" min="0" max="52" defaultValue={s.overdueMax} /></Field><Field label="Daily summary hour"><Input type="number" name="digest_hour" min="0" max="23" defaultValue={s.digestHour} /></Field></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="digest" defaultChecked={s.digestEnabled} />Send the daily summary to recipients who opted in</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="fallback" defaultChecked={s.emailFallback} />Email fallback when a WhatsApp message fails permanently</label></ActionForm></div></Card>}

      {admin && <NotificationRules c={c} />}
      {admin && <ScheduledReports c={c} />}

      {admin && wa && <Card id="whatsapp"><CardHeader title="WhatsApp Business Platform (Meta Cloud API)" action={<Badge tone={wa.mode === 'live' ? 'green' : 'amber'}>{wa.mode === 'live' ? 'Live' : 'Sandbox'}</Badge>} />
        <div className="grid gap-6 p-4 lg:grid-cols-2"><div className="space-y-4">
          <Alert tone={wa.mode === 'live' ? 'green' : 'amber'}>{wa.reason}</Alert>
          <ActionForm action={saveWhatsApp} resetOnSuccess={false}>
            <Field label="Phone number ID"><Input name="phone_number_id" defaultValue={s.phoneNumberId ?? wa.phoneNumberId ?? ''} inputMode="numeric" /></Field>
            <Field label="WhatsApp Business Account ID" hint="needed to submit and check message templates"><Input name="waba_id" defaultValue={s.wabaId ?? ''} inputMode="numeric" /></Field>
            <Field label="Meta App ID" hint="optional; needed only to submit templates that attach a PDF (example document upload)"><Input name="app_id" defaultValue={typeof st?.find(x => x.key === 'whatsapp.app_id')?.value === 'string' ? st!.find(x => x.key === 'whatsapp.app_id')!.value : ''} inputMode="numeric" /></Field>
            <Field label="Access token" hint={wa.hasToken ? 'A token is configured. Leave blank to keep it. Tokens are encrypted at rest and never shown again.' : 'Use a permanent System User token. Alternatively set WHATSAPP_ACCESS_TOKEN as a server environment variable.'}><Input name="token" type="password" autoComplete="off" placeholder={wa.hasToken ? '••••••••••••' : ''} /></Field>
            <Field label="Estimated cost per message (AED)" hint="Optional – only used to show an estimate in the delivery log."><Input name="cost" type="number" step="0.0001" min="0" defaultValue={s.whatsappCostPerMessage ?? ''} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sandbox" defaultChecked={s.whatsappMode === 'sandbox'} />Force sandbox mode (never send real messages)</label></ActionForm>
          <div className="flex flex-wrap gap-2"><ActionButton action={testWhatsAppConnection} variant="secondary">Test connection</ActionButton><ActionButton action={clearWhatsAppToken} variant="ghost" confirm="Remove the stored WhatsApp token?">Remove stored token</ActionButton></div></div>
          <div className="space-y-3 text-sm"><h3 className="font-medium">Webhook (delivery receipts &amp; STOP replies)</h3>
            <p className="text-muted">In Meta → WhatsApp → Configuration set:</p>
            <dl className="space-y-1 rounded-md bg-surface-2 p-3 font-mono text-xs"><div>Callback URL: <b className="select-all">{appUrl}/api/webhooks/whatsapp</b></div><div>Verify token: the value of <b>WHATSAPP_VERIFY_TOKEN</b></div><div>Subscribe to field: <b>messages</b></div></dl>
            <p className="text-muted">The server also needs <code>META_APP_SECRET</code> to verify signatures; unsigned requests are rejected.</p>
            <h3 className="pt-2 font-medium">Message templates to approve in Meta</h3>
            {(Object.keys(TEMPLATE_META) as (keyof typeof TEMPLATE_META)[]).map(k => <details key={k} className="rounded-md border border-border p-2"><summary className="cursor-pointer font-mono text-xs">{TEMPLATE_META[k].metaName} <span className="text-muted">({TEMPLATE_META[k].language}, utility)</span></summary><pre className="mt-2 whitespace-pre-wrap text-xs text-muted">{templateBody(k)}</pre></details>)}</div></div></Card>}

      {admin && wa && <WhatsAppTemplates c={c} live={wa.mode === 'live'} />}
      {admin && <AiAutomation c={c} wa={wa} />}
      {admin && <Integrations c={c} />}

      <Card id="account"><CardHeader title="Your account & security" sub="Language, two-step verification, signed-in devices and sign-in history. Light / dark theme is in the toolbar." /><div className="space-y-5 p-4 text-sm">
        <div><div className="text-xs text-muted">Signed in as</div><div>{c.email} · <span className="capitalize">{c.profile.role.replace('_', ' ')}</span></div></div>
        <ActionForm action={setLocale} submit="Save language" resetOnSuccess={false}><Field label="Interface language" hint="Arabic (right-to-left) and Bengali currently translate navigation and chrome only; page content is English."><Select name="locale" defaultValue={c.profile.locale}>{LOCALES.map(l => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}</Select></Field></ActionForm>
        <div><h3 className="mb-2 font-medium">Two-step verification</h3><MfaSetup /></div>
        <MySessions c={c} /></div></Card>

      <DataBackup c={c} />
    </div></div></>
}
