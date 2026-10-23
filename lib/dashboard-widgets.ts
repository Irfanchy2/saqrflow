// Dashboard widgets a user can show, hide, move between columns and reorder (stored in user_preferences 'dashboard.layout').
export const WIDGETS = {
  banner: { label: 'Today: greeting, timeline, cash on hand', col: 'top' },
  finance: { label: 'Key figures', col: 'top' },
  trend: { label: 'Year at a glance (12 months)', col: 'left' },
  funnel: { label: 'Sales funnel', col: 'left' },
  floor: { label: 'On the floor (work orders)', col: 'left' },
  road: { label: 'On the road (visits, deliveries)', col: 'left' },
  quick: { label: 'Quick actions', col: 'left' },
  recent: { label: 'Latest documents', col: 'left' },
  activity: { label: 'Live activity', col: 'left' },
  projects: { label: 'Project progress', col: 'left' },
  inbox: { label: 'Smart Inbox', col: 'left' },
  team: { label: 'Team today', col: 'right' },
  lowstock: { label: 'Running low (stock)', col: 'right' },
  mytasks: { label: 'My tasks', col: 'right' },
  attention: { label: 'Needs attention', col: 'right' },
  calendar: { label: 'Calendar', col: 'right' },
  operations: { label: 'Operations', col: 'right' },
  approvals: { label: 'Waiting for approval', col: 'right' },
} as const
export type WidgetKey = keyof typeof WIDGETS
export type WidgetCol = 'top' | 'left' | 'right'
export interface DashboardLayout { items: { key: WidgetKey; col: WidgetCol; hidden: boolean }[] }

/** The layout users get until they customise it. Saved layouts keep their choices; widgets added later are appended visible. */
export const DEFAULT_LAYOUT: DashboardLayout = { items: (Object.keys(WIDGETS) as WidgetKey[]).map(k => ({ key: k, col: WIDGETS[k].col, hidden: k === 'approvals' || k === 'quick' })) }

/** Accepts whatever was stored and returns a complete, valid layout (unknown keys dropped, new widgets appended). */
export function normalizeLayout(raw: unknown): DashboardLayout {
  const seen = new Set<string>(), items: DashboardLayout['items'] = []
  const list = raw && typeof raw === 'object' && Array.isArray((raw as any).items) ? (raw as any).items : []
  for (const it of list) {
    const k = it?.key
    if (typeof k !== 'string' || !(k in WIDGETS) || seen.has(k)) continue
    seen.add(k)
    const col: WidgetCol = k === 'finance' || k === 'banner' ? 'top' : it.col === 'left' || it.col === 'right' ? it.col : WIDGETS[k as WidgetKey].col
    items.push({ key: k as WidgetKey, col, hidden: it.hidden === true })
  }
  for (const d of DEFAULT_LAYOUT.items) if (!seen.has(d.key)) items.push({ ...d })
  return { items }
}
