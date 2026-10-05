'use client'
import { createContext, useContext, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './primitives'
import type { VariantProps } from 'class-variance-authority'

const Ctx = createContext<{ close: () => void }>({ close: () => {} })
export const useDialog = () => useContext(Ctx)

/** Trigger button + modal built on the native <dialog> element (focus trap, Esc to close, backdrop for free). */
export function DialogButton({ label, title, children, icon, variant = 'primary', size = 'md', wide }: {
  label: ReactNode; title: string; children: ReactNode; icon?: ReactNode; wide?: boolean
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'icon'
}) {
  const ref = useRef<HTMLDialogElement>(null)
  return <>
    <Button variant={variant} size={size} onClick={() => ref.current?.showModal()}>{icon}{label}</Button>
    <dialog ref={ref} onClick={e => { if (e.target === ref.current) ref.current?.close() }}
      className={`m-auto w-[calc(100%-2rem)] ${wide ? 'max-w-2xl' : 'max-w-lg'} rounded-lg border border-border bg-surface p-0 text-fg shadow-2xl`}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <button aria-label="Close" className="rounded p-1 text-muted hover:bg-surface-2" onClick={() => ref.current?.close()}><X size={16} /></button>
      </div>
      <Ctx.Provider value={{ close: () => ref.current?.close() }}><div className="max-h-[75vh] overflow-y-auto p-5">{children}</div></Ctx.Provider>
    </dialog>
  </>
}
