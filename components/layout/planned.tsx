import { Hammer } from 'lucide-react'
import { Badge, Card, PageHeader } from '@/components/ui/primitives'

/** Honest placeholder: states what is planned and which phase delivers it. Never shows fake data. */
export function Planned({ title, phase, summary, items, meanwhile }: { title: string; phase: string; summary: string; items: string[]; meanwhile?: React.ReactNode }) {
  return <><PageHeader title={title} actions={<Badge tone="amber">Planned · {phase}</Badge>} />
    <Card className="p-6"><div className="flex items-start gap-3"><span className="rounded-lg bg-surface-2 p-2.5 text-muted"><Hammer size={20} /></span><div>
      <h2 className="font-semibold">Not built yet</h2><p className="mt-1 max-w-2xl text-sm text-muted">{summary}</p>
      <ul className="mt-4 grid gap-1.5 text-sm sm:grid-cols-2">{items.map(i => <li key={i} className="flex gap-2"><span className="text-muted">○</span>{i}</li>)}</ul>
      {meanwhile && <div className="mt-5 border-t border-border pt-4 text-sm">{meanwhile}</div>}</div></div></Card></>
}
