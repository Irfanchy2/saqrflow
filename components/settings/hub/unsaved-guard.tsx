'use client'
import { useEffect, useRef, type ReactNode } from 'react'

const MSG = 'You have unsaved changes in Settings. Leave without saving?'

/**
 * Protects edits on a settings page: once a field in one of its forms is changed and not yet submitted, leaving the page
 * (another link, closing or reloading the tab) asks first. Submitting a form counts as saved. Search boxes are ignored.
 */
export function UnsavedGuard({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null), dirty = useRef(new Set<HTMLFormElement>())
  useEffect(() => {
    const el = box.current; if (!el) return
    const mark = (e: Event) => {
      const t = e.target as HTMLInputElement
      if (!t?.form || t.type === 'search' || t.closest('[data-no-guard]')) return
      if (!t.form.querySelector('button[type=submit],button:not([type]),input[type=submit]')) return   // switches that save on their own
      dirty.current.add(t.form)
    }
    const saved = (e: Event) => { dirty.current.delete(e.target as HTMLFormElement) }
    const isDirty = () => { for (const f of dirty.current) if (!f.isConnected) dirty.current.delete(f); return dirty.current.size > 0 }
    const unload = (e: BeforeUnloadEvent) => { if (isDirty()) { e.preventDefault(); e.returnValue = MSG } }
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return
      const to = new URL(a.href, location.href)
      if (to.origin === location.origin && to.pathname === location.pathname) return   // a jump within this page
      if (isDirty() && !window.confirm(MSG)) { e.preventDefault(); e.stopPropagation() } else dirty.current.clear()
    }
    el.addEventListener('input', mark); el.addEventListener('change', mark); el.addEventListener('submit', saved, true)
    addEventListener('beforeunload', unload); document.addEventListener('click', click, true)
    return () => { el.removeEventListener('input', mark); el.removeEventListener('change', mark); el.removeEventListener('submit', saved, true); removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true) }
  }, [])
  return <div ref={box} className="contents">{children}</div>
}
