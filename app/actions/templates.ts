'use server'
import { revalidatePath } from 'next/cache'
import { getCtx, need } from '@/lib/auth'
import { safe } from '@/lib/action'
import { TEMPLATE_KINDS, TEMPLATE_LABEL, isDefault, sanitizeTemplate, type TemplateKind } from '@/lib/sales/template'
import type { ActionState } from '@/lib/utils'

/** Saves the template for one document type. New and existing documents print with it (it is layout, not content). */
export async function saveDocTemplate(kind: string, json: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    if (!(TEMPLATE_KINDS as readonly string[]).includes(kind)) return { error: 'Unknown document type.' }
    let raw: unknown; try { raw = JSON.parse(json) } catch { return { error: 'The template could not be read.' } }
    const k = kind as TemplateKind, tp = sanitizeTemplate(k, raw)   // the standard layout is stored as false
    const { error } = await c.supabase.from('app_settings').upsert({ company_id: c.company.id, key: `template.${k}`, value: isDefault(k, tp) ? false : tp, updated_at: new Date().toISOString() })
    if (error) throw error
    revalidatePath('/', 'layout')
    return { ok: true, message: `${TEMPLATE_LABEL[k]} template saved. The preview, print view and PDF all use it.` }
  })
}
