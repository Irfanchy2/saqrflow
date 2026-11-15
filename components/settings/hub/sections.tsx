import 'server-only'
import type { ReactNode } from 'react'
import type { Ctx } from '@/lib/auth'
import { Alert, Badge, Card, CardHeader, Field, Input, Select } from '@/components/ui/primitives'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { MfaSetup } from '@/components/mfa-setup'
import { clearWhatsAppToken, saveCompany, saveReminderSettings, saveWhatsApp, setLocale } from '@/app/actions/admin'
import { testWhatsAppConnection } from '@/app/actions/whatsapp'
import { parseSettings } from '@/lib/reminders/settings'
import { whatsappStatus } from '@/lib/reminders/mode'
import { TEMPLATE_META, templateBody } from '@/lib/whatsapp/templates'
import { LOCALE_NAMES, LOCALES } from '@/lib/i18n'
import { companyNameAr } from '@/lib/sales/paid-stamp'
import { BrandingSettings } from '@/components/sales/branding-settings'
import { NumberingSettings } from '@/components/settings/numbering'
import { AiAutomation } from '@/components/settings/ai-automation'
import { TemplatesSettings } from '@/components/settings/templates'
import { TemplateBuilderSection } from '@/components/settings/templates-section'
import { DataBackup } from '@/components/settings/data-backup'
import { ApprovalRules } from '@/components/settings/approval-rules'
import { PortalSettingsCard } from '@/components/settings/portal-settings'
import { CompanyCardsSettings } from '@/components/settings/company-cards'
import { CustomFieldsSettings } from '@/components/settings/custom-fields'
import { PublicFormsSettings } from '@/components/settings/public-forms'
import { NotificationRules } from '@/components/settings/notification-rules'
import { ScheduledReports } from '@/components/settings/scheduled-reports'
import { Integrations } from '@/components/settings/integrations'
import { MySessions } from '@/components/settings/sessions'
import { WhatsAppTemplates } from '@/components/settings/whatsapp-templates'
import { ShareMessages } from '@/components/settings/share-messages'
import { EvolutionSettings } from '@/components/settings/evolution'
import { ThemeChoice } from './theme-choice'
import Link from 'next/link'
import type { CategoryDef } from '@/lib/settings/catalog'

/**
 * The settings sections of one category, exactly as they were on the single Settings page (same forms, same actions,
 * same saved values); only where they are shown changed. Shared data is loaded once per page and only when needed.
 */
export async function CategorySections({ c, cat }: { c: Ctx; cat: CategoryDef }) {
  const ids = new Set(cat.sections.map(s => s.id))
  const needs = (...x: string[]) => x.some(i => ids.has(i))
  const admin = c.can('settings.manage')
  const [stRes, wa, nameAr] = await Promise.all([
    needs('notifications', 'evolution', 'whatsapp') ? c.supabase.from('app_settings').select('key,value') : Promise.resolve({ data: null }),
    admin && needs('evolution', 'whatsapp', 'wa-templates', 'ai') ? whatsappStatus(c.company.id) : Promise.resolve(null),
    admin && needs('company') ? companyNameAr(c) : Promise.resolve(null),
  ])
  const st = (stRes.data ?? []) as { key: string; value: unknown }[], s = parseSettings(st as any)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://YOUR-APP-URL'

  const render: Record<string, () => ReactNode> = {
    company: () => <><Card id="company"><CardHeader title="Company, tax & currency" sub="The legal company name prints on quotations, invoices and delivery notes." /><div className="p-4"><ActionForm action={saveCompany} resetOnSuccess={false}>
      <Field label="Company name"><Input name="name" defaultValue={c.company.name} required /></Field><Field label="Trade name"><Input name="trade_name" /></Field>
      <Field label="Company name in Arabic" hint="Printed around the top of the green PAID stamp on fully paid tax invoices. Enter the registered Arabic name exactly as on your trade licence. Leave empty to show the English name only."><Input name="name_ar" defaultValue={nameAr ?? ''} dir="rtl" lang="ar" maxLength={200} placeholder="اسم الشركة بالعربية" /></Field>
      <p className="text-xs text-muted">Time zone: {c.company.timezone} · Currency: {c.company.currency} (fixed in this version).</p></ActionForm></div></Card>
      <Link href="/settings/documents#branding" className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm transition-colors hover:bg-surface-2" data-related>
        <span><span className="font-medium">Logo, address, phone, TRN and bank details</span><span className="block text-xs text-muted">They print on your documents, so they are kept with Document branding &amp; layout.</span></span>
        <span className="shrink-0 font-medium text-primary">Open</span></Link></>,
    branding: () => <BrandingSettings c={c} />,
    builder: () => <TemplateBuilderSection c={c} />,
    templates: () => <TemplatesSettings c={c} />,
    numbering: () => <NumberingSettings c={c} />,
    approvals: () => <ApprovalRules c={c} />,
    'employee-portal': () => <PortalSettingsCard c={c} />,
    'company-cards': () => <CompanyCardsSettings c={c} />,
    custom: () => <CustomFieldsSettings c={c} />,
    forms: () => <PublicFormsSettings c={c} />,
    notifications: () => <Card id="notifications"><CardHeader title="Notifications and reminder schedule" sub="Applies to every document, cheque and reminder unless overridden on the item or category." /><div className="p-4"><ActionForm action={saveReminderSettings} resetOnSuccess={false}>
      <Field label="Remind … days before" hint="Comma-separated. 0 = on the due date."><Input name="offsets" defaultValue={s.offsets!.join(', ')} inputMode="numeric" /></Field>
      <div className="grid gap-4 sm:grid-cols-3"><Field label="Overdue: repeat every (days)"><Input type="number" name="overdue_every" min="0" max="90" defaultValue={s.overdueEveryDays} inputMode="numeric" /></Field><Field label="Max overdue reminders"><Input type="number" name="overdue_max" min="0" max="52" defaultValue={s.overdueMax} inputMode="numeric" /></Field><Field label="Daily summary hour"><Input type="number" name="digest_hour" min="0" max="23" defaultValue={s.digestHour} inputMode="numeric" /></Field></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="digest" defaultChecked={s.digestEnabled} />Send the daily summary to recipients who opted in</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="fallback" defaultChecked={s.emailFallback} />Email fallback when a WhatsApp message fails permanently</label></ActionForm></div></Card>,
    rules: () => <NotificationRules c={c} />,
    schedules: () => <ScheduledReports c={c} />,
    evolution: () => wa && <EvolutionSettings companyId={c.company.id} s={s} wa={wa} />,
    whatsapp: () => wa && <Card id="whatsapp"><CardHeader title="WhatsApp Business Platform (Meta Cloud API)" action={<Badge tone={wa.mode === 'live' ? 'green' : 'amber'}>{wa.mode === 'live' ? 'Live' : 'Sandbox'}</Badge>} />
      <div className="grid gap-6 p-4 lg:grid-cols-2"><div className="min-w-0 space-y-4">
        <Alert tone={wa.mode === 'live' ? 'green' : 'amber'}>{wa.reason}</Alert>
        <ActionForm action={saveWhatsApp} resetOnSuccess={false}>
          <Field label="Phone number ID"><Input name="phone_number_id" defaultValue={s.phoneNumberId ?? wa.phoneNumberId ?? ''} inputMode="numeric" /></Field>
          <Field label="WhatsApp Business Account ID" hint="needed to submit and check message templates"><Input name="waba_id" defaultValue={s.wabaId ?? ''} inputMode="numeric" /></Field>
          <Field label="Meta App ID" hint="optional; needed only to submit templates that attach a PDF (example document upload)"><Input name="app_id" defaultValue={typeof st.find(x => x.key === 'whatsapp.app_id')?.value === 'string' ? st.find(x => x.key === 'whatsapp.app_id')!.value as string : ''} inputMode="numeric" /></Field>
          <Field label="Access token" hint={wa.hasToken ? 'A token is configured. Leave blank to keep it. Tokens are encrypted at rest and never shown again.' : 'Use a permanent System User token. Alternatively set WHATSAPP_ACCESS_TOKEN as a server environment variable.'}><Input name="token" type="password" autoComplete="off" placeholder={wa.hasToken ? '••••••••••••' : ''} /></Field>
          <Field label="Estimated cost per message (AED)" hint="Optional – only used to show an estimate in the delivery log."><Input name="cost" type="number" step="0.0001" min="0" defaultValue={s.whatsappCostPerMessage ?? ''} inputMode="decimal" /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sandbox" defaultChecked={s.whatsappMode === 'sandbox'} />Force sandbox mode (never send real messages)</label></ActionForm>
        <div className="flex flex-wrap gap-2"><ActionButton action={testWhatsAppConnection} variant="secondary">Test connection</ActionButton><ActionButton action={clearWhatsAppToken} variant="ghost" confirm="Remove the stored WhatsApp token?">Remove stored token</ActionButton></div></div>
        <div className="min-w-0 space-y-3 text-sm"><h3 className="font-medium">Webhook (delivery receipts &amp; STOP replies)</h3>
          <p className="text-muted">In Meta → WhatsApp → Configuration set:</p>
          <dl className="space-y-1 break-all rounded-md bg-surface-2 p-3 font-mono text-xs"><div>Callback URL: <b className="select-all">{appUrl}/api/webhooks/whatsapp</b></div><div>Verify token: the value of <b>WHATSAPP_VERIFY_TOKEN</b></div><div>Subscribe to field: <b>messages</b></div></dl>
          <p className="text-muted">The server also needs <code>META_APP_SECRET</code> to verify signatures; unsigned requests are rejected.</p>
          <h3 className="pt-2 font-medium">Message templates to approve in Meta</h3>
          {(Object.keys(TEMPLATE_META) as (keyof typeof TEMPLATE_META)[]).map(k => <details key={k} className="rounded-md border border-border p-2"><summary className="cursor-pointer font-mono text-xs">{TEMPLATE_META[k].metaName} <span className="text-muted">({TEMPLATE_META[k].language}, utility)</span></summary><pre className="mt-2 whitespace-pre-wrap text-xs text-muted">{templateBody(k)}</pre></details>)}</div></div></Card>,
    'wa-templates': () => wa && <WhatsAppTemplates c={c} live={wa.mode === 'live'} />,
    'wa-share': () => <ShareMessages c={c} />,
    ai: () => <AiAutomation c={c} wa={wa} />,
    integrations: () => <Integrations c={c} />,
    account: () => <Card id="account"><CardHeader title="Your account & security" sub="Two-step verification, signed-in devices and sign-in history." /><div className="space-y-5 p-4 text-sm">
      <div><div className="text-xs text-muted">Signed in as</div><div className="break-all">{c.email} · <span className="capitalize">{c.profile.role.replace('_', ' ')}</span></div></div>
      <div id="mfa" className="scroll-mt-32"><h3 className="mb-2 font-medium">Two-step verification</h3>{c.company.is_demo ? <p className="text-muted">Not available in the shared demo (it would lock other visitors out).</p> : <MfaSetup />}</div>
      <MySessions c={c} /></div></Card>,
    theme: () => <Card id="theme"><CardHeader title="Theme" sub="Applies to this browser. The sun / moon switch in the toolbar changes the same setting." /><div className="p-4"><ThemeChoice /></div></Card>,
    language: () => <Card id="language"><CardHeader title="Interface language" sub="Your own choice; other users keep theirs." /><div className="p-4 text-sm">
      <ActionForm action={setLocale} submit="Save language" resetOnSuccess={false}><Field label="Interface language" hint="Arabic (right-to-left) and Bengali currently translate navigation and chrome only; page content is English."><Select name="locale" defaultValue={c.profile.locale}>{LOCALES.map(l => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}</Select></Field></ActionForm></div></Card>,
    data: () => <DataBackup c={c} />,
  }
  return <>{cat.sections.map(sec => <div key={sec.id} className="min-w-0 scroll-mt-32 lg:scroll-mt-20 [&>*+*]:mt-3">{render[sec.id]?.()}</div>)}</>
}
