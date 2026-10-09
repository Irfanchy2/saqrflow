// Dashboard widgets a user can show, hide, move between columns and reorder (stored in user_preferences 'dashboard.layout').
export const WIDGETS = {
  finance: { label: 'Financial pulse', col: 'top' },
  attention: { label: 'Needs attention', col: 'left' },
  projects: { label: 'Projects in progress', col: 'left' },
  mytasks: { label: 'My tasks', col: 'left' },
  operations: { label: 'Operations', col: 'right' },
  approvals: { label: 'Waiting for approval', col: 'right' },
  inbox: { label: 'Smart Inbox', col: 'right' },
  activity: { label: 'Recent activity', col: 'right' },
} as const
export type WidgetKey = keyof typeof WIDGETS
export type WidgetCol = 'top' | 'left' | 'right'
export interface DashboardLayout { items: { key: WidgetKey; col: WidgetCol; hidden: boolean }[] }

/** The layout users get until they customise it: exactly the original dashboard (new widgets start hidden). */
export const DEFAULT_LAYOUT: DashboardLayout = { items: (Object.keys(WIDGETS) as WidgetKey[]).map(k => ({ key: k, col: WIDGETS[k].col, hidden: k === 'mytasks' || k === 'approvals' })) }

/** Accepts whatever was stored and returns a complete, valid layout (unknown keys dropped, new widgets appended). */
export function normalizeLayout(raw: unknown): DashboardLayout {
  const seen = new Set<string>(), items: DashboardLayout['items'] = []
  const list = raw && typeof raw === 'object' && Array.isArray((raw as any).items) ? (raw as any).items : []
  for (const it of list) {
    const k = it?.key
    if (typeof k !== 'string' || !(k in WIDGETS) || seen.has(k)) continue
    seen.add(k)
    const col: WidgetCol = k === 'finance' ? 'top' : it.col === 'left' || it.col === 'right' ? it.col : WIDGETS[k as WidgetKey].col
    items.push({ key: k as WidgetKey, col, hidden: it.hidden === true })
  }
  for (const d of DEFAULT_LAYOUT.items) if (!seen.has(d.key)) items.push({ ...d })
  return { items }
}
