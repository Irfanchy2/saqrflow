'use client'
import { Moon, Sun } from '@/components/icons'
import { useEffect, useState } from 'react'
import { isDarkNow, toggleTheme } from '@/lib/theme'
import { Button } from '@/components/ui/primitives'
export function ThemeToggle() {
  const [dark, setDark] = useState(false)
  useEffect(() => { const sync = () => setDark(isDarkNow()); sync(); addEventListener('sf-theme', sync); return () => removeEventListener('sf-theme', sync) }, [])
  return <Button variant="ghost" size="icon" aria-label="Toggle dark mode" onClick={toggleTheme}>{dark ? <Sun size={17} /> : <Moon size={17} />}</Button>
}
