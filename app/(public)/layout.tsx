import type { Metadata } from 'next'

// Pages opened from secure links and public forms. No app navigation, no session needed, never indexed.
export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' }
export const dynamic = 'force-dynamic'

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[100dvh] bg-bg">{children}</div>
}
