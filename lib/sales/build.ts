import 'server-only'
import type { Ctx } from '../auth'
import { brandingBytes, brandingFor, loadSalesDoc } from './data'
import { renderSalesPdf } from './pdf'
import { salesPdfName } from './filename'

/** Renders the stored document (with the company branding) to PDF bytes. Caller must already hold a session that passes RLS. */
export async function buildSalesPdf(c: Ctx, id: string) {
  const d = await loadSalesDoc(c, id)
  if (!d) return null
  const [b, images] = await Promise.all([brandingFor(c), brandingBytes(c)])
  const bytes = await renderSalesPdf(d.doc, d.items, { companyName: c.company.name, images, showHeaderFooter: b.showHeaderFooter, showStamp: b.showStamp, bankDetails: b.bankDetails, paid: d.paid + ((d as any).credited ?? 0),
    companyTrn: b.companyTrn, sealSize: b.sealSize, signatureWidth: b.signatureWidth, signAlign: b.signAlign, signSpacing: b.signSpacing,
    signatoryName: b.signatoryName, signatoryTitle: b.signatoryTitle, brandColor: b.brandColor, companyAddress: b.companyAddress, companyPhone: b.companyPhone, companyEmail: b.companyEmail, companyWebsite: b.companyWebsite })
  const name = salesPdfName(d.doc as any)
  return { bytes, name, data: d }
}

