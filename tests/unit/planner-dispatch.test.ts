import { describe, it, expect } from 'vitest'
import { planNotifications, type Source, type Recipient } from '@/lib/reminders/planner'
import { processBatch, backoffMs, type Store, type LogRow, type RecipientInfo, type Patch, type Senders } from '@/lib/reminders/dispatch'
import { renderText, documentParams, paymentParams, sanitizeParam, cloudApiPayload, digestParams } from '@/lib/whatsapp/templates'
import { classifyMetaError, sendWhatsApp, sendEmail } from '@/lib/whatsapp/client'

const TODAY = '2026-10-04'
const doc: Source = { company_id: 'c1', source_type: 'document', source_id: 'd1', title: 'Employee Residence Visa', subject: 'Mohammed', category: 'Residence Visa', owner_type: 'employee', due_date: '2026-10-20', offsets: null, amount: null, direction: null, link: '/employees/e1' }
const chq: Source = { company_id: 'c1', source_type: 'cheque', source_id: 'ch1', title: 'Cheque 100001', subject: 'ABC Trading', category: 'ENBD', owner_type: null, due_date: '2026-10-20', offsets: null, amount: 15000, direction: 'outgoing', link: '/cheques' }
const rcpt = (o: Partial<Recipient> = {}): Recipient => ({ id: 'r1', user_id: 'u1', whatsapp_number: '+971501234567', email: 'a@b.ae', channels: ['whatsapp', 'email', 'in_app'], whatsapp_opt_in: 'opted_in', receives_cheque_alerts: true, receives_hr_alerts: true, is_active: true, ...o })

describe('message content & privacy', () => {
  it('document reminder matches the specified wording', () => {
    const t = renderText('document_reminder', documentParams({ title: 'Employee Residence Visa', subject: 'Mohammed', expiry: '2026-10-20', daysRemaining: 16 }))
    expect(t).toContain('SAQRFLOW REMINDER'); expect(t).toContain('Expiry Date: 20 October 2026'); expect(t).toContain('Days Remaining: 16')
    expect(t).toContain('Status: Renewal Required'); expect(t).toContain('Please log in to SaqrFlow')
  })
  it('cheque alert matches the specified wording', () => {
    const t = renderText('payment_alert', paymentParams({ direction: 'outgoing', kind: 'Cheque', party: 'ABC Trading', amount: 15000, date: '2026-10-20', daysRemaining: 16 }))
    expect(t).toContain('SAQRFLOW PAYMENT ALERT'); expect(t).toContain('Type: Outgoing Cheque'); expect(t).toContain('Amount: AED 15,000')
    expect(t).toContain('Verify available funds and payment status')
  })
  it('long digit runs (ID / passport / account numbers) are masked', () => {
    expect(sanitizeParam('Emirates ID 784-1990-1234567-1 / 784199012345671')).not.toMatch(/\d{8,}/)
    expect(sanitizeParam('P1234567')).toBe('P1234567')
    expect(sanitizeParam('line1\nline2\t  x')).toBe('line1 line2 x')
  })
  it('planner output never carries reference numbers', () => {
    const logs = planNotifications([{ ...doc, title: 'Passport', subject: 'Mohammed' }], [rcpt()], TODAY, {})
    expect(JSON.stringify(logs)).not.toMatch(/reference|passport_no/i)
  })
  it('daily digest has counts only', () => expect(renderText('daily_summary', digestParams({ expiring: 5, cheques: 3, invoices: 4, renewals: 2 }))).toContain('Documents expiring within 30 days: 5'))
  it('Cloud API payload is a template message with ordered body params', () => {
    const p = cloudApiPayload('payment_alert', paymentParams({ direction: 'outgoing', kind: 'Cheque', party: 'ABC', amount: 5, date: '2026-10-20', daysRemaining: 3 }), '+971501234567')
    expect(p.to).toBe('971501234567'); expect(p.type).toBe('template'); expect(p.template.name).toBe('saqrflow_payment_alert')
    expect(p.template.components[0].parameters.map(x => x.text)[0]).toBe('Outgoing Cheque')
    expect(p.template.components[0].parameters).toHaveLength(5)
  })
})

describe('planner: fan-out, opt-in, preferences, duplicate prevention', () => {
  it('plans one log per source × recipient × channel', () => {
    const logs = planNotifications([doc, chq], [rcpt()], TODAY, {})
    expect(logs).toHaveLength(6)
    expect(logs.find(l => l.source_type === 'cheque')!.template).toBe('payment_alert')
  })
  it('re-planning the same day yields identical dedupe keys (so inserts are idempotent)', () => {
    const a = planNotifications([doc, chq], [rcpt()], TODAY, {}).map(l => l.dedupe_key)
    const b = planNotifications([doc, chq], [rcpt()], TODAY, {}).map(l => l.dedupe_key)
    expect(b).toEqual(a); expect(new Set(a).size).toBe(a.length)
  })
  it('next day on the same threshold keeps the same key; crossing a threshold changes it', () => {
    const k = (d: string) => planNotifications([doc], [rcpt({ channels: ['whatsapp'] })], d, {})[0]?.dedupe_key
    expect(k('2026-10-03')).toBe(k('2026-10-04'))      // 17 and 16 days left: both latest-crossed threshold = 30
    expect(k('2026-10-05')).not.toBe(k('2026-10-04'))  // 15 days left: threshold 15 crossed → new key
  })
  it('renewing (new due date) restarts the schedule with new keys', () => {
    const before = planNotifications([doc], [rcpt({ channels: ['whatsapp'] })], TODAY, {})[0].dedupe_key
    const after = planNotifications([{ ...doc, due_date: '2027-10-20' }], [rcpt({ channels: ['whatsapp'] })], '2027-09-20', {})[0].dedupe_key
    expect(after).not.toBe(before)
  })
  it('WhatsApp requires explicit opt-in and a number', () => {
    for (const r of [rcpt({ whatsapp_opt_in: 'pending' }), rcpt({ whatsapp_opt_in: 'opted_out' }), rcpt({ whatsapp_number: null })])
      expect(planNotifications([doc], [r], TODAY, {}).filter(l => l.channel === 'whatsapp')).toHaveLength(0)
  })
  it('respects per-recipient category preferences and inactive recipients', () => {
    expect(planNotifications([chq], [rcpt({ receives_cheque_alerts: false })], TODAY, {})).toHaveLength(0)
    expect(planNotifications([doc], [rcpt({ receives_hr_alerts: false })], TODAY, {})).toHaveLength(0)
    expect(planNotifications([doc], [rcpt({ is_active: false })], TODAY, {})).toHaveLength(0)
  })
  it('per-document offsets win over company settings', () => {
    expect(planNotifications([{ ...doc, offsets: [5] }], [rcpt()], TODAY, { offsets: [30] })).toHaveLength(0)
  })
})

// ── in-memory queue to exercise retry / fallback / quiet hours ──
function memStore(rows: LogRow[], recipients: Record<string, RecipientInfo>) {
  const state = { rows: new Map(rows.map(r => [r.id, { ...r, status: 'queued' } as any])), inApp: [] as string[], patches: [] as [string, Patch][] }
  const store: Store = {
    claim: async () => [...state.rows.values()].filter(r => r.status === 'queued' || r.status === 'retry').map(r => ({ ...r })),
    recipient: async id => recipients[id] ?? null,
    update: async (id, p) => { state.patches.push([id, p]); Object.assign(state.rows.get(id), p) },
    enqueueEmailFallback: async (from, to) => { state.rows.set('fb-' + from.id, { ...from, id: 'fb-' + from.id, channel: 'email', fallback_of: from.id, attempts: 0, status: 'queued' }) },
    createInApp: async log => { state.inApp.push(log.id) },
  }
  return { state, store }
}
const R: RecipientInfo = { id: 'r1', user_id: 'u1', name: 'Owner', whatsapp_number: '+971501234567', email: 'o@x.ae', whatsapp_opt_in: 'opted_in', quiet_start: null, quiet_end: null, is_active: true }
const L = (o: Partial<LogRow> = {}): LogRow => ({ id: 'l1', company_id: 'c1', recipient_id: 'r1', channel: 'whatsapp', template: 'document_reminder', params: documentParams({ title: 'Visa', expiry: '2026-10-20', daysRemaining: 16 }), source_type: 'document', source_id: 'd1', dedupe_key: 'k', attempts: 0, max_attempts: 3, fallback_of: null, ...o })
const okSenders: Senders = { whatsapp: async () => ({ ok: true, sandbox: true }), email: async () => ({ ok: true, sandbox: true }) }
const NOW = new Date('2026-10-04T08:00:00Z')
const opts = { now: NOW, tz: 'Asia/Dubai', emailFallback: true }

describe('dispatcher: sandbox honesty, retry with exponential backoff, fallback', () => {
  it('sandbox sends are recorded as "sandbox", never "sent"/"delivered"', async () => {
    const { store, state } = memStore([L()], { r1: R })
    const s = await processBatch(store, okSenders, opts)
    expect(s.sandbox).toBe(1); expect(s.sent).toBe(0)
    expect(state.rows.get('l1').status).toBe('sandbox'); expect(state.rows.get('l1').sandbox).toBe(true)
  })
  it('real sends are "sent" with the provider message id', async () => {
    const { store, state } = memStore([L()], { r1: R })
    await processBatch(store, { ...okSenders, whatsapp: async () => ({ ok: true, sandbox: false, messageId: 'wamid.1' }) }, opts)
    expect(state.rows.get('l1')).toMatchObject({ status: 'sent', provider_message_id: 'wamid.1', attempts: 1 })
  })
  it('backoff doubles and is capped', () => {
    expect([1, 2, 3, 4, 5].map(backoffMs)).toEqual([60_000, 120_000, 240_000, 480_000, 960_000])
    expect(backoffMs(20)).toBe(6 * 3600_000)
  })
  it('retryable failures are rescheduled with backoff, then fail permanently at max attempts', async () => {
    const fail: Senders = { ...okSenders, whatsapp: async () => ({ ok: false, retryable: true, error: 'HTTP 503' }) }
    const { store, state } = memStore([L({ max_attempts: 3 })], { r1: { ...R, email: null } })
    await processBatch(store, fail, opts)
    let row = state.rows.get('l1')
    expect(row.status).toBe('retry'); expect(row.attempts).toBe(1)
    expect(new Date(row.next_attempt_at).getTime() - NOW.getTime()).toBe(60_000)
    await processBatch(store, fail, { ...opts, now: new Date(NOW.getTime() + 61_000) })
    row = state.rows.get('l1'); expect(row.attempts).toBe(2)
    expect(new Date(row.next_attempt_at).getTime() - (NOW.getTime() + 61_000)).toBe(120_000)
    const s = await processBatch(store, fail, { ...opts, now: new Date(NOW.getTime() + 200_000) })
    expect(state.rows.get('l1')).toMatchObject({ status: 'failed', attempts: 3, last_error: 'HTTP 503' }); expect(s.failed).toBe(1)
  })
  it('permanent errors fail immediately (no retries)', async () => {
    const { store, state } = memStore([L()], { r1: { ...R, email: null } })
    await processBatch(store, { ...okSenders, whatsapp: async () => ({ ok: false, retryable: false, error: 'invalid number' }) }, opts)
    expect(state.rows.get('l1')).toMatchObject({ status: 'failed', attempts: 1 })
  })
  it('thrown exceptions are treated as retryable', async () => {
    const { store, state } = memStore([L()], { r1: R })
    await processBatch(store, { ...okSenders, whatsapp: async () => { throw new Error('boom') } }, opts)
    expect(state.rows.get('l1').status).toBe('retry')
  })
  it('failed WhatsApp → email fallback is queued once; a failed fallback does not cascade', async () => {
    const { store, state } = memStore([L()], { r1: R })
    const failAll: Senders = { whatsapp: async () => ({ ok: false, retryable: false, error: 'x' }), email: async () => ({ ok: false, retryable: false, error: 'y' }) }
    const s = await processBatch(store, failAll, opts)
    expect(s.fallbacks).toBe(1); expect(state.rows.get('fb-l1')).toMatchObject({ channel: 'email', fallback_of: 'l1' })
    const s2 = await processBatch(store, failAll, opts)
    expect(s2.fallbacks).toBe(0); expect(state.rows.get('fb-l1').status).toBe('failed')
  })
  it('fallback disabled → no email', async () => {
    const { store, state } = memStore([L()], { r1: R })
    await processBatch(store, { ...okSenders, whatsapp: async () => ({ ok: false, retryable: false, error: 'x' }) }, { ...opts, emailFallback: false })
    expect(state.rows.has('fb-l1')).toBe(false)
  })
  it('skips WhatsApp for recipients who opted out after the message was queued', async () => {
    let called = 0
    const { store, state } = memStore([L()], { r1: { ...R, whatsapp_opt_in: 'opted_out' } })
    await processBatch(store, { ...okSenders, whatsapp: async () => { called++; return { ok: true, sandbox: false } } }, opts)
    expect(called).toBe(0); expect(state.rows.get('l1').status).toBe('skipped')
  })
  it('quiet hours defer the message without using an attempt', async () => {
    const { store, state } = memStore([L()], { r1: { ...R, quiet_start: '22:00', quiet_end: '07:00' } })
    const night = new Date('2026-10-04T19:00:00Z')   // 23:00 Dubai
    const s = await processBatch(store, okSenders, { ...opts, now: night })
    expect(s.deferred).toBe(1)
    expect(state.rows.get('l1')).toMatchObject({ status: 'queued', attempts: 0, next_attempt_at: '2026-10-05T03:00:00.000Z' })
  })
  it('in-app notifications are created via the store', async () => {
    const { store, state } = memStore([L({ channel: 'in_app' })], { r1: R })
    await processBatch(store, okSenders, opts); expect(state.inApp).toEqual(['l1']); expect(state.rows.get('l1').status).toBe('sent')
  })
  it('missing recipient is skipped', async () => {
    const { store, state } = memStore([L({ recipient_id: 'nope' })], {})
    await processBatch(store, okSenders, opts); expect(state.rows.get('l1').status).toBe('skipped')
  })
})

describe('WhatsApp client', () => {
  const cfg = { phoneNumberId: '123', accessToken: 't', apiVersion: 'v21.0' }
  it('classifies Meta errors', () => {
    expect(classifyMetaError(500, {}).retryable).toBe(true)
    expect(classifyMetaError(429, {}).retryable).toBe(true)
    expect(classifyMetaError(400, { error: { code: 130429, message: 'rate' } }).retryable).toBe(true)
    expect(classifyMetaError(400, { error: { code: 131026, message: 'undeliverable' } }).retryable).toBe(false)
    expect(classifyMetaError(400, { error: { code: 132001, message: 'template missing' } }).error).toContain('132001')
  })
  it('no credentials → sandbox, no network call', async () => {
    const r = await sendWhatsApp({ apiVersion: 'v21.0' }, '+971501234567', 'test_message', { note: 'hi' }, (() => { throw new Error('network!') }) as any)
    expect(r).toEqual({ ok: true, sandbox: true })
    expect(await sendWhatsApp({ ...cfg, forceSandbox: true }, '+971501234567', 'test_message', { note: 'hi' }, (() => { throw new Error('network!') }) as any)).toEqual({ ok: true, sandbox: true })
  })
  it('posts a template to the Graph API with bearer auth and returns the wamid', async () => {
    let seen: any
    const f = (async (url: string, init: any) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.X' }] }) } }) as any
    const r = await sendWhatsApp(cfg, '+971501234567', 'test_message', { note: 'hi' }, f)
    expect(r).toEqual({ ok: true, sandbox: false, messageId: 'wamid.X' })
    expect(seen.url).toBe('https://graph.facebook.com/v21.0/123/messages'); expect(seen.init.headers.Authorization).toBe('Bearer t')
  })
  it('maps HTTP errors and network failures', async () => {
    const bad = (async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 131026, message: 'Message undeliverable' } }) })) as any
    expect(await sendWhatsApp(cfg, '+971501234567', 'test_message', { note: 'hi' }, bad)).toMatchObject({ ok: false, retryable: false })
    const net = (async () => { throw new Error('ECONNRESET') }) as any
    expect(await sendWhatsApp(cfg, '+971501234567', 'test_message', { note: 'hi' }, net)).toMatchObject({ ok: false, retryable: true })
  })
  it('email: sandbox without key, error mapping with key', async () => {
    expect(await sendEmail({}, 'a@b.ae', 's', 't')).toEqual({ ok: true, sandbox: true })
    const f = (async () => ({ ok: false, status: 503, json: async () => ({ message: 'down' }) })) as any
    expect(await sendEmail({ apiKey: 'k', from: 'x@y' }, 'a@b.ae', 's', 't', f)).toMatchObject({ ok: false, retryable: true })
  })
})
