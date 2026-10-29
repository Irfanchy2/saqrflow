import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'

// Salary accounts (migration 0034): opening balance, monthly accruals, many payments a month, oldest-first allocation,
// reversals, advance offsets, history, and who may see or change what. Real scenarios A–J from the brief.
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL not set — run via `npm run test:db`')
const pool = new pg.Pool({ connectionString: url })

async function as(uid: string | null, sql: string, params: unknown[] = []) {
  const c = await pool.connect()
  try {
    await c.query('begin'); await c.query('set local role authenticated')
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ''])
    const r = await c.query(sql, params); await c.query('commit'); return r
  } catch (e) { await c.query('rollback'); throw e } finally { c.release() }
}
const sup = (sql: string, p: unknown[] = []) => pool.query(sql, p)
const fails = async (p: Promise<unknown>, re?: RegExp) => {
  let err: Error | null = null
  try { await p } catch (e) { err = e as Error }
  expect(err, 'expected the statement to fail').not.toBeNull()
  if (re) expect(err!.message).toMatch(re)
}
const uuid = () => crypto.randomUUID()
const U = { owner: uuid(), hr: uuid(), acc: uuid(), pm: uuid(), viewer: uuid(), emp: uuid(), ownerB: uuid() }
let A: string, B: string, ali: string, sara: string, legacy: string, empB: string

const outstanding = async (emp: string, uid = U.hr) => Number((await as(uid, `select outstanding from salary_accounts where employee_id=$1`, [emp])).rows[0]?.outstanding)
const obligations = async (emp: string) => (await as(U.hr, `select kind, to_char(period,'YYYY-MM') p, amount::float a, remaining::float r, status from salary_obligations where employee_id=$1 order by case kind when 'opening' then 0 else 1 end, period`, [emp])).rows
const pay = (emp: string, amount: number, paid_on = '2026-10-15', extra: Record<string, unknown> = {}) =>
  as(U.hr, `insert into salary_payments(company_id,employee_id,period,amount,paid_on,method,allocate_to,idempotency_key) values ($1,$2,date_trunc('month',$4::date),$3,$4,'cash',$5,$6) returning id`,
    [A, emp, amount, paid_on, extra.allocate_to ?? null, extra.key ?? null]).then(r => r.rows[0].id as string)

beforeAll(async () => {
  for (const [k, id] of Object.entries(U)) await sup('insert into auth.users(id,email) values ($1,$2)', [id, `sal-${k}@test.local`])
  A = (await as(U.owner, `select create_company_with_owner('Salary Co','Owner') id`)).rows[0].id
  B = (await as(U.ownerB, `select create_company_with_owner('Other Co','Owner B') id`)).rows[0].id
  for (const [id, role] of [[U.hr, 'hr_manager'], [U.acc, 'accountant'], [U.pm, 'project_manager'], [U.viewer, 'viewer'], [U.emp, 'employee']])
    await sup('insert into profiles(id,company_id,full_name,role) values ($1,$2,$3,$4)', [id, A, role, role])
  const mk = async (no: string, name: string, salary: number, user: string | null = null) => {
    const id = (await as(U.hr, `insert into employees(company_id,employee_no,full_name,user_id) values ($1,$2,$3,$4) returning id`, [A, no, name, user])).rows[0].id
    await as(U.hr, `insert into employee_compensation(employee_id,company_id,monthly_salary) values ($1,$2,$3)`, [id, A, salary]); return id as string
  }
  ali = await mk('S-001', 'Ali Hassan', 3000, U.emp)
  sara = await mk('S-002', 'Sara Khan', 2500)
  legacy = await mk('S-003', 'Imran Ali', 1500)
  empB = (await as(U.ownerB, `insert into employees(company_id,employee_no,full_name) values ($1,'B-1','Other Person') returning id`, [B])).rows[0].id
  await as(U.ownerB, `insert into employee_compensation(employee_id,company_id,monthly_salary) values ($1,$2,9000)`, [empB, B])
})
afterAll(() => pool.end())

describe('scenarios A–D: opening balance, accruals carry forward, partial payments oldest first', () => {
  it('A: opening AED 8,000 + October salary AED 3,000 = AED 11,000 owed', async () => {
    await as(U.hr, `select salary_set_opening($1, 8000, '2026-10-01', null)`, [ali])
    expect(await as(U.hr, `select salary_post_month('2026-10-01', array[$1]::uuid[]) n`, [ali]).then(r => r.rows[0].n)).toBe(1)
    expect(await outstanding(ali)).toBe(11000)
    expect(await obligations(ali)).toEqual([
      { kind: 'opening', p: null, a: 8000, r: 8000, status: 'unpaid' }, { kind: 'accrual', p: '2026-10', a: 3000, r: 3000, status: 'unpaid' }])
  })
  it('B: AED 2,000 then AED 1,500 (same month, same day) both save and settle the oldest first: 7,500 left', async () => {
    await pay(ali, 2000); await pay(ali, 1500)
    expect(await outstanding(ali)).toBe(7500)
    expect(await obligations(ali)).toEqual([
      { kind: 'opening', p: null, a: 8000, r: 4500, status: 'partial' }, { kind: 'accrual', p: '2026-10', a: 3000, r: 3000, status: 'unpaid' }])
  })
  it('C: November salary adds to what is left: 10,500', async () => {
    await as(U.hr, `select salary_post_month('2026-11-01', array[$1]::uuid[])`, [ali])
    expect(await outstanding(ali)).toBe(10500)
    expect((await obligations(ali)).map(o => o.r)).toEqual([4500, 3000, 3000])
  })
  it('D: another AED 1,000 payment: 9,500', async () => {
    await pay(ali, 1000, '2026-11-05')
    expect(await outstanding(ali)).toBe(9500)
    expect((await obligations(ali)).map(o => o.r)).toEqual([3500, 3000, 3000])
  })
})

describe('E–F: one accrual per month, any number of payments', () => {
  it('E: posting October twice adds nothing; a second October accrual is refused', async () => {
    expect(await as(U.hr, `select salary_post_month('2026-10-01', array[$1]::uuid[]) n`, [ali]).then(r => r.rows[0].n)).toBe(0)
    await fails(as(U.hr, `insert into salary_ledger(company_id,employee_id,kind,period,amount) values ($1,$2,'accrual','2026-10-01',3000)`, [A, ali]), /duplicate key|unique/i)
    expect((await as(U.hr, `select count(*)::int n from salary_ledger where employee_id=$1 and kind='accrual' and period='2026-10-01'`, [ali])).rows[0].n).toBe(1)
    expect(await outstanding(ali)).toBe(9500)
  })
  it('F: three payments on the same day are three transactions', async () => {
    await as(U.hr, `select salary_post_month('2026-10-01', array[$1]::uuid[])`, [sara])
    for (const a of [500, 700.25, 299.75]) await pay(sara, a, '2026-10-20')
    expect((await as(U.hr, `select count(*)::int n, sum(amount)::float s from salary_payments where employee_id=$1 and paid_on='2026-10-20'`, [sara])).rows[0]).toEqual({ n: 3, s: 1500 })
    expect(await outstanding(sara)).toBe(1000)
  })
  it('a resubmitted form (same idempotency key) is refused, a new payment is not', async () => {
    const key = uuid()
    await pay(sara, 100, '2026-10-21', { key })
    await fails(pay(sara, 100, '2026-10-21', { key }), /duplicate key|unique/i)
    await pay(sara, 100, '2026-10-21', { key: uuid() })
    expect(await outstanding(sara)).toBe(800)
  })
  it('later salary changes never alter posted months', async () => {
    await as(U.hr, `update employee_compensation set monthly_salary=3500 where employee_id=$1`, [sara])
    expect((await as(U.hr, `select amount::float a from salary_ledger where employee_id=$1 and kind='accrual'`, [sara])).rows).toEqual([{ a: 2500 }])
    await as(U.hr, `select salary_post_month('2026-11-01', array[$1]::uuid[])`, [sara])
    expect((await as(U.hr, `select amount::float a from salary_ledger where employee_id=$1 and kind='accrual' order by period`, [sara])).rows).toEqual([{ a: 2500 }, { a: 3500 }])
  })
})

describe('G: allocation', () => {
  it('pays the oldest period first; a payment aimed at a period settles that period', async () => {
    const nov = (await as(U.hr, `select id from salary_ledger where employee_id=$1 and kind='accrual' and period='2026-11-01'`, [ali])).rows[0].id
    const p = await pay(ali, 500, '2026-11-10', { allocate_to: nov })
    expect((await obligations(ali)).map(o => o.r)).toEqual([3500, 3000, 2500])
    const alloc = (await as(U.hr, `select obligation_id, amount::float a from salary_allocations where payment_id=$1`, [p])).rows
    expect(alloc).toEqual([{ obligation_id: nov, a: 500 }])
    expect(await outstanding(ali)).toBe(9000)
  })
  it('a payment larger than what is owed leaves a credit that the next month absorbs', async () => {
    await as(U.hr, `select salary_post_month('2026-10-01', array[$1]::uuid[])`, [legacy])
    await pay(legacy, 2000, '2026-10-30')
    expect(await outstanding(legacy)).toBe(-500)
    await as(U.hr, `select salary_post_month('2026-11-01', array[$1]::uuid[])`, [legacy])
    expect(await outstanding(legacy)).toBe(1000)
    expect((await obligations(legacy)).map(o => [o.r, o.status])).toEqual([[0, 'paid'], [1000, 'partial']])
  })
})

describe('H: corrections', () => {
  it('reversing a payment puts the amount back on what is owed, and its allocation goes', async () => {
    const p = await pay(ali, 1200, '2026-11-12')
    expect(await outstanding(ali)).toBe(7800)
    await fails(as(U.hr, `update salary_payments set status='reversed' where id=$1`, [p]), /reason/i)
    await as(U.hr, `update salary_payments set status='reversed', reversal_reason='Entered twice' where id=$1`, [p])
    expect(await outstanding(ali)).toBe(9000)
    expect((await as(U.hr, `select count(*)::int n from salary_allocations where payment_id=$1`, [p])).rows[0].n).toBe(0)
    const r = (await as(U.hr, `select status, reversed_by, reversed_at is not null at from salary_payments where id=$1`, [p])).rows[0]
    expect(r).toEqual({ status: 'reversed', reversed_by: U.hr, at: true })
    expect((await as(U.hr, `select action, reason from salary_audit where payment_id=$1 order by id`, [p])).rows).toEqual([{ action: 'posted', reason: null }, { action: 'reversed', reason: 'Entered twice' }])
  })
  it('amounts cannot be edited, reversed rows stay reversed, nothing can be deleted', async () => {
    const p = (await as(U.hr, `select id from salary_payments where employee_id=$1 and status='posted' limit 1`, [ali])).rows[0].id
    await fails(as(U.hr, `update salary_payments set amount=1 where id=$1`, [p]), /cannot be changed/i)
    await as(U.hr, `update salary_payments set reference='TRX-77', notes='Paid at site', method='bank_transfer' where id=$1`, [p])   // metadata may change
    expect((await as(U.hr, `select action from salary_audit where payment_id=$1 order by id desc limit 1`, [p])).rows[0].action).toBe('edited')
    const rev = (await as(U.hr, `select id from salary_payments where status='reversed' limit 1`)).rows[0].id
    await fails(as(U.hr, `update salary_payments set status='posted' where id=$1`, [rev]), /reversed/i)
    await as(U.owner, `delete from salary_payments where id=$1`, [p])
    await as(U.owner, `delete from salary_ledger where employee_id=$1`, [ali])
    expect((await as(U.hr, `select count(*)::int n from salary_payments where id=$1`, [p])).rows[0].n).toBe(1)
    expect(await outstanding(ali)).toBe(9000)
    const acc = (await as(U.hr, `select id from salary_ledger where employee_id=$1 and kind='accrual' limit 1`, [ali])).rows[0].id
    await fails(as(U.hr, `update salary_ledger set amount=1 where id=$1`, [acc]), /cannot be changed/i)
  })
  it('a reversed month can be posted again', async () => {
    const acc = (await as(U.hr, `select id from salary_ledger where employee_id=$1 and kind='accrual' and period='2026-11-01' and status='posted'`, [legacy])).rows[0].id
    await as(U.hr, `update salary_ledger set status='reversed', reversal_reason='Wrong month' where id=$1`, [acc])
    expect(await outstanding(legacy)).toBe(-500)
    expect(await as(U.hr, `select salary_post_month('2026-11-01', array[$1]::uuid[]) n`, [legacy]).then(r => r.rows[0].n)).toBe(1)
    expect(await outstanding(legacy)).toBe(1000)
  })
  it('changing the opening balance needs a reason and keeps the old entry, reversed', async () => {
    await fails(as(U.hr, `select salary_set_opening($1, 7000, '2026-10-01', '')`, [ali]), /reason/i)
    await as(U.hr, `select salary_set_opening($1, 7000, '2026-10-01', 'Agreed with employee')`, [ali])
    expect((await as(U.hr, `select status, amount::float a, reversal_reason from salary_ledger where employee_id=$1 and kind='opening' order by created_at`, [ali])).rows)
      .toEqual([{ status: 'reversed', a: 8000, reversal_reason: 'Agreed with employee' }, { status: 'posted', a: 7000, reversal_reason: null }])
    expect(await outstanding(ali)).toBe(8000)
  })
  it('an opening balance cannot cover months whose salary is already posted', async () => {
    await fails(as(U.hr, `select salary_set_opening($1, 4000, '2026-12-01', 'Late entry')`, [sara]), /already posted/i)
    await as(U.hr, `select salary_set_opening($1, 4000, '2026-10-01', null)`, [sara])
    await fails(as(U.hr, `select salary_post_month('2026-09-01', array[$1]::uuid[])`, [sara]), /opening balance already covers/i)
  })
})

describe('I: advances against salary', () => {
  let adv: string
  it('an advance stays separate until it is applied; an offset reduces both balances once', async () => {
    adv = (await as(U.hr, `insert into employee_advances(company_id,employee_id,kind,amount,given_on) values ($1,$2,'advance',2000,'2026-10-05') returning id`, [A, ali])).rows[0].id
    const before = await outstanding(ali)
    expect(before).toBe(8000)                                         // recording an advance is not a salary payment
    await as(U.hr, `insert into salary_ledger(company_id,employee_id,kind,amount,advance_id,entry_date) values ($1,$2,'advance_offset',500,$3,'2026-11-30')`, [A, ali, adv])
    expect(await outstanding(ali)).toBe(7500)
    expect((await as(U.hr, `select recovered::float r, remaining::float m, settled from employee_advance_balances where id=$1`, [adv])).rows[0]).toEqual({ r: 500, m: 1500, settled: false })
    await fails(as(U.hr, `insert into salary_ledger(company_id,employee_id,kind,amount,advance_id) values ($1,$2,'advance_offset',1600,$3)`, [A, ali, adv]), /still to be recovered/i)
    const o = (await as(U.hr, `insert into salary_ledger(company_id,employee_id,kind,amount,advance_id) values ($1,$2,'advance_offset',1500,$3) returning id`, [A, ali, adv])).rows[0].id
    expect((await as(U.hr, `select settled from employee_advances where id=$1`, [adv])).rows[0].settled).toBe(true)
    await as(U.hr, `update salary_ledger set status='reversed', reversal_reason='Recover next month' where id=$1`, [o])
    expect((await as(U.hr, `select settled, remaining::float m from employee_advance_balances where id=$1`, [adv])).rows[0]).toEqual({ settled: false, m: 1500 })
    expect(await outstanding(ali)).toBe(7500)
  })
  it('deductions and additions need a reason and move the balance', async () => {
    await fails(as(U.hr, `insert into salary_ledger(company_id,employee_id,kind,amount) values ($1,$2,'deduction',100)`, [A, ali]), /check constraint/i)
    await as(U.hr, `insert into salary_ledger(company_id,employee_id,kind,amount,reason) values ($1,$2,'deduction',100.5,'Damaged tool')`, [A, ali])
    await as(U.hr, `insert into salary_ledger(company_id,employee_id,kind,amount,reason,period) values ($1,$2,'adjustment',250.25,'Overtime October','2026-10-01')`, [A, ali])
    expect(await outstanding(ali)).toBe(7649.75)
  })
})

describe('J: existing payment history', () => {
  it('payments recorded before the ledger stay, and an opening balance reconciles to what is owed today', async () => {
    const emp = (await as(U.hr, `insert into employees(company_id,employee_no,full_name) values ($1,'S-004','Legacy Worker') returning id`, [A])).rows[0].id
    await as(U.hr, `insert into employee_compensation(employee_id,company_id,monthly_salary) values ($1,$2,1500)`, [emp, A])
    // as the old screen saved them: one per "month", the second filed under next month to get past the old rule
    await as(U.hr, `insert into salary_payments(company_id,employee_id,period,amount,paid_on) values ($1,$2,'2026-10-01',2000,'2026-10-07'),($1,$2,'2026-11-01',1000,'2026-10-22')`, [A, emp])
    expect(await outstanding(emp)).toBe(-3000)
    // admin knows 5,500 is still owed today: opening = owed today + already paid − salary already posted
    await as(U.hr, `select salary_set_opening($1, 5500 + 3000, '2026-10-01', null)`, [emp])
    expect(await outstanding(emp)).toBe(5500)
    expect((await as(U.hr, `select count(*)::int n, sum(amount)::float s from salary_payments where employee_id=$1`, [emp])).rows[0]).toEqual({ n: 2, s: 3000 })
    await as(U.hr, `select salary_post_month('2026-10-01', array[$1]::uuid[])`, [emp])
    expect(await outstanding(emp)).toBe(7000)
  })
})

describe('who may see and change salary accounts', () => {
  it('HR, accountant and owner read the ledger; project manager and viewer see nothing', async () => {
    for (const u of [U.hr, U.acc, U.owner]) expect((await as(u, `select count(*)::int n from salary_ledger`)).rows[0].n).toBeGreaterThan(0)
    for (const u of [U.pm, U.viewer]) {
      for (const t of ['salary_ledger', 'salary_allocations', 'salary_audit', 'salary_payments']) expect((await as(u, `select count(*)::int n from ${t}`)).rows[0].n).toBe(0)
      await fails(as(u, `select salary_post_month('2026-12-01', array[$1]::uuid[])`, [ali]), /permission/i)
      await fails(as(u, `insert into salary_ledger(company_id,employee_id,kind,amount,reason) values ($1,$2,'adjustment',50,'x')`, [A, ali]), /row-level security/i)
    }
  })
  it('an employee reads only their own account and cannot change it', async () => {
    const own = (await as(U.emp, `select distinct employee_id from salary_ledger`)).rows
    expect(own).toEqual([{ employee_id: ali }])
    expect(Number((await as(U.emp, `select outstanding from salary_accounts where employee_id=$1`, [ali])).rows[0].outstanding)).toBe(7649.75)
    expect((await as(U.emp, `select count(*)::int n from salary_obligations where employee_id<>$1`, [ali])).rows[0].n).toBe(0)
    expect((await as(U.emp, `select count(*)::int n from salary_audit`)).rows[0].n).toBe(0)
    await fails(as(U.emp, `insert into salary_payments(company_id,employee_id,period,amount,paid_on) values ($1,$2,'2026-11-01',99,'2026-11-01')`, [A, ali]), /row-level security/i)
    await fails(as(U.emp, `select salary_set_opening($1, 1, '2026-10-01', 'x')`, [ali]), /permission/i)
    const p = (await as(U.emp, `select id from salary_payments limit 1`)).rows[0].id
    await as(U.emp, `update salary_payments set status='reversed', reversal_reason='mine' where id=$1`, [p])
    expect((await as(U.hr, `select status from salary_payments where id=$1`, [p])).rows[0].status).toBe('posted')
  })
  it('companies are isolated', async () => {
    expect((await as(U.ownerB, `select count(*)::int n from salary_ledger`)).rows[0].n).toBe(0)
    expect(await as(U.ownerB, `select salary_post_month('2026-10-01', array[$1]::uuid[]) n`, [ali]).then(r => r.rows[0].n)).toBe(0)
    await fails(as(U.ownerB, `select salary_set_opening($1, 100, '2026-10-01', null)`, [ali]), /not found|row-level/i)
    await fails(as(U.ownerB, `insert into salary_payments(company_id,employee_id,period,amount,paid_on) values ($1,$2,'2026-11-01',10,'2026-11-01')`, [B, ali]), /not found/i)
    expect(await as(U.ownerB, `select salary_post_month('2026-10-01', array[$1]::uuid[]) n`, [empB]).then(r => r.rows[0].n)).toBe(1)
    expect(await outstanding(empB, U.ownerB)).toBe(9000)
    expect((await as(U.hr, `select count(*)::int n from salary_accounts where employee_id=$1`, [empB])).rows[0].n).toBe(0)
  })
  it('the audit log never holds salary amounts', async () => {
    const rows = (await sup(`select changes from audit_logs where table_name in ('salary_ledger','salary_payments') and company_id=$1`, [A])).rows
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r.changes).toEqual({ redacted: true })
  })
})

describe('0035: WhatsApp sharing of salary documents', () => {
  it('an accountant (salary access) can read employee names for the salary pages, a project manager cannot see salary', async () => {
    const names = (await as(U.acc, `select full_name from employees where company_id=$1 order by employee_no`, [A])).rows.map(r => r.full_name)
    expect(names).toContain('Ali Hassan')
    expect((await as(U.acc, `select count(*)::int n from salary_accounts where employee_id=$1`, [ali])).rows[0].n).toBe(1)
    expect((await as(U.ownerB, `select count(*)::int n from employees where id=$1`, [ali])).rows[0].n).toBe(0)
  })
  it('the employee WhatsApp number must be international, and only HR / owner can change it', async () => {
    await fails(as(U.hr, `update employees set whatsapp='0501234567' where id=$1`, [ali]), /employees_whatsapp_e164/)
    await as(U.hr, `update employees set whatsapp='+971501234567' where id=$1`, [ali])
    await as(U.acc, `update employees set whatsapp='+971559999999' where id=$1`, [ali])          // no employee edit right: no effect
    expect((await as(U.hr, `select whatsapp from employees where id=$1`, [ali])).rows[0].whatsapp).toBe('+971501234567')
  })
  it('shares are logged per document, readable only with the matching access, never edited', async () => {
    const pay = (await as(U.hr, `select id from salary_payments where employee_id=$1 limit 1`, [ali])).rows[0].id
    await as(U.acc, `insert into document_shares(company_id,doc_kind,record_id,party_type,party_id,method,phone_last4) values ($1,'salary_receipt',$2,'employee',$3,'whatsapp_link','4567')`, [A, pay, ali])
    await fails(as(U.pm, `insert into document_shares(company_id,doc_kind,record_id,party_type,party_id,method) values ($1,'salary_receipt',$2,'employee',$3,'native_share')`, [A, pay, ali]), /row-level security/i)
    await fails(as(U.acc, `insert into document_shares(company_id,doc_kind,record_id,party_type,party_id,method,user_id) values ($1,'payslip',$2,'employee',$3,'download',$4)`, [A, pay, ali, U.hr]), /row-level security/i)
    await fails(as(U.ownerB, `insert into document_shares(company_id,doc_kind,record_id,party_type,party_id,method) values ($1,'payslip',$2,'employee',$3,'download')`, [A, pay, ali]), /row-level security/i)
    await fails(as(U.acc, `insert into document_shares(company_id,doc_kind,record_id,party_type,method,phone_last4) values ($1,'payslip',$2,'employee','download','971501234567')`, [A, pay]), /check constraint/i)
    expect((await as(U.hr, `select count(*)::int n from document_shares where record_id=$1`, [pay])).rows[0].n).toBe(1)
    for (const u of [U.pm, U.viewer, U.emp, U.ownerB]) expect((await as(u, `select count(*)::int n from document_shares`)).rows[0].n).toBe(0)
    await fails(as(U.owner, `delete from document_shares where record_id=$1`, [pay]), /permission denied/i)
    await fails(as(U.owner, `update document_shares set method='download' where record_id=$1`, [pay]), /permission denied/i)
    expect((await as(U.hr, `select method from document_shares where record_id=$1`, [pay])).rows).toEqual([{ method: 'whatsapp_link' }])
  })
  it('sharing changes no salary balance', async () => {
    expect(await outstanding(ali)).toBe(7649.75)
  })
})
