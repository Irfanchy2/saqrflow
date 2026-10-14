/** Tiny trend line (server-rendered SVG, no JS). Used only next to a number it explains (last 12 months of that number). */
export function Spark({ values, className = 'text-primary', label }: { values: number[]; className?: string; label: string }) {
  if (values.length < 2 || values.every(v => v === 0)) return null
  const w = 72, h = 24, max = Math.max(...values), min = Math.min(0, ...values), span = max - min || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - ((v - min) / span) * (h - 4)] as const)
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const [lx, ly] = pts[pts.length - 1]
  return <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className={className} role="img" aria-label={label}>
    <path d={`${d} L${w},${h} L0,${h} Z`} fill="currentColor" opacity=".08" />
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    <circle cx={lx} cy={ly} r="2.25" fill="currentColor" />
  </svg>
}
