import 'server-only'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import * as fontkit from 'fontkit'
import type { FkFont } from 'fontkit'
import type { PaidStampInfo, StampArt } from '@/components/sales/paid-stamp'
import type { Ctx } from '@/lib/auth'
import { paidStamp } from './status'

// The green circular PAID stamp, drawn as vector shapes (no image, no text objects): every letter is the font's own
// outline, shaped by fontkit (Arabic joined and right-to-left), then bent around the ring. The same shapes are drawn by
// the on-screen / print component (SVG) and by the PDF writer, so all three look the same. Units: a 200 × 200 box.

export const STAMP_INK = '#15803D'
const C = 100, TILT = -8                    // centre; the whole stamp sits slightly turned, like a hand-pressed stamp
const RING = { outer: 96, outerInner: 89.5, inner: 58 }
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFC]/

let fonts: Promise<{ ar: FkFont; en: FkFont }> | null = null
function loadFonts() {
  fonts ??= (async () => {
    const dir = path.join(process.cwd(), 'assets/fonts')
    const [ar, en] = await Promise.all([readFile(path.join(dir, 'NotoNaskhArabic-Bold.ttf')), readFile(path.join(dir, 'NotoSans-ExtraBold.ttf'))])
    return { ar: fontkit.create(ar), en: fontkit.create(en) }
  })().catch(e => { fonts = null; throw e })
  return fonts
}

type M = [number, number, number, number, number, number]   // x' = a x + c y + e, y' = b x + d y + f
const mul = (p: M, q: M): M => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]]
const rot = (deg: number, cx = 0, cy = 0): M => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy] }
const TILT_M = rot(TILT, C, C)
const pt = (m: M, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })
const r2 = (n: number) => Math.round(n * 100) / 100

/** Shaped glyph run: each glyph's outline and where it starts along the line (in font units). */
function shape(font: FkFont, text: string, tracking = 0) {
  const run = font.layout(text)
  let x = 0
  const out = run.glyphs.map((g, i) => {
    const p = run.positions[i], item = { g, x, xOff: p.xOffset, yOff: p.yOffset, adv: p.xAdvance }
    x += p.xAdvance + (p.xAdvance > 0 ? tracking * font.unitsPerEm : 0)
    return item
  })
  return { glyphs: out, width: x - (out.length ? tracking * font.unitsPerEm : 0) }
}

/**
 * Text bent around the ring. `top`: across the top, letters standing outward from the baseline circle; bottom: across the
 * bottom, letters standing toward the centre. Both read left to right as seen; the font size shrinks to fit the arc.
 */
function arcText(font: FkFont, text: string, o: { top: boolean; radius: number; size: number; minSize: number; maxDeg: number; tracking: number }): string[] {
  // shrink to fit the arc; a very long name drops its letter-spacing first, then keeps shrinking (never overlaps)
  let run = shape(font, text, o.tracking)
  const maxLen = (o.radius * o.maxDeg * Math.PI) / 180, fit = (w: number) => Math.min(o.size, (maxLen / w) * font.unitsPerEm)
  if (fit(run.width) < o.minSize && o.tracking > 0) run = shape(font, text, 0)
  const s = fit(run.width) / font.unitsPerEm
  const span = (run.width * s) / o.radius                      // radians the text covers
  return run.glyphs.filter(gl => gl.g.path).map(gl => {
    const along = (gl.x + gl.adv / 2) * s
    const phi = o.top ? -Math.PI / 2 - span / 2 + along / o.radius : Math.PI / 2 + span / 2 - along / o.radius
    const P = { x: C + o.radius * Math.cos(phi), y: C + o.radius * Math.sin(phi) }
    const turn = o.top ? phi + Math.PI / 2 : phi - Math.PI / 2
    const c = Math.cos(turn), n = Math.sin(turn)
    // font units (y up, origin at the pen) → glyph centred on P, upright along the ring
    const tx = s * gl.xOff - (gl.adv * s) / 2, ty = -s * gl.yOff
    const place: M = [c * s, n * s, n * s, -c * s, c * tx - n * ty + P.x, n * tx + c * ty + P.y]
    const m = mul(TILT_M, place)
    return gl.g.path.transform(...m).toSVG()
  }).filter(d => d.length > 2)
}

/** Centred single-line text (date, PAID) at a baseline y; shrinks to `maxWidth`. */
function lineText(font: FkFont, text: string, o: { baseline: number; size: number; maxWidth: number; tracking: number }): string[] {
  const run = shape(font, text, o.tracking)
  const size = Math.min(o.size, (o.maxWidth / run.width) * font.unitsPerEm), s = size / font.unitsPerEm
  const x0 = C - (run.width * s) / 2
  return run.glyphs.filter(gl => gl.g.path).map(gl => {
    const m = mul(TILT_M, [s, 0, 0, -s, x0 + (gl.x + gl.xOff) * s, o.baseline - gl.yOff * s])
    return gl.g.path.transform(...m).toSVG()
  }).filter(d => d.length > 2)
}

/** Small deterministic "worn rubber" specks (same stamp → same texture), only where ink can be. */
function specks(seed: string) {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296 }
  const out: { x: number; y: number; r: number }[] = []
  while (out.length < 130) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 97, x = C + d * Math.cos(a), y = C + d * Math.sin(a), r = 0.3 + rnd() * rnd() * 1.1
    if (y > 66 && y < 92 && Math.abs(x - C) < 52) continue   // the date stays fully legible
    out.push({ x: r2(x), y: r2(y), r: r2(r) })
  }
  return out
}

export const stampDate = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`

const cache = new Map<string, StampArt>()
/**
 * Stamp artwork for one company and payment date. Arabic name on the top arc, English name on the bottom arc
 * (without an Arabic name: English on top, "PAYMENT RECEIVED" below); "DATE: DD-MM-YYYY" above a large PAID.
 */
export async function paidStampArt(o: { nameEn: string; nameAr?: string | null; date: string | null }): Promise<StampArt> {
  const nameEn = o.nameEn.trim().replace(/\s+/g, ' ').toUpperCase(), nameAr = (o.nameAr ?? '').trim().replace(/\s+/g, ' ')
  const key = `${nameEn}|${nameAr}|${o.date ?? ''}`
  const hit = cache.get(key); if (hit) return hit
  const { ar, en } = await loadFonts()
  const topText = nameAr || nameEn, bottomText = nameAr ? nameEn : 'PAYMENT RECEIVED'
  const topFont = ARABIC.test(topText) ? ar : en
  const fills = [
    ...arcText(topFont, topText, topFont === ar
      ? { top: true, radius: 67, size: 17, minSize: 9, maxDeg: 158, tracking: 0 }
      : { top: true, radius: 70, size: 13, minSize: 6.5, maxDeg: 158, tracking: 0.06 }),
    ...arcText(en, bottomText, { top: false, radius: 84, size: 12.5, minSize: 6.5, maxDeg: 158, tracking: 0.05 }),
    ...(o.date ? lineText(en, `DATE: ${stampDate(o.date)}`, { baseline: 84, size: 10.5, maxWidth: 96, tracking: 0.04 }) : []),
    ...lineText(en, 'PAID', { baseline: o.date ? 125 : 117, size: 40, maxWidth: 98, tracking: 0.04 }),
  ]
  const line = (y: number, half: number) => { const a = pt(TILT_M, C - half, y), b = pt(TILT_M, C + half, y); return { x1: r2(a.x), y1: r2(a.y), x2: r2(b.x), y2: r2(b.y), w: 1.3 } }
  const art: StampArt = {
    ink: STAMP_INK,
    circles: [{ r: RING.outer, w: 4.2 }, { r: RING.outerInner, w: 1.3 }, { r: RING.inner, w: 1.3 }],
    lines: o.date ? [line(90.5, 44), line(132, 40)] : [line(126, 40)],
    fills, specks: specks(key),
  }
  if (cache.size > 200) cache.clear()
  cache.set(key, art)
  return art
}

/** The company's Arabic name (Settings → Company). Tolerates a database without migration 0039 (no Arabic name yet). */
export async function companyNameAr(c: Pick<Ctx, 'supabase' | 'company'>): Promise<string | null> {
  try {
    const { data, error } = await c.supabase.from('companies').select('name_ar').eq('id', c.company.id).maybeSingle()
    return error ? null : ((data as { name_ar?: string | null } | null)?.name_ar ?? null)
  } catch { return null }
}

/**
 * The stamp to show on a stored invoice, or null: only a fully paid tax invoice (see paidStamp) whose per-invoice switch
 * is on (`show_paid_stamp`, default on). The date is the date of the payment that completed it.
 */
export async function invoicePaidStamp(c: Pick<Ctx, 'supabase' | 'company'>, d: { doc: Record<string, any>; paid: number; credited?: number; payments: { paid_on?: string | null }[] }): Promise<PaidStampInfo | null> {
  const base = paidStamp({ ...(d.doc as any), paid: d.paid, credited: d.credited }, d.payments)
  if (!base || d.doc.show_paid_stamp === false) return null
  try { return { date: base.date, art: await paidStampArt({ nameEn: c.company.name, nameAr: await companyNameAr(c), date: base.date }) } }
  catch (e) { console.error('[paid-stamp]', e); return { date: base.date, art: null } }   // fonts missing: a plain green stamp instead
}
