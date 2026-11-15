import { Bell, Building2, DatabaseBackup, FileText, Palette, Plug, ShieldCheck, Sun, Users, WhatsApp } from '@/components/icons'
import type { IconName } from '@/lib/settings/catalog'

const ICONS = { Bell, Building2, DatabaseBackup, FileText, Palette, Plug, ShieldCheck, Sun, Users, WhatsApp }
export function CategoryIcon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  const I = ICONS[name]
  return <I size={size} className={className} aria-hidden />
}
