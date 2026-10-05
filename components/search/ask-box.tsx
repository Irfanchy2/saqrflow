'use client'
import { useActionState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Loader2, Sparkles } from 'lucide-react'
import { Badge, Button } from '@/components/ui/primitives'
import { runAiSearch } from '@/app/actions/ai'
import type { SearchAnswer } from '@/lib/ai/search'

const EXAMPLES = ['Show our latest Trade License', 'Which employees have visas expiring next month?', "Find Mohammed Ayub's Emirates ID", 'Show tenancy contract', 'Which documents expire within 60 days?', 'Show invoices for ABC Contracting']

/** Natural-language search. Results come from the user's own session, so permissions (RLS) always apply. */
export function AskBox({ initial, autoRun }: { initial?: string; autoRun?: boolean }) {
  const [res, run, pending] = useActionState(runAiSearch, null as SearchAnswer | { error: string } | null)
  const form = useRef<HTMLFormElement>(null), input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (autoRun && initial) form.current?.requestSubmit() }, [autoRun, initial])
  const ask = (q: string) => { if (input.current) { input.current.value = q; form.current?.requestSubmit() } }
  return <div className="space-y-4">
    <form ref={form} action={run} className="flex gap-2">
      <div className="relative flex-1"><Sparkles size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-primary" aria-hidden />
        <input ref={input} name="q" defaultValue={initial} aria-label="Ask a question about your documents" placeholder="Ask anything — e.g. Which documents expire within 60 days?" className="h-11 w-full rounded-md border border-border bg-surface ps-9 pe-3 text-sm placeholder:text-muted/70" /></div>
      <Button type="submit" className="h-11" disabled={pending}>{pending ? <Loader2 size={15} className="animate-spin" /> : null}Search</Button>
    </form>
    <div className="flex flex-wrap gap-1.5">{EXAMPLES.map(e => <button key={e} type="button" onClick={() => ask(e)} className="cursor-pointer rounded-full border border-border px-3 py-1 text-xs text-muted hover:border-primary/40 hover:text-fg">{e}</button>)}</div>
    {res && 'error' in res && <p role="alert" className="text-sm text-danger">{res.error}</p>}
    {res && 'results' in res && <div aria-live="polite" className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3"><span className="text-sm font-semibold">{res.summary}</span>
        <span className="text-xs text-muted">{res.engine === 'gemini' ? 'Understood by Gemini' : 'Understood by local rules'} · only records you are allowed to see</span></div>
      {res.results.length === 0 ? <p className="px-4 py-6 text-sm text-muted">Nothing found.</p> :
        <ul className="divide-y divide-border">{res.results.map((r, i) => <li key={i}><Link href={r.href} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/60">
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.title}</span><span className="block truncate text-xs text-muted">{r.sub}</span></span>
          {r.badge && <Badge tone={r.tone}>{r.badge}</Badge>}</Link></li>)}</ul>}
    </div>}
  </div>
}
