import { Card, CardHeader, Field, Textarea } from '@/components/ui/primitives'
import { ActionForm } from '@/components/ui/action-form'
import { saveShareTemplate } from '@/app/actions/share'
import { SHARE, SHARE_KINDS, shareSettingKey } from '@/lib/whatsapp/share'
import type { Ctx } from '@/lib/auth'

/** Settings → WhatsApp sharing messages: the text "Share via WhatsApp" opens with, per document. Free sharing needs no
 *  WhatsApp Business account and no approval; these are separate from the WhatsApp Business templates. */
export async function ShareMessages({ c }: { c: Ctx }) {
  const { data } = await c.supabase.from('app_settings').select('key,value').in('key', SHARE_KINDS.map(shareSettingKey))
  const saved = new Map((data ?? []).map(r => [r.key, (r.value as any)?.body as string | null]))
  return <Card id="wa-share" data-share-messages><CardHeader title="WhatsApp sharing messages" sub="The message “Share via WhatsApp” starts with. It opens in your own WhatsApp, where you can still change it before sending. Salary amounts appear only where a message uses {amount}." />
    <div className="grid gap-3 px-5 pb-5 lg:grid-cols-2">{SHARE_KINDS.map(k => {
      const own = saved.get(shareSettingKey(k))
      return <details key={k} className="group rounded-lg border border-border p-3" data-share-template={k}>
        <summary className="flex cursor-pointer items-center justify-between gap-2 text-[14px] font-medium">{SHARE[k].label}<span className="text-xs font-normal text-muted">{own ? 'Edited' : 'Default'}</span></summary>
        <ActionForm action={saveShareTemplate.bind(null, k)} resetOnSuccess={false} submit="Save message" className="mt-3 flex flex-col gap-3">
          <Field label="Message" hint={`Placeholders: ${SHARE[k].vars.map(v => `{${v}}`).join(' ')}`}><Textarea name="body" rows={8} maxLength={1000} defaultValue={own ?? SHARE[k].body} /></Field>
          {own && <label className="flex items-center gap-2 text-[13px] text-muted"><input type="checkbox" name="reset" value="1" />Go back to the default message</label>}
        </ActionForm></details>
    })}</div></Card>
}
