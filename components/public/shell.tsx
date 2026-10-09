import type { ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'

/** Header + width for public pages. The company's own name is shown; Averiqo appears only as the small "secured by" line. */
export function PublicShell({ company, title, sub, children, isPublic }: { company: string; title: string; sub?: string; children: ReactNode; isPublic?: boolean }) {
  return <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
    <header className="mb-6">
      <div className="text-sm font-semibold uppercase tracking-wide text-muted">{company}</div>
      <h1 className="mt-1 text-[22px] font-semibold leading-tight tracking-[-0.01em] sm:text-2xl">{title}</h1>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
    </header>
    <main className="space-y-5">{children}</main>
    <footer className="mt-10 flex items-center gap-1.5 text-xs text-muted"><ShieldCheck size={13} aria-hidden />{isPublic ? 'Your details are sent securely. Secured by Averiqo.' : 'Private link for you only. Please do not forward it. Secured by Averiqo.'}</footer>
  </div>
}

export function LinkGone({ what = 'link' }: { what?: string }) {
  return <div className="mx-auto grid min-h-[70dvh] max-w-md place-items-center px-4 text-center">
    <div><h1 className="text-xl font-semibold">This {what} is not available</h1>
      <p className="mt-2 text-sm text-muted">It may have expired or been switched off by the sender. Please ask them for a new link.</p></div>
  </div>
}
