import type { LucideIcon } from '@/components/icons'
import { cn } from '@/lib/utils'

// Small illustrations for empty states, 404 and error pages: inline SVG drawn with the theme colours (light and dark
// follow automatically), no image requests and no client JavaScript. The page's own icon sits on a floating card in
// front of a scene that matches what the list holds: papers, money, people, the workshop or a search.
type Scene = 'papers' | 'money' | 'people' | 'workshop' | 'search' | 'done'
// matched by the icon's name (Phosphor sets displayName), so this file imports no icons and adds nothing to client bundles
const SCENES: [Scene, string[]][] = [
  ['money', ['Wallet', 'Money', 'Bank', 'ChartBar', 'Receipt']],
  ['people', ['UsersThree', 'UserCircle', 'Handshake', 'Target']],
  ['workshop', ['HardHat', 'Wrench', 'Package', 'Camera', 'MapTrifold', 'Buildings', 'Truck', 'Car']],
  ['search', ['MagnifyingGlass', 'MagnifyingGlassMinus', 'Warning', 'LinkBreak']],
  ['done', ['CheckCircle', 'BellRinging', 'ClipboardText', 'ListChecks', 'Trash']],
]
const sceneOf = (icon: LucideIcon): Scene => { const n = ((icon as { displayName?: string }).displayName ?? '').replace(/Icon$/, ''); return SCENES.find(([, list]) => list.includes(n))?.[0] ?? 'papers' }

const sheet = 'fill-surface stroke-border-strong/50', line = 'fill-border-strong/35', soft = 'fill-primary/[.07]', accent = 'fill-primary/25'

function Back({ scene }: { scene: Scene }) {
  switch (scene) {
    case 'money': return <g>
      <rect x="44" y="30" width="64" height="44" rx="7" className={sheet} transform="rotate(-7 76 52)" />
      <rect x="54" y="40" width="22" height="4" rx="2" className={line} transform="rotate(-7 76 52)" />
      <g className="art-bars">{[0, 1, 2, 3].map(i => <rect key={i} x={124 + i * 11} y={78 - [14, 24, 18, 32][i]} width="7" height={[14, 24, 18, 32][i]} rx="2" className={i === 3 ? accent : line} />)}</g>
      <circle cx="54" cy="86" r="9" className="fill-warning/20 stroke-warning/40" /><circle cx="66" cy="92" r="7" className="fill-warning/15 stroke-warning/35" />
    </g>
    case 'people': return <g>
      <circle cx="56" cy="50" r="13" className={sheet} /><circle cx="56" cy="46" r="5" className={line} /><path d="M47 58a9 6 0 0 1 18 0" className={line} />
      <circle cx="144" cy="46" r="11" className={sheet} /><circle cx="144" cy="43" r="4" className={line} /><path d="M137 53a7 5 0 0 1 14 0" className={line} />
      <circle cx="140" cy="86" r="8" className={sheet} /><circle cx="52" cy="88" r="4" className={accent} />
      <path d="M68 52 C86 40, 112 40, 132 47" className="fill-none stroke-primary/25" strokeDasharray="3 4" />
    </g>
    case 'workshop': return <g>
      {/* a steel I-beam on two trestles, with a bolt */}
      <path d="M36 74h128v6H36zM36 88h128v6H36z" className={line} /><rect x="46" y="80" width="108" height="8" className="fill-border-strong/20" />
      <path d="M52 94l-8 14M60 94l8 14M140 94l-8 14M148 94l8 14" className="fill-none stroke-border-strong/45" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="150" cy="40" r="7" className="fill-none stroke-primary/30" strokeWidth="3" /><circle cx="150" cy="40" r="2" className={accent} />
      <path d="M44 34l6 6m0-6l-6 6" className="fill-none stroke-warning/50" strokeWidth="2" strokeLinecap="round" />
    </g>
    case 'search': return <g>
      <rect x="40" y="28" width="56" height="66" rx="7" className={sheet} transform="rotate(-8 68 61)" />
      {[40, 50, 60].map(y => <rect key={y} x="50" y={y} width={y === 60 ? 22 : 34} height="4" rx="2" className={line} transform="rotate(-8 68 61)" />)}
      <circle cx="146" cy="58" r="16" className="fill-surface stroke-primary/30" strokeWidth="4" /><path d="M157 70l12 12" className="fill-none stroke-primary/30" strokeWidth="5" strokeLinecap="round" />
    </g>
    case 'done': return <g>
      <rect x="40" y="26" width="60" height="70" rx="8" className={sheet} transform="rotate(-6 70 61)" />
      {[40, 54, 68].map(y => <g key={y} transform="rotate(-6 70 61)"><rect x="50" y={y} width="7" height="7" rx="2" className={accent} /><rect x="61" y={y + 1.5} width="26" height="4" rx="2" className={line} /></g>)}
      <path d="M138 44l5 5 10-11" className="fill-none stroke-success/50" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="152" cy="84" r="5" className="fill-success/20" />
    </g>
    default: return <g>
      <rect x="38" y="30" width="56" height="68" rx="7" className={sheet} transform="rotate(-9 66 64)" />
      <rect x="110" y="26" width="54" height="66" rx="7" className={sheet} transform="rotate(7 137 59)" />
      {[44, 54, 64].map(y => <rect key={y} x="48" y={y} width={y === 64 ? 20 : 32} height="4" rx="2" className={line} transform="rotate(-9 66 64)" />)}
      {[40, 50].map(y => <rect key={y} x="122" y={y} width={y === 50 ? 18 : 30} height="4" rx="2" className={line} transform="rotate(7 137 59)" />)}
    </g>
  }
}

/** Empty-state art: a scene for the icon's kind of data, with the icon on a gently floating card in front. */
export function EmptyArt({ icon: Icon, className, size = 'md' }: { icon: LucideIcon; className?: string; size?: 'md' | 'lg' }) {
  const scene = sceneOf(Icon)
  return <div className={cn('relative mx-auto', size === 'lg' ? 'h-[150px] w-[250px]' : 'h-[120px] w-[200px]', className)} aria-hidden data-empty-art={scene}>
    <svg viewBox="0 0 200 120" className="absolute inset-0 h-full w-full" strokeWidth="1.25">
      <ellipse cx="100" cy="62" rx="92" ry="52" className={soft} />
      <ellipse cx="100" cy="112" rx="46" ry="4" className="fill-fg/[.06]" />
      <Back scene={scene} />
      <g className="art-twinkle"><path d="M170 18l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" className={accent} /><circle cx="26" cy="56" r="2.5" className={accent} /><circle cx="180" cy="98" r="2" className="fill-warning/40" /></g>
    </svg>
    <span className={cn('art-float absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center border border-border/80 bg-surface text-primary shadow-lift',
      size === 'lg' ? 'h-16 w-16 rounded-[18px]' : 'h-14 w-14 rounded-2xl')}><Icon size={size === 'lg' ? 30 : 26} weight="duotone" /></span>
  </div>
}
