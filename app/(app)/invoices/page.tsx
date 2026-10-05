import { Planned } from '@/components/layout/planned'
export const metadata = { title: 'Invoices & Payments' }
export default function Page() {
  return <Planned title="Invoices & Payments" phase="Phase 2" summary="Quotations, purchase orders, VAT invoices with partial payments and PDF output. The database tables (invoices, payments) and cheque links already exist; the screens do not."
    items={['Quotations, invoices, purchase orders', 'Partial payments & outstanding reports', 'Configurable VAT rate (not presented as certified tax software)', 'PDF invoices and quotations', 'Link to projects, customers and cheques', 'Expense records']}
    meanwhile="Cheques you receive or issue can already be tracked under Banking & Cheques." />
}
