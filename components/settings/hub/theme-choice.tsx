'use client'
import { useEffect, useState } from 'react'
import { Laptop, Moon, Sun } from '@/components/icons'
import { getThemePref, setThemePref, type ThemePref } from '@/lib/theme'
import { cn } from '@/lib/utils'

const OPTS: { v: ThemePref; label: string; Icon: typeof Sun }[] = [{ v: 'light', label: 'Light', Icon: Sun }, { v: 'dark', label: 'Dark', Icon: Moon }, { v: 'system', label: 'Match device', Icon: Laptop }]

/** Light / dark / match the device. The same preference as the toolbar switch (stored in this browser). */
export function ThemeChoice() {
  const [pref, setPref] = useState<ThemePref | null>(null)
  useEffect(() => { const sync = () => setPref(getThemePref()); sync(); addEventListener('sf-theme', sync); return () => removeEventListener('sf-theme', sync) }, [])
  return <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2 sm:max-w-md" data-theme-choice>
    {OPTS.map(({ v, label, Icon }) => <button key={v} type="button" role="radio" aria-checked={pref === v} onClick={() => setThemePref(v)}
      className={cn('flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-sm transition-colors',
        pref === v ? 'border-primary bg-primary-soft font-medium text-fg ring-2 ring-primary/15' : 'border-border bg-surface text-muted hover:bg-surface-2 hover:text-fg')}>
      <Icon size={20} aria-hidden />{label}</button>)}
  </div>
}
