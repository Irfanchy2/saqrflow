// A4 field report (site visit report, daily site report): the same print engine as quotations (".sales-paper").
import { TextHeader, type Branding } from '@/components/sales/paper'

export interface ReportSection { heading: string; text?: string | null }
export function ReportPaper({ branding, title, left, right, sections, photos = [], table, signatures, className = '' }: {
  branding: Branding; title: string; left: [string, string | null | undefined][]; right: [string, string | null | undefined][]
  sections: ReportSection[]; photos?: { src: string; caption: string }[]; table?: { heading: string; cols: string[]; rows: string[][] }
  signatures?: string[]; className?: string
}) {
  const footer = branding.showHeaderFooter ? branding.footer : null
  const Pair = ({ k, v }: { k: string; v: string }) => <div className="paper-pair"><dt>{k}</dt><dd>{v}</dd></div>
  return <div className={`sales-paper ${footer ? 'has-footer' : ''} ${branding.brandColor ? 'has-accent' : ''} ${className}`} data-doc="report" style={branding.brandColor ? ({ ['--paper-accent' as string]: branding.brandColor } as React.CSSProperties) : undefined}>
    <table className="paper-frame">
      <thead><tr><td><div className="pf-top" /></td></tr></thead>
      <tfoot><tr><td><div className="pf-bottom" /></td></tr></tfoot>
      <tbody><tr><td>
        {branding.showHeaderFooter && <div className="paper-letterhead">{branding.header ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={branding.header} alt={`${branding.companyName} letterhead`} /> : <TextHeader b={branding} />}</div>}
        <div className="paper-title"><h1>{title}</h1></div>
        <div className="paper-boxes">
          <dl className="paper-box">{left.filter(([, v]) => v).map(([k, v]) => <Pair key={k} k={`${k}:`} v={v!} />)}</dl>
          <dl className="paper-box paper-box--meta">{right.filter(([, v]) => v).map(([k, v]) => <Pair key={k} k={`${k}:`} v={v!} />)}</dl>
        </div>
        {sections.filter(s => s.text?.trim()).map(s => <div key={s.heading} className="mb-[3mm]">
          <div className="paper-keep-next paper-accent text-[13px] font-bold">{s.heading}</div>
          <div className="paper-text text-[12.5px]">{s.text}</div></div>)}
        {table && table.rows.length > 0 && <div className="mb-[3mm]"><div className="paper-keep-next paper-accent text-[13px] font-bold">{table.heading}</div>
          <table className="paper-items text-[12px]"><thead><tr>{table.cols.map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={j === 0 ? 'text-center' : ''}>{v}</td>)}</tr>)}</tbody></table></div>}
        {photos.length > 0 && <div className="mb-[3mm]"><div className="paper-keep-next paper-accent text-[13px] font-bold">Photos</div>
          <div className="grid grid-cols-3 gap-[2mm]">{photos.map((p, i) => <figure key={i} className="paper-keep m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.src} alt={p.caption} className="aspect-[4/3] w-full border border-[var(--rule)] object-cover" />
            <figcaption className="mt-[0.5mm] truncate text-[10.5px]">{p.caption}</figcaption></figure>)}</div></div>}
        {signatures && <div className="paper-keep mt-[8mm] grid gap-[10mm]" style={{ gridTemplateColumns: `repeat(${signatures.length}, minmax(0, 1fr))` }}>
          {signatures.map(s => <div key={s} className="border-t border-[var(--rule)] pt-[1mm] text-center text-[11.5px]">{s}</div>)}</div>}
      </td></tr></tbody>
    </table>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {footer && <div className="paper-footer"><img src={footer} alt="Company contact details" /></div>}
  </div>
}
