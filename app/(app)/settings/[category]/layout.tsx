import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { getCtx } from '@/lib/auth'
import { categoriesFor } from '@/lib/settings/perms'

/** Access check before anything is sent: a category this role may not open (or that does not exist) is a real 404. */
export default async function SettingsCategoryLayout({ children, params }: { children: ReactNode; params: Promise<{ category: string }> }) {
  const { category } = await params
  if (!categoriesFor(await getCtx()).some(x => x.id === category)) notFound()
  return children
}
