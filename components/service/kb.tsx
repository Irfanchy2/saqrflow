import { Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { KB_CATEGORIES, kbBlocks } from '@/lib/service'

/** Article editor fields. Formatting is plain text: "# Heading", "- bullet", "1. step". */
export function KbFields({ a = {}, categories = [] }: { a?: Record<string, any>; categories?: string[] }) {
  const cats = [...new Set([...KB_CATEGORIES, ...categories])]
  return <div className="grid gap-4 sm:grid-cols-2">
    <Field label="Title *" className="sm:col-span-2"><Input name="title" required minLength={3} maxLength={200} defaultValue={a.title} placeholder="e.g. Hot work permit before welding on site" /></Field>
    <Field label="Category"><Input name="category" list="kb-cats" required maxLength={60} defaultValue={a.category ?? 'General'} /></Field>
    <datalist id="kb-cats">{cats.map(c => <option key={c} value={c} />)}</datalist>
    <Field label="Tags" hint="comma separated"><Input name="tags" maxLength={400} defaultValue={(a.tags ?? []).join(', ')} placeholder="safety, welding, permit" /></Field>
    <Field label="Content" className="sm:col-span-2" hint={'Plain text. Start a line with "# " for a heading, "- " for a bullet, "1. " for a numbered step.'}>
      <Textarea name="body" rows={14} maxLength={60000} defaultValue={a.body ?? ''} className="font-mono text-[13px]" /></Field>
    <Field label="Status"><Select name="status" defaultValue={a.status ?? 'published'}><option value="published">Published (everyone in the company)</option><option value="draft">Draft (editors only)</option></Select></Field>
    <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="pinned" defaultChecked={!!a.pinned} />Pin to the top</label>
  </div>
}

/** Renders an article body as text blocks (no HTML from the database is ever injected). */
export function KbBody({ body }: { body: string }) {
  const blocks = kbBlocks(body)
  if (!blocks.length) return <p className="text-sm text-muted">This article is empty.</p>
  return <div data-kb-body className="space-y-3 text-[15px] leading-relaxed">{blocks.map((b, i) =>
    b.t === 'h' ? (b.level === 2 ? <h2 key={i} className="pt-2 text-base font-semibold">{b.text}</h2> : <h3 key={i} className="pt-1 text-sm font-semibold">{b.text}</h3>)
    : b.t === 'ul' ? <ul key={i} className="list-disc space-y-1 ps-5">{b.items.map((x, j) => <li key={j} className="break-words">{x}</li>)}</ul>
    : b.t === 'ol' ? <ol key={i} className="list-decimal space-y-1 ps-5">{b.items.map((x, j) => <li key={j} className="break-words">{x}</li>)}</ol>
    : <p key={i} className="whitespace-pre-line break-words">{(b as { text: string }).text}</p>)}</div>
}
