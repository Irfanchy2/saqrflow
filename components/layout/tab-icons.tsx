// Phone tab bar icons, drawn for Averiqo on one 24 px grid: 1.6 stroke, round joins, and a tinted inner fill that
// lights up on the open tab. Projects is a steel I-beam. Pages without their own drawing use the regular icon set.
import type { ReactNode } from 'react'

const shapes: Record<string, { fill: ReactNode; line: ReactNode }> = {
  overview: {
    fill: <rect x="3.5" y="3.5" width="7.5" height="9.5" rx="2.2" />,
    line: <><rect x="3.5" y="3.5" width="7.5" height="9.5" rx="2.2" /><rect x="13" y="3.5" width="7.5" height="5.5" rx="2.2" /><rect x="13" y="11" width="7.5" height="9.5" rx="2.2" /><rect x="3.5" y="15" width="7.5" height="5.5" rx="2.2" /></>,
  },
  quotations: {
    fill: <path d="M7.5 3.5h6.4c.5 0 1 .2 1.4.6l3.6 3.6c.4.4.6.9.6 1.4V18a2.5 2.5 0 0 1-2.5 2.5h-9.5A2.5 2.5 0 0 1 5 18V6a2.5 2.5 0 0 1 2.5-2.5Z" />,
    line: <><path d="M7.5 3.5h6.4c.5 0 1 .2 1.4.6l3.6 3.6c.4.4.6.9.6 1.4V18a2.5 2.5 0 0 1-2.5 2.5h-9.5A2.5 2.5 0 0 1 5 18V6a2.5 2.5 0 0 1 2.5-2.5Z" /><path d="M14 3.8V7a1.5 1.5 0 0 0 1.5 1.5h3.2M8.5 12.5h7M8.5 16h4.5" /></>,
  },
  projects: {
    fill: <path d="M4.5 3.5h15a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H14v9h5.5a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1H10v-9H4.5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z" />,
    line: <path d="M4.5 3.5h15a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H14v9h5.5a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1H10v-9H4.5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z" />,
  },
  tasks: {
    fill: <rect x="3.5" y="3.5" width="17" height="17" rx="5" />,
    line: <><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><path d="m8.4 12.2 2.5 2.5 4.9-5.1" /></>,
  },
  employees: {
    fill: <circle cx="9" cy="8" r="3.2" />,
    line: <><circle cx="9" cy="8" r="3.2" /><path d="M3.6 19.5c.6-3.1 2.8-5 5.4-5s4.8 1.9 5.4 5M15.6 5a3.1 3.1 0 0 1 0 6M17.3 14.6c1.7.6 2.8 2.3 3.1 4.9" /></>,
  },
  more: {
    fill: <rect x="15.2" y="13.7" width="6.6" height="6.6" rx="2" />,
    line: <><path d="M4 6.5h16M4 12h16M4 17h8.5" /><rect x="15.2" y="13.7" width="6.6" height="6.6" rx="2" /></>,
  },
}
export const hasTabIcon = (key: string) => key in shapes

export function TabIcon({ name, on, className }: { name: string; on?: boolean; className?: string }) {
  const s = shapes[name]; if (!s) return null
  return <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <g fill="currentColor" stroke="none" style={{ opacity: on ? 0.3 : 0, transition: 'opacity .25s ease-out' }}>{s.fill}</g>{s.line}</svg>
}
