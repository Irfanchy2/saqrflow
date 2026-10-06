import { Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { PROJECT_STATUS } from '@/lib/projects'

export function ProjectFields({ customers, p = {} }: { customers: { id: string; name: string }[]; p?: Record<string, any> }) {
  return <div className="grid gap-4 sm:grid-cols-2">
    <Field label="Project name *" className="sm:col-span-2"><Input name="name" required maxLength={200} defaultValue={p.name} placeholder="e.g. Steel staircase — Villa 22, Fujairah" /></Field>
    <Field label="Project code" hint="Leave blank to number it automatically"><Input name="code" maxLength={40} defaultValue={p.code ?? ''} /></Field>
    <Field label="Client"><Select name="customer_id" defaultValue={p.customer_id ?? ''}><option value="">— None —</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
    <Field label="Location / site"><Input name="location" maxLength={300} defaultValue={p.location ?? ''} /></Field>
    <Field label="Contract value (AED)"><Input name="contract_value" type="number" min={0} step="0.01" defaultValue={p.contract_value ?? ''} /></Field>
    <Field label="Start date"><Input name="start_date" type="date" defaultValue={p.start_date ?? ''} /></Field>
    <Field label="Expected completion"><Input name="expected_completion" type="date" defaultValue={p.expected_completion ?? ''} /></Field>
    <Field label="Status"><Select name="status" defaultValue={p.status ?? 'planning'}>{Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
    <Field label="Scope / description" className="sm:col-span-2"><Textarea name="description" maxLength={4000} defaultValue={p.description ?? ''} /></Field>
  </div>
}

export function Progress({ label, value, tone = 'bg-primary' }: { label: string; value: number; tone?: string }) {
  return <div><div className="mb-1 flex justify-between text-xs"><span className="text-muted">{label}</span><span className="font-medium tabular-nums">{value}%</span></div>
    <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><div className={`h-full rounded-full ${tone} transition-[width] duration-500`} style={{ width: `${value}%` }} /></div></div>
}
