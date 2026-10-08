'use client'
import { useEffect, useRef, type ReactNode } from 'react'

/** Copies each column header onto its cells (data-label) so phone CSS can show the row as a labelled card. Desktop is unchanged. */
function label(table: HTMLTableElement) {
  const heads = [...table.querySelectorAll('thead tr:last-child th')].flatMap(th => {
    const visible = [...th.childNodes].some(n => !(n instanceof HTMLElement && n.classList.contains('sr-only')) && (n.textContent ?? '').trim())
    const text = visible ? (th as HTMLElement).innerText.replace(/[↑↓↕]/g, '').trim() : ''
    return Array(Number(th.getAttribute('colspan') ?? 1)).fill(text) as string[]
  })
  for (const tr of table.querySelectorAll('tbody tr')) {
    let i = 0
    for (const td of tr.children) { if (!td.hasAttribute('data-label')) td.setAttribute('data-label', heads[i] ?? ''); i += Number(td.getAttribute('colspan') ?? 1) }
  }
}
export function TableWrap({ children, cards = true }: { children: ReactNode; cards?: boolean }) {
  const ref = useRef<HTMLTableElement>(null)
  useEffect(() => {
    const t = ref.current; if (!t || !cards) return
    label(t)
    const mo = new MutationObserver(() => label(t)); mo.observe(t, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [cards])
  return <div className="relative overflow-x-auto"><table ref={ref} className={`w-full text-sm tabular-nums ${cards ? 'rtable' : ''}`}>{children}</table></div>
}
