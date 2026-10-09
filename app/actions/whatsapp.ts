'use server'
import { revalidatePath } from 'next/cache'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { KINDS, bodyProblems, maskPhone, toMetaBody } from '@/lib/whatsapp/messages'
import { SendError, companyWhatsApp, loadTemplates, prepare, queueAndSend } from '@/lib/whatsapp/outbox'
import { listTemplates, phoneInfo, submitTemplate } from '@/lib/whatsapp/cloud'
import { renderSimplePdf } from '@/lib/sales/simple-pdf'
import type { ActionState } from '@/lib/utils'

const asState = (e: unknown): ActionState | null => (e instanceof SendError ? { error: e.message } : null)

/** Data for the send dialog: who, which number, the exact message, whether a PDF is attached, template / window state. */
export async function prepareWhatsApp(kind: string, recordId: string): Promise<ActionState> {
  try { const c = await getCtx(); need(c, 'records.edit'); return { ok: true, data: await prepare(c, kind, recordId) } }
  catch (e) { return asState(e) ?? { error: 'Could not prepare the message.' } }
}

export async function sendViaWhatsApp(kind: string, recordId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    try {
      const custom = fd.get('custom') === 'on' ? String(fd.get('text') ?? '') : undefined
      const r = await queueAndSend(c, kind, recordId, str(fd, 'to') ?? '', custom)
      revalidatePath('/', 'layout')
      const to = maskPhone(str(fd, 'to'))
      if (r.status === 'sandbox') return { ok: true, message: `Recorded in sandbox mode: nothing was sent to ${to}. Connect WhatsApp in Settings to send for real.`, data: { status: r.status } }
      if (r.status === 'sent' || r.status === 'delivered' || r.status === 'read') return { ok: true, message: `Sent to ${to}. Delivery is tracked in the history.`, data: { status: r.status } }
      if (r.status === 'retry') return { ok: true, message: `Not sent yet (${r.last_error}). Averiqo retries automatically; see the history.`, data: { status: r.status } }
      return { error: `Not sent: ${r.last_error ?? 'unknown error'}` }
    } catch (e) { const s = asState(e); if (s) return s; throw e }
  })
}

// ───────────── Settings → WhatsApp ─────────────
export async function testWhatsAppConnection(): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const { cfg } = await companyWhatsApp(c.company.id)
    const r = await phoneInfo(cfg)
    return 'error' in r ? { error: r.error } : { ok: true, message: `Connected: ${r.name} · ${r.number}${r.quality ? ` · quality ${r.quality.toLowerCase()}` : ''}` }
  })
}

export async function saveWaTemplate(kind: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    if (!KINDS[kind]) return { error: 'Unknown message type.' }
    const body = (str(fd, 'body') ?? '').replace(/\r/g, '')
    const problems = bodyProblems(kind, body); if (problems.length) return { error: problems.join(' ') }
    const language = /^[a-z]{2}(_[A-Z]{2})?$/.test(str(fd, 'language') ?? '') ? str(fd, 'language')! : 'en'
    const cur = (await loadTemplates(c.supabase, c.company.id))[kind]
    const { error } = await c.supabase.from('app_settings').upsert({ company_id: c.company.id, key: `whatsapp.template.${kind}`, value: { ...cur, body, language }, updated_at: new Date().toISOString() })
    if (error) throw error
    revalidatePath('/settings')
    return { ok: true, message: cur.submitted && cur.submitted.body !== body ? 'Saved. Submit it to WhatsApp again: messages keep using the approved text until the new one is approved.' : 'Saved.' }
  })
}

/** Creates / edits averiqo_<kind> in the WhatsApp Business Account for Meta's review. */
export async function submitWaTemplate(kind: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    if (!KINDS[kind]) return { error: 'Unknown message type.' }
    const wa = await companyWhatsApp(c.company.id)
    if (!wa.live) return { error: 'Connect WhatsApp first (phone number ID, access token, sandbox off).' }
    if (!wa.wabaId) return { error: 'Add your WhatsApp Business Account ID first.' }
    const t = (await loadTemplates(c.supabase, c.company.id))[kind]
    const problems = bodyProblems(kind, t.body); if (problems.length) return { error: problems.join(' ') }
    const examplePdf = KINDS[kind].pdf ? await renderSimplePdf({ title: `${KINDS[kind].label} (example)`, companyName: c.company.name, images: {}, showHeaderFooter: true, left: [['Example:', 'Averiqo template sample']], right: [] }) : undefined
    const r = await submitTemplate(wa.cfg, { wabaId: wa.wabaId, appId: wa.appId ?? undefined, kind, body: t.body, language: t.language, existingId: t.meta?.id, examplePdf })
    if ('error' in r) return { error: r.error }
    const { error } = await c.supabase.from('app_settings').upsert({ company_id: c.company.id, key: `whatsapp.template.${kind}`, value: { ...t, submitted: { body: t.body, at: new Date().toISOString() }, meta: { id: r.id, status: r.status } }, updated_at: new Date().toISOString() })
    if (error) throw error
    revalidatePath('/settings')
    return { ok: true, message: `Submitted to WhatsApp (${r.status.toLowerCase()}). Approval usually takes minutes to a few hours; use “Check status”.` }
  })
}

export async function refreshWaTemplates(): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const wa = await companyWhatsApp(c.company.id)
    if (!wa.live || !wa.wabaId) return { error: 'Connect WhatsApp and add the Business Account ID first.' }
    const list = await listTemplates(wa.cfg, wa.wabaId); if ('error' in list) return { error: list.error }
    const tpls = await loadTemplates(c.supabase, c.company.id); let n = 0
    for (const [k, t] of Object.entries(tpls)) {
      const m = list.find(x => x.name === `averiqo_${k}` && x.language === t.language) ?? list.find(x => x.name === `averiqo_${k}`); if (!m) continue
      const matches = m.body && m.body === toMetaBody(k, t.body).text   // created in WhatsApp Manager with the same text
      await c.supabase.from('app_settings').upsert({ company_id: c.company.id, key: `whatsapp.template.${k}`, value: { ...t, submitted: t.submitted ?? (matches ? { body: t.body, at: new Date().toISOString() } : undefined), meta: { id: m.id, status: m.status, reason: m.rejected_reason } }, updated_at: new Date().toISOString() })
      n++
    }
    revalidatePath('/settings')
    return { ok: true, message: n ? `Status updated for ${n} template(s).` : 'No Averiqo templates found in your WhatsApp account yet.' }
  })
}
