import type { Tone } from '@/components/ui/primitives'

export const TICKET_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'blue' }, scheduled: { label: 'Scheduled', tone: 'blue' }, in_progress: { label: 'In progress', tone: 'amber' },
  waiting_customer: { label: 'Waiting for customer', tone: 'amber' }, resolved: { label: 'Resolved', tone: 'green' }, closed: { label: 'Closed', tone: 'neutral' }, cancelled: { label: 'Cancelled', tone: 'neutral' },
}
export const OPEN_TICKET = ['open', 'scheduled', 'in_progress', 'waiting_customer']
export const TICKET_CATEGORY: Record<string, string> = { repair: 'Repair', maintenance: 'Maintenance', installation_defect: 'Installation defect', inspection: 'Inspection', complaint: 'Complaint', other: 'Other' }
export const TICKET_SOURCE: Record<string, string> = { internal: 'Internal', phone: 'Phone', whatsapp: 'WhatsApp', email: 'Email', walk_in: 'Walk-in', form: 'Website form', portal: 'Customer portal' }
export const TICKET_PRIORITY: Record<string, { label: string; tone: Tone; days: number }> = {
  low: { label: 'Low', tone: 'neutral', days: 10 }, normal: { label: 'Normal', tone: 'neutral', days: 5 }, high: { label: 'High', tone: 'amber', days: 2 }, urgent: { label: 'Urgent', tone: 'red', days: 1 },
}
export const ticketOverdue = (t: { status: string; due_date?: string | null }, today: string) => OPEN_TICKET.includes(t.status) && !!t.due_date && t.due_date < today
export const warrantyState = (w: { start_date: string; end_date: string }, today: string): { label: string; tone: Tone } =>
  today < w.start_date ? { label: 'Not started', tone: 'neutral' } : today > w.end_date ? { label: 'Expired', tone: 'neutral' } : { label: 'Active', tone: 'green' }

export const KB_CATEGORIES = ['General', 'Safety', 'Fabrication', 'Welding', 'Painting', 'Installation', 'Site', 'Vehicles', 'Office & admin', 'HR', 'Quality'] as const

/** Lines of plain-text article body → blocks (# heading, - bullet, 1. step, blank line = new paragraph). Rendered as React text, never HTML. */
export type KbBlock = { t: 'h'; level: 2 | 3; text: string } | { t: 'ul' | 'ol'; items: string[] } | { t: 'p'; text: string }
export function kbBlocks(body: string): KbBlock[] {
  const out: KbBlock[] = []; let para: string[] = []
  const flush = () => { if (para.length) { out.push({ t: 'p', text: para.join('\n') }); para = [] } }
  for (const raw of body.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd()
    const h = /^(#{1,3})\s+(.+)/.exec(line), ul = /^\s*[-*•]\s+(.+)/.exec(line), ol = /^\s*\d+[.)]\s+(.+)/.exec(line)
    if (!line.trim()) { flush(); continue }
    if (h) { flush(); out.push({ t: 'h', level: h[1].length <= 2 ? 2 : 3, text: h[2] }); continue }
    if (ul || ol) {
      flush(); const kind = ul ? 'ul' : 'ol', text = (ul ?? ol)![1], last = out[out.length - 1]
      if (last && last.t === kind) last.items.push(text); else out.push({ t: kind, items: [text] })
      continue
    }
    para.push(line)
  }
  flush(); return out
}
