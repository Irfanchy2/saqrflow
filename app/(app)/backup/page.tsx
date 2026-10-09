import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle, ArrowLeft, CheckCircle2, DatabaseBackup, Download, ExternalLink } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { Alert, Badge, Card, CardHeader, Metrics, PageHeader, StatCard, Td, Th } from '@/components/ui/primitives'

export const metadata = { title: 'Backup status' }
const DAY = 864e5
const fmt = (d: string, tz: string) => new Date(d).toLocaleString('en-GB', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const size = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`)

/** What is backed up, when your own copy was last taken, whether the scheduled jobs run, and how much data there is. */
export default async function BackupStatus() {
  const c = await getCtx(); if (!c.can('data.export') && !c.can('settings.manage')) redirect('/settings')
  const admin = createAdminClient(), cid = c.company.id, head = { count: 'exact' as const, head: true }
  const cnt = (t: string, f?: (q: any) => any) => { let q: any = admin.from(t).select('id', head).eq('company_id', cid); if (f) q = f(q); return q }
  const [exports, cron, events, versions, ...counts] = await Promise.all([
    admin.from('audit_logs').select('id,user_id,table_name,changes,created_at').eq('company_id', cid).eq('action', 'EXPORT').order('created_at', { ascending: false }).limit(12),
    c.can('settings.manage') ? c.supabase.from('system_runs').select('started_at,finished_at,ok,detail').eq('job', 'cron').order('started_at', { ascending: false }).limit(5) : Promise.resolve({ data: null }),
    c.can('settings.manage') ? c.supabase.from('system_runs').select('started_at,ok').eq('job', 'events').order('started_at', { ascending: false }).limit(1) : Promise.resolve({ data: null }),
    admin.from('document_versions').select('size_bytes').eq('company_id', cid).limit(50000),
    cnt('customers', q => q.is('deleted_at', null)), cnt('suppliers', q => q.is('deleted_at', null)), cnt('invoices', q => q.is('deleted_at', null)), cnt('payments'),
    cnt('projects', q => q.is('deleted_at', null)), cnt('employees', q => q.is('deleted_at', null)), cnt('documents', q => q.is('deleted_at', null)), cnt('assets', q => q.is('deleted_at', null)),
    cnt('leads', q => q.is('deleted_at', null)), cnt('service_tickets', q => q.is('deleted_at', null)), cnt('audit_logs'),
  ])
  const { data: people } = await c.supabase.from('profiles').select('id,full_name')
  const who = new Map((people ?? []).map(p => [p.id, p.full_name as string]))
  const lastFull = (exports.data ?? []).find(e => e.table_name === 'full-backup')
  const fullAge = lastFull ? (Date.now() - new Date(lastFull.created_at).getTime()) / DAY : null
  const files = (versions.data ?? []).length, bytes = (versions.data ?? []).reduce((a, v: any) => a + Number(v.size_bytes ?? 0), 0)
  const lastCron = (cron.data ?? [])[0] as any, cronAge = lastCron ? (Date.now() - new Date(lastCron.started_at).getTime()) / DAY : null
  const ref = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
  const labels = ['Customers', 'Suppliers', 'Sales documents', 'Payments', 'Projects', 'Employees', 'Documents', 'Vehicles & assets', 'Leads', 'Service tickets', 'Audit log entries']
  return <>
    <Link href="/settings#data" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft size={14} className="rtl:rotate-180" />Settings</Link>
    <PageHeader title="Backup status" sub="How your data is protected, when the last copy was taken and whether the scheduled jobs are running."
      actions={c.can('data.export') ? <a href="/api/backup" className="inline-flex h-11 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg hover:bg-primary/90 sm:h-9" data-full-backup><Download size={15} aria-hidden />Download full backup (.xlsx)</a> : undefined} />
    <div className="mb-5 grid gap-3 lg:grid-cols-2">
      {fullAge === null ? <Alert tone="amber">No full backup has been downloaded yet. Download one now and keep it somewhere safe (outside this system).</Alert>
        : fullAge > 30 ? <Alert tone="amber">The last full backup is {Math.floor(fullAge)} days old. Download a fresh copy.</Alert>
        : <Alert tone="green">Last full backup {fmt(lastFull!.created_at, c.company.timezone)} by {who.get(lastFull!.user_id) ?? 'a former user'} ({(lastFull!.changes as any)?.rows ?? 0} rows).</Alert>}
      {c.can('settings.manage') && (cronAge === null ? <Alert tone="amber">The daily scheduler has not reported a run yet. Check that CRON_SECRET is set and the Vercel cron job is enabled.</Alert>
        : !lastCron.ok ? <Alert tone="red">The last scheduled run failed: {lastCron.detail ?? 'unknown error'}.</Alert>
        : cronAge > 1.6 ? <Alert tone="amber">The daily scheduler last ran {Math.floor(cronAge)} days ago. Reminders, scheduled reports and webhook retries are waiting.</Alert>
        : <Alert tone="green">Scheduler healthy: last run {fmt(lastCron.started_at, c.company.timezone)} ({lastCron.detail}).</Alert>)}
    </div>
    <Metrics cols={4} className="mb-5">
      <StatCard label="Records" value={counts.slice(0, 10).reduce((a, r: any) => a + (r.count ?? 0), 0).toLocaleString('en-US')} hint="across the main modules" />
      <StatCard label="Stored files" value={files.toLocaleString('en-US')} hint={size(bytes)} />
      <StatCard label="Audit log entries" value={((counts[10] as any).count ?? 0).toLocaleString('en-US')} />
      <StatCard label="Exports (latest 12)" value={(exports.data ?? []).length} />
    </Metrics>
    <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
      <Card><CardHeader title="What is protected, and how" action={<DatabaseBackup size={16} className="text-muted" aria-hidden />} />
        <ul className="space-y-3 p-4 text-sm">
          <li className="flex gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden /><span><b className="font-medium">Database</b>: managed Supabase Postgres with automatic daily backups (retention and point-in-time recovery depend on the Supabase plan). {ref && <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`https://supabase.com/dashboard/project/${ref}/database/backups/scheduled`} target="_blank" rel="noopener noreferrer">Check in Supabase <ExternalLink size={12} /></a>}</span></li>
          <li className="flex gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden /><span><b className="font-medium">Files</b>: private storage, every replaced file keeps its earlier versions. Storage is <i>not</i> in the database backups; keep the Excel backup plus your own copies of important originals.</span></li>
          <li className="flex gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden /><span><b className="font-medium">Mistakes</b>: deleted records go to the <Link className="text-primary hover:underline" href="/trash">Trash</Link>; every change is in the <Link className="text-primary hover:underline" href="/audit">Audit log</Link>; sales documents keep every revision.</span></li>
          <li className="flex gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden /><span><b className="font-medium">Your own copy</b>: the full backup workbook has one sheet per list you may export. Restoring a whole database is done from the Supabase dashboard by the project owner (docs/BACKUP.md).</span></li>
        </ul></Card>
      <Card><CardHeader title="Data in this company" />
        <div className="overflow-x-auto"><table className="w-full"><tbody>{labels.map((l, i) => <tr key={l}><Td>{l}</Td><Td className="text-end tabular-nums">{((counts[i] as any).count ?? 0).toLocaleString('en-US')}</Td></tr>)}</tbody></table></div></Card>
      <Card className="xl:col-span-2"><CardHeader title="Recent exports and backups" sub="Every export is recorded" />
        <div className="overflow-x-auto"><table className="w-full min-w-[560px]"><thead><tr><Th>When</Th><Th>Who</Th><Th>What</Th><Th>Rows</Th></tr></thead>
          <tbody>{(exports.data ?? []).map(e => <tr key={e.id}><Td className="whitespace-nowrap text-xs tabular-nums text-muted">{fmt(e.created_at, c.company.timezone)}</Td><Td>{who.get(e.user_id) ?? 'Former user'}</Td>
            <Td>{e.table_name === 'full-backup' ? <Badge tone="blue">Full backup</Badge> : e.table_name}</Td><Td className="tabular-nums">{(e.changes as any)?.rows ?? '—'}</Td></tr>)}
            {!(exports.data ?? []).length && <tr><Td colSpan={4} className="text-muted">No exports yet.</Td></tr>}</tbody></table></div></Card>
      {c.can('settings.manage') && <Card className="xl:col-span-2"><CardHeader title="Scheduled jobs" sub="Daily morning run: reminders, scheduled reports, rule alerts and webhook retries" />
        <div className="overflow-x-auto"><table className="w-full min-w-[480px]"><thead><tr><Th>Started</Th><Th>Result</Th><Th>Details</Th></tr></thead>
          <tbody>{(cron.data ?? []).map((r: any) => <tr key={r.started_at}><Td className="whitespace-nowrap text-xs tabular-nums text-muted">{fmt(r.started_at, c.company.timezone)}</Td>
            <Td><Badge tone={r.ok ? 'green' : r.ok === false ? 'red' : 'amber'}>{r.ok ? 'OK' : r.ok === false ? 'Failed' : 'Running'}</Badge></Td><Td className="text-xs text-muted">{r.detail ?? '—'}</Td></tr>)}
            {!(cron.data ?? []).length && <tr><Td colSpan={3} className="text-muted">No runs recorded yet.</Td></tr>}</tbody></table></div>
        {(events.data ?? [])[0] && <p className="border-t border-border px-4 py-2 text-xs text-muted">Frequent sweep (optional /api/cron/events): last run {fmt((events.data as any)[0].started_at, c.company.timezone)}</p>}</Card>}
    </div></>
}
