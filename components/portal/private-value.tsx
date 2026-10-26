'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Salary figures are hidden until tapped (someone may be looking at the screen). The choice lasts for this browser tab.
const KEY = 'portal-show-pay'
export function PrivateValue({ children, className }: { children: ReactNode; className?: string }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    try { setShown(sessionStorage.getItem(KEY) === '1') } catch {}
    const sync = () => { try { setShown(sessionStorage.getItem(KEY) === '1') } catch {} }
    addEventListener('portal-pay', sync); return () => removeEventListener('portal-pay', sync)
  }, [])
  const toggle = () => { try { sessionStorage.setItem(KEY, shown ? '0' : '1') } catch {} setShown(!shown); dispatchEvent(new Event('portal-pay')) }
  return <button type="button" onClick={toggle} aria-pressed={shown} data-private={shown ? 'shown' : 'hidden'}
    title={shown ? 'Tap to hide' : 'Tap to show'} className={cn('-my-1.5 inline-flex min-h-8 cursor-pointer items-center rounded-md py-1.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-primary/40', className)}>
    <span className={cn('transition-[filter] duration-200', !shown && 'select-none blur-[7px]')} aria-hidden={!shown}>{children}</span>
    {!shown && <span className="sr-only">Hidden. Tap to show.</span>}
  </button>
}
