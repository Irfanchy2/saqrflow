import Link from 'next/link'
import type { Ctx } from '@/lib/auth'
import { Card, CardHeader, Field, Input } from '@/components/ui/primitives'
import { ActionForm } from '@/components/ui/action-form'
import { saveApprovalRules } from '@/app/actions/approvals'

/** Settings → Approvals: which records need a manager's approval automatically. Enforced by the database on insert. */
export async function ApprovalRules({ c }: { c: Ctx }) {
  const { data } = await c.supabase.from('app_settings').select('key,value').in('key', ['approvals.expense_threshold', 'approvals.cheque_threshold', 'approvals.po_required', 'sales.require_approval'])
  const v = new Map((data ?? []).map(r => [r.key, r.value]))
  const num = (k: string) => (typeof v.get(k) === 'number' && (v.get(k) as number) > 0 ? String(v.get(k)) : '')
  return <Card id="approvals"><CardHeader title="Approvals" sub="When a manager has to approve before work continues. Requests appear in Approvals and notify everyone who can decide." />
    <div className="p-4"><ActionForm action={saveApprovalRules} resetOnSuccess={false} submit="Save approval rules">
      <div className="space-y-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="quote_required" defaultChecked={v.get('sales.require_approval') === true} />Quotations need approval before they can be sent</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="po_required" defaultChecked={v.get('approvals.po_required') === true} />Purchase orders need approval before they can be sent</label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Expenses from (AED)" hint="expenses of this amount or more wait for approval; empty = off"><Input name="expense_threshold" type="number" min={0} step="0.01" defaultValue={num('approvals.expense_threshold')} /></Field>
        <Field label="Outgoing cheques from (AED)" hint="cannot be presented or cleared until approved; empty = off"><Input name="cheque_threshold" type="number" min={0} step="0.01" defaultValue={num('approvals.cheque_threshold')} /></Field>
      </div>
      <p className="text-xs text-muted">Approvers: Company Owner and Super Admin (permission “approvals.decide”); quotations can also be approved by anyone with sales approval. Rules apply to records created after saving. <Link href="/approvals" className="text-primary hover:underline">Open Approvals</Link></p>
    </ActionForm></div></Card>
}
