'use client'
import { m } from 'framer-motion'
import { T } from '@/components/motion'

/** Each page fades in with a 4 px rise on navigation: quick enough to never feel slow, skipped with reduced motion. */
export default function PageTransition({ children }: { children: React.ReactNode }) {
  return <m.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={T.base}>{children}</m.div>
}
