// The green circular PAID stamp (artwork built by lib/sales/paid-stamp.ts on the server; plain data, so it also renders in
// the client editor preview). Pure vector SVG on a transparent background: sharp on screen, in print and in PDF.
import { memo } from 'react'

export interface StampArt {
  ink: string
  circles: { r: number; w: number }[]
  lines: { x1: number; y1: number; x2: number; y2: number; w: number }[]
  /** glyph outlines and small shapes, already placed in the 200 × 200 box */
  fills: string[]
  /** "worn rubber" gaps, cut out of the ink with a mask */
  specks: { x: number; y: number; r: number }[]
}
export interface PaidStampInfo { date: string | null; art?: StampArt | null }

const label = (date: string | null) => `Paid${date ? ` on ${date.slice(8, 10)}-${date.slice(5, 7)}-${date.slice(0, 4)}` : ''}`

function Stamp({ art, date, size = '38mm', className = '' }: { art: StampArt; date: string | null; size?: string; className?: string }) {
  const id = `ps-${(date ?? 'x').replace(/\D/g, '')}-${art.fills.length}`
  return <svg viewBox="0 0 200 200" width={size} height={size} className={`paid-stamp ${className}`} role="img" aria-label={label(date)} data-paid-stamp data-stamp-date={date ?? ''}
    style={{ color: art.ink, printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
    <defs>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
        <rect width="200" height="200" fill="#fff" />
        {art.specks.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#000" />)}
      </mask>
    </defs>
    <g mask={`url(#${id})`} fill="currentColor" stroke="none" opacity={0.92}>
      {art.circles.map((c, i) => <circle key={i} cx={100} cy={100} r={c.r} fill="none" stroke="currentColor" strokeWidth={c.w} />)}
      {art.lines.map((l, i) => <line key={i} {...l} strokeWidth={l.w} stroke="currentColor" strokeLinecap="round" />)}
      {art.fills.map((d, i) => <path key={i} d={d} />)}
    </g>
  </svg>
}
export const PaidStamp = memo(Stamp)
