// Renders "Materials to be used" rich text (lib/sales/rich) as React elements: no HTML from the text is ever injected.
import { Fragment, type ReactNode } from 'react'
import { parseRich, type Run } from '@/lib/sales/rich'

const runs = (rs: Run[]) => rs.map((r, i) => {
  let n: ReactNode = r.text
  if (r.u) n = <u>{n}</u>
  if (r.i) n = <em>{n}</em>
  if (r.b) n = <strong>{n}</strong>
  return <Fragment key={i}>{n}</Fragment>
})

/** label (bold) runs into the first paragraph; lists always start on their own line, one item per line */
export function RichBlocks({ src, label, className = '' }: { src: string | null | undefined; label?: string; className?: string }) {
  const blocks = parseRich(src)
  if (!blocks.length) return null
  const first = blocks[0]
  return <div className={`paper-rich ${className}`} dir="auto">
    {label && first.kind !== 'p' && <div><b>{label}</b></div>}
    {blocks.map((bl, i) => bl.kind === 'p'
      ? <div key={i} className="paper-rich-p">{i === 0 && label && <><b>{label}</b> </>}{bl.runs.length ? runs(bl.runs) : ' '}</div>
      : bl.kind === 'ul'
        ? <ul key={i}>{bl.items.map((it, j) => <li key={j}>{runs(it)}</li>)}</ul>
        : <ol key={i} start={bl.start}>{bl.items.map((it, j) => <li key={j}>{runs(it)}</li>)}</ol>)}
  </div>
}
