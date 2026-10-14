'use client'
import { useRef, type KeyboardEvent } from 'react'
import { Bold, Italic, List, ListOrdered, Underline } from 'lucide-react'
import { Textarea } from '@/components/ui/primitives'
import { hasMarkup } from '@/lib/sales/rich'
import { RichBlocks } from './rich-text'

const BULLET = /^(\s*)[-•*]\s+/, NUMBER = /^(\s*)(\d{1,3})[.)]\s+/

/**
 * "Materials to be used" editor: a plain textarea with a formatting toolbar (Bold, Italic, Underline, bullet and numbered
 * lists; Enter = new line). The text is stored with light markup (lib/sales/rich) and rendered the same on screen, print and PDF.
 */
export function RichTextField({ value, onChange, label, placeholder, maxLength = 4000 }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; maxLength?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const commit = (next: string, selStart: number, selEnd = selStart) => {
    onChange(next.slice(0, maxLength))
    requestAnimationFrame(() => { const el = ref.current; if (el) { el.focus(); el.setSelectionRange(selStart, selEnd) } })
  }
  const wrap = (mark: string) => {
    const el = ref.current; if (!el) return
    const { selectionStart: a, selectionEnd: b } = el
    const sel = value.slice(a, b)
    // already wrapped → unwrap (toggle)
    if (sel && value.slice(a - mark.length, a) === mark && value.slice(b, b + mark.length) === mark) return commit(value.slice(0, a - mark.length) + sel + value.slice(b + mark.length), a - mark.length, b - mark.length)
    const lead = sel.match(/^\s*/)![0], trail = sel.match(/\s*$/)![0], core = sel.trim()   // markers hug the words, not the spaces
    if (!core) return commit(value.slice(0, a) + mark + mark + value.slice(b), a + mark.length)
    commit(value.slice(0, a) + lead + mark + core + mark + trail + value.slice(b), a + lead.length + mark.length, a + lead.length + mark.length + core.length)
  }
  const list = (kind: 'ul' | 'ol') => {
    const el = ref.current; if (!el) return
    const start = value.lastIndexOf('\n', el.selectionStart - 1) + 1
    const endNl = value.indexOf('\n', Math.max(el.selectionEnd - (el.selectionEnd > el.selectionStart && value[el.selectionEnd - 1] === '\n' ? 1 : 0), start))
    const end = endNl === -1 ? value.length : endNl
    const ls = value.slice(start, end).split('\n')
    const re = kind === 'ul' ? BULLET : NUMBER
    const all = ls.every(l => re.test(l))
    const bare = (l: string) => l.replace(BULLET, '$1').replace(NUMBER, '$1')
    const next = all ? ls.map(bare) : ls.map((l, i) => (kind === 'ul' ? `- ${bare(l).trimStart()}` : `${i + 1}. ${bare(l).trimStart()}`))
    const block = next.join('\n')
    commit(value.slice(0, start) + block + value.slice(end), start, start + block.length)
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const k = e.key.toLowerCase()
    if ((e.ctrlKey || e.metaKey) && !e.altKey && ['b', 'i', 'u'].includes(k)) { e.preventDefault(); wrap(k === 'b' ? '**' : k === 'i' ? '*' : '__'); return }
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    // Enter inside a list continues it; Enter on an empty item ends the list
    const el = e.currentTarget, pos = el.selectionStart
    if (pos !== el.selectionEnd) return
    const ls = value.lastIndexOf('\n', pos - 1) + 1, line = value.slice(ls, pos)
    const b = BULLET.exec(line), n = b ? null : NUMBER.exec(line)
    if (!b && !n) return
    e.preventDefault()
    const prefixLen = (b ?? n)![0].length
    if (line.length === prefixLen) return commit(value.slice(0, ls) + value.slice(pos), ls)
    const ins = b ? `\n${b[1]}- ` : `\n${n![1]}${Number(n![2]) + 1}. `
    commit(value.slice(0, pos) + ins + value.slice(pos), pos + ins.length)
  }
  const tool = (lab: string, Icon: typeof Bold, run: () => void, kbd?: string) =>
    <button type="button" aria-label={lab} title={kbd ? `${lab} (${kbd})` : lab} onMouseDown={e => e.preventDefault()} onClick={run}
      className="grid h-9 w-9 cursor-pointer place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:h-8 sm:w-8"><Icon size={15} aria-hidden /></button>
  return <div className="rounded-md border border-border bg-surface focus-within:border-primary/60" data-rich-field>
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-1 py-0.5" role="toolbar" aria-label={`${label} formatting`}>
      {tool('Bold', Bold, () => wrap('**'), 'Ctrl+B')}{tool('Italic', Italic, () => wrap('*'), 'Ctrl+I')}{tool('Underline', Underline, () => wrap('__'), 'Ctrl+U')}
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      {tool('Bulleted list', List, () => list('ul'))}{tool('Numbered list', ListOrdered, () => list('ol'))}
      <span className="ms-auto hidden pe-2 text-[11px] text-muted sm:inline">Enter = new line</span>
    </div>
    <Textarea ref={ref} aria-label={label} rows={2} maxLength={maxLength} value={value} placeholder={placeholder} onKeyDown={onKey} onChange={e => onChange(e.target.value)}
      className="min-h-[60px] rounded-none border-0 bg-transparent shadow-none focus:ring-0 [field-sizing:content]" />
    {hasMarkup(value) && <div className="border-t border-border px-3 py-2 text-[13px]" aria-label={`${label} preview`}><RichBlocks src={value} className="rich-preview" /></div>}
  </div>
}
