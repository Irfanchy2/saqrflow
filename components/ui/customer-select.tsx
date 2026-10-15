'use client'
import { useEffect, useRef, useState } from 'react'
import { Select } from './primitives'

type Opt = { id: string; name: string }
export type OptionKind = 'customers' | 'employees' | 'users'
const shared = new Map<OptionKind, Promise<Opt[]>>()   // one request per list per page, however many forms ask
const load = (k: OptionKind) => {
  let p = shared.get(k)
  if (!p) { p = fetch(`/api/options/${k}`).then(r => r.ok ? r.json() : { options: [] }).then(d => d.options as Opt[]).catch(() => { shared.delete(k); return [] }); shared.set(k, p) }
  return p
}

/**
 * Dropdown that carries only the current choice in the page and loads its full list (customers, employees or users) the
 * first time it is shown, i.e. when its dialog opens. Record pages no longer ship every name with every hidden form.
 */
export function RemoteSelect({ kind, name, defaultValue, defaultLabel, none }: { kind: OptionKind; name: string; defaultValue?: string | null; defaultLabel?: string | null; none: string }) {
  const ref = useRef<HTMLSelectElement>(null)
  const [opts, setOpts] = useState<Opt[] | null>(null)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); load(kind).then(setOpts) } })
    io.observe(el); return () => io.disconnect()
  }, [kind])
  const list = opts ?? (defaultValue ? [{ id: defaultValue, name: defaultLabel ?? 'Current choice' }] : [])
  return <Select ref={ref} name={name} defaultValue={defaultValue ?? ''} aria-busy={opts ? undefined : true}>
    <option value="">{none}</option>
    {list.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    {!opts && <option value="" disabled>Loading…</option>}
  </Select>
}

export const CustomerSelect = ({ name = 'customer_id', defaultValue, defaultLabel, none = '— None —' }: { name?: string; defaultValue?: string | null; defaultLabel?: string | null; none?: string }) =>
  <RemoteSelect kind="customers" name={name} defaultValue={defaultValue} defaultLabel={defaultLabel} none={none} />
