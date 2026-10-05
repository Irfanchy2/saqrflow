'use client'
import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/primitives'
export function ThemeToggle() {
  const [dark, setDark] = useState(false)
  useEffect(() => setDark(document.documentElement.classList.contains('dark')), [])
  return <Button variant="ghost" size="icon" aria-label="Toggle dark mode" onClick={() => {
    const next = !dark; setDark(next); document.documentElement.classList.toggle('dark', next)
    try { localStorage.setItem('sf-theme', next ? 'dark' : 'light') } catch {}
  }}>{dark ? <Sun size={17} /> : <Moon size={17} />}</Button>
}
