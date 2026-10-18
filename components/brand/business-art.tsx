import { cn } from '@/lib/utils'

// Background art for the dark brand surfaces (dashboard banner, sign-in): a city skyline with the everyday tools of any
// business floating above it (sales trend, bar chart, an invoice that is paid, a share donut, a delivery, a calendar),
// joined by a network of glowing points. Inline SVG drawn in white on the dark background: no image request, no client
// JavaScript. Motion is CSS only (globals.css, .ba-*), off for reduced motion.

type Variant = 'banner' | 'hero'

/** Glass card: translucent fill, hairline border, soft top highlight. */
function Card({ x, y, w, h, r = 14, children, float }: { x: number; y: number; w: number; h: number; r?: number; children?: React.ReactNode; float?: 1 | 2 | 3 }) {
  return <g className={cn('ba-card', float && `ba-f${float}`)}>
    <rect x={x} y={y} width={w} height={h} rx={r} fill="#fff" fillOpacity=".07" stroke="#fff" strokeOpacity=".2" />
    <path d={`M${x + r} ${y + 0.5}H${x + w - r}`} stroke="#fff" strokeOpacity=".35" />
    {children}
  </g>
}

/** Sales trend: area + line that draws itself once, and a live point at the end. */
function Trend({ x, y, w, h, id }: { x: number; y: number; w: number; h: number; id: string }) {
  const pts = [0.78, 0.7, 0.74, 0.55, 0.6, 0.42, 0.46, 0.28, 0.2].map((v, i, a) => [x + 16 + (i * (w - 32)) / (a.length - 1), y + 26 + v * (h - 42)] as const)
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join('')
  const [ex, ey] = pts[pts.length - 1]
  return <Card x={x} y={y} w={w} h={h} float={1}>
    <rect x={x + 16} y={y + 12} width={46} height={5} rx={2.5} fill="#fff" fillOpacity=".55" />
    <rect x={x + w - 52} y={y + 11} width={36} height={8} rx={4} fill="#4ade80" fillOpacity=".35" />
    <path d={`${line}L${ex.toFixed(1)} ${y + h - 14}L${x + 16} ${y + h - 14}Z`} fill={`url(#${id}-area)`} />
    <path d={line} className="ba-draw" pathLength={1} fill="none" stroke="#9cc3ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx={ex} cy={ey} r="4.5" fill="#fff" /><circle cx={ex} cy={ey} r="9" fill="#9cc3ff" className="ba-ping" />
  </Card>
}

/** Bars that grow from the baseline. */
function Bars({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const v = [0.45, 0.7, 0.55, 0.85, 0.62, 0.95], bw = (w - 32 - (v.length - 1) * 7) / v.length
  return <Card x={x} y={y} w={w} h={h} float={2}>
    <rect x={x + 14} y={y + 12} width={34} height={5} rx={2.5} fill="#fff" fillOpacity=".5" />
    <g className="ba-bars">{v.map((t, i) => <rect key={i} x={x + 16 + i * (bw + 7)} y={y + h - 12 - t * (h - 40)} width={bw} height={t * (h - 40)} rx={3}
      fill={i === v.length - 1 ? '#fbbf24' : '#fff'} fillOpacity={i === v.length - 1 ? '.85' : '.32'} />)}</g>
  </Card>
}

/** An invoice with a "paid" check. */
function Invoice({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return <Card x={x} y={y} w={w} h={h} r={12} float={3}>
    <rect x={x + 14} y={y + 14} width={w * 0.45} height={6} rx={3} fill="#fff" fillOpacity=".6" />
    {[0, 1, 2].map(i => <rect key={i} x={x + 14} y={y + 32 + i * 13} width={w - 28 - (i === 2 ? 18 : 0)} height={4} rx={2} fill="#fff" fillOpacity=".25" />)}
    <rect x={x + 14} y={y + h - 22} width={w * 0.4} height={7} rx={3.5} fill="#fff" fillOpacity=".45" />
    <circle cx={x + w - 4} cy={y + 4} r="13" fill="#22c55e" /><path d={`M${x + w - 10} ${y + 4}l4 4 8-8`} fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </Card>
}

/** Share of revenue: a donut. */
function Donut({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const c = 2 * Math.PI * r
  return <g className="ba-card ba-f2">
    <circle cx={cx} cy={cy} r={r + 14} fill="#fff" fillOpacity=".07" stroke="#fff" strokeOpacity=".2" />
    <circle cx={cx} cy={cy} r={r} fill="none" stroke="#fff" strokeOpacity=".18" strokeWidth="9" />
    <circle cx={cx} cy={cy} r={r} fill="none" stroke="#9cc3ff" strokeWidth="9" strokeDasharray={`${(c * 0.62).toFixed(1)} ${c.toFixed(1)}`} transform={`rotate(-90 ${cx} ${cy})`} strokeLinecap="round" />
    <circle cx={cx} cy={cy} r={r} fill="none" stroke="#fbbf24" strokeWidth="9" strokeDasharray={`${(c * 0.2).toFixed(1)} ${c.toFixed(1)}`} strokeDashoffset={(-c * 0.66).toFixed(1)} transform={`rotate(-90 ${cx} ${cy})`} strokeLinecap="round" />
  </g>
}

/** A delivery van on its way. */
function Van({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return <g className="ba-van" transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M0 22V6a4 4 0 0 1 4-4h30v20zM34 8h10l8 8v6H34z" fill="#fff" fillOpacity=".75" />
    <path d="M37 10h6l5 5h-11z" fill="#0b1530" fillOpacity=".55" />
    <circle cx="12" cy="24" r="5" fill="#0b1530" stroke="#fff" strokeOpacity=".8" strokeWidth="2.5" /><circle cx="42" cy="24" r="5" fill="#0b1530" stroke="#fff" strokeOpacity=".8" strokeWidth="2.5" />
  </g>
}

/** A calendar with today marked. */
function Calendar({ x, y, w }: { x: number; y: number; w: number }) {
  const cell = (w - 24) / 5
  return <Card x={x} y={y} w={w} h={w * 0.9} r={12} float={1}>
    <rect x={x} y={y} width={w} height={18} rx={12} fill="#fff" fillOpacity=".12" />
    {Array.from({ length: 15 }, (_, i) => <rect key={i} x={x + 12 + (i % 5) * cell + 2} y={y + 26 + Math.floor(i / 5) * (cell * 0.85)} width={cell - 4} height={cell * 0.85 - 4} rx={3}
      fill={i === 8 ? '#fbbf24' : '#fff'} fillOpacity={i === 8 ? '.9' : '.16'} />)}
  </Card>
}

/** Offices, a shop, a warehouse and a factory: business of every kind. Windows are one repeating pattern (a few light up). */
function Skyline({ x0, x1, base, scale = 1, id }: { x0: number; x1: number; base: number; scale?: number; id: string }) {
  const shapes: { w: number; h: number; kind?: 'roof' | 'saw' | 'stack' }[] = [
    { w: 46, h: 70 }, { w: 30, h: 110 }, { w: 58, h: 52, kind: 'saw' }, { w: 38, h: 140 }, { w: 26, h: 84 }, { w: 64, h: 44, kind: 'roof' },
    { w: 34, h: 122 }, { w: 48, h: 96 }, { w: 30, h: 60, kind: 'stack' }, { w: 42, h: 150 }, { w: 54, h: 74 }, { w: 28, h: 104 }, { w: 60, h: 50, kind: 'saw' }, { w: 36, h: 128 },
  ]
  const cw = 12 * scale, ch = 16 * scale, out: React.ReactNode[] = [], lit: React.ReactNode[] = []
  let x = x0
  for (let k = 0; x < x1; k++) {
    const b = shapes[k % shapes.length], w = b.w * scale, h = b.h * scale, top = base - h
    const roof = b.kind === 'roof' ? `M${x} ${top}L${x + w / 2} ${top - 16 * scale}L${x + w} ${top}` : b.kind === 'saw' ? Array.from({ length: 3 }, (_, i) => `M${x + (i * w) / 3} ${top}l${w / 3} ${-12 * scale}v${12 * scale}`).join('') : ''
    out.push(<g key={k}>
      <rect x={x} y={top} width={w - 3} height={h} fill="#fff" fillOpacity=".06" stroke="#fff" strokeOpacity=".16" />
      <rect x={x + 3 * scale} y={top + 6 * scale} width={w - 9 * scale} height={h - 10 * scale} fill={`url(#${id}-win)`} />
      {roof && <path d={roof} fill="#fff" fillOpacity=".06" stroke="#fff" strokeOpacity=".16" />}
      {b.kind === 'stack' && <rect x={x + w * 0.6} y={top - 26 * scale} width={7 * scale} height={26 * scale} fill="#fff" fillOpacity=".1" />}
    </g>)
    if (k % 2 === 0 && h > 60 * scale) lit.push(<rect key={k} x={x + 3 * scale + cw * (k % 3) + 2 * scale} y={top + 6 * scale + ch * (1 + (k % 4)) + 2 * scale} width={5 * scale} height={7 * scale} rx={1}
      fill="#fde68a" className={`ba-win ba-w${k % 4}`} />)
    x += w + 2
  }
  return <g>
    <defs><pattern id={`${id}-win`} width={cw} height={ch} patternUnits="userSpaceOnUse" x={x0 + 3 * scale} y={0}>
      <rect x={2 * scale} y={2 * scale} width={5 * scale} height={7 * scale} rx={1} fill="#fff" fillOpacity=".13" /></pattern></defs>
    {out}{lit}<path d={`M${x0 - 40} ${base}H${x1 + 40}`} stroke="#fff" strokeOpacity=".22" /></g>
}

/** Points of the network joining the cards; a few of them pulse. */
function Network({ pts }: { pts: [number, number][] }) {
  return <g>
    <path d={pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('')} fill="none" stroke="#9cc3ff" strokeOpacity=".35" strokeDasharray="2 6" strokeLinecap="round" className="ba-flow" />
    {pts.map(([x, y], i) => <g key={i}><circle cx={x} cy={y} r="3" fill="#cfe1ff" />{i % 2 === 0 && <circle cx={x} cy={y} r="8" fill="#9cc3ff" className={`ba-ping ba-d${i % 3}`} />}</g>)}
  </g>
}

function Defs({ id }: { id: string }) {
  return <defs>
    <linearGradient id={`${id}-area`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#9cc3ff" stopOpacity=".45" /><stop offset="1" stopColor="#9cc3ff" stopOpacity="0" /></linearGradient>
    <radialGradient id={`${id}-glow`}><stop offset="0" stopColor="#4f8cff" stopOpacity=".55" /><stop offset="1" stopColor="#4f8cff" stopOpacity="0" /></radialGradient>
    <radialGradient id={`${id}-warm`}><stop offset="0" stopColor="#f59e0b" stopOpacity=".28" /><stop offset="1" stopColor="#f59e0b" stopOpacity="0" /></radialGradient>
    <linearGradient id={`${id}-fade`} x1="0" x2="1"><stop offset=".26" stopColor="#fff" stopOpacity="0" /><stop offset=".38" stopColor="#fff" /><stop offset=".66" stopColor="#fff" /><stop offset=".84" stopColor="#fff" stopOpacity=".12" /></linearGradient>
    <mask id={`${id}-m`}><rect width="100%" height="100%" fill={`url(#${id}-fade)`} /></mask>
  </defs>
}

/**
 * `banner`: wide strip on the right of the dashboard banner (fades in from the left so the title stays readable).
 * `hero`: tall scene for the sign-in panel. `id` keeps gradient ids unique when two copies are on one page.
 */
export function BusinessArt({ variant = 'banner', id = variant, className }: { variant?: Variant; id?: string; className?: string }) {
  // hero: the cards fill the space between the logo (top left) and the headline (lower half); the skyline sits low behind the text
  if (variant === 'hero') return <svg viewBox="0 0 640 760" preserveAspectRatio="xMidYMid slice" className={cn('absolute inset-0 h-full w-full', className)} aria-hidden data-business-art="hero">
    <Defs id={id} />
    <circle cx="470" cy="200" r="300" fill={`url(#${id}-glow)`} className="ba-aura" />
    <circle cx="120" cy="600" r="220" fill={`url(#${id}-warm)`} className="ba-aura ba-aura2" />
    <Network pts={[[124, 150], [250, 132], [470, 150], [575, 262], [460, 360], [300, 330], [150, 300]]} />
    <Trend x={236} y={84} w={256} h={132} id={id} />
    <Invoice x={60} y={140} w={118} h={132} />
    <Bars x={446} y={236} w={156} h={112} />
    <Donut cx={318} cy={318} r={30} />
    <Calendar x={96} y={300} w={108} />
    <g opacity=".7"><Skyline x0={-10} x1={660} base={730} scale={1.05} id={id} /></g>
    <path d="M-10 748H660" stroke="#fff" strokeOpacity=".1" /><Van x={60} y={704} s={1} />
  </svg>
  // banner: the scene sits in the middle of the strip and fades out on both sides, so the title (left) and the day's
  // numbers (right) stay on a calm background
  return <svg viewBox="0 0 1100 220" preserveAspectRatio="xMidYMid slice" className={cn('absolute inset-0 h-full w-full', className)} aria-hidden data-business-art="banner">
    <Defs id={id} />
    <circle cx="540" cy="20" r="260" fill={`url(#${id}-glow)`} className="ba-aura" />
    <circle cx="980" cy="250" r="170" fill={`url(#${id}-warm)`} className="ba-aura ba-aura2" />
    <g mask={`url(#${id}-m)`}>
      <g opacity=".75"><Skyline x0={300} x1={1110} base={224} scale={0.8} id={id} /></g>
      <Network pts={[[372, 128], [430, 54], [590, 40], [660, 92]]} />
      <Trend x={420} y={24} w={186} h={100} id={id} />
      <Invoice x={624} y={44} w={84} h={98} />
      <Donut cx={370} cy={128} r={20} />
      <Van x={520} y={194} s={0.75} />
    </g>
  </svg>
}
