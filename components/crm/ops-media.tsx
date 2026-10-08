import Link from 'next/link'
import { Camera, FileText, Paperclip } from 'lucide-react'
import { Card, CardHeader, EmptyState, Field, Input, Select } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { uploadOpsFiles } from '@/app/actions/operations'
import { ACCEPT_ATTR } from '@/lib/files'
import { PHOTO_ROLES, type OpsDoc } from '@/lib/ops'

/** Photos (small thumbnails, full size opens from the vault) + attachments for a field record. */
export function OpsMedia({ kind, id, photos, files, canUpload, tz, className }: { kind: 'site_visit' | 'work_order' | 'site_report'; id: string; photos: OpsDoc[]; files: OpsDoc[]; canUpload: boolean; tz: string; className?: string }) {
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { timeZone: tz, day: '2-digit', month: 'short' })
  const action = uploadOpsFiles.bind(null, kind, id)
  return <Card className={className}><CardHeader title="Photos & files" sub={`${photos.length} photo${photos.length === 1 ? '' : 's'} · ${files.length} file${files.length === 1 ? '' : 's'}. Private, stored in the Document Vault`}
    action={canUpload ? <div className="flex gap-2">
      <DialogButton size="sm" label="Photos" title="Add photos" icon={<Camera size={14} />}><ActionForm action={action} submit="Upload photos"><input type="hidden" name="as" value="photo" />
        <Field label="Category"><Select name="category" defaultValue="progress">{Object.entries(PHOTO_ROLES).map(([k, l]) => <option key={k} value={k.replace('photo_', '')}>{l}</option>)}</Select></Field>
        <Field label="Caption"><Input name="caption" maxLength={500} placeholder="e.g. Existing slab edge, north side" /></Field>
        <Field label="Photos *" hint="Take with the camera or choose from the gallery. Up to 30"><input type="file" name="file" multiple required accept="image/*" capture="environment" className="text-sm" /></Field></ActionForm></DialogButton>
      <DialogButton size="sm" variant="secondary" label="Files" title="Attach files" icon={<Paperclip size={14} />}><ActionForm action={action} submit="Upload">
        <Field label="Type"><Select name="category" defaultValue="attachment"><option value="drawing">Drawing / sketch</option><option value="measurement">Measurement sheet</option><option value="attachment">Other attachment</option></Select></Field>
        <Field label="Files *" hint="PDF, images or Office files"><input type="file" name="file" multiple required accept={ACCEPT_ATTR} className="text-sm" /></Field></ActionForm></DialogButton>
    </div> : null} />
    {!photos.length && !files.length ? <EmptyState icon={Camera} title="No photos or files yet" body="Add site photos, measurement sheets and sketches. On a phone, Photos opens the camera." />
      : <>{photos.length > 0 && <ul className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">{photos.map(d => <li key={d.id}>
        <Link href={`/documents/${d.id}`} className="group block overflow-hidden rounded-lg border border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/documents/${d.id}/thumb?w=320`} alt={d.notes ?? d.name} loading="lazy" decoding="async" width={320} height={240} className="aspect-[4/3] w-full bg-surface-2 object-cover transition-opacity group-hover:opacity-90" />
          <div className="px-2 py-1.5 text-xs"><div className="truncate font-medium">{d.notes ?? d.name}</div><div className="text-muted">{PHOTO_ROLES[d.role] ?? 'Photo'} · {day(d.created_at)}</div></div></Link></li>)}</ul>}
        {files.length > 0 && <ul className="divide-y divide-border border-t border-border text-sm">{files.map(d => <li key={d.id}><Link href={`/documents/${d.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60"><FileText size={15} className="shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{d.name}</span><span className="text-xs text-muted">{d.role === 'drawing' ? 'Drawing' : d.role === 'measurement' ? 'Measurements' : 'File'} · {day(d.created_at)}</span></Link></li>)}</ul>}</>}
  </Card>
}
