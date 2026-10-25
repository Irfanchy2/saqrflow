import type { Ctx } from '@/lib/auth'
import { Badge, Card, CardHeader, Field, Input, Select } from '@/components/ui/primitives'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { addCompanyCard, setCompanyCardActive } from '@/app/actions/cards'
import { CARD_KINDS, companyCards } from '@/lib/cards'

/** Settings → Company cards: the cards employees may pay with. Only a name and the last four digits are stored. */
export async function CompanyCardsSettings({ c }: { c: Ctx }) {
  const cards = await companyCards(c, true)
  return <Card id="company-cards" data-company-cards><CardHeader title="Company cards" sub="When an employee pays by card, they choose which of these cards they used. Only the last 4 digits are kept, never the full card number." />
    <div className="space-y-4 p-4 pt-0">
      {cards.length > 0 && <ul className="divide-y divide-border rounded-lg border border-border">{cards.map(k => <li key={k.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
        <span className="min-w-0 flex-1"><span className="font-medium">{k.label}</span> <span className="font-mono text-muted">••{k.last4}</span><span className="block text-xs text-muted">{CARD_KINDS[k.kind] ?? k.kind}</span></span>
        <Badge tone={k.active ? 'green' : 'neutral'}>{k.active ? 'In use' : 'Off'}</Badge>
        <ActionButton variant="ghost" action={setCompanyCardActive.bind(null, k.id, !k.active)}>{k.active ? 'Switch off' : 'Switch on'}</ActionButton></li>)}</ul>}
      <ActionForm action={addCompanyCard} submit="Add card">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name"><Input name="label" required maxLength={60} placeholder="Company credit card" /></Field>
          <Field label="Last 4 digits" hint="Only these are stored"><Input name="last4" required inputMode="numeric" maxLength={4} pattern="\d{4}" placeholder="9865" autoComplete="off" /></Field>
          <Field label="Type"><Select name="kind" defaultValue="credit">{Object.entries(CARD_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        </div>
      </ActionForm>
    </div></Card>
}
