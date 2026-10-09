import 'server-only'
import type { Ctx } from '@/lib/auth'
import { buildAlerts, type Alert } from '@/lib/dashboard'
import { summarizeCheques } from '@/lib/cheques'
import { loadSalesKpis } from '@/lib/sales/kpis'
import { addDays, daysBetween } from '@/lib/time'
import { canDecide } from '@/lib/approvals'

export interface BriefCheque { id: string; cheque_no: string; party_name: string | null; amount: number; cheque_date: string; direction: string; status: string }
export interface Brief {
  cheques: { due: BriefCheque[]; overdue: BriefCheque[] } | null
  invoices: { id: string; number: string; customer: string | null; balance: number; due_date: string; days: number }[] | null
  documents: Alert[] | null
  tasks: { mine: { id: string; title: string; due_date: string; status: string }[]; teamOverdue: number }
  projects: { id: string; name: string; reason: string }[] | null
  approvals: { id: string; title: string; amount: number | null; entity_type: string }[] | null
  followups: number | null
}

/**
 * Everything that needs attention today, filtered by what this user may see. Used by the Daily Brief page and (with the
 * owner's context) by scheduled brief emails. Each block is null when the user lacks the permission for it.
 */
export async function loadBrief(c: Ctx): Promise<Brief> {
  const fin = c.can('finance.view'), docs = c.can('documents.view') || c.can('employees.view_sensitive'), week = addDays(c.today, 7), in30 = addDays(c.today, 30)
  const OPEN = ['todo', 'in_progress', 'waiting']
  const [chq, sales, src, mine, team, projects, approvals, follow] = await Promise.all([
    fin ? c.supabase.from('cheques').select('id,cheque_no,party_name,amount,cheque_date,direction,status').in('status', ['received', 'issued', 'scheduled', 'deposited', 'presented']).lte('cheque_date', week).order('cheque_date').limit(500) : null,
    fin ? loadSalesKpis(c) : null,
    docs ? c.supabase.from('reminder_sources').select('source_type,source_id,title,subject,owner_type,due_date,amount,direction,link').lte('due_date', in30).order('due_date').limit(200) : null,
    c.supabase.from('tasks').select('id,title,due_date,status').eq('owner_id', c.userId).in('status', OPEN).lte('due_date', c.today).is('deleted_at', null).order('due_date').limit(30),
    c.can('records.edit') ? c.supabase.from('tasks').select('id', { count: 'exact', head: true }).in('status', OPEN).lt('due_date', c.today).is('deleted_at', null) : null,
    c.can('documents.view') ? c.supabase.from('projects').select('id,name,status,expected_completion,contract_value').in('status', ['active', 'planning']).limit(300) : null,
    c.supabase.from('approval_requests').select('id,title,amount,entity_type').eq('status', 'pending').order('requested_at').limit(50),
    c.can('crm.view') ? c.supabase.from('leads').select('id', { count: 'exact', head: true }).lte('next_followup', c.today).not('stage', 'in', '(won,lost,on_hold)') : null,
  ])

  const rows = (chq?.data ?? []).map(r => ({ ...r, amount: Number(r.amount) })) as BriefCheque[]
  const cs = chq ? summarizeCheques(rows as any, c.today) : null
  const dueIds = new Set((cs?.dueThisWeek ?? []).map((x: any) => x.id)), odIds = new Set((cs?.overdue ?? []).map((x: any) => x.id))

  // project alerts: past the expected completion date, or recorded costs above the contract value
  let projAlerts: Brief['projects'] = null
  if (projects) {
    const list = projects.data ?? []
    const costs = new Map<string, number>()
    if (fin && list.length) {
      const { data: exp } = await c.supabase.from('project_expenses').select('project_id,amount').in('project_id', list.map(p => p.id)).limit(20000)
      for (const e of exp ?? []) if (e.project_id) costs.set(e.project_id, (costs.get(e.project_id) ?? 0) + Number(e.amount))
    }
    projAlerts = []
    for (const p of list) {
      if (p.expected_completion && p.expected_completion < c.today) projAlerts.push({ id: p.id, name: p.name, reason: `${daysBetween(p.expected_completion, c.today)} days past the planned completion` })
      const cost = costs.get(p.id) ?? 0
      if (fin && p.contract_value && cost > Number(p.contract_value)) projAlerts.push({ id: p.id, name: p.name, reason: 'recorded costs are above the contract value' })
    }
  }

  return {
    cheques: cs ? { due: rows.filter(r => dueIds.has(r.id)), overdue: rows.filter(r => odIds.has(r.id)) } : null,
    invoices: sales ? sales.openRows.map(r => ({ id: r.id, number: r.number, customer: r.customer_name, balance: Math.max(0, r.total - r.paid), due_date: r.due_date ?? '', days: r.due_date ? daysBetween(r.due_date, c.today) : 0 }))
      .filter(r => r.due_date && r.due_date < c.today && r.balance > 0).sort((a, b) => b.days - a.days) : null,
    documents: src ? buildAlerts(((src.data ?? []) as any[]).filter(s => s.source_type === 'document' || s.source_type.startsWith('asset_')), c.today) : null,
    tasks: { mine: (mine.data ?? []) as any, teamOverdue: team?.count ?? 0 },
    projects: projAlerts,
    approvals: (approvals.data ?? []).some(a => canDecide(a.entity_type, c.can)) ? (approvals.data ?? []).filter(a => canDecide(a.entity_type, c.can)) as any : null,
    followups: follow ? follow.count ?? 0 : null,
  }
}
