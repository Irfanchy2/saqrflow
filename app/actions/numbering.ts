'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import type { ActionState } from '@/lib/utils'

const TYPES = ['quotation', 'invoice', 'delivery_note', 'purchase_order', 'credit_note', 'receipt', 'project'] as const
/** Settings → Document numbering (admins only; RLS re-checks settings.manage). Existing document numbers are never changed. */
export async function saveNumbering(docType: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const t = z.enum(TYPES).parse(docType)
    if (fd.get('enabled') !== 'on') {
      if (t === 'quotation') return { error: 'Quotations always use a custom format — change its fields instead.' }
      const { error } = await c.supabase.from('document_number_formats').delete().eq('doc_type', t)
      if (error) throw error
      revalidatePath('/settings'); return { ok: true, message: 'Back to the standard format.' }
    }
    const v = z.object({
      prefix: z.string().trim().regex(/^[A-Za-z0-9-]{0,12}$/, 'Prefix: letters, digits or “-”, up to 12'),
      fixed_digits: z.string().trim().regex(/^[0-9]{0,6}$/, 'Fixed digits: up to 6 digits, e.g. 00'),
      seq_pad: z.coerce.number().int().min(1).max(10),
      next_seq: z.coerce.number().int().min(1, 'Next number must be at least 1').max(9_999_999_999),
      year_separator: z.enum(['/', '-', '']),
      yearly_reset: z.boolean(), include_year: z.boolean(),
    }).parse({ prefix: str(fd, 'prefix') ?? '', fixed_digits: str(fd, 'fixed_digits') ?? '', seq_pad: str(fd, 'seq_pad'), next_seq: str(fd, 'next_seq'),
      year_separator: (fd.get('year_separator') as string) ?? '/', yearly_reset: fd.get('yearly_reset') === 'on', include_year: fd.get('include_year') === 'on' })
    const { error } = await c.supabase.from('document_number_formats').upsert({ ...v, reset_to: 1, company_id: c.company.id, doc_type: t, updated_by: c.userId, updated_at: new Date().toISOString() })
    if (error) throw error
    revalidatePath('/settings'); return { ok: true, message: 'Numbering saved. New documents use it; existing numbers are unchanged.' }
  })
}
