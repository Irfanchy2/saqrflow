'use client'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Loader2 } from '@/components/icons'
import { Button } from '@/components/ui/primitives'
import { toast } from '@/components/ui/toast'
import { createTallyExport } from '@/app/actions/expenses'

/**
 * Creates the Tally export for the current filters and downloads it. The button is disabled while the validation report
 * has problems; the server checks everything again (and refuses) in case anything changed meanwhile.
 */
export function CreateTallyExport({ filters, disabled, count }: { filters: Record<string, string | undefined>; disabled?: boolean; count: number }) {
  const [busy, start] = useTransition(), router = useRouter()
  const go = () => start(async () => {
    const r = (await createTallyExport(filters)) ?? {}
    if (r.error) { toast(r.error, 'error'); return }
    toast(r.message ?? 'Export created')
    if (r.data?.id) { const a = document.createElement('a'); a.href = `/api/expenses/tally/${r.data.id}`; a.download = ''; document.body.appendChild(a); a.click(); a.remove() }
    router.refresh()
  })
  return <Button type="button" variant="primary" disabled={disabled || busy || !count} onClick={go} data-create-export>
    {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <FileText size={15} aria-hidden />}Create Tally XML ({count})</Button>
}
