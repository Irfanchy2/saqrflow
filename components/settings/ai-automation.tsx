import { BrainCircuit, KeyRound, ScanText, Send } from 'lucide-react'
import type { Ctx } from '@/lib/auth'
import { Alert, Badge, Card, CardHeader, Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { clearAiSecret, saveAiSettings, sendTestReminder, testAiProvider, testOcrProvider } from '@/app/actions/ai'
import { getSecret, mask, secretSource, SECRETS, type SecretName } from '@/lib/ai/secrets'
import { OCR_MODES, ocrProviders } from '@/lib/ai/ocr'
import { parseServiceAccount } from '@/lib/ai/ocr/google-vision'
import { AI_MODES, aiProviders } from '@/lib/ai/llm'
import { aiSettings } from '@/lib/inbox/pipeline'
import type { WaStatus } from '@/lib/reminders/mode'

/** Settings → AI & Automation: provider choice, connection status, tests, usage. Secrets are never displayed. */
export async function AiAutomation({ c, wa }: { c: Ctx; wa: WaStatus | null }) {
  const [s, ocr, ai] = await Promise.all([aiSettings(c), ocrProviders(c.company.id), aiProviders(c.company.id)])
  const keys = Object.fromEntries(await Promise.all((Object.keys(SECRETS) as SecretName[]).map(async k => [k, await getSecret(c.company.id, k)] as const))) as Record<SecretName, string | null>
  const sa = parseServiceAccount(keys.google_service_account, process.env.GOOGLE_APPLICATION_CREDENTIALS)
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
  const [{ data: usage }, { data: recips }, { count: docs }] = await Promise.all([
    c.supabase.from('ai_usage_daily').select('kind,provider,calls,failures,cache_hits,volume').gte('day', since),
    c.supabase.from('notification_recipients').select('id,name,whatsapp_opt_in').eq('is_active', true).not('whatsapp_number', 'is', null).limit(50),
    c.supabase.from('document_inbox').select('id', { count: 'exact', head: true }).gte('created_at', since),
  ])
  const sum = (kind: string, provider?: string) => (usage ?? []).filter(u => u.kind === kind && (!provider || u.provider === provider)).reduce((a, u) => ({ calls: a.calls + u.calls, failures: a.failures + u.failures, cache: a.cache + u.cache_hits }), { calls: 0, failures: 0, cache: 0 })
  const encOk = !!process.env.SETTINGS_ENCRYPTION_KEY

  const Status = ({ on, label }: { on: boolean; label?: string }) => <Badge tone={on ? 'green' : 'neutral'}>{label ?? (on ? 'Configured' : 'Not configured')}</Badge>
  const KeyRow = ({ name, hint, multiline }: { name: SecretName; hint: string; multiline?: boolean }) => {
    const v = keys[name], src = secretSource(name)
    return <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-medium">{SECRETS[name].label}</span>
        <span className="flex items-center gap-2 text-muted">{v ? <><KeyRound size={12} aria-hidden /><code>{name === 'google_service_account' ? (sa?.client_email ?? 'set') : mask(v)}</code>{src === 'env' ? <Badge>env: {SECRETS[name].env}</Badge> : <ActionButton variant="ghost" action={clearAiSecret.bind(null, name)} confirm={`Remove the stored ${SECRETS[name].label}?`}>Remove</ActionButton>}</> : 'not set'}</span></div>
      {src !== 'env' && (multiline ? <Textarea name={name} rows={2} placeholder={v ? 'Paste to replace (leave blank to keep)' : hint} autoComplete="off" spellCheck={false} className="font-mono text-xs" />
        : <Input name={name} type="password" placeholder={v ? 'Enter a new key to replace (leave blank to keep)' : hint} autoComplete="off" />)}
    </div>
  }

  return <Card className="lg:col-span-2" id="ai">
    <CardHeader title="AI & Automation" sub="How uploaded documents are read (OCR) and classified (AI). Keys stay on the server and are never shown again." action={<Badge tone="blue">{OCR_MODES.find(m => m.id === s.ocr)?.label.split(' (')[0]} · {AI_MODES.find(m => m.id === s.ai)?.label.split(' (')[0]}</Badge>} />
    <div className="grid gap-6 p-4 xl:grid-cols-2">
      <ActionForm action={saveAiSettings} resetOnSuccess={false} submit="Save AI settings">
        <div className="grid gap-4">
          <Field label="OCR provider"><Select name="ocr_provider" defaultValue={s.ocr}>{OCR_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</Select></Field>
          <Field label="AI classification"><Select name="ai_provider" defaultValue={s.ai}>{AI_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</Select></Field>
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="redact" defaultChecked={s.redact} className="mt-0.5" /><span><b>Remove ID numbers before AI</b> (recommended) — Emirates ID, passport MRZ, IBAN and card numbers are replaced with placeholders before text is sent to Gemini; SaqrFlow reads and checks those numbers itself.</span></label>
        {!encOk && <Alert tone="amber">Keys typed here need <code>SETTINGS_ENCRYPTION_KEY</code> on the server. Without it, set them as environment variables instead.</Alert>}
        <KeyRow name="ocr_space_api_key" hint="OCR.Space API key (K…)" />
        <KeyRow name="gemini_api_key" hint="Gemini API key (AIza…)" />
        <KeyRow name="google_vision_api_key" hint="Google Vision API key (optional, if not using a service account)" />
        <KeyRow name="google_service_account" hint='Google service-account JSON {"client_email": …, "private_key": …}' multiline />
      </ActionForm>

      <div className="space-y-4 text-sm">
        <div className="rounded-lg border border-border">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2 font-medium"><ScanText size={15} className="text-primary" aria-hidden />OCR connection</div>
          <ul className="divide-y divide-border">{(['google_vision', 'ocrspace', 'tesseract'] as const).map(k => <li key={k} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="flex-1">{ocr[k].label}{k === 'google_vision' && sa ? <span className="block text-xs text-muted">Service account · project {process.env.GOOGLE_CLOUD_PROJECT_ID || sa.project_id || '—'}</span> : null}</span>
            <Status on={ocr[k].configured()} label={k === 'tesseract' ? 'Built in' : undefined} />
            {ocr[k].configured() && <ActionButton action={testOcrProvider.bind(null, k)}>Test connection</ActionButton>}</li>)}</ul>
        </div>
        <div className="rounded-lg border border-border">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2 font-medium"><BrainCircuit size={15} className="text-primary" aria-hidden />AI status</div>
          <ul className="divide-y divide-border">{(['gemini', 'claude'] as const).map(k => <li key={k} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="flex-1">{ai[k].label} <span className="text-xs text-muted">{ai[k].model}</span></span><Status on={ai[k].configured()} />
            {ai[k].configured() && <ActionButton action={testAiProvider.bind(null, k)}>Test AI</ActionButton>}</li>)}</ul>
        </div>
        <div className="rounded-lg border border-border">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2 font-medium"><Send size={15} className="text-primary" aria-hidden />WhatsApp status <span className="ms-auto"><Badge tone={wa?.mode === 'live' ? 'green' : 'amber'}>{wa?.mode === 'live' ? 'Live' : 'Sandbox'}</Badge></span></div>
          <div className="space-y-2 px-3 py-2"><p className="text-xs text-muted">{wa?.reason}</p>
            {(recips ?? []).length ? <ActionForm action={sendTestReminder} submit="Send test reminder" variant="secondary" resetOnSuccess={false} className="flex flex-wrap items-end gap-2">
              <Field label="Recipient" className="min-w-48 flex-1"><Select name="recipient_id">{(recips ?? []).map(r => <option key={r.id} value={r.id}>{r.name}{r.whatsapp_opt_in !== 'opted_in' ? ' (not opted in)' : ''}</option>)}</Select></Field></ActionForm>
              : <p className="text-xs text-muted">Add a WhatsApp recipient under Smart Reminders to send a test.</p>}</div>
        </div>
        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-3 py-2 font-medium">Usage — last 30 days <span className="text-xs font-normal text-muted">(cost control)</span></div>
          <dl className="grid grid-cols-2 gap-px bg-border text-xs sm:grid-cols-4">{[
            ['Documents processed', String(docs ?? 0)],
            ['OCR calls', `${sum('ocr').calls}${sum('ocr').failures ? ` · ${sum('ocr').failures} failed` : ''}`],
            ['Gemini calls', `${sum('ai', 'gemini').calls}${sum('ai', 'gemini').failures ? ` · ${sum('ai', 'gemini').failures} failed` : ''}`],
            ['Cache hits (no API cost)', String(sum('ocr').cache + sum('ai').cache)],
          ].map(([k, v]) => <div key={k} className="bg-surface p-3"><dt className="text-muted">{k}</dt><dd className="mt-0.5 text-base font-semibold tabular-nums">{v}</dd></div>)}</dl>
          <p className="px-3 py-2 text-xs text-muted">Re-uploading an identical file reuses the earlier reading instead of calling OCR/AI again. Digital PDFs are read on the server without any OCR call.</p>
        </div>
      </div>
    </div>
  </Card>
}
