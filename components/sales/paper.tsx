// A4 sales document — Al Saqr Al Ahmar templates (Quotation / Tax Invoice / Delivery Note).
// One component for the live editor preview and the print view, so screen and paper match.
// Layout is in millimetres on a fixed 210 mm canvas; print rules live in app/globals.css (".sales-paper").
import { memo } from 'react'
import { amountInWords, computeTotals, fmtMoney, lineAmount, lineVat } from '@/lib/sales/money'
import { DOC_META, type SalesType } from '@/lib/sales/docs'

export interface PaperItem { description: string; materials?: string | null; quantity: number | string; unit?: string | null; unit_price: number | string }
export interface PaperDoc {
  doc_type: SalesType; number: string; issue_date: string; due_date?: string | null; valid_until?: string | null
  attention?: string | null; customer_name?: string | null; customer_address?: string | null; customer_trn?: string | null; customer_phone?: string | null; customer_email?: string | null
  site?: string | null; subject?: string | null; intro?: string | null; closing?: string | null; lpo_ref?: string | null; del_no?: string | null; reference?: string | null
  project_name?: string | null
  vat_rate: number; discount?: number; show_total?: boolean; terms: string[]; payment_terms: string[]; receiver_name?: string | null; vehicle_no?: string | null
}
export interface Branding {
  companyName: string; header?: string | null; headerInvoice?: string | null; footer?: string | null; stamp?: string | null; signature?: string | null
  showHeaderFooter: boolean; showStamp: boolean; bankDetails?: string | null; companyTrn?: string | null
  /** on-paper sizes in px at 96 dpi (1 mm ≈ 3.78 px) */
  sealSize?: number; signatureWidth?: number; signAlign?: 'left' | 'center' | 'right'; signSpacing?: number
}
export const SIGN_DEFAULTS = { sealSize: 140, signatureWidth: 160, signAlign: 'right' as const, signSpacing: 8 }

const fmtDate = (iso?: string | null) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '—')
const dash = (s?: string | null) => (s && s.trim() ? s : '—')

function Paper({ doc, items, branding, paid = 0, className = '', pageGuides = false }: { doc: PaperDoc; items: PaperItem[]; branding: Branding; paid?: number; className?: string; pageGuides?: boolean }) {
  const meta = DOC_META[doc.doc_type]
  const isInv = doc.doc_type === 'invoice', isDn = doc.doc_type === 'delivery_note', isQtn = doc.doc_type === 'quotation'
  const t = computeTotals(items, doc.vat_rate, doc.discount ?? 0, isInv)
  const header = (isInv && branding.headerInvoice) || branding.header
  const rows = items.length ? items : [{ description: '', quantity: 1, unit_price: 0 } as PaperItem]
  const pad = Math.max(0, (isInv ? 3 : 1) - rows.length + 1)
  const seal = branding.sealSize ?? SIGN_DEFAULTS.sealSize, sigW = branding.signatureWidth ?? SIGN_DEFAULTS.signatureWidth
  const align = branding.signAlign ?? SIGN_DEFAULTS.signAlign, spacing = branding.signSpacing ?? SIGN_DEFAULTS.signSpacing
  const showSign = branding.showStamp && !isInv && !!(branding.stamp || branding.signature)
  const footer = branding.showHeaderFooter ? branding.footer : null
  const cols = isInv ? 7 : 5

  return <div className={`sales-paper ${footer ? 'has-footer' : ''} ${className}`} data-doc={doc.doc_type}>
    {pageGuides && <div className="paper-guides no-print" aria-hidden />}
    {/* Outer frame: its thead/tfoot repeat on every printed page and reserve room for the top margin and the fixed footer. */}
    <table className="paper-frame">
      <thead><tr><td><div className="pf-top" /></td></tr></thead>
      <tfoot><tr><td><div className="pf-bottom" /></td></tr></tfoot>
      <tbody><tr><td>
        {branding.showHeaderFooter && <div className="paper-letterhead">
          {header ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={header} alt={`${branding.companyName} letterhead`} decoding="sync" />
            : <div className="text-center"><div className="text-[20px] font-bold tracking-wide">{branding.companyName}</div><div className="text-[11px] text-neutral-600">Upload your letterhead in Settings → Branding</div></div>}
        </div>}
        <div className="paper-title">
          <h1 className={isInv ? 'underline' : ''}>{meta.paperTitle}</h1>
          {isInv && branding.companyTrn && <div className="text-[12px] font-bold">TRN: {branding.companyTrn}</div>}
        </div>

        {/* party + reference boxes */}
        <div className="paper-boxes">
          <dl className="paper-box">
            {isQtn && <Pair k="Attention:" v={dash(doc.attention)} />}
            <Pair k="Company Name:" v={dash(doc.customer_name)} />
            {!isQtn && <Pair k="TRN:" v={dash(doc.customer_trn)} />}
            {doc.customer_phone && <Pair k="Tel:" v={doc.customer_phone} />}
            {doc.customer_email && <Pair k="Email:" v={doc.customer_email} />}
            <Pair k="Address:" v={dash(doc.customer_address)} />
            {doc.site && <Pair k={isDn ? 'Delivery to:' : 'Site:'} v={doc.site} />}
            {doc.project_name && <Pair k="Project:" v={doc.project_name} />}
          </dl>
          <dl className="paper-box paper-box--meta">
            <Pair k={isDn ? 'Delivery No.' : isInv ? 'Invoice No.' : 'Ref No.'} v={dash(doc.number)} />
            <Pair k="Date:" v={fmtDate(doc.issue_date)} />
            {!isQtn && <Pair k="L.P.O:" v={dash(doc.lpo_ref)} />}
            {isInv && <Pair k="DEL NO:" v={dash(doc.del_no)} />}
            {doc.reference && <Pair k="Your Ref:" v={doc.reference} />}
            {isInv && doc.due_date && <Pair k="Due:" v={fmtDate(doc.due_date)} />}
            {isQtn && doc.valid_until && <Pair k="Valid till:" v={fmtDate(doc.valid_until)} />}
          </dl>
        </div>

        {isQtn && doc.intro && <div className="paper-text mb-[1.5mm]">{doc.intro}</div>}
        {doc.subject && <div className="paper-text mb-[1.5mm]"><b>Subject:</b> {doc.subject}</div>}
        {!isInv && <div className="paper-keep-next text-[14px] font-bold">The scope of works:-</div>}

        {/* items — fixed table layout: the description column absorbs the width, nothing can widen the table */}
        <table className="paper-items">
          <colgroup>
            <col style={{ width: '9mm' }} /><col />
            {isInv ? <><col style={{ width: '17mm' }} /><col style={{ width: '21mm' }} /><col style={{ width: '24mm' }} /><col style={{ width: '20mm' }} /><col style={{ width: '27mm' }} /></>
              : <><col style={{ width: '20mm' }} /><col style={{ width: '27mm' }} /><col style={{ width: '29mm' }} /></>}
          </colgroup>
          <thead><tr>
            <th>SR<br />NO</th><th className="text-left">DESCRIPTION</th><th>QTY.</th>
            {isInv ? <><th>Rate</th><th>Amount</th><th>VAT {doc.vat_rate}%</th><th>Amount With Vat</th></>
              : <><th>Unit price<br />(dhs)</th><th>Total Price<br />(dhs)</th></>}
          </tr></thead>
          <tbody>
            {rows.map((it, i) => {
              const amt = lineAmount(it), vat = lineVat(it, doc.vat_rate)
              return <tr key={i}>
                <td className="text-center font-bold">{String(i + 1).padStart(2, '0')}</td>
                <td className="paper-desc">{it.description ? <div className="paper-text">{it.description}</div> : <span className="text-neutral-400">—</span>}
                  {it.materials && <div className="paper-text mt-[0.5mm] text-[12px]"><b>Materials to be used:</b> {it.materials}</div>}</td>
                <td className="text-center">{Number(it.quantity || 0)}{it.unit && it.unit !== 'Nos' ? <span className="block text-[11px]">{it.unit}</span> : null}</td>
                {isDn ? <><td className="paper-hatch" /><td className="paper-hatch" /></>
                  : isInv ? <><td className="text-right">{Number(it.unit_price) ? fmtMoney(it.unit_price) : '—'}</td><td className="text-right">{fmtMoney(amt)}</td><td className="text-right">{fmtMoney(vat)}</td><td className="text-right font-bold">{fmtMoney(amt + vat)}</td></>
                  : <><td className="text-center">{Number(it.unit_price) ? fmtMoney(it.unit_price) : '—'}</td><td className="text-center">{fmtMoney(amt)}</td></>}
              </tr>
            })}
            {Array.from({ length: pad }).map((_, i) => <tr key={`p${i}`} style={{ height: isInv ? '5mm' : '10mm' }}>{Array.from({ length: cols }).map((_, j) => <td key={j} className={isDn && j >= 3 ? 'paper-hatch' : ''} />)}</tr>)}
            {isQtn && doc.show_total !== false && <tr className="paper-total"><td /><td /><td /><td className="text-center font-bold">Total<br />Amount</td><td className="text-center font-bold">{fmtMoney(t.taxable)}</td></tr>}
            {isInv && <tr className="paper-total font-bold"><td className="text-center" colSpan={2}>Grand Total{t.discount ? ` (after discount ${fmtMoney(t.discount)})` : ''}</td><td /><td /><td className="text-right">{fmtMoney(t.taxable)}</td><td className="text-right">{fmtMoney(t.vat)}</td><td className="text-right">{fmtMoney(t.total)}</td></tr>}
          </tbody>
        </table>

        {isInv && <table className="paper-items paper-keep mt-0 text-[14px]"><colgroup><col /><col style={{ width: '36mm' }} /><col style={{ width: '30mm' }} /></colgroup><tbody><tr>
          <td className="px-[3mm] font-bold" rowSpan={2}>Amount in Words: - {amountInWords(t.total).replace(/^UAE Dirhams /, '')}</td>
          <td className="text-center font-bold">Paid Amount</td><td className="text-right font-bold">{fmtMoney(paid)}</td></tr>
          <tr><td className="text-center font-bold">Total Balance</td><td className="text-right font-bold">{fmtMoney(t.total - paid)}</td></tr></tbody></table>}

        {isQtn && doc.closing && <div className="paper-keep mt-[3mm] text-[14px]">{doc.closing.split('\n').map((l, i) => <div key={i} className={`paper-text ${i === 0 ? 'font-bold' : ''}`}>{l}</div>)}</div>}

        {/* terms / bank / delivery lines + seal & signature */}
        <div className={`paper-tail ${align === 'left' ? 'paper-tail--sign-left' : ''}`}>
          {showSign && align !== 'center' && <div className="paper-sign" style={{ paddingTop: spacing }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {branding.stamp && <img src={branding.stamp} alt="Company seal" style={{ width: seal, height: seal }} />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {branding.signature && <img src={branding.signature} alt="Authorised signature" style={{ width: sigW, height: Math.round(sigW * 0.75), marginInlineStart: branding.stamp ? -Math.round(seal * 0.18) : 0 }} />}
          </div>}
          <div className="paper-tail-text">
            {isQtn && <>
              {doc.terms.length > 0 && <Clauses title="Terms and Conditions: -" items={doc.terms} />}
              {doc.payment_terms.length > 0 && <Clauses title="Payment Terms: -" items={doc.payment_terms} />}
            </>}
            {isInv && <>
              {branding.bankDetails && <div className="paper-keep"><div className="mt-[1mm] text-[15px] font-bold">Bank Details: -</div><div className="paper-text text-[13px]">{branding.bankDetails}</div></div>}
              {doc.payment_terms.length > 0 && <div className="paper-text mt-[2mm] text-[13px]"><b>Payment terms:</b> {doc.payment_terms.join(' · ')}</div>}
              <div className="mt-[3mm] text-center text-[12px] font-bold italic paper-red">This is a computer-generated report.</div>
            </>}
            {isDn && <div className="paper-keep mt-[12mm] space-y-[6mm] text-[14px] paper-red">
              <div>Delivered By: <span className="inline-block w-[50mm] border-b border-current align-bottom" />{doc.vehicle_no && <span className="ms-2 text-black">Vehicle: {doc.vehicle_no}</span>}</div>
              <div>Received By: <span className="inline-block w-[50mm] border-b border-current align-bottom" />{doc.receiver_name && <span className="ms-2 text-black">{doc.receiver_name}</span>}</div>
            </div>}
          </div>
          {showSign && align === 'center' && <div className="paper-sign paper-sign--center" style={{ paddingTop: spacing }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {branding.stamp && <img src={branding.stamp} alt="Company seal" style={{ width: seal, height: seal }} />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {branding.signature && <img src={branding.signature} alt="Authorised signature" style={{ width: sigW, height: Math.round(sigW * 0.75), marginInlineStart: branding.stamp ? -Math.round(seal * 0.18) : 0 }} />}
          </div>}
        </div>
      </td></tr></tbody>
    </table>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {footer && <div className="paper-footer"><img src={footer} alt="Company contact details" /></div>}
  </div>
}
/** memoised: the editor re-renders on every keystroke, the paper only when its (deferred) props change */
export const SalesPaper = memo(Paper)

const Pair = ({ k, v }: { k: string; v: string }) => <div className="paper-pair"><dt>{k}</dt><dd>{v}</dd></div>
function Clauses({ title, items }: { title: string; items: string[] }) {
  return <div className="paper-clauses">
    <div className="paper-keep-next mt-[1.5mm] text-[16px] font-bold underline">{title}</div>
    <ol>{items.map((x, i) => <li key={i}><span>{i + 1}.</span><span className="paper-text">{x}</span></li>)}</ol>
  </div>
}
