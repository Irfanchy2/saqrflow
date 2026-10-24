import Link from 'next/link'
import type { Ctx } from '@/lib/auth'
import { Card, CardHeader, Field, Input } from '@/components/ui/primitives'
import { ActionForm } from '@/components/ui/action-form'
import { savePortalSettings } from '@/app/actions/approvals'
import { portalSettings } from '@/lib/me'

/** Settings → Employee portal: what employees may do themselves in their own portal. */
export async function PortalSettingsCard({ c }: { c: Ctx }) {
  const s = await portalSettings(c)
  return <Card id="employee-portal"><CardHeader title="Employee portal" sub="Employees sign in to see only their own expenses, attendance, salary and payslips, and to send receipts for approval." />
    <div className="p-4"><ActionForm action={savePortalSettings} resetOnSuccess={false} submit="Save portal settings">
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="checkin" defaultChecked={s.checkin} className="mt-0.5" /><span>Employees check in and out themselves<span className="block text-xs text-muted">One tap per day; the time is the server&apos;s, never the phone&apos;s. HR can still correct any day.</span></span></label>
      <Field label="Salary advance limit (% of monthly salary)" hint="Shows each employee how much advance they can still ask for. Empty or 0 = not shown."><Input name="advance_limit_pct" type="number" min={0} max={100} step="1" defaultValue={s.advanceLimitPct || ''} /></Field>
      <p className="text-xs text-muted">Give someone access from their employee record (Portal access). Employee expenses are approved under <Link href="/expenses?tab=claims" className="text-primary hover:underline">Expenses → Employee claims</Link> by owners and accountants.</p>
    </ActionForm></div></Card>
}
