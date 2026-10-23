'use client'
import { Menu, Search } from '@/components/icons'

const round = 'grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full bg-surface/80 text-fg shadow-card ring-1 ring-white/70 backdrop-blur transition-transform duration-150 active:scale-95 dark:ring-white/[.06] lg:hidden'

/** Opens the navigation drawer on phones and tablets (the sidebar listens for averiqo:menu). */
export function MenuButton() {
  return <button type="button" aria-label="Open menu" onClick={() => dispatchEvent(new Event('averiqo:menu'))} className={round}><Menu size={19} /></button>
}

/** Phones and tablets: opens the command palette (the same search as Ctrl K and the dock on desktop). */
export function SearchButton() {
  return <button type="button" aria-label="Search" onClick={() => dispatchEvent(new Event('saqrflow:palette'))} className={round}><Search size={18} /></button>
}
