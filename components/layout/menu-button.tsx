'use client'
import { Menu } from 'lucide-react'

/** Opens the navigation drawer on phones and tablets (the sidebar listens for averiqo:menu). */
export function MenuButton() {
  return <button type="button" aria-label="Open menu" onClick={() => dispatchEvent(new Event('averiqo:menu'))}
    className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg lg:hidden"><Menu size={20} /></button>
}
