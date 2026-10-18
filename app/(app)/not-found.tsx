import Link from 'next/link'
import { SearchX } from '@/components/icons'
import { EmptyArt } from '@/components/ui/empty-art'

export default function NotFound() {
  return <div className="empty-in mx-auto mt-12 max-w-md rounded-xl border border-border/80 bg-surface px-6 pb-6 pt-8 text-center shadow-card">
    <EmptyArt icon={SearchX} size="lg" className="mb-5" />
    <h1 className="text-lg font-semibold">Not found</h1>
    <p className="mt-2 text-sm text-muted">This record does not exist, was moved to the trash, or you do not have access to it.</p>
    <div className="mt-5 flex justify-center gap-2"><Link href="/" className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-fg">Dashboard</Link><Link href="/search" className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-surface-2">Search</Link></div>
  </div>
}
