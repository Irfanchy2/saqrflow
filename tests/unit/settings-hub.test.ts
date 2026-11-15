import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { CATEGORIES, SECTION_CATEGORY, searchIndex, searchSettings, visibleCategories } from '@/lib/settings/catalog'

const owner = { admin: true, users: true, audit: true, trash: true }, staff = { admin: false, users: false, audit: false, trash: false }
// the sections of the old single Settings page: every one must still have a home
const OLD = ['company', 'branding', 'builder', 'templates', 'numbering', 'approvals', 'employee-portal', 'company-cards', 'custom', 'forms', 'notifications', 'rules', 'schedules', 'evolution', 'whatsapp', 'wa-templates', 'wa-share', 'ai', 'integrations', 'account', 'data']

describe('settings catalog', () => {
  it('every old section belongs to exactly one category, and every section has a renderer', () => {
    const ids = CATEGORIES.flatMap(c => c.sections.map(s => s.id))
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of OLD) expect(SECTION_CATEGORY[id], id).toBeTruthy()
    const src = fs.readFileSync('components/settings/hub/sections.tsx', 'utf8')
    for (const id of ids) expect(src.includes(`${/^[a-z]+$/.test(id) ? id : `'${id}'`}: () =>`), id).toBe(true)
  })
  it('a staff member only gets their own settings; no empty categories', () => {
    expect(visibleCategories(owner).map(c => c.id)).toHaveLength(CATEGORIES.length)
    const v = visibleCategories(staff)
    expect(v.map(c => c.id)).toEqual(['security', 'appearance', 'data'])
    expect(v.every(c => c.sections.length > 0 || (c.links?.length ?? 0) > 0)).toBe(true)
    expect(visibleCategories({ ...staff, users: true }).find(c => c.id === 'security')!.links!.map(l => l.href)).toEqual(['/users', '/users/activity'])
  })
  it('search finds settings by name and keyword, best match first, never outside what the user may open', () => {
    const idx = searchIndex(visibleCategories(owner))
    expect(searchSettings(idx, 'Letterhead')[0].href).toBe('/settings/documents#branding')
    expect(searchSettings(idx, 'company logo')[0].href).toBe('/settings/documents#branding')
    expect(searchSettings(idx, 'whatsapp')[0].href.startsWith('/settings/whatsapp')).toBe(true)
    expect(searchSettings(idx, 'IBAN')[0]).toMatchObject({ href: '/settings/documents#branding', hit: 'iban' })
    expect(searchSettings(idx, 'roles')[0].href).toBe('/users')
    expect(searchSettings(idx, '  ')).toEqual([])
    expect(searchSettings(idx, 'qqqzz')).toEqual([])
    expect(searchSettings(searchIndex(visibleCategories(staff)), 'letterhead')).toEqual([])
  })
})
