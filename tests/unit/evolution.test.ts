import { describe, expect, it } from 'vitest'
import { classify, createPayload, documentPayload, errorText, jidToE164, mapStatus, parseConnect, parseEvolutionWebhook, serverUrlProblem, textPayload, toNumber, webhookPayload, INSTANCE_RE } from '@/lib/whatsapp/evolution-core'
import { isConfigured } from '@/lib/whatsapp/client'
import { parseSettings } from '@/lib/reminders/settings'

describe('Evolution API server URL', () => {
  it('accepts a public https URL only', () => {
    expect(serverUrlProblem('https://wa.alsaqr.ae')).toBeNull()
    expect(serverUrlProblem('http://wa.alsaqr.ae')).toMatch(/https/)
    expect(serverUrlProblem('https://user:pw@wa.alsaqr.ae')).toMatch(/username/)
    expect(serverUrlProblem('https://wa.alsaqr.ae/?x=1')).toMatch(/query/)
    expect(serverUrlProblem('not a url')).toMatch(/full server URL/)
  })
  it('blocks private, loopback and metadata addresses (SSRF) unless local testing allows them', () => {
    for (const u of ['https://localhost:8080', 'https://127.0.0.1', 'https://10.0.0.5', 'https://169.254.169.254', 'https://192.168.1.10', 'https://[::1]', 'https://evo.internal'])
      expect(serverUrlProblem(u), u).toMatch(/public internet/)
    expect(serverUrlProblem('http://127.0.0.1:54399/mock/evolution', true)).toBeNull()
  })
  it('instance names are short slugs', () => {
    expect(INSTANCE_RE.test('alsaqr-main')).toBe(true)
    expect(INSTANCE_RE.test('a')).toBe(false)
    expect(INSTANCE_RE.test('../admin')).toBe(false)
  })
})

describe('Evolution API payloads', () => {
  it('numbers go as digits, text without link preview', () => {
    expect(toNumber('+971 50 111 2222')).toBe('971501112222')
    expect(textPayload('+971501112222', 'Hello')).toEqual({ number: '971501112222', text: 'Hello', linkPreview: false })
  })
  it('the PDF as a document with file name and caption', () => {
    expect(documentPayload('+971501112222', 'JVBERi0=', 'INV-1.pdf', 'Your invoice')).toEqual({ number: '971501112222', mediatype: 'document', mimetype: 'application/pdf', fileName: 'INV-1.pdf', media: 'JVBERi0=', caption: 'Your invoice' })
    expect(documentPayload('+971501112222', 'JVBERi0=', 'a.pdf')).not.toHaveProperty('caption')
  })
  it('instance creation sets the webhook with the secret header and the three events Averiqo reads', () => {
    const p = createPayload('alsaqr-main', 'https://app.example.com/api/webhooks/evolution/c1', 's3cret')
    expect(p).toMatchObject({ instanceName: 'alsaqr-main', integration: 'WHATSAPP-BAILEYS', qrcode: true })
    expect(p.webhook).toEqual(webhookPayload('https://app.example.com/api/webhooks/evolution/c1', 's3cret').webhook)
    expect(p.webhook).toEqual({ enabled: true, url: 'https://app.example.com/api/webhooks/evolution/c1', headers: { 'x-averiqo-token': 's3cret' }, byEvents: false, base64: false, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'] })
  })
})

describe('Evolution API answers', () => {
  it('QR code, pairing code or already linked', () => {
    expect(parseConnect({ pairingCode: 'WZYEH1YY', code: '2@abc', base64: 'data:image/png;base64,AAA', count: 1 })).toEqual({ state: 'connecting', qr: 'data:image/png;base64,AAA', pairingCode: 'WZYEH1YY' })
    expect(parseConnect({ instance: { instanceName: 'x', state: 'open' } })).toEqual({ state: 'open' })
    expect(parseConnect({ instance: { status: 'connecting' }, qrcode: { base64: 'data:image/png;base64,BBB' } }).qr).toBe('data:image/png;base64,BBB')
    expect(parseConnect({ base64: 'javascript:alert(1)' }).qr).toBeUndefined()   // only data:image URLs reach the <img>
    expect(parseConnect({ count: 0 })).toEqual({ state: 'close', qr: undefined, pairingCode: undefined })   // real server before WhatsApp sent the first code
  })
  it('errors: number not on WhatsApp is permanent, server trouble is retried, auth errors say what to check', () => {
    const notOn = classify(400, { status: 400, error: 'Bad Request', response: { message: [{ exists: false, jid: '971500000000@s.whatsapp.net', number: '971500000000' }] } })
    expect(notOn).toEqual({ retryable: false, error: '971500000000 is not on WhatsApp [HTTP 400]' })
    expect(classify(500, { response: { message: ['Connection Closed'] } }).retryable).toBe(true)
    expect(classify(401, { response: { message: 'Unauthorized' } })).toEqual({ retryable: false, error: 'Unauthorized Check the API key in Settings → WhatsApp. [HTTP 401]' })
    expect(classify(404, {}).error).toMatch(/instance name/)
    expect(errorText({ message: 'x'.repeat(500) })).toHaveLength(300)
  })
  it('status mapping', () => {
    expect([mapStatus('SERVER_ACK'), mapStatus('DELIVERY_ACK'), mapStatus('READ'), mapStatus('PLAYED'), mapStatus('ERROR'), mapStatus('nope'), mapStatus(3)]).toEqual(['sent', 'delivered', 'read', 'read', 'failed', null, null])
  })
})

describe('Evolution webhook', () => {
  it('delivery receipts from messages.update', () => {
    const r = parseEvolutionWebhook({ event: 'messages.update', instance: 'alsaqr-main', data: { keyId: '3EB0ABC', remoteJid: '971501112222@s.whatsapp.net', fromMe: true, status: 'DELIVERY_ACK' } })
    expect(r).toEqual({ instance: 'alsaqr-main', statuses: [{ id: '3EB0ABC', status: 'delivered' }], inbound: [], connection: undefined })
    expect(parseEvolutionWebhook({ event: 'MESSAGES_UPDATE', data: [{ keyId: 'A', status: 'ERROR' }] }).statuses).toEqual([{ id: 'A', status: 'failed', error: 'Delivery failed (reported by WhatsApp)' }])
  })
  it('inbound messages: people only, own messages and groups ignored, STOP text kept', () => {
    const r = parseEvolutionWebhook({ event: 'messages.upsert', instance: 'i', data: { key: { remoteJid: '971501112222@s.whatsapp.net', fromMe: false, id: 'X' }, message: { conversation: 'STOP' }, messageTimestamp: 1767225600 } })
    expect(r.inbound).toEqual([{ from: '+971501112222', text: 'STOP', at: '2026-01-01T00:00:00.000Z' }])
    expect(parseEvolutionWebhook({ event: 'messages.upsert', data: { key: { remoteJid: '971501112222@s.whatsapp.net', fromMe: true }, message: { conversation: 'hi' } } }).inbound).toEqual([])
    expect(parseEvolutionWebhook({ event: 'messages.upsert', data: { key: { remoteJid: '120363@g.us', fromMe: false }, message: { conversation: 'hi' } } }).inbound).toEqual([])
    expect(parseEvolutionWebhook({ event: 'messages.upsert', data: { key: { remoteJid: '1234567@lid', remoteJidAlt: '971502223333@s.whatsapp.net', fromMe: false }, message: { extendedTextMessage: { text: 'start' } } } }).inbound[0]).toMatchObject({ from: '+971502223333', text: 'start' })
  })
  it('link state and junk', () => {
    expect(parseEvolutionWebhook({ event: 'connection.update', data: { state: 'open' } }).connection).toBe('open')
    expect(parseEvolutionWebhook(null)).toEqual({ instance: null, statuses: [], inbound: [], connection: undefined })
    expect(jidToE164('abc', 12, '971501112222:4@s.whatsapp.net')).toBe('+971501112222')
  })
})

describe('provider settings', () => {
  it('Meta stays the default; Evolution is live only with URL, instance, key and sandbox off', () => {
    expect(parseSettings([]).whatsappProvider).toBe('meta')
    const s = parseSettings([{ key: 'whatsapp.provider', value: 'evolution' }, { key: 'whatsapp.evolution_url', value: 'https://wa.x.ae' }, { key: 'whatsapp.evolution_instance', value: 'main' }])
    expect(s).toMatchObject({ whatsappProvider: 'evolution', evolutionUrl: 'https://wa.x.ae', evolutionInstance: 'main' })
    const evolution = { url: 'https://wa.x.ae', instance: 'main', apiKey: 'k'.repeat(12) }
    expect(isConfigured({ provider: 'evolution', apiVersion: 'v21.0', evolution })).toBe(true)
    expect(isConfigured({ provider: 'evolution', apiVersion: 'v21.0', evolution, forceSandbox: true })).toBe(false)
    expect(isConfigured({ provider: 'evolution', apiVersion: 'v21.0', phoneNumberId: '1', accessToken: 't' })).toBe(false)   // Meta creds never used when Evolution is chosen
    expect(isConfigured({ provider: 'meta', apiVersion: 'v21.0', phoneNumberId: '1', accessToken: 't', evolution })).toBe(true)
  })
})
