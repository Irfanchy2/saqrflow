// Light rich text for "Materials to be used" (pure, unit-tested; shared by the editor preview, print and PDF).
// Stored as plain text in the existing column, so old entries render exactly as before:
//   **bold**   *italic*   __underline__   "- " or "• " bullet lines   "1. " numbered lines   a new line = line break
// Rendering never uses HTML from the text: markup is parsed into runs, then drawn as React elements or PDF text.

export interface Run { text: string; b?: boolean; i?: boolean; u?: boolean }
export type Block = { kind: 'p'; runs: Run[] } | { kind: 'ul'; items: Run[][] } | { kind: 'ol'; start: number; items: Run[][] }

const BULLET = /^\s*[-•*]\s+(.*)$/
const NUMBER = /^\s*(\d{1,3})[.)]\s+(.*)$/
// markers need a non-space next to them (and italic / underline a word boundary outside), so "2*3*4" or snake_case stay text
const PATTERNS: { re: RegExp; style: keyof Omit<Run, 'text'> }[] = [
  { re: /\*\*(?!\s)(.+?)(?<!\s)\*\*/, style: 'b' },
  { re: /(?<![A-Za-z0-9_])__(?!\s)(.+?)(?<!\s)__(?![A-Za-z0-9_])/, style: 'u' },
  { re: /(?<![A-Za-z0-9*])\*(?![\s*])(.+?)(?<![\s*])\*(?![A-Za-z0-9*])/, style: 'i' },   // "*primer*__coats__" works: _ may follow
]

export function parseInline(text: string, style: Omit<Run, 'text'> = {}): Run[] {
  let best: { m: RegExpExecArray; style: keyof Omit<Run, 'text'> } | null = null
  for (const p of PATTERNS) {
    const m = p.re.exec(text)
    if (m && (!best || m.index < best.m.index)) best = { m, style: p.style }
  }
  if (!best) return text ? [{ text, ...style }] : []
  const { m } = best
  return [
    ...(m.index > 0 ? [{ text: text.slice(0, m.index), ...style }] : []),
    ...parseInline(m[1], { ...style, [best.style]: true }),
    ...parseInline(text.slice(m.index + m[0].length), style),
  ]
}

export function parseRich(src: string | null | undefined): Block[] {
  const out: Block[] = []
  for (const raw of String(src ?? '').replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    const b = BULLET.exec(line), n = b ? null : NUMBER.exec(line)
    const last = out[out.length - 1]
    if (b) { if (last?.kind === 'ul') last.items.push(parseInline(b[1])); else out.push({ kind: 'ul', items: [parseInline(b[1])] }) }
    else if (n) { if (last?.kind === 'ol') last.items.push(parseInline(n[2])); else out.push({ kind: 'ol', start: Number(n[1]) || 1, items: [parseInline(n[2])] }) }
    else out.push({ kind: 'p', runs: parseInline(line) })
  }
  while (out.length && out[out.length - 1].kind === 'p' && !(out[out.length - 1] as { runs: Run[] }).runs.length) out.pop()   // trailing empty lines
  while (out.length && out[0].kind === 'p' && !(out[0] as { runs: Run[] }).runs.length) out.shift()
  return out
}

/** plain text without markers (search, change summaries) */
export const richToPlain = (src: string | null | undefined) =>
  parseRich(src).map(bl => bl.kind === 'p' ? bl.runs.map(r => r.text).join('') : bl.items.map((it, i) => `${bl.kind === 'ol' ? `${bl.start + i}.` : '•'} ${it.map(r => r.text).join('')}`).join('\n')).join('\n')
export const hasMarkup = (src: string | null | undefined) => /\*\*|__|\*\S|^\s*([-•*]|\d{1,3}[.)])\s/m.test(String(src ?? ''))
