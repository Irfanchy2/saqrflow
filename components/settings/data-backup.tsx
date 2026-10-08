import Link from 'next/link'
import { DatabaseBackup, Download, ExternalLink, HardDrive } from 'lucide-react'
import type { Ctx } from '@/lib/auth'
import { Card, CardHeader } from '@/components/ui/primitives'

const EXPORTS: [string, string][] = [['customers', 'Customers'], ['suppliers', 'Suppliers'], ['quotations', 'Quotations'], ['invoices', 'Tax invoices'], ['delivery-notes', 'Delivery notes'], ['payments', 'Payments'],
  ['expenses', 'Expenses'], ['cheques', 'Cheques'], ['employees', 'Employees'], ['documents', 'Documents index'], ['expiry-report', 'Expiry report'], ['vehicles', 'Vehicles'], ['assets', 'Assets'], ['catalog', 'Products & services']]

/** Settings → Data & backup. Shows how the data is actually protected — no fake "backup" button. */
export function DataBackup({ c }: { c: Ctx }) {
  const ref = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
  return <Card id="data"><CardHeader title="Data & backup" sub="Where your data lives, how it is backed up and how to take your own copy" action={<DatabaseBackup size={16} className="text-muted" aria-hidden />} />
    <div className="grid gap-5 p-4 text-sm lg:grid-cols-3">
      <div className="space-y-2"><h3 className="font-medium">Database backups</h3>
        <p className="text-muted">Records are stored in a managed Supabase Postgres database. Supabase takes the database backups; how many days are kept (and whether point-in-time recovery is on) depends on your Supabase plan. Check it on the project’s Backups page.</p>
        {ref ? <a href={`https://supabase.com/dashboard/project/${ref}/database/backups/scheduled`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Open Supabase backups <ExternalLink size={12} /></a>
          : <p className="text-xs text-muted">Supabase project not detected in this environment.</p>}</div>
      <div className="space-y-2"><h3 className="flex items-center gap-1.5 font-medium"><HardDrive size={14} aria-hidden />Document files</h3>
        <p className="text-muted">Uploaded files are kept in a private storage bucket (no public links; downloads use 60-second signed URLs). Replacing a file creates a new version. Earlier versions are never overwritten. Deleted records go to the Trash and can be restored.</p>
        <p className="text-xs text-muted">Storage files are not part of database backups. Keep the periodic export below, or enable Supabase storage backups, for an off-site copy.</p></div>
      <div className="space-y-2"><h3 className="font-medium">Restore procedure</h3>
        <ol className="list-decimal space-y-1 ps-5 text-muted"><li>Single record deleted by mistake → Settings → <Link href="/trash" className="text-primary hover:underline">Trash</Link> → Restore.</li><li>Wrong edit → open the <Link href="/audit" className="text-primary hover:underline">Audit log</Link> to see the previous values; sales documents keep every revision.</li><li>Full database restore → Supabase dashboard → Backups (owner of the Supabase project). Steps are in <code>docs/BACKUP.md</code>.</li></ol></div>
      {c.can('data.export') && <div className="lg:col-span-3"><h3 className="mb-2 flex items-center gap-1.5 font-medium"><Download size={14} aria-hidden />Your own copy (Excel)</h3>
        <div className="flex flex-wrap gap-2">{EXPORTS.map(([k, l]) => <a key={k} href={`/api/export/${k}?format=xlsx`} className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-surface-2">{l}</a>)}</div>
        <p className="mt-2 text-xs text-muted">Every export is recorded in the audit log. CSV is also available from each list.</p></div>}
    </div></Card>
}
