'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { SECTION_CATEGORY } from '@/lib/settings/catalog'

/** Old links to the single long page (/settings#branding …) open the category that now holds that section. */
export function LegacySettingsHash() {
  const router = useRouter()
  useEffect(() => {
    const go = () => { const id = decodeURIComponent(location.hash.slice(1)); const cat = SECTION_CATEGORY[id]; if (cat) router.replace(`/settings/${cat}#${id}`) }
    go(); addEventListener('hashchange', go); return () => removeEventListener('hashchange', go)
  }, [router])
  return null
}
