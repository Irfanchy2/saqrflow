'use client'
import { useState } from 'react'
import { Input, Select } from '@/components/ui/primitives'
import { UNIT_MAX, UNIT_OPTIONS, UNITS, unitChoices } from '@/lib/sales/docs'

const OTHER = '__other__'
const LABEL = new Map(UNIT_OPTIONS.map(u => [u.code, u.label]))

/**
 * Unit of a line: the standard codes (L.S, LM, SQM, PCS, KG …) plus "Other…" for anything else, typed by hand.
 * Controlled (`value` + `onChange`, the sales editor) or a plain form field (`name`, the catalog form).
 * The stored text is exactly what is shown and printed.
 */
export function UnitPicker({ value, onChange, name, defaultValue, ariaLabel = 'Unit', disabled }: {
  value?: string; onChange?: (unit: string) => void; name?: string; defaultValue?: string; ariaLabel?: string; disabled?: boolean
}) {
  const [own, setOwn] = useState(defaultValue ?? 'Nos')
  const unit = value ?? own
  const [typing, setTyping] = useState(false)
  const set = (u: string) => { if (value === undefined) setOwn(u); onChange?.(u) }
  const custom = typing || !UNITS.includes(unit)
  return <div className="flex min-w-0 flex-col gap-1">
    <Select aria-label={ariaLabel} disabled={disabled} value={typing ? OTHER : unit} title={LABEL.get(unit) ?? unit}
      onChange={e => { if (e.target.value === OTHER) { setTyping(true); return } setTyping(false); set(e.target.value) }}>
      {unitChoices(unit).map(u => <option key={u} value={u}>{u}</option>)}
      <option value={OTHER}>Other…</option>
    </Select>
    {custom && typing && <Input aria-label={`${ariaLabel} (type your own)`} autoFocus maxLength={UNIT_MAX} placeholder="e.g. BAG" disabled={disabled}
      defaultValue={UNITS.includes(unit) ? '' : unit} onBlur={e => { const v = e.target.value.trim(); if (v) { set(v); setTyping(false) } }}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() } if (e.key === 'Escape') setTyping(false) }} />}
    {name && <input type="hidden" name={name} value={unit} />}
  </div>
}
