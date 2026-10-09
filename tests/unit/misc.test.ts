import { describe, it, expect, beforeAll } from 'vitest'
import { summarizeCheques, canTransition, nextStatuses, type ChequeLike } from '@/lib/cheques'
import { effectiveStatus, daysRemaining } from '@/lib/documents'
import { validateUpload, sniffMime, safeFileName, storagePath, sha256Hex, MAX_UPLOAD_BYTES } from '@/lib/files'
import { toE164 } from '@/lib/phone'
import { can, ROLES, assertCan, ForbiddenError, ROLE_PERMISSIONS } from '@/lib/permissions'
import { encryptSecret, decryptSecret, hmacSha256Hex } from '@/lib/crypto'
import { verifySignature, mergeStatus, parseWebhook, optIntent } from '@/lib/whatsapp/webhook'

const c = (direction: any, status: any, amount: number, cheque_date: string): ChequeLike => ({ direction, status, amount, cheque_date })

describe('cheque calculations', () => {
  const today = '2026-10-14' // Wednesday
  const list = [
    c('incoming', 'received', 1000.10, '2026-10-16'), c('incoming', 'deposited', 2000.20, '2026-10-10'),
    c('outgoing', 'issued', 15000, '2026-10-20'), c('outgoing', 'scheduled', 500, '2026-10-14'),
    c('outgoing', 'issued', 300, '2026-10-01'), c('incoming', 'cleared', 9999, '2026-10-02'),
    c('incoming', 'returned', 777, '2026-10-03'), c('outgoing', 'cancelled', 888, '2026-10-30'),
    c('incoming', 'scheduled', 50, '2026-11-02'),
  ]
  const s = summarizeCheques(list, today)
  it('totals only open cheques, with exact decimal sums', () => {
    expect(s.incomingTotal).toBe(3050.3); expect(s.incomingCount).toBe(3)
    expect(s.outgoingTotal).toBe(15800); expect(s.outgoingCount).toBe(3)
    expect(s.netPosition).toBe(-12749.7)
  })
  it('due this week = next 7 days incl. today, not yet at bank', () => expect(s.dueThisWeek.map(x => x.amount)).toEqual([1000.10, 15000, 500]))
  it('due this month excludes next month, cleared, cancelled', () => expect(s.dueThisMonth).toHaveLength(3))
  it('overdue requires action only for not-yet-banked cheques', () => expect(s.overdue.map(x => x.amount)).toEqual([300]))
  it('awaiting clearance & returned', () => { expect(s.awaitingClearance).toHaveLength(1); expect(s.returned).toHaveLength(1) })
  it('month boundary: dueThisMonth ends on the last day', () => {
    const r = summarizeCheques([c('outgoing', 'issued', 1, '2026-10-31'), c('outgoing', 'issued', 1, '2026-11-01')], today)
    expect(r.dueThisMonth).toHaveLength(1)
  })
  it('status machine', () => {
    expect(canTransition('incoming', 'received', 'deposited')).toBe(true)
    expect(canTransition('incoming', 'received', 'cleared')).toBe(false)
    expect(canTransition('outgoing', 'cleared', 'issued')).toBe(false)
    expect(nextStatuses('incoming', 'cleared')).toEqual([])
  })
})

describe('document status', () => {
  const t = '2026-10-04'
  it('computes status from expiry', () => {
    expect(effectiveStatus({ expiry_date: '2026-10-03' }, t)).toBe('expired')
    expect(effectiveStatus({ expiry_date: '2026-10-04' }, t)).toBe('expiring_soon')
    expect(effectiveStatus({ expiry_date: '2026-12-03' }, t)).toBe('expiring_soon')   // 60 days
    expect(effectiveStatus({ expiry_date: '2026-12-04' }, t)).toBe('valid')           // 61 days → Active
    expect(effectiveStatus({ expiry_date: '2027-01-01', status: 'archived' }, t)).toBe('archived')
    expect(effectiveStatus({}, t)).toBe('no_expiry')
    expect(effectiveStatus({ expiry_date: '2026-10-10', status: 'renewal_in_progress' }, t)).toBe('renewal_in_progress')
    expect(effectiveStatus({ expiry_date: '2026-10-01', status: 'renewal_in_progress' }, t)).toBe('expired')
    expect(effectiveStatus({ expiry_date: '2020-01-01', status: 'cancelled' }, t)).toBe('cancelled')
    expect(daysRemaining('2026-10-20', t)).toBe(16)
  })
})

describe('file validation', () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]), exe = new Uint8Array([0x4d, 0x5a, 0, 0])
  it('accepts allowed types with matching content', () => {
    expect(validateUpload({ name: 'Trade License.PDF', size: 1000, type: 'application/pdf' }, pdf)).toMatchObject({ ok: true, mime: 'application/pdf' })
    expect(validateUpload({ name: 'x.jpg', size: 5, type: 'image/jpeg' }, new Uint8Array([0xff, 0xd8, 0xff]))).toMatchObject({ ok: true })
  })
  it('rejects bad extension, executables, empty and oversized files', () => {
    for (const n of ['a.exe', 'a.html', 'a.svg', 'a.js', 'noext']) expect(validateUpload({ name: n, size: 10, type: '' }).ok).toBe(false)
    expect(validateUpload({ name: 'a.pdf', size: 0, type: 'application/pdf' }).ok).toBe(false)
    expect(validateUpload({ name: 'a.pdf', size: MAX_UPLOAD_BYTES + 1, type: 'application/pdf' }).ok).toBe(false)
  })
  it('rejects spoofed content (exe renamed .pdf; png renamed .pdf; declared type mismatch)', () => {
    expect(validateUpload({ name: 'a.pdf', size: 10, type: 'application/pdf' }, exe).ok).toBe(false)
    expect(validateUpload({ name: 'a.pdf', size: 10, type: 'application/pdf' }, png).ok).toBe(false)
    expect(validateUpload({ name: 'a.pdf', size: 10, type: 'image/png' }, pdf).ok).toBe(false)
  })
  it('sniffs and sanitises', () => {
    expect(sniffMime(pdf)).toBe('application/pdf')
    expect(safeFileName('../../etc/passwd')).not.toContain('/')
    expect(safeFileName('بيان.pdf')).toMatch(/\.pdf$/)
    expect(storagePath('co', 'doc', 2, 'a b.pdf')).toBe('co/doc/v2-a b.pdf')
    expect(sha256Hex(new Uint8Array([1, 2, 3]))).toHaveLength(64)
  })
})

describe('phone numbers', () => {
  it('normalises UAE formats', () => {
    for (const x of ['0501234567', '050 123 4567', '971501234567', '00971501234567', '+971 50 123 4567']) expect(toE164(x)).toBe('+971501234567')
    expect(toE164('12345')).toBeNull(); expect(toE164('abc')).toBeNull(); expect(toE164('+0123456789')).toBeNull()
  })
})

describe('permissions', () => {
  it('matches the specification', () => {
    expect(can('company_owner', 'users.manage')).toBe(true)
    expect(can('hr_manager', 'salary.view')).toBe(true); expect(can('hr_manager', 'finance.view')).toBe(false)
    expect(can('accountant', 'cheques.manage')).toBe(true); expect(can('accountant', 'employees.view_sensitive')).toBe(false)
    expect(can('project_manager', 'salary.view')).toBe(false)
    expect(can('viewer', 'documents.view')).toBe(true); expect(can('viewer', 'records.edit')).toBe(false)
    expect(can('employee', 'documents.view')).toBe(false); expect(can(null, 'documents.view')).toBe(false)
    expect(() => assertCan('viewer', 'data.export')).toThrow(ForbiddenError)
    expect(ROLES).toHaveLength(7)
  })
  it('only owners delete or manage users', () => {
    for (const r of ROLES) { const own = r === 'super_admin' || r === 'company_owner'
      expect(can(r, 'records.delete')).toBe(own); expect(can(r, 'users.manage')).toBe(own) }
    expect(Object.keys(ROLE_PERMISSIONS)).toHaveLength(7)
  })
})

describe('crypto & webhook signatures', () => {
  beforeAll(() => { process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64') })
  it('round-trips secrets, randomised IV, tamper-evident', () => {
    const a = encryptSecret('EAAG-token'), b = encryptSecret('EAAG-token')
    expect(a).not.toBe(b); expect(a).not.toContain('EAAG'); expect(decryptSecret(a)).toBe('EAAG-token')
    const parts = a.split('.'); parts[3] = Buffer.from('tampered').toString('base64url')
    expect(() => decryptSecret(parts.join('.'))).toThrow()
  })
  it('refuses to run without a valid key', () => {
    const k = process.env.SETTINGS_ENCRYPTION_KEY; process.env.SETTINGS_ENCRYPTION_KEY = 'short'
    expect(() => encryptSecret('x')).toThrow(/32/); process.env.SETTINGS_ENCRYPTION_KEY = k
  })
  it('verifies Meta X-Hub-Signature-256', () => {
    const body = '{"entry":[]}', sig = 'sha256=' + hmacSha256Hex('app-secret', body)
    expect(verifySignature('app-secret', body, sig)).toBe(true)
    expect(verifySignature('wrong', body, sig)).toBe(false)
    expect(verifySignature('app-secret', body + ' ', sig)).toBe(false)
    expect(verifySignature('app-secret', body, null)).toBe(false); expect(verifySignature('app-secret', body, 'sha256=')).toBe(false)
  })
  it('delivery status never regresses', () => {
    expect(mergeStatus('sent', 'delivered')).toBe('delivered'); expect(mergeStatus('read', 'delivered')).toBe('read')
    expect(mergeStatus('delivered', 'sent')).toBe('delivered'); expect(mergeStatus('sent', 'failed')).toBe('failed')
    expect(mergeStatus('delivered', 'failed')).toBe('delivered'); expect(mergeStatus('failed', 'delivered')).toBe('delivered')
  })
  it('parses statuses and STOP/START messages', () => {
    const p = parseWebhook({ entry: [{ changes: [{ value: {
      statuses: [{ id: 'wamid.1', status: 'failed', errors: [{ code: 131026, title: 'Undeliverable' }] }],
      messages: [{ from: '971501234567', type: 'text', text: { body: ' STOP ' } }] } }] }] })
    expect(p.statuses[0]).toMatchObject({ id: 'wamid.1', status: 'failed', error: 'Undeliverable (code 131026)' })
    expect(p.messages[0].from).toBe('+971501234567'); expect(optIntent(p.messages[0].text)).toBe('opt_out')
    expect(optIntent('yes')).toBe('opt_in'); expect(optIntent('hello')).toBeNull()
    expect(parseWebhook({})).toEqual({ statuses: [], messages: [], inbound: [] })
  })
})

import { toCsv, csvCell } from '@/lib/csv'
describe('csv export safety', () => {
  it('escapes quotes/newlines and neutralises formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"'); expect(csvCell('say "hi"')).toBe('"say ""hi"""'); expect(csvCell(null)).toBe('')
    for (const f of ['=HYPERLINK("x")', '+1', '-1', '@SUM(A1)']) expect(csvCell(f).replace(/^"/, '')).toMatch(/^'/)
    expect(toCsv(['A', 'B'], [[1, 'x']])).toBe('﻿A,B\r\n1,x')
  })
})
