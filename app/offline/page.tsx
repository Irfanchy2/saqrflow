import { WifiOff } from 'lucide-react'

export const metadata = { title: 'Offline', robots: { index: false } }
export const dynamic = 'force-static'

/** Shown by the service worker when a page is opened without a connection. Contains no company data. */
export default function Offline() {
  return <main className="flex min-h-screen items-center justify-center bg-bg p-6">
    <div className="max-w-sm space-y-3 text-center">
      <WifiOff size={32} className="mx-auto text-muted" aria-hidden />
      <h1 className="text-lg font-semibold">You are offline</h1>
      <p className="text-sm text-muted">This page needs a connection. Anything you were typing in a quotation, invoice, site report, ticket or expense is kept on this device and offered back to you when you open it again.</p>
      <a href="/" className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary/90">Try again</a>
    </div>
  </main>
}
