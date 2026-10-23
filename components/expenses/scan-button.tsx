'use client'
import { useRef, useState } from 'react'
import { Camera, Upload } from '@/components/icons'
import { Modal } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { ExpenseFields, type SupplierOpt } from '@/components/expenses/expense-fields'
import { saveExpense } from '@/app/actions/projects'
import { cn } from '@/lib/utils'

type Opt = { id: string; name: string }
/**
 * "Scan receipt": on a phone the camera opens straight away (or pick a photo / PDF); the expense form then opens with the
 * receipt attached and being read. Nothing is saved until the person checks the fields and presses Save.
 */
export function ScanReceiptButton({ today, projects, assets, employees, suppliers, compact }: { today: string; projects: Opt[]; assets: Opt[]; employees: Opt[]; suppliers: SupplierOpt[]; compact?: boolean }) {
  const [file, setFile] = useState<File | null>(null), cam = useRef<HTMLInputElement>(null), up = useRef<HTMLInputElement>(null)
  const take = (ev: React.ChangeEvent<HTMLInputElement>) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) setFile(f) }
  return <>
    <div className="inline-flex overflow-hidden rounded-xl shadow-card">
      <button type="button" onClick={() => cam.current?.click()} className={cn('arc inline-flex h-10 cursor-pointer items-center gap-2 px-4 text-[14px] font-semibold', compact && 'px-3')}><Camera size={17} aria-hidden />Scan receipt</button>
      <button type="button" onClick={() => up.current?.click()} aria-label="Upload a receipt image or PDF" title="Upload a receipt image or PDF" className="arc inline-flex h-10 w-10 cursor-pointer items-center justify-center border-s border-white/25"><Upload size={16} aria-hidden /></button>
    </div>
    <input ref={cam} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={take} />
    <input ref={up} type="file" accept="image/*,application/pdf" className="sr-only" tabIndex={-1} aria-hidden onChange={take} data-scan-upload />
    {file && <Modal title="Scanned receipt: check and save" wide onClose={() => setFile(null)}>
      <ActionForm action={saveExpense.bind(null, null, null)} submit="Save expense" idempotent>
        <ExpenseFields today={today} projects={projects} assets={assets} employees={employees} suppliers={suppliers} initialFile={file} />
      </ActionForm>
    </Modal>}
  </>
}
