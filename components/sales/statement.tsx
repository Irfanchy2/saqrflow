// A4 customer statement — same print engine and styles as the sales paper (".sales-paper" in globals.css).
import { fmtMoney } from '@/lib/sales/money'
import { TextHeader, type Branding } from './paper'
import type { Ledger } from '@/lib/ledger'

const fd = (iso?: string | null) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '—')
export interface StatementCustomer { name: string; address?: string | null; trn?: string | null; phone?: string | null; email?: string | null; contact_person?: string | null }

export function StatementPaper({ customer, ledger, branding, from, to, today, className = '' }: { customer: StatementCustomer; ledger: Ledger; branding: Branding; from?: string; to?: string; today: string; className?: string }) {
  const footer = branding.showHeaderFooter ? branding.footer : null
  const open = ledger.invoices.filter(i => i.balance > 0.004)
  return <div className={`sales-paper ${footer ? 'has-footer' : ''} ${branding.brandColor ? 'has-accent' : ''} ${className}`} data-doc="statement" style={branding.brandColor ? ({ ['--paper-accent' as string]: branding.brandColor } as React.CSSProperties) : undefined}>
    <table className="paper-frame">
      <thead><tr><td><div className="pf-top" /></td></tr></thead>
      <tfoot><tr><td><div className="pf-bottom" /></td></tr></tfoot>
      <tbody><tr><td>
        {branding.showHeaderFooter && <div className="paper-letterhead">{branding.header ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={branding.header} alt={`${branding.companyName} letterhead`} /> : <TextHeader b={branding} />}</div>}
        <div className="paper-title"><h1>STATEMENT OF ACCOUNT</h1>{branding.companyTrn && <div className="text-[12px] font-bold">TRN: {branding.companyTrn}</div>}</div>
        <div className="paper-boxes">
          <dl className="paper-box">
            <Pair k="Customer:" v={customer.name} />{customer.contact_person && <Pair k="Attention:" v={customer.contact_person} />}
            {customer.trn && <Pair k="TRN:" v={customer.trn} />}{customer.address && <Pair k="Address:" v={customer.address} />}
            {customer.phone && <Pair k="Tel:" v={customer.phone} />}{customer.email && <Pair k="Email:" v={customer.email} />}
          </dl>
          <dl className="paper-box paper-box--meta">
            <Pair k="Date:" v={fd(today)} /><Pair k="Period:" v={`${from ? fd(from) : 'Start'} – ${fd(to ?? today)}`} />
            <Pair k="Opening:" v={fmtMoney(ledger.opening)} /><Pair k="Closing:" v={`AED ${fmtMoney(ledger.closing)}`} />
          </dl>
        </div>
        <table className="paper-items text-[12px]">
          <colgroup><col style={{ width: '21mm' }} /><col style={{ width: '30mm' }} /><col /><col style={{ width: '25mm' }} /><col style={{ width: '25mm' }} /><col style={{ width: '27mm' }} /></colgroup>
          <thead><tr><th>Date</th><th>Reference</th><th className="text-left">Description</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>
          <tbody>{ledger.entries.map((e, i) => <tr key={i}>
            <td className="text-center">{fd(e.date)}</td><td className="text-center">{e.ref || '—'}</td><td className="paper-desc"><div className="paper-text">{e.description}</div></td>
            <td className="text-right">{e.debit ? fmtMoney(e.debit) : ''}</td><td className="text-right">{e.credit ? fmtMoney(e.credit) : ''}</td><td className="text-right font-bold">{fmtMoney(e.balance)}</td></tr>)}
            <tr className="paper-total font-bold"><td colSpan={3} className="text-right">Totals for the period</td><td className="text-right">{fmtMoney(ledger.totalDebit)}</td><td className="text-right">{fmtMoney(ledger.totalCredit)}</td><td className="text-right">{fmtMoney(ledger.closing)}</td></tr>
          </tbody>
        </table>
        {open.length > 0 && <>
          <div className="paper-keep-next mt-[4mm] text-[14px] font-bold">Open invoices</div>
          <table className="paper-items text-[12px]">
            <colgroup><col style={{ width: '32mm' }} /><col /><col /><col style={{ width: '27mm' }} /><col style={{ width: '27mm' }} /><col style={{ width: '22mm' }} /></colgroup>
            <thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th>Amount</th><th>Balance</th><th>Days overdue</th></tr></thead>
            <tbody>{open.map(i => <tr key={i.id}><td className="text-center">{i.number}</td><td className="text-center">{fd(i.issue_date)}</td><td className="text-center">{fd(i.due_date)}</td>
              <td className="text-right">{fmtMoney(i.total)}</td><td className="text-right font-bold">{fmtMoney(i.balance)}</td><td className="text-center">{i.daysOverdue || '—'}</td></tr>)}</tbody>
          </table></>}
        <div className="paper-keep mt-[4mm] flex justify-end"><dl className="paper-box paper-box--meta" style={{ flex: '0 0 80mm' }}>
          <Pair k="Total due:" v={`AED ${fmtMoney(ledger.outstanding)}`} /><Pair k="Overdue:" v={`AED ${fmtMoney(ledger.overdue)}`} /></dl></div>
        {branding.bankDetails && <div className="paper-keep mt-[3mm]"><div className="text-[14px] font-bold">Bank Details: -</div><div className="paper-text text-[12px]">{branding.bankDetails}</div></div>}
        <div className="mt-[3mm] text-center text-[11px] italic">Please review this statement and inform us of any difference within 15 days. This is a computer-generated statement.</div>
      </td></tr></tbody>
    </table>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {footer && <div className="paper-footer"><img src={footer} alt="Company contact details" /></div>}
  </div>
}
const Pair = ({ k, v }: { k: string; v: string }) => <div className="paper-pair"><dt>{k}</dt><dd>{v}</dd></div>
