'use client'
import Link from 'next/link'
import { useEffect } from 'react'
import { AlertTriangle, RotateCcw } from '@/components/icons'
import { Button } from '@/components/ui/primitives'
import { EmptyArt } from '@/components/ui/empty-art'

/** Friendly fallback instead of a blank "Application error" page. The technical detail goes to the console / server log only. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error) }, [error])
  const offline = typeof navigator !== 'undefined' && !navigator.onLine
  return <div className="empty-in mx-auto mt-12 max-w-md rounded-xl border border-border/80 bg-surface px-6 pb-6 pt-8 text-center shadow-card" role="alert">
    <EmptyArt icon={AlertTriangle} size="lg" className="mb-5" />
    <h1 className="text-lg font-semibold">{offline ? 'You are offline' : 'This page could not be loaded'}</h1>
    <p className="mt-2 text-sm text-muted">{offline ? 'Check your internet connection, then try again.' : 'A temporary problem stopped this page from loading. Try again. If it keeps happening, tell your administrator'}{error.digest && !offline ? ` (reference ${error.digest}).` : '.'}</p>
    <div className="mt-5 flex justify-center gap-2"><Button onClick={reset}><RotateCcw size={14} />Try again</Button><Link href="/" className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-surface-2">Dashboard</Link></div>
  </div>
}
