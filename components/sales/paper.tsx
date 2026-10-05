// A4 sales document — faithful to the Al Saqr Al Ahmar templates (Quotation / Tax Invoice / Delivery Note).
// Pure presentational component: used by the live editor preview (client) and the print view (server).
import { amountInWords, computeTotals, fmtMoney, lineAmount, lineVat } from '@/lib/sales/money'
import { DOC_META, type SalesType } from '@/lib/sales/docs'

export interface PaperItem { description: string; materials?: string | null; quantity: number | string; unit?: string | null; unit_price: number | string }
export interface PaperDoc {
  doc_type: SalesType; number: string; issue_date: string; due_date?: string | null; valid_until?: string | null
  attention?: string | null; customer_name?: string | null; customer_address?: string | null; customer_trn?: string | null; customer_phone?: string | null
  site?: string | null; subject?: string | null; intro?: string | null; closing?: string | null; lpo_ref?: string | null; del_no?: string | null; reference?: string | null
  vat_rate: number; discount?: number; show_total?: boolean; terms: string[]; payment_terms: string[]; receiver_name?: string | null; vehicle_no?: string | null
}
export interface Branding {
  companyName: string; header?: string | null; headerInvoice?: string | null; footer?: string | null; stamp?: string | null; signature?: string | null
  showHeaderFooter: boolean; showStamp: boolean; bankDetails?: string | null; companyTrn?: string | null
}

const fmtDate = (iso?: string | null) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '—')
const cell = 'border border-black px-1.5 py-1 align-middle'
const dash = (s?: string | null) => (s && s.trim() ? s : '—')

export function SalesPaper({ doc, items, branding, paid = 0, className = '' }: { doc: PaperDoc; items: PaperItem[]; branding: Branding; paid?: number; className?: string }) {
  const meta = DOC_META[doc.doc_type]
  const isInv = doc.doc_type === 'invoice', isDn = doc.doc_type === 'delivery_note', isQtn = doc.doc_type === 'quotation'
  const t = computeTotals(items, doc.vat_rate, doc.discount ?? 0, isInv)
  const header = (isInv && branding.headerInvoice) || branding.header
  const rows = items.length ? items : [{ description: '', quantity: 1, unit_price: 0 } as PaperItem]
  const pad = Math.max(0, (isInv ? 3 : 1) - rows.length + 1)

  return <div className={`sales-paper relative mx-auto flex flex-col bg-white text-black ${className}`} style={{ width: 794, minHeight: 1123, padding: '28px 30px 22px', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 14, lineHeight: 1.35 }}>
    {/* letterhead */}
    {branding.showHeaderFooter && <div className="mb-2 flex justify-center" style={{ minHeight: 90 }}>
      {header ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={header} alt={`${branding.companyName} letterhead`} style={{ maxHeight: 110, maxWidth: 640, objectFit: 'contain' }} />
        : <div className="text-center"><div className="text-xl font-bold tracking-wide">{branding.companyName}</div><div className="text-xs text-neutral-500">Upload your letterhead in Settings → Branding</div></div>}
    </div>}
    <h1 className={`mb-2 text-center font-bold ${isInv ? 'text-[19px] underline' : 'text-[17px]'}`}>{meta.paperTitle}</h1>

    {/* party + reference boxes */}
    <div className="mb-3 flex gap-3.5 text-[14px]">
      <div className="flex-1 border border-neutral-400 px-3 py-2" style={{ background: '#F3F0EA' }}>
        <table className="w-full"><tbody>
          {isQtn && <Row k="Attention:" v={dash(doc.attention)} />}
          <Row k="Company Name:" v={dash(doc.customer_name)} />
          {!isQtn && <Row k="TRN:" v={dash(doc.customer_trn)} />}
          {!isQtn && doc.customer_phone && <Row k="Tel:" v={doc.customer_phone} />}
          <Row k="Address:" v={dash(doc.customer_address)} />
          {doc.site && <Row k={isDn ? 'Delivery to:' : 'Site:'} v={doc.site} />}
        </tbody></table>
      </div>
      <div className="w-[200px] border border-neutral-400 px-3 py-2" style={{ background: '#F3F0EA' }}>
        <table className="w-full"><tbody>
          <Row k={isDn ? 'Delivery No.' : isInv ? 'Invoice No.' : 'No.'} v={dash(doc.number)} />
          <Row k="Date:" v={fmtDate(doc.issue_date)} />
          {!isQtn && <Row k="L.P.O:" v={dash(doc.lpo_ref)} />}
          {isInv && <Row k="DEL NO:" v={dash(doc.del_no)} />}
          {isInv && doc.reference && <Row k="REF:" v={doc.reference} />}
          {isInv && doc.due_date && <Row k="Due:" v={fmtDate(doc.due_date)} />}
          {isQtn && doc.valid_until && <Row k="Valid till:" v={fmtDate(doc.valid_until)} />}
        </tbody></table>
      </div>
    </div>

    {isQtn && <div className="mb-1 whitespace-pre-line text-[14px]">{dash(doc.intro)}</div>}
    {doc.subject && <div className="mb-1 text-[14px]"><b>Subject:</b> {doc.subject}</div>}
    {!isInv && <div className="text-[14px] font-bold">The scope of works:-</div>}

    {/* items */}
    <table className="w-full border-collapse text-[13px]">
      <thead><tr className="font-bold">
        <th className={`${cell} w-10 text-center`}>SR<br />NO</th><th className={`${cell} text-left`}>DESCRIPTION</th><th className={`${cell} w-14 text-center`}>QTY.</th>
        {isInv ? <><th className={`${cell} w-20 text-center`}>Rate</th><th className={`${cell} w-24 text-center`}>Amount</th><th className={`${cell} w-20 text-center`}>VAT {doc.vat_rate}%</th><th className={`${cell} w-28 text-center`}>Amount With Vat</th></>
          : <><th className={`${cell} w-28 text-center`}>Unit price<br />(dhs)</th><th className={`${cell} w-28 text-center`}>Total Price<br />(dhs)</th></>}
      </tr></thead>
      <tbody>
        {rows.map((it, i) => {
          const amt = lineAmount(it), vat = lineVat(it, doc.vat_rate)
          return <tr key={i}>
            <td className={`${cell} text-center font-bold`}>{String(i + 1).padStart(2, '0')}</td>
            <td className={cell}><div className="whitespace-pre-line">{it.description || <span className="text-neutral-400">—</span>}</div>
              {it.materials && <div className="mt-0.5 text-[12px]"><b>Materials to be used:</b> {it.materials}</div>}</td>
            <td className={`${cell} text-center`}>{Number(it.quantity || 0)}{it.unit && it.unit !== 'Nos' ? ` ${it.unit}` : ''}</td>
            {isDn ? <><td className={cell} style={hatch} /><td className={cell} style={hatch} /></>
              : isInv ? <><td className={`${cell} text-right`}>{Number(it.unit_price) ? fmtMoney(it.unit_price) : '—'}</td><td className={`${cell} text-right`}>{fmtMoney(amt)}</td><td className={`${cell} text-right`}>{fmtMoney(vat)}</td><td className={`${cell} text-right font-bold`}>{fmtMoney(amt + vat)}</td></>
              : <><td className={`${cell} text-center`}>{Number(it.unit_price) ? fmtMoney(it.unit_price) : '—'}</td><td className={`${cell} text-center`}>{fmtMoney(amt)}</td></>}
          </tr>
        })}
        {Array.from({ length: pad }).map((_, i) => <tr key={`p${i}`} style={{ height: isInv ? 18 : 40 }}><td className={cell} /><td className={cell} /><td className={cell} />{isInv ? <><td className={cell} /><td className={cell} /><td className={cell} /><td className={cell} /></> : <><td className={cell} style={isDn ? hatch : undefined} /><td className={cell} style={isDn ? hatch : undefined} /></>}</tr>)}
        {isQtn && doc.show_total !== false && <tr><td className={cell} /><td className={cell} /><td className={cell} /><td className={`${cell} text-center font-bold`}>Total<br />Amount</td><td className={`${cell} text-center font-bold`}>{fmtMoney(t.taxable)}</td></tr>}
        {isInv && <tr className="font-bold"><td className={`${cell} text-center`} colSpan={2}>Grand Total{t.discount ? ` (after discount ${fmtMoney(t.discount)})` : ''}</td><td className={cell} /><td className={cell} /><td className={`${cell} text-right`}>{fmtMoney(t.taxable)}</td><td className={`${cell} text-right`}>{fmtMoney(t.vat)}</td><td className={`${cell} text-right`}>{fmtMoney(t.total)}</td></tr>}
      </tbody>
    </table>

    {isInv && <table className="mt-0 w-full border-collapse text-[16px]"><tbody><tr>
      <td className={`${cell} border-t-0 px-3 font-bold`} rowSpan={2}>Amount in Words: - {amountInWords(t.total).replace(/^UAE Dirhams /, '')}</td>
      <td className={`${cell} w-36 border-t-0 text-center font-bold`}>Paid Amount</td><td className={`${cell} w-28 border-t-0 text-right font-bold`}>{fmtMoney(paid)}</td></tr>
      <tr><td className={`${cell} text-center font-bold`}>Total Balance</td><td className={`${cell} text-right font-bold`}>{fmtMoney(t.total - paid)}</td></tr></tbody></table>}

    {isQtn && <div className="mt-3 whitespace-pre-line text-[14px] [&>*:first-child]:font-bold">{(doc.closing ?? '').split('\n').map((l, i) => <div key={i} className={i === 0 ? 'font-bold' : ''}>{l}</div>)}</div>}

    {/* terms / bank / signatures */}
    <div className="mt-3 flex flex-1 gap-4">
      <div className="flex-1 text-[15px]">
        {isQtn && <>
          {doc.terms.length > 0 && <><div className="mt-1 text-[17px] font-bold underline">Terms and Conditions: -</div>{doc.terms.map((x, i) => <div key={i}>{i + 1}. {x}</div>)}</>}
          {doc.payment_terms.length > 0 && <><div className="mt-2 text-[17px] font-bold underline">Payment Terms: -</div>{doc.payment_terms.map((x, i) => <div key={i}>{i + 1}. {x}</div>)}</>}
        </>}
        {isInv && <>
          {branding.bankDetails && <><div className="mt-1 text-[15px] font-bold">Bank Details: -</div><div className="whitespace-pre-line text-[13px]">{branding.bankDetails}</div></>}
          {doc.payment_terms.length > 0 && <div className="mt-2 text-[13px]"><b>Payment terms:</b> {doc.payment_terms.join(' · ')}</div>}
          <div className="mt-3 text-center text-[12px] font-bold italic" style={{ color: '#B91C1C' }}>This is a computer-generated report.</div>
        </>}
        {isDn && <div className="mt-14 space-y-6 text-[14px]" style={{ color: '#B91C1C' }}>
          <div>Delivered By: <span className="inline-block w-48 border-b border-current align-bottom" />{doc.vehicle_no && <span className="ms-2 text-black">Vehicle: {doc.vehicle_no}</span>}</div>
          <div>Received By: <span className="inline-block w-48 border-b border-current align-bottom" />{doc.receiver_name && <span className="ms-2 text-black">{doc.receiver_name}</span>}</div>
        </div>}
      </div>
      {branding.showStamp && !isInv && (branding.stamp || branding.signature) && <div className="flex items-start gap-3 pt-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {branding.stamp && <img src={branding.stamp} alt="Company stamp" style={{ width: 90, height: 90, objectFit: 'contain' }} />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {branding.signature && <img src={branding.signature} alt="Authorised signature" style={{ width: 120, height: 90, objectFit: 'contain' }} />}
      </div>}
    </div>

    {branding.showHeaderFooter && branding.footer && <div className="mt-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={branding.footer} alt="Company contact details" style={{ width: '100%', maxHeight: 70, objectFit: 'contain' }} /></div>}
  </div>
}

const hatch = { background: 'repeating-linear-gradient(45deg, #f5efe6, #f5efe6 4px, #ece3d4 4px, #ece3d4 5px)' }
const Row = ({ k, v }: { k: string; v: string }) => <tr><td className="whitespace-nowrap pe-3 align-top font-bold">{k}</td><td className="align-top">{v}</td></tr>
