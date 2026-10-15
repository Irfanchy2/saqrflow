'use client'
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { X } from '@/components/icons'
import { Button } from './primitives'
import type { VariantProps } from 'class-variance-authority'

const Ctx = createContext<{ close: () => void }>({ close: () => {} })
export const useDialog = () => useContext(Ctx)

/**
 * Trigger button + modal on the native <dialog> element (focus trap, Esc to close, backdrop for free).
 * Phones: bottom sheet. `wide` forms (the longer workflows) open as a full-height side drawer from lg up, so long forms
 * keep their context and the Save bar (pinned at the bottom) never leaves the screen.
 */
export function DialogButton({ label, title, children, icon, variant = 'primary', size = 'md', wide, openParam }: {
  label: ReactNode; title: string; children: ReactNode; icon?: ReactNode; wide?: boolean
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'icon'
  /** opens automatically when the URL has ?new=<openParam> (used by Ctrl+K quick actions) */
  openParam?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (openParam && new URLSearchParams(location.search).get('new') === openParam && !ref.current?.open) ref.current?.showModal() }, [openParam])
  // the phone "+" button (components/ui/mobile Fab) opens the form for its openParam
  useEffect(() => {
    if (!openParam) return
    const on = (e: Event) => { if ((e as CustomEvent).detail === openParam && !ref.current?.open) ref.current?.showModal() }
    addEventListener('averiqo:open', on); return () => removeEventListener('averiqo:open', on)
  }, [openParam])
  return <>
    <Button variant={variant} size={size} onClick={() => ref.current?.showModal()}>{icon}{label}</Button>
    <dialog ref={ref} onClick={e => { if (e.target === ref.current) ref.current?.close() }}
      data-drawer={wide ? '' : undefined}
      className={`mx-0 mb-0 mt-auto max-h-[92dvh] w-full max-w-none flex-col rounded-t-2xl text-start border border-border/80 bg-surface p-0 text-fg shadow-pop open:flex sm:m-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:rounded-2xl ${wide ? 'sm:max-w-2xl lg:my-0 lg:me-0 lg:ms-auto lg:h-[100dvh] lg:max-h-[100dvh] lg:w-[min(680px,100vw)] lg:max-w-[680px] lg:rounded-none lg:border-y-0 lg:border-e-0' : 'sm:max-w-lg'}`}>
      {/* phones: a grab handle says "this is a sheet" */}
      <span aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border-strong/80 sm:hidden" />
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/80 px-4 pb-3 pt-2 sm:px-6 sm:py-4">
        <h2 className="min-w-0 text-[16px] font-semibold tracking-[-0.018em]">{title}</h2>
        <button type="button" aria-label="Close" className="-me-1.5 grid h-10 w-10 cursor-pointer place-items-center rounded-lg text-muted transition-colors hover:bg-fg/[.05] hover:text-fg active:scale-95 sm:h-8 sm:w-8" onClick={() => ref.current?.close()}><X size={18} /></button>
      </div>
      <Ctx.Provider value={{ close: () => ref.current?.close() }}><div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">{children}</div></Ctx.Provider>
    </dialog>
  </>
}
