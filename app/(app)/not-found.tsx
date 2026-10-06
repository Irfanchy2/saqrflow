import Link from 'next/link'
import { SearchX } from 'lucide-react'

export default function NotFound() {
  return <div className="mx-auto mt-16 max-w-md rounded-lg border border-border bg-surface p-6 text-center shadow-card">
    <SearchX className="mx-auto mb-3 text-muted" size={28} aria-hidden />
    <h1 className="text-lg font-semibold">Not found</h1>
    <p className="mt-2 text-sm text-muted">This record does not exist, was moved to the trash, or you do not have access to it.</p>
    <div className="mt-5 flex justify-center gap-2"><Link href="/" className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-fg">Dashboard</Link><Link href="/search" className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-surface-2">Search</Link></div>
  </div>
}
