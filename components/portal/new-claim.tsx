'use client'
import { useRef, useState } from 'react'
import { Camera, Pencil, Upload } from '@/components/icons'
import { Modal } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { ExpenseFields } from '@/components/expenses/expense-fields'
import { submitClaim } from '@/app/actions/me'
import { warmScan } from '@/lib/expenses/scan-turbo'
import { cn } from '@/lib/utils'

/**
 * The employee's way in: one big "Scan receipt" button (the phone camera opens at once), "Upload" for a photo or PDF
 * already on the phone, and "Enter by hand". The receipt is read on the server and the form fills; the employee checks
 * every field and sends it for approval. Nothing reaches the company's expenses until an approver approves it.
 */
export function NewClaim({ today, size = 'lg' }: { today: string; size?: 'lg' | 'sm' }) {
  const [open, setOpen] = useState<{ file: File | null } | null>(null)
  const cam = useRef<HTMLInputElement>(null), up = useRef<HTMLInputElement>(null)
  const take = (ev: React.ChangeEvent<HTMLInputElement>) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) setOpen({ file: f }) }
  const lg = size === 'lg'
  const second = cn('inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-border bg-surface font-semibold text-fg shadow-key transition-[background-color,transform] duration-150 hover:bg-surface-2 active:scale-[.98]', lg ? 'h-14 text-[15px]' : 'h-11 px-4 text-[14px]')
  return <>
    <div className={cn(lg ? 'grid grid-cols-2 gap-2.5' : 'flex flex-wrap gap-2')}>
      <button type="button" data-claim-scan onClick={() => { warmScan(); cam.current?.click() }}
        className={cn('arc inline-flex cursor-pointer items-center justify-center gap-2.5 rounded-2xl font-semibold text-white shadow-solid transition-transform duration-150 active:scale-[.98]', lg ? 'col-span-2 h-16 text-[17px]' : 'h-11 px-5 text-[14px]')}>
        <Camera size={lg ? 24 : 18} aria-hidden />Scan receipt</button>
      <button type="button" data-claim-upload onClick={() => { warmScan(); up.current?.click() }} className={second}><Upload size={lg ? 19 : 16} aria-hidden />Upload</button>
      <button type="button" data-claim-manual onClick={() => setOpen({ file: null })} className={second}><Pencil size={lg ? 18 : 15} aria-hidden />Enter by hand</button>
    </div>
    <input ref={cam} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={take} />
    <input ref={up} type="file" accept="image/*,application/pdf" className="sr-only" tabIndex={-1} aria-hidden onChange={take} data-claim-file />
    {open && <Modal title={open.file ? 'Check the receipt and send' : 'New expense'} wide onClose={() => setOpen(null)}>
      <ActionForm action={submitClaim} submit="Send for approval" idempotent>
        <ExpenseFields claim today={today} employees={[]} suppliers={[]} initialFile={open.file} />
        <p className="mt-4 text-[12.5px] leading-relaxed text-muted">Your manager approves it before it is paid back or added to the company&apos;s expenses. You can change or withdraw it until then.</p>
      </ActionForm>
    </Modal>}
  </>
}
