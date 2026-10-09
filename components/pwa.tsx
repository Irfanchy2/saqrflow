'use client'
import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'
import { clearAllDrafts } from '@/lib/drafts'

/** Registers the service worker, shows an offline banner, and wipes device drafts on sign-out (shared devices). */
export function Pwa() {
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['127.0.0.1', 'localhost'].includes(location.hostname)))
      navigator.serviceWorker.register('/sw.js').catch(() => { /* not supported here: the app works without it */ })
    const set = () => setOffline(!navigator.onLine); set()
    const out = (e: Event) => { if ((e.target as HTMLElement)?.closest?.('[data-signout]')) clearAllDrafts() }
    window.addEventListener('online', set); window.addEventListener('offline', set); document.addEventListener('submit', out, true)
    return () => { window.removeEventListener('online', set); window.removeEventListener('offline', set); document.removeEventListener('submit', out, true) }
  }, [])
  if (!offline) return null
  return <div role="status" className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-2 bg-warning px-4 py-2 text-sm font-medium text-black" data-offline-banner>
    <WifiOff size={15} aria-hidden />You are offline. What you type is kept on this device; save again when you are back online.</div>
}
