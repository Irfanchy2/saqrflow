import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'

// Employee Petty Cash (migration 0037): the wallet ledger, employee reports, settlement of claims, reimbursements,
// returns, reversals, company cash, duplicate protection, who may see or do what, and payroll isolation.
// Test cases 1–10 from the brief, plus the extra checks it lists.
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL not set — run via `npm run test:db`')
const pool = new pg.Pool({ connectionString: url })

async function as(uid: string | null, sql: string, params: unknown[] = []) {
  const c = await pool.connect()
  try {
    await c.query('begin'); await c.query(uid ? 'set local role authenticated' : 'set local role anon')
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
const U = { owner: uuid(), acc: uuid(), hr: uuid(), viewer: uuid(), ayub: uuid(), irfan: uuid(), ownerB: uuid(), empB: uuid() }
let A: string, B: string, ayub: string, irfan: string, sara: string, empB: string, cash: string, bank: string, project: string

const wallet = async (emp: string, uid = U.owner) =>
  (await as(uid, `select available::float a, received::float r, settled::float s, returned::float ret, reimbursement_due::float due, reimbursed::float paid,
    pending_received::float pr, pending_returns::float pret, pending_expenses::float pe, awaiting_settlement::float aw from petty_cash_wallets where employee_id=$1`, [emp])).rows[0]
    ?? { a: 0, r: 0, s: 0, ret: 0, due: 0, paid: 0, pr: 0, pret: 0, pe: 0, aw: 0 }
const balance = async (emp: string, uid = U.owner) => Number((await as(uid, `select petty_wallet_balance($1) b`, [emp])).rows[0].b)
const due = async (emp: string, uid = U.owner) => Number((await as(uid, `select petty_reimbursement_due($1) b`, [emp])).rows[0].b)
const issue = (emp: string, amount: number, extra: { key?: string, bank?: string | null, date?: string, project?: string | null, ref?: string | null } = {}) =>
  as(U.owner, `select petty_issue($1,$2,$3,'cash',$4,$5,'Site purchases',$6,null,null,$7) id`,
    [emp, amount, extra.date ?? '2026-10-20', extra.bank === undefined ? cash : extra.bank, extra.project ?? null, extra.ref ?? null, extra.key ?? uuid()]).then(r => r.rows[0].id as string)
const claim = (uid: string, emp: string, amount: number, funded: string | null, extra: Record<string, unknown> = {}) =>
  as(uid, `insert into expense_claims(company_id,employee_id,spent_on,description,supplier_name,reference,amount,vat_amount,category,funded_by,project_id)
    values ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10) returning id`,
    [A, emp, extra.date ?? '2026-10-21', extra.desc ?? 'Site purchase', extra.supplier ?? `Supplier ${uuid().slice(0, 6)}`, extra.ref ?? uuid().slice(0, 8), amount,
     extra.category ?? 'material', funded, extra.project ?? null]).then(r => r.rows[0].id as string)
const decide = (cl: string, decision = 'approved', extra: { petty?: number | null, personal?: number | null, bank?: string | null, note?: string | null, uid?: string } = {}) =>
  as(extra.uid ?? U.owner, `select decide_expense_claim($1,$2,$3,null,null,null,$4,$5,$6) id`,
    [cl, decision, extra.note ?? (decision === 'approved' ? null : 'Wrong receipt'), extra.bank ?? null, extra.petty ?? null, extra.personal ?? null]).then(r => r.rows[0].id as string | null)
const report = (uid: string, emp: string, kind: 'received' | 'return', amount: number, extra: Record<string, unknown> = {}) =>
  as(uid, `insert into petty_cash_requests(company_id,employee_id,kind,amount,entry_date,method,counterparty,purpose,reference) values ($1,$2,$3,$4,$5,'cash',$6,$7,$8) returning id`,
    [A, emp, kind, amount, extra.date ?? '2026-10-20', extra.from ?? 'Owner', extra.purpose ?? null, extra.ref ?? null]).then(r => r.rows[0].id as string)
const decideReq = (req: string, decision = 'approved', extra: { link?: string | null, bank?: string | null, note?: string | null, uid?: string } = {}) =>
  as(extra.uid ?? U.owner, `select petty_decide_request($1,$2,$3,$4,$5) id`, [req, decision, extra.note ?? (decision === 'approved' ? null : 'Not handed over'), extra.link ?? null, extra.bank ?? null]).then(r => r.rows[0].id as string | null)
const cashOut = async (acct = cash) => Number((await sup(`select coalesce(sum(amount),0) s from bank_transactions where bank_id=$1 and source_type='petty_cash'`, [acct])).rows[0].s)
const entries = async (emp: string) => Number((await sup(`select count(*) n from petty_cash_entries where employee_id=$1`, [emp])).rows[0].n)

beforeAll(async () => {
  for (const [k, id] of Object.entries(U)) await sup('insert into auth.users(id,email) values ($1,$2)', [id, `petty-${k}@test.local`])
  A = (await as(U.owner, `select create_company_with_owner('Petty Co','Owner') id`)).rows[0].id
  B = (await as(U.ownerB, `select create_company_with_owner('Other Co','Owner B') id`)).rows[0].id
  for (const [id, role] of [[U.acc, 'accountant'], [U.hr, 'hr_manager'], [U.viewer, 'viewer'], [U.ayub, 'employee'], [U.irfan, 'employee']])
    await sup('insert into profiles(id,company_id,full_name,role) values ($1,$2,$3,$4)', [id, A, role, role])
  await sup('insert into profiles(id,company_id,full_name,role) values ($1,$2,$3,$4)', [U.empB, B, 'B employee', 'employee'])
  const mk = async (co: string, uid: string, no: string, name: string, user: string | null) =>
    (await as(uid, `insert into employees(company_id,employee_no,full_name,user_id) values ($1,$2,$3,$4) returning id`, [co, no, name, user])).rows[0].id as string
  ayub = await mk(A, U.owner, 'P-001', 'Mohammed Ayub', U.ayub)
  irfan = await mk(A, U.owner, 'P-002', 'Mohammed Irfan', U.irfan)
  sara = await mk(A, U.owner, 'P-003', 'Sara Khan', null)
  empB = await mk(B, U.ownerB, 'B-1', 'Other Person', U.empB)
  cash = (await as(U.owner, `insert into banks(company_id,name,account_display_name,is_account,account_type) values ($1,'Petty cash box','Office',true,'cash') returning id`, [A])).rows[0].id
  bank = (await as(U.owner, `insert into banks(company_id,name,account_display_name,is_account) values ($1,'Emirates NBD','Current ••0001',true) returning id`, [A])).rows[0].id
  project = (await as(U.owner, `insert into projects(company_id,name) values ($1,'Site A') returning id`, [A])).rows[0].id
})
afterAll(() => pool.end())

describe('test 1: admin issues petty cash, an expense is approved and settled', () => {
  it('AED 1,000 issued, AED 250 expense approved: wallet AED 750; company cash −1,000 once; expense recognised once', async () => {
    await issue(ayub, 1000, { project })
    expect(await balance(ayub)).toBe(1000)
    expect(await cashOut()).toBe(-1000)                          // scenario A: company cash −1,000, no expense yet
    expect(Number((await sup(`select count(*) n from project_expenses where employee_id=$1`, [ayub])).rows[0].n)).toBe(0)
    const cl = await claim(U.ayub, ayub, 250, 'petty_cash')
    expect(await balance(ayub)).toBe(1000)                       // pending: balance unchanged
    expect((await wallet(ayub)).pe).toBe(250)                    // shown as pending, separately
    const exp = await decide(cl)
    expect(await balance(ayub)).toBe(750)
    const e = (await sup(`select amount::float, paid_from_bank_id, payment_status from project_expenses where id=$1`, [exp])).rows[0]
    expect(e).toEqual({ amount: 250, paid_from_bank_id: null, payment_status: 'paid' })   // scenario B: expense +250
    expect(await cashOut()).toBe(-1000)                          // no second cash movement
    expect(Number((await sup(`select count(*) n from bank_transactions where source_type='expense' and source_id=$1`, [exp])).rows[0].n)).toBe(0)
  })
  it('multiple expenses on the same day each settle once', async () => {
    const a = await claim(U.ayub, ayub, 100, 'petty_cash'), b = await claim(U.ayub, ayub, 50, 'petty_cash')
    await decide(a); await decide(b)
    expect(await balance(ayub)).toBe(600)
    expect((await wallet(ayub)).s).toBe(400)
  })
  it('multiple issues in the same month add up; the same request key posts once', async () => {
    const key = uuid()
    const one = await issue(irfan, 300, { key }), two = await issue(irfan, 300, { key })
    expect(one).toBe(two)
    await issue(irfan, 200)
    expect(await balance(irfan)).toBe(500)
  })
})

describe('test 2: employee reports petty cash received', () => {
  it('pending report does not change the wallet; approval credits AED 500 once', async () => {
    const before = await balance(irfan)
    const req = await report(U.irfan, irfan, 'received', 500, { purpose: 'Tools' })
    expect(await balance(irfan)).toBe(before)
    expect((await wallet(irfan)).pr).toBe(500)
    const notes = (await sup(`select user_id from in_app_notifications where link like $1`, [`%open=${req}`])).rows.map(r => r.user_id)
    expect(notes).toContain(U.owner); expect(notes).toContain(U.acc); expect(notes).not.toContain(U.irfan)   // approvers hear about it
    const e1 = await decideReq(req), e2 = await decideReq(req)    // a second click returns the same row
    expect(e1).toBe(e2)
    expect(await balance(irfan)).toBe(before + 500)
    expect(Number((await sup(`select count(*) n from in_app_notifications where user_id=$1 and title like 'Petty cash received confirmed%'`, [U.irfan])).rows[0].n)).toBe(1)
  })
  it('a report matching a hand-over the company already recorded is linked, not credited again', async () => {
    const handover = await issue(sara, 400, { ref: 'PC-77' })
    const req = await report(U.owner, sara, 'received', 400, { ref: 'PC-77' }).catch(() => null)
    expect(req).toBeNull()                                         // only the employee themself can report
    const r2 = await sup(`insert into petty_cash_requests(company_id,employee_id,kind,amount,entry_date,reference) values ($1,$2,'received',400,'2026-10-20','PC-77') returning id`, [A, sara])
    const linked = await decideReq(r2.rows[0].id, 'approved', { link: handover })
    expect(linked).toBe(handover)
    expect(await balance(sara)).toBe(400)                          // still 400, not 800
    const r3 = await sup(`insert into petty_cash_requests(company_id,employee_id,kind,amount,entry_date) values ($1,$2,'received',400,'2026-10-20') returning id`, [A, sara])
    await fails(decideReq(r3.rows[0].id, 'approved', { link: handover }), /already matched/)
    // a genuine second payment of the same amount on the same day is still accepted when posted on its own
    await decideReq(r3.rows[0].id)
    expect(await balance(sara)).toBe(800)
  })
  it('rejected and correction-requested reports never touch the wallet; the employee cannot approve their own', async () => {
    const before = await balance(irfan)
    const req = await report(U.irfan, irfan, 'received', 999)
    await fails(as(U.irfan, `update petty_cash_requests set status='approved' where id=$1`, [req]), /approver/)
    await fails(as(U.irfan, `select petty_decide_request($1,'approved',null,null,null)`, [req]), /not allowed/)
    await fails(decideReq(req, 'rejected', { note: '' }), /reason/)
    await decideReq(req, 'correction_requested', { note: 'Wrong amount' })
    await as(U.irfan, `update petty_cash_requests set amount=99, status='pending' where id=$1`, [req])
    await decideReq(req, 'rejected')
    expect(await balance(irfan)).toBe(before)
  })
})

describe('test 3: rejected expense', () => {
  it('AED 300 rejected: no wallet deduction, no company expense', async () => {
    const before = await balance(ayub)
    const cl = await claim(U.ayub, ayub, 300, 'petty_cash')
    await decide(cl, 'rejected')
    expect(await balance(ayub)).toBe(before)
    expect(Number((await sup(`select count(*) n from petty_cash_entries where claim_id=$1`, [cl])).rows[0].n)).toBe(0)
    expect(Number((await sup(`select count(*) n from project_expenses where expense_claim_id=$1`, [cl])).rows[0].n)).toBe(0)
  })
})

describe('test 4: expense larger than the petty cash held', () => {
  let emp: string
  beforeAll(async () => { emp = (await as(U.owner, `insert into employees(company_id,employee_no,full_name) values ($1,'P-004','Imran Ali') returning id`, [A])).rows[0].id; await issue(emp, 200) })
  it('split: AED 200 from petty cash and AED 150 the employee paid: wallet 0, reimbursement due 150', async () => {
    const cl = await sup(`insert into expense_claims(company_id,employee_id,spent_on,description,amount,funded_by) values ($1,$2,'2026-10-22','Steel',350,'petty_cash') returning id`, [A, emp])
    await decide(cl.rows[0].id, 'approved', { petty: 200, personal: 150 })
    expect(await balance(emp)).toBe(0)
    expect(await due(emp)).toBe(150)
    expect((await sup(`select unsettled::float u from expense_claim_settlement where claim_id=$1`, [cl.rows[0].id])).rows[0].u).toBe(0)
  })
  it('never negative: more petty cash than held is refused; without confirmation the shortfall awaits settlement', async () => {
    await issue(emp, 100)
    const big = await sup(`insert into expense_claims(company_id,employee_id,spent_on,description,amount,funded_by) values ($1,$2,'2026-10-22','Paint',180,'petty_cash') returning id`, [A, emp])
    await fails(decide(big.rows[0].id, 'approved', { petty: 180 }), /holds AED 100/)
    expect((await sup(`select status from expense_claims where id=$1`, [big.rows[0].id])).rows[0].status).toBe('pending')   // whole approval rolled back
    await decide(big.rows[0].id)                                    // default: as much as held, rest waits
    expect(await balance(emp)).toBe(0)
    expect(await due(emp)).toBe(150)                                // the employee is not assumed to have paid
    expect((await wallet(emp)).aw).toBe(80)
    await fails(as(U.owner, `select petty_settle_claim($1,10,0,'late-1')`, [big.rows[0].id]), /holds AED 0/)
    await issue(emp, 100)
    await as(U.owner, `select petty_settle_claim($1,80,0,'late-1')`, [big.rows[0].id])
    await as(U.owner, `select petty_settle_claim($1,80,0,'late-1')`, [big.rows[0].id])   // retry: nothing more
    expect(await balance(emp)).toBe(20)
    expect((await wallet(emp)).aw).toBe(0)
    await fails(as(U.owner, `select petty_settle_claim($1,1,0,'late-2')`, [big.rows[0].id]), /still to settle/)
  })
})

describe('test 5: petty cash returned', () => {
  it('received 1,000, expenses 650, returned 350 in two parts: wallet 0; company cash +350; more than held is refused', async () => {
    const emp = (await as(U.owner, `insert into employees(company_id,employee_no,full_name,user_id) values ($1,'P-005','Return Test',null) returning id`, [A])).rows[0].id
    await issue(emp, 1000)
    for (const amt of [350, 100, 200]) { const cl = await sup(`insert into expense_claims(company_id,employee_id,spent_on,description,amount,funded_by) values ($1,$2,'2026-10-23','Materials',$3,'petty_cash') returning id`, [A, emp, amt]); await decide(cl.rows[0].id) }
    expect(await balance(emp)).toBe(350)
    const cash0 = await cashOut()
    const key = uuid()
    await as(U.owner, `select petty_record_return($1,150,'2026-10-24','cash',$2,null,null,$3)`, [emp, cash, key])
    await as(U.owner, `select petty_record_return($1,150,'2026-10-24','cash',$2,null,null,$3)`, [emp, cash, key])   // retry
    await fails(as(U.owner, `select petty_record_return($1,250,'2026-10-24','cash',$2,null,null,$3)`, [emp, cash, uuid()]), /more than the petty cash/)
    await as(U.owner, `select petty_record_return($1,200,'2026-10-24','cash',$2,null,null,$3)`, [emp, cash, uuid()])
    expect(await balance(emp)).toBe(0)
    expect(await cashOut() - cash0).toBe(350)                     // scenario C: company cash +350
  })
  it('an employee-reported return changes nothing until confirmed', async () => {
    const before = await balance(ayub), c0 = await cashOut()
    const req = await report(U.ayub, ayub, 'return', 100)
    expect(await balance(ayub)).toBe(before)
    expect(await cashOut()).toBe(c0)
    expect((await wallet(ayub)).pret).toBe(100)
    await decideReq(req, 'approved', { bank: cash })
    expect(await balance(ayub)).toBe(before - 100)
    expect(await cashOut() - c0).toBe(100)
    const tooMuch = await report(U.ayub, ayub, 'return', 100000)
    await fails(decideReq(tooMuch), /more than the petty cash/)
  })
})

describe('tests 6–7: personal money, reimbursement', () => {
  it('AED 250 paid personally: wallet unchanged, reimbursement due 250, no company cash moves', async () => {
    const before = await balance(irfan), d0 = await due(irfan), c0 = await cashOut(bank)
    const cl = await claim(U.irfan, irfan, 250, 'personal')
    const exp = await decide(cl, 'approved', { uid: U.acc })
    expect(await balance(irfan)).toBe(before)
    expect(await due(irfan) - d0).toBe(250)
    expect(await cashOut(bank)).toBe(c0)                            // scenario D
    expect(Number((await sup(`select amount from project_expenses where id=$1`, [exp])).rows[0].amount)).toBe(250)
  })
  it('AED 100 paid back: 150 remains; company cash −100; no second expense; overpaying is refused', async () => {
    const d0 = await due(irfan), c0 = await cashOut(bank), exp0 = Number((await sup(`select count(*) n from project_expenses where company_id=$1`, [A])).rows[0].n)
    const key = uuid()
    await as(U.owner, `select petty_reimburse($1,100,'2026-10-25','bank_transfer',$2,'TRX-1',null,$3)`, [irfan, bank, key])
    await as(U.owner, `select petty_reimburse($1,100,'2026-10-25','bank_transfer',$2,'TRX-1',null,$3)`, [irfan, bank, key])   // retry
    expect(await due(irfan)).toBe(d0 - 100)
    expect(await cashOut(bank) - c0).toBe(-100)                    // scenario E
    expect(Number((await sup(`select count(*) n from project_expenses where company_id=$1`, [A])).rows[0].n)).toBe(exp0)
    await fails(as(U.owner, `select petty_reimburse($1,100000,null,'cash',null,null,null,$2)`, [irfan, uuid()]), /owes this employee/)
  })
  it('a personal claim approved with an account is paid back at once', async () => {
    const d0 = await due(irfan), c0 = await cashOut(bank)
    const cl = await claim(U.irfan, irfan, 75, 'personal')
    await decide(cl, 'approved', { bank })
    expect(await due(irfan)).toBe(d0)
    expect(await cashOut(bank) - c0).toBe(-75)
  })
})

describe('test 8: duplicate approval protection', () => {
  it('approving twice, or a concurrent retry, settles once', async () => {
    const cl = await claim(U.ayub, ayub, 40, 'petty_cash')
    const before = await balance(ayub)
    const r = await Promise.allSettled([decide(cl), decide(cl, 'approved', { uid: U.acc })])
    expect(r.some(x => x.status === 'fulfilled')).toBe(true)
    await decide(cl)
    expect(Number((await sup(`select count(*) n from petty_cash_entries where claim_id=$1`, [cl])).rows[0].n)).toBe(1)
    expect(Number((await sup(`select count(*) n from project_expenses where expense_claim_id=$1`, [cl])).rows[0].n)).toBe(1)
    expect(await balance(ayub)).toBe(before - 40)
  })
  it('two concurrent issues with the same key post once', async () => {
    const key = uuid(), n0 = await entries(sara)
    await Promise.allSettled([issue(sara, 10, { key }), issue(sara, 10, { key })])
    expect(await entries(sara) - n0).toBe(1)
  })
})

describe('test 9: who may see and do what', () => {
  it('an employee sees only their own wallet, requests and entries', async () => {
    expect((await as(U.ayub, `select distinct employee_id from petty_cash_entries`)).rows.map(r => r.employee_id)).toEqual([ayub])
    expect((await as(U.ayub, `select employee_id from petty_cash_wallets`)).rows.map(r => r.employee_id)).toEqual([ayub])
    expect(await balance(irfan, U.ayub)).toBe(0)                  // another employee's balance reads as nothing
    expect(await balance(ayub, U.ayub)).toBeGreaterThan(0)
  })
  it('employees cannot issue, decide, settle, reimburse, adjust or reverse; and cannot write the ledger directly', async () => {
    await fails(as(U.ayub, `select petty_issue($1,100,'2026-10-20','cash',null,null,'x',null,null,null,$2)`, [ayub, uuid()]), /not allowed/)
    await fails(as(U.ayub, `select petty_adjust($1,100,null,'gift',$2)`, [ayub, uuid()]), /not allowed/)
    await fails(as(U.ayub, `select petty_reimburse($1,1,null,'cash',null,null,null,$2)`, [ayub, uuid()]), /not allowed/)
    const e = (await sup(`select id from petty_cash_entries where employee_id=$1 limit 1`, [ayub])).rows[0].id
    await fails(as(U.ayub, `select petty_reverse($1,'oops')`, [e]), /not allowed/)
    await fails(as(U.ayub, `insert into petty_cash_entries(company_id,employee_id,book,kind,amount,entry_date,description,source_event) values ($1,$2,'wallet','received',5000,'2026-10-20','free','x')`, [A, ayub]), /permission denied/)
    await fails(as(U.owner, `update petty_cash_entries set amount=1 where id=$1`, [e]), /permission denied/)
    await fails(as(U.owner, `delete from petty_cash_entries where id=$1`, [e]), /permission denied/)
    await fails(sup(`update petty_cash_entries set amount=1 where id=$1`, [e]), /cannot be changed or deleted/)   // not even the service role
    await fails(as(U.ayub, `insert into petty_cash_requests(company_id,employee_id,kind,amount,entry_date) values ($1,$2,'received',100,'2026-10-20')`, [A, irfan]), /row-level security/)
    await fails(as(U.ayub, `insert into petty_cash_requests(company_id,employee_id,kind,amount,entry_date,status) values ($1,$2,'received',100,'2026-10-20','approved')`, [A, ayub]), /row-level security/)
    await fails(as(U.hr, `select petty_issue($1,100,'2026-10-20','cash',null,null,'x',null,null,null,$2)`, [ayub, uuid()]), /not allowed/)
    await fails(as(U.viewer, `select petty_issue($1,100,'2026-10-20','cash',null,null,'x',null,null,null,$2)`, [ayub, uuid()]), /not allowed/)
  })
  it('company B sees nothing of company A and cannot act on it', async () => {
    expect((await as(U.ownerB, `select count(*) n from petty_cash_entries`)).rows[0].n).toBe('0')
    expect((await as(U.ownerB, `select count(*) n from petty_cash_requests`)).rows[0].n).toBe('0')
    expect((await as(U.ownerB, `select count(*) n from petty_cash_wallets`)).rows[0].n).toBe('0')
    expect((await as(U.empB, `select count(*) n from petty_cash_entries`)).rows[0].n).toBe('0')
    expect(await balance(ayub, U.ownerB)).toBe(0)
    await fails(as(U.ownerB, `select petty_issue($1,100,'2026-10-20','cash',null,null,'x',null,null,null,$2)`, [ayub, uuid()]), /Employee not found/)
    await fails(as(U.owner, `select petty_issue($1,100,'2026-10-20','cash',null,null,'x',null,null,null,$2)`, [empB, uuid()]), /Employee not found/)
    const bankB = (await as(U.ownerB, `insert into banks(company_id,name,account_display_name,is_account) values ($1,'B bank','B',true) returning id`, [B])).rows[0].id
    await fails(as(U.owner, `select petty_issue($1,100,'2026-10-20','cash',$2,null,'x',null,null,null,$3)`, [ayub, bankB, uuid()]), /company's accounts/)
    const req = (await sup(`select id from petty_cash_requests where company_id=$1 limit 1`, [A])).rows[0].id
    await fails(as(U.ownerB, `select petty_decide_request($1,'approved',null,null,null)`, [req]), /not found/)
    const e = (await sup(`select id from petty_cash_entries where company_id=$1 limit 1`, [A])).rows[0].id
    await fails(as(U.ownerB, `select petty_reverse($1,'x')`, [e]), /not found/)
    await fails(as(U.empB, `insert into petty_cash_requests(company_id,employee_id,kind,amount,entry_date) values ($1,$2,'received',100,'2026-10-20')`, [A, ayub]), /row-level security/)
  })
  it('signed-out callers can do nothing', async () => {
    await fails(as(null, `select petty_wallet_balance($1)`, [ayub]), /permission denied/)
    await fails(as(null, `select * from petty_cash_entries`), /permission denied/)
  })
})

describe('test 10: payroll isolation', () => {
  it('issuing, settling, returning, reimbursing and reversing petty cash leaves every salary table untouched', async () => {
    const snap = async () => (await sup(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) h from (
      select 'l' || row(x.*)::text t from salary_ledger x union all select 'p' || row(x.*)::text from salary_payments x
      union all select 'a' || row(x.*)::text from salary_allocations x union all select 'v' || row(x.*)::text from employee_advances x
      union all select 'u' || row(x.*)::text from salary_audit x) s`)).rows[0].h
    const before = await snap()
    const emp = (await as(U.owner, `insert into employees(company_id,employee_no,full_name) values ($1,'P-010','Payroll Check') returning id`, [A])).rows[0].id
    const e = await issue(emp, 1000)
    const cl = await sup(`insert into expense_claims(company_id,employee_id,spent_on,description,amount,funded_by) values ($1,$2,'2026-10-26','Fuel',120,'petty_cash') returning id`, [A, emp])
    await decide(cl.rows[0].id)
    const pc = await sup(`insert into expense_claims(company_id,employee_id,spent_on,description,amount,funded_by) values ($1,$2,'2026-10-26','Taxi',30,'personal') returning id`, [A, emp])
    await decide(pc.rows[0].id)
    await as(U.owner, `select petty_reimburse($1,30,null,'cash',$2,null,null,$3)`, [emp, cash, uuid()])
    await as(U.owner, `select petty_record_return($1,80,null,'cash',$2,null,null,$3)`, [emp, cash, uuid()])
    await as(U.owner, `select petty_adjust($1,-5,null,'Counted short',$2)`, [emp, uuid()])
    expect(await balance(emp)).toBe(795)
    await fails(as(U.owner, `select petty_reverse($1,'wrong amount')`, [e]), /below zero/)    // most of it is spent: cannot simply undo
    expect(await snap()).toBe(before)
    const fns = (await sup(`select string_agg(prosrc, ' ') s from pg_proc where proname like 'petty%'`)).rows[0].s as string
    expect(fns).not.toMatch(/salary|payslip|employee_advances/)
  })
})

describe('corrections, reversals, project allocation, cash flow', () => {
  it('a reversal posts an opposite row (once), reverses the company cash, and the original row stays', async () => {
    const emp = (await as(U.owner, `insert into employees(company_id,employee_no,full_name) values ($1,'P-011','Reversal Test') returning id`, [A])).rows[0].id
    const c0 = await cashOut()
    const e = await issue(emp, 500, { project })
    expect(await cashOut() - c0).toBe(-500)
    const r1 = await as(U.acc, `select petty_reverse($1,'Entered twice') id`, [e]), r2 = await as(U.owner, `select petty_reverse($1,'again') id`, [e])
    expect(r1.rows[0].id).toBe(r2.rows[0].id)
    expect(await balance(emp)).toBe(0)
    expect(await cashOut() - c0).toBe(0)
    expect((await sup(`select count(*) n from petty_cash_entries where employee_id=$1`, [emp])).rows[0].n).toBe('2')
    await fails(as(U.owner, `select petty_reverse($1,'x')`, [r1.rows[0].id]), /cannot be reversed/)
    await fails(as(U.owner, `select petty_reverse($1,'')`, [e]), /reason/)
  })
  it('adjustments need a reason and never take the wallet below zero', async () => {
    await fails(as(U.owner, `select petty_adjust($1,10,null,'',$2)`, [sara, uuid()]), /reason/)
    const b = await balance(sara)
    await fails(as(U.owner, `select petty_adjust($1,$2,null,'too much',$3)`, [sara, -(b + 1), uuid()]), /below zero/)
    await as(U.owner, `select petty_adjust($1,25,null,'Found in the box',$2)`, [sara, uuid()])
    expect(await balance(sara)).toBe(b + 25)
  })
  it('a settled expense keeps its project; the settlement row carries the project too', async () => {
    const cl = await claim(U.ayub, ayub, 60, 'petty_cash', { project })
    const exp = await decide(cl)
    expect((await sup(`select project_id from project_expenses where id=$1`, [exp])).rows[0].project_id).toBe(project)
    expect((await sup(`select project_id from petty_cash_entries where claim_id=$1`, [cl])).rows[0].project_id).toBe(project)
  })
  it('earlier claims (no payment source) and company-paid claims work exactly as before', async () => {
    const n0 = Number((await sup(`select count(*) n from petty_cash_entries`)).rows[0].n)
    const old = await claim(U.ayub, ayub, 33, null), co = await claim(U.ayub, ayub, 44, 'company')
    const e1 = await decide(old, 'approved', { bank }), e2 = await decide(co, 'approved', { bank })
    expect((await sup(`select paid_from_bank_id from project_expenses where id=$1`, [e1])).rows[0].paid_from_bank_id).toBe(bank)
    expect((await sup(`select paid_from_bank_id from project_expenses where id=$1`, [e2])).rows[0].paid_from_bank_id).toBe(bank)
    expect(Number((await sup(`select count(*) n from petty_cash_entries`)).rows[0].n)).toBe(n0)
    await fails(as(U.owner, `select petty_settle_claim($1,10,0,'x')`, [co]), /paid by the company/)
  })
  it('a company-card claim cannot be marked as petty cash or personal money', async () => {
    const card = (await as(U.owner, `insert into company_cards(company_id,label,last4) values ($1,'Fuel card','4242') returning id`, [A]).catch(() => ({ rows: [] }))).rows[0]?.id
    if (!card) return
    await fails(sup(`insert into expense_claims(company_id,employee_id,spent_on,description,amount,paid_with,card_id,funded_by) values ($1,$2,'2026-10-20','Fuel',50,'card',$3,'petty_cash')`, [A, ayub, card]), /card_funded/)
  })
  it('the statement can be logged for WhatsApp sharing only by petty cash managers', async () => {
    expect((await as(U.owner, `select share_kind_allowed('petty_cash_statement') ok`)).rows[0].ok).toBe(true)
    expect((await as(U.ayub, `select share_kind_allowed('petty_cash_statement') ok`)).rows[0].ok).toBe(false)
    expect((await as(U.hr, `select share_kind_allowed('petty_cash_statement') ok`)).rows[0].ok).toBe(false)
  })
  it('every ledger row is audited', async () => {
    const n = Number((await sup(`select count(*) n from petty_cash_entries where company_id=$1`, [A])).rows[0].n)
    const a = Number((await sup(`select count(*) n from audit_logs where table_name='petty_cash_entries' and company_id=$1`, [A])).rows[0].n)
    expect(a).toBe(n)
  })
})
