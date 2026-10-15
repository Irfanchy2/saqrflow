'use client'
import { useEffect } from 'react'

// anything the user meant to press keeps its own behaviour; only the row's empty space opens the record
const INTERACTIVE = 'a,button,input,select,textarea,label,summary,[role=button],[role=menuitem],[role=checkbox],[contenteditable=true],[data-row-stop]'

/**
 * Whole-row navigation for every data table (TableWrap → .rtable) and any element marked [data-row-link]:
 * clicking empty space in a row opens the row's record — its link marked [data-row-primary], else the first page link in it.
 * Action buttons, menus, checkboxes and other links in the row keep working; Ctrl/⌘/middle-click opens a new tab;
 * selecting text never navigates. One listener for the whole app (no per-row handlers).
 */
export function RowNavigator() {
  useEffect(() => {
    const target = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (!t || t.closest(INTERACTIVE)) return null
      const row = t.closest('.rtable tbody tr, [data-row-link]')
      if (!row || row.closest('[data-rows-off]')) return null
      if (window.getSelection()?.toString()) return null
      return row.querySelector<HTMLAnchorElement>('a[data-row-primary]') ?? row.querySelector<HTMLAnchorElement>('a[href]:not([href^="/api/"]):not([target]):not([download])')
    }
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return
      const a = target(e); if (!a) return
      if (e.metaKey || e.ctrlKey || e.shiftKey) window.open(a.href, '_blank', 'noopener')
      else a.click()
    }
    const aux = (e: MouseEvent) => { if (e.button !== 1) return; const a = target(e); if (a) { e.preventDefault(); window.open(a.href, '_blank', 'noopener') } }
    document.addEventListener('click', click)
    document.addEventListener('auxclick', aux)
    return () => { document.removeEventListener('click', click); document.removeEventListener('auxclick', aux) }
  }, [])
  return null
}
