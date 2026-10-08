import { describe, expect, it } from 'vitest'
import { costControl, followupState, pipelineSummary, projectProgress, sourceAnalytics, taskBucket, tasksCompletion } from '@/lib/crm'

describe('pipeline', () => {
  const leads = [
    { stage: 'new', source: 'google', estimated_value: 10000 },
    { stage: 'negotiation', source: 'google', estimated_value: 20000, probability: 80 },
    { stage: 'won', source: 'referral', estimated_value: 50000 },
    { stage: 'lost', source: 'google', estimated_value: 5000 },
    { stage: 'quotation_sent', source: 'referral', estimated_value: null },
  ]
  it('values open leads only and weights by entered or stage probability', () => {
    const s = pipelineSummary(leads)
    expect(s.open).toBe(3); expect(s.value).toBe(30000)
    expect(s.weighted).toBe(10000 * 0.1 + 20000 * 0.8)   // the null-value lead adds nothing
    expect(s.unvalued).toBe(1); expect(s.winRate).toBe(50)
  })
  it('conversion = won ÷ decided, never counting open leads as lost', () => {
    const g = sourceAnalytics(leads).find(r => r.source === 'google')!
    expect(g).toMatchObject({ leads: 3, open: 2, won: 0, lost: 1, conversion: 0, pipeline: 30000 })
    expect(sourceAnalytics([{ stage: 'new', source: 'tender' }])[0].conversion).toBeNull()
  })
  it('follow-up state ignores closed leads', () => {
    expect(followupState({ stage: 'contacted', next_followup: '2026-10-07' }, '2026-10-08')).toBe('overdue')
    expect(followupState({ stage: 'contacted', next_followup: '2026-10-08' }, '2026-10-08')).toBe('today')
    expect(followupState({ stage: 'won', next_followup: '2026-10-01' }, '2026-10-08')).toBe('none')
  })
})

describe('tasks & progress', () => {
  it('buckets by due date; overdue is derived', () => {
    const t = '2026-10-08'
    expect(taskBucket({ status: 'todo', due_date: '2026-10-07' }, t)).toBe('overdue')
    expect(taskBucket({ status: 'in_progress', due_date: '2026-10-14' }, t)).toBe('week')
    expect(taskBucket({ status: 'todo', due_date: '2026-10-15' }, t)).toBe('later')
    expect(taskBucket({ status: 'completed', due_date: '2026-10-01' }, t)).toBe('done')
  })
  it('work order completion averages live tasks', () => {
    expect(tasksCompletion([])).toBeNull()
    expect(tasksCompletion([{ status: 'completed' }, { status: 'in_progress', completion: 50 }, { status: 'cancelled', completion: 0 }])).toBe(75)
  })
  it('overall progress: entered value wins, else weighted; commercial needs a contract', () => {
    expect(projectProgress({ fabrication_progress: 100, site_progress: 50, inspection_progress: 0 }, null)).toMatchObject({ overall: 68, derived: true, commercial: null })
    expect(projectProgress({ fabrication_progress: 100, site_progress: 50, overall_progress: 90 }, 40)).toMatchObject({ overall: 90, derived: false, commercial: 40 })
  })
})

describe('cost control', () => {
  it('flags missing inputs instead of inventing them', () => {
    const r = costControl({ contract: 0, budgets: [], byCategory: { transport: 300 } })
    expect(r.complete).toBe(false)
    expect(r.missing).toEqual(['Contract value', 'Estimated cost (budget)', 'Material costs', 'Labour costs'])
    expect(r.estimatedProfit).toBeNull(); expect(r.forecastProfit).toBeNull(); expect(r.remaining).toBeNull()
  })
  it('budget vs actual per category, overruns and forecast', () => {
    const r = costControl({ contract: 100000, budgets: [{ category: 'material', amount: 40000 }, { category: 'labour', amount: '20000' }], byCategory: { material: 45000, labour: 8000 } })
    expect(r.complete).toBe(true)
    expect(r.estimated).toBe(60000); expect(r.actual).toBe(53000); expect(r.remaining).toBe(7000)
    expect(r.estimatedProfit).toBe(40000); expect(r.forecastProfit).toBe(40000)
    expect(r.overruns.map(o => o.category)).toEqual(['material'])
    expect(r.lines.find(l => l.category === 'material')).toMatchObject({ variance: -5000, usedPct: 113 })
  })
  it('a planning project does not demand material / labour costs yet', () => {
    expect(costControl({ contract: 5000, budgets: [{ category: 'material', amount: 1000 }], byCategory: {}, started: false }).complete).toBe(true)
  })
})
