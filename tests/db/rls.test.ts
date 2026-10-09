import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { ROLE_PERMISSIONS, ROLES } from '@/lib/permissions'
import { canTransition } from '@/lib/cheques'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL not set — run via `npm run test:db`')
const pool = new pg.Pool({ connectionString: url })

/** Run SQL as a Supabase-style `authenticated` user (RLS applies). Each call is its own transaction. */
async function as(uid: string | null, sql: string, params: unknown[] = [], role = 'authenticated') {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query(`set local role ${role}`)
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ''])
    const r = await c.query(sql, params)
    await c.query('commit')
    return r
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    c.release()
  }
}
const sup = (sql: string, p: unknown[] = []) => pool.query(sql, p)
const fails = async (p: Promise<unknown>, re?: RegExp) => {
  let err: Error | null = null
  try { await p } catch (e) { err = e as Error }
  expect(err, 'expected the statement to fail').not.toBeNull()
  if (re) expect(err!.message).toMatch(re)
}
const uuid = () => crypto.randomUUID()

const U = { ownerA: uuid(), ownerB: uuid(), hrA: uuid(), accA: uuid(), pmA: uuid(), viewerA: uuid(), empA: uuid() }
let A: string, B: string
let empRecA: string, empRecA2: string, docEmpPassport: string, docCompany: string, docOwn: string, chequeA: string, chequeB: string

beforeAll(async () => {
  for (const [k, id] of Object.entries(U)) await sup('insert into auth.users(id,email) values ($1,$2)', [id, `${k}@test.local`])
  A = (await as(U.ownerA, `select create_company_with_owner('Al Saqr Steels','Owner A') id`)).rows[0].id
  B = (await as(U.ownerB, `select create_company_with_owner('Rival Co','Owner B') id`)).rows[0].id
  const add = (id: string, role: string) =>
    sup('insert into profiles(id,company_id,full_name,role) values ($1,$2,$3,$4)', [id, A, role, role])
  await add(U.hrA, 'hr_manager'); await add(U.accA, 'accountant'); await add(U.pmA, 'project_manager')
  await add(U.viewerA, 'viewer'); await add(U.empA, 'employee')

  empRecA = (await as(U.hrA, `insert into employees(company_id,employee_no,full_name,user_id) values ($1,'E-001','Mohammed Ali',$2) returning id`, [A, U.empA])).rows[0].id
  empRecA2 = (await as(U.hrA, `insert into employees(company_id,employee_no,full_name) values ($1,'E-002','Rahim Uddin') returning id`, [A])).rows[0].id
  await as(U.hrA, `insert into employee_compensation(employee_id,company_id,monthly_salary) values ($1,$2,2500)`, [empRecA, A])
  docEmpPassport = (await as(U.hrA, `insert into documents(company_id,owner_type,owner_id,name,expiry_date) values ($1,'employee',$2,'Passport','2027-01-01') returning id`, [A, empRecA2])).rows[0].id
  docOwn = (await as(U.hrA, `insert into documents(company_id,owner_type,owner_id,name,expiry_date) values ($1,'employee',$2,'Emirates ID','2027-02-01') returning id`, [A, empRecA])).rows[0].id
  docCompany = (await as(U.ownerA, `insert into documents(company_id,name,expiry_date) values ($1,'Trade License','2027-03-01') returning id`, [A])).rows[0].id
  chequeA = (await as(U.accA, `insert into cheques(company_id,cheque_no,direction,party_name,bank_name,amount,cheque_date,status) values ($1,'100001','outgoing','ABC Trading','ENBD',15000,'2026-10-20','issued') returning id`, [A])).rows[0].id
  chequeB = (await as(U.ownerB, `insert into cheques(company_id,cheque_no,direction,party_name,bank_name,amount,cheque_date,status) values ($1,'900','incoming','Client','ADCB',500,'2026-10-20','received') returning id`, [B])).rows[0].id
})
afterAll(() => pool.end())

describe('onboarding', () => {
  it('seeds categories and an owner profile', async () => {
    const r = await as(U.ownerA, 'select count(*)::int n from document_categories')
    expect(r.rows[0].n).toBe(23)
    const p = await as(U.ownerA, 'select role from profiles where id = auth.uid()')
    expect(p.rows[0].role).toBe('company_owner')
  })
  it('refuses a second company for the same user', async () => {
    await fails(as(U.ownerA, `select create_company_with_owner('Again','x')`), /already belongs/)
  })
  it('anon cannot call onboarding', async () => {
    await fails(as(null, `select create_company_with_owner('x y','z')`, [], 'anon'), /permission denied/)
  })
})

describe('tenant isolation', () => {
  it('company B sees none of company A data', async () => {
    for (const t of ['employees', 'documents', 'cheques', 'employee_compensation', 'document_categories', 'audit_logs', 'profiles']) {
      const r = await as(U.ownerB, `select count(*)::int n from ${t} where company_id = $1`, [A])
      expect(r.rows[0].n, t).toBe(0)
    }
  })
  it("B cannot insert rows into A's tenant", async () => {
    await fails(as(U.ownerB, `insert into cheques(company_id,cheque_no,direction,party_name,bank_name,amount,cheque_date,status) values ($1,'x','incoming','p','b',1,'2026-01-01','received')`, [A]), /row-level security/)
  })
  it("B cannot update or delete A's rows (0 rows affected)", async () => {
    const u = await as(U.ownerB, `update cheques set notes='pwned' where id = $1`, [chequeA])
    expect(u.rowCount).toBe(0)
    const d = await as(U.ownerB, `delete from employees where id = $1`, [empRecA])
    expect(d.rowCount).toBe(0)
  })
  it('B cannot re-parent its own row into A', async () => {
    await fails(as(U.ownerB, `update cheques set company_id = $1 where id = $2`, [A, chequeB]), /row-level security/)
  })
  it('anon sees nothing / is denied', async () => {
    await fails(as(null, 'select * from employees', [], 'anon'), /permission denied/)
  })
})

describe('permissions: salary & sensitive HR data enforced in the database', () => {
  it('salary visible to HR, accountant, owner only', async () => {
    for (const [u, n] of [[U.hrA, 1], [U.accA, 1], [U.ownerA, 1], [U.pmA, 0], [U.viewerA, 0], [U.empA, 0]] as const) {
      const r = await as(u, 'select count(*)::int n from employee_compensation')
      expect(r.rows[0].n, u).toBe(n)
    }
  })
  it('project manager sees employee list but cannot edit employees', async () => {
    expect((await as(U.pmA, 'select count(*)::int n from employees')).rows[0].n).toBe(2)
    await fails(as(U.pmA, `insert into employees(company_id,employee_no,full_name) values ($1,'E-9','Nope Nope')`, [A]), /row-level security/)
    expect((await as(U.pmA, `update employees set designation='x' where id=$1`, [empRecA])).rowCount).toBe(0)
  })
  it('employee role sees only their own employee record', async () => {
    const r = await as(U.empA, 'select id from employees')
    expect(r.rows.map(x => x.id)).toEqual([empRecA])
  })
  it('employee documents are hidden from non-HR roles; employee sees only own', async () => {
    expect((await as(U.pmA, `select count(*)::int n from documents where owner_type='employee'`)).rows[0].n).toBe(0)
    expect((await as(U.accA, `select count(*)::int n from documents where owner_type='employee'`)).rows[0].n).toBe(0)
    expect((await as(U.hrA, `select count(*)::int n from documents where owner_type='employee'`)).rows[0].n).toBe(2)
    const own = await as(U.empA, 'select id from documents')
    expect(own.rows.map(x => x.id)).toEqual([docOwn])
  })
  it('viewer can read company docs but not write', async () => {
    expect((await as(U.viewerA, `select count(*)::int n from documents where owner_type='company'`)).rows[0].n).toBe(1)
    await fails(as(U.viewerA, `insert into documents(company_id,name) values ($1,'x')`, [A]), /row-level security/)
    expect((await as(U.viewerA, `update documents set name='x' where id=$1`, [docCompany])).rowCount).toBe(0)
  })
  it('only the owner can read audit logs', async () => {
    expect((await as(U.pmA, 'select count(*)::int n from audit_logs')).rows[0].n).toBe(0)
    expect((await as(U.ownerA, 'select count(*)::int n from audit_logs')).rows[0].n).toBeGreaterThan(0)
  })
})

describe('documents: no permanent deletion, immutable versions', () => {
  it('hard delete is impossible for every role', async () => {
    for (const u of [U.ownerA, U.hrA]) expect((await as(u, 'delete from documents where id=$1', [docCompany])).rowCount).toBe(0)
  })
  it('soft delete needs records.delete; recovery works for owner', async () => {
    await fails(as(U.pmA, `update documents set deleted_at=now() where id=$1`, [docCompany]), /records\.delete/)
    await as(U.ownerA, `update documents set deleted_at=now(), deleted_by=auth.uid() where id=$1`, [docCompany])
    expect((await as(U.viewerA, `select count(*)::int n from documents where id=$1`, [docCompany])).rows[0].n).toBe(0)
    expect((await as(U.ownerA, `select count(*)::int n from documents where id=$1`, [docCompany])).rows[0].n).toBe(1)
    await as(U.ownerA, `update documents set deleted_at=null, deleted_by=null where id=$1`, [docCompany])
    expect((await as(U.viewerA, `select count(*)::int n from documents where id=$1`, [docCompany])).rows[0].n).toBe(1)
  })
  it('versions are append-only and cannot be updated or deleted', async () => {
    const v = (await as(U.ownerA, `insert into document_versions(company_id,document_id,version_no,storage_path,file_name,mime_type,size_bytes,sha256) values ($1,$2,1,'p/1','a.pdf','application/pdf',10,'abc') returning id`, [A, docCompany])).rows[0].id
    await as(U.ownerA, `insert into document_versions(company_id,document_id,version_no,storage_path,file_name,mime_type,size_bytes,sha256) values ($1,$2,2,'p/2','b.pdf','application/pdf',10,'def')`, [A, docCompany])
    expect((await as(U.ownerA, `update document_versions set file_name='evil' where id=$1`, [v])).rowCount).toBe(0)
    expect((await as(U.ownerA, `delete from document_versions where id=$1`, [v])).rowCount).toBe(0)
    await fails(as(U.ownerA, `insert into document_versions(company_id,document_id,version_no,storage_path,file_name,mime_type,size_bytes,sha256) values ($1,$2,2,'p/3','c.pdf','application/pdf',10,'x')`, [A, docCompany]), /duplicate key/)
  })
  it("a PM cannot attach versions to documents they cannot see", async () => {
    await fails(as(U.pmA, `insert into document_versions(company_id,document_id,version_no,storage_path,file_name,mime_type,size_bytes,sha256) values ($1,$2,1,'p','a','application/pdf',1,'h')`, [A, docEmpPassport]), /row-level security/)
  })
})

describe('cheques: status machine, manual clearing, permissions', () => {
  const ok = async (dir: string, a: string, b: string) =>
    (await sup('select cheque_transition_ok($1,$2,$3) ok', [dir, a, b])).rows[0].ok
  it('transition table', async () => {
    expect(await ok('incoming', 'received', 'deposited')).toBe(true)
    expect(await ok('incoming', 'deposited', 'cleared')).toBe(true)
    expect(await ok('incoming', 'received', 'cleared')).toBe(false)
    expect(await ok('incoming', 'cleared', 'returned')).toBe(false)
    expect(await ok('outgoing', 'issued', 'presented')).toBe(true)
    expect(await ok('outgoing', 'issued', 'deposited')).toBe(false)
    expect(await ok('outgoing', 'cancelled', 'issued')).toBe(false)
  })
  it('viewer / PM cannot see or manage cheques', async () => {
    expect((await as(U.viewerA, 'select count(*)::int n from cheques')).rows[0].n).toBe(0)
    expect((await as(U.pmA, 'select count(*)::int n from cheques')).rows[0].n).toBe(0)
    await fails(as(U.pmA, `update cheques set status='cleared' where id=$1`, [chequeA]).then(r => { if (r.rowCount === 0) throw new Error('0 rows') }))
  })
  it('rejects invalid transitions and wrong-direction statuses', async () => {
    await fails(as(U.accA, `update cheques set status='deposited' where id=$1`, [chequeA]), /check constraint|invalid cheque status/)
    await fails(as(U.accA, `update cheques set status='returned', direction='incoming' where id=$1`, [chequeA]), /direction cannot change/)
    await fails(as(U.accA, `insert into cheques(company_id,cheque_no,direction,party_name,bank_name,amount,cheque_date,status) values ($1,'x','incoming','p','b',5,'2026-01-01','cleared')`, [A]), /must start as/)
    await fails(as(U.accA, `insert into cheques(company_id,cheque_no,direction,party_name,bank_name,amount,cheque_date,status) values ($1,'x','incoming','p','b',0,'2026-01-01','received')`, [A]), /check constraint/)
  })
  it('clearing is a manual confirmation recorded against the user', async () => {
    await as(U.accA, `update cheques set status='presented' where id=$1`, [chequeA])
    await as(U.accA, `update cheques set status='cleared' where id=$1`, [chequeA])
    const r = await as(U.accA, 'select cleared_by, cleared_at from cheques where id=$1', [chequeA])
    expect(r.rows[0].cleared_by).toBe(U.accA)
    expect(r.rows[0].cleared_at).not.toBeNull()
    await fails(as(U.accA, `update cheques set status='returned' where id=$1`, [chequeA]), /invalid cheque status/)
  })
})

describe('profiles: no privilege escalation', () => {
  it('a PM cannot make themselves owner or change anyone else', async () => {
    await fails(as(U.pmA, `update profiles set role='company_owner' where id=$1`, [U.pmA]), /users\.manage/)
    expect((await as(U.pmA, `update profiles set role='viewer' where id=$1`, [U.viewerA])).rowCount).toBe(0)
  })
  it('PM can edit own non-privileged fields; owner can change roles; B cannot touch A', async () => {
    expect((await as(U.pmA, `update profiles set phone='+971500000000' where id=$1`, [U.pmA])).rowCount).toBe(1)
    expect((await as(U.ownerA, `update profiles set role='viewer' where id=$1`, [U.empA])).rowCount).toBe(1)
    await as(U.ownerA, `update profiles set role='employee' where id=$1`, [U.empA])
    expect((await as(U.ownerB, `update profiles set role='viewer' where id=$1`, [U.hrA])).rowCount).toBe(0)
  })
  it('owner cannot move a user to another company', async () => {
    await fails(as(U.ownerA, `update profiles set company_id=$1 where id=$2`, [B, U.viewerA]), /company/)
  })
})

describe('audit trail', () => {
  it('records updates with old/new, redacts salary values', async () => {
    await as(U.ownerA, `update employees set designation='Welder' where id=$1`, [empRecA])
    const a = await as(U.ownerA, `select changes from audit_logs where table_name='employees' and action='UPDATE' and record_id=$1 order by id desc limit 1`, [empRecA])
    expect(a.rows[0].changes.new.designation).toBe('Welder')
    await as(U.hrA, `update employee_compensation set monthly_salary=3100 where employee_id=$1`, [empRecA])
    const s = await sup(`select changes::text t from audit_logs where table_name='employee_compensation' order by id desc limit 1`)
    expect(s.rows[0].t).not.toContain('3100'); expect(s.rows[0].t).toContain('redacted')
  })
  it('is append-only for clients', async () => {
    await fails(as(U.ownerA, `insert into audit_logs(table_name,action) values ('x','y')`), /row-level security|permission/)
    expect((await as(U.ownerA, 'delete from audit_logs')).rowCount).toBe(0)
    expect((await as(U.ownerA, `update audit_logs set action='x'`)).rowCount).toBe(0)
  })
})

describe('notification queue', () => {
  const log = (key: string, extra = '') =>
    sup(`insert into notification_logs(company_id,channel,template,dedupe_key${extra ? ',' + extra.split('=')[0] : ''}) values ($1,'whatsapp','t',$2${extra ? ',' + extra.split('=')[1] : ''})`, [A, key])
  it('duplicate dedupe_key is rejected; ON CONFLICT DO NOTHING makes fan-out idempotent', async () => {
    await log('doc:1:30:2026-10-20:whatsapp:r1')
    await fails(log('doc:1:30:2026-10-20:whatsapp:r1'), /duplicate key/)
    const r = await sup(`insert into notification_logs(company_id,channel,template,dedupe_key) values ($1,'whatsapp','t','doc:1:30:2026-10-20:whatsapp:r1') on conflict do nothing`, [A])
    expect(r.rowCount).toBe(0)
  })
  it('same key in a different tenant is allowed', async () => {
    await sup(`insert into notification_logs(company_id,channel,template,dedupe_key) values ($1,'whatsapp','t','doc:1:30:2026-10-20:whatsapp:r1')`, [B])
  })
  it('clients cannot write logs; only reminder-permitted roles can read them', async () => {
    await fails(as(U.ownerA, `insert into notification_logs(company_id,channel,template,dedupe_key) values ($1,'whatsapp','t','k')`, [A]), /row-level security/)
    expect((await as(U.viewerA, 'select count(*)::int n from notification_logs')).rows[0].n).toBe(0)
    expect((await as(U.ownerA, 'select count(*)::int n from notification_logs')).rows[0].n).toBeGreaterThan(0)
    expect((await as(U.ownerB, 'select count(*)::int n from notification_logs where company_id=$1', [A])).rows[0].n).toBe(0)
  })
  it('claim_notifications is service-role only and claims each due row once', async () => {
    await fails(as(U.ownerA, 'select * from claim_notifications(10)'), /permission denied/)
    await sup(`insert into notification_logs(company_id,channel,template,dedupe_key,next_attempt_at) values ($1,'email','t','future', now() + interval '1 day')`, [A])
    const first = await as(null, 'select * from claim_notifications(100)', [], 'service_role')
    expect(first.rows.length).toBeGreaterThan(0)
    expect(first.rows.every(r => r.status === 'sending')).toBe(true)
    expect(first.rows.find(r => r.dedupe_key === 'future')).toBeUndefined()
    const second = await as(null, 'select * from claim_notifications(100)', [], 'service_role')
    expect(second.rows.length).toBe(0)
  })
})

describe('secrets & storage', () => {
  it('integration_secrets are invisible/unwritable to every client role', async () => {
    await sup(`insert into integration_secrets(company_id,name,ciphertext) values ($1,'whatsapp_token','xx')`, [A])
    expect((await as(U.ownerA, 'select count(*)::int n from integration_secrets')).rows[0].n).toBe(0)
    await fails(as(U.ownerA, `insert into integration_secrets(company_id,name,ciphertext) values ($1,'x','y')`, [A]), /row-level security/)
  })
  it('vault bucket is private; uploads limited to own company folder + permission; no client reads', async () => {
    expect((await sup(`select public from storage.buckets where id='vault'`)).rows[0].public).toBe(false)
    const ins = (u: string, folder: string) =>
      as(u, `insert into storage.objects(bucket_id,name) values ('vault', $1)`, [`${folder}/doc/v1-a.pdf`])
    await ins(U.hrA, A)
    await fails(ins(U.hrA, B), /row-level security/)       // cross-tenant path
    await fails(ins(U.viewerA, A), /row-level security/)    // lacks documents.upload
    expect((await as(U.ownerA, `select count(*)::int n from storage.objects`)).rows[0].n).toBe(0)
  })
})

describe('reminder_sources view honours RLS', () => {
  it('shows cheques to accountants but not PMs; employee docs to HR but not accountants', async () => {
    const q = (u: string, t: string) => as(u, `select count(*)::int n from reminder_sources where source_type=$1`, [t]).then(r => r.rows[0].n)
    expect(await q(U.accA, 'cheque')).toBe(0)   // chequeA already cleared → excluded
    await sup(`insert into cheques(company_id,cheque_no,direction,party_name,bank_name,amount,cheque_date,status) values ($1,'777','incoming','C','B',9,'2026-11-01','received')`, [A])
    expect(await q(U.accA, 'cheque')).toBe(1)
    expect(await q(U.pmA, 'cheque')).toBe(0)
    expect(await q(U.ownerB, 'cheque')).toBe(1)  // only B's own
    const hrDocs = (await as(U.hrA, `select count(*)::int n from reminder_sources where source_type='document'`)).rows[0].n
    const accDocs = (await as(U.accA, `select count(*)::int n from reminder_sources where source_type='document'`)).rows[0].n
    expect(hrDocs).toBe(3); expect(accDocs).toBe(1)
  })
})

describe('TypeScript ↔ SQL parity (prevents UI/DB drift)', () => {
  it('role_permissions table equals lib/permissions.ts', async () => {
    const rows = (await sup('select role::text, permission from role_permissions')).rows
    for (const role of ROLES) {
      const db = rows.filter(r => r.role === role).map(r => r.permission).sort()
      expect(db, role).toEqual([...ROLE_PERMISSIONS[role]].sort())
    }
  })
  it('cheque transition function equals lib/cheques.ts for every combination', async () => {
    const st = ['received', 'issued', 'scheduled', 'deposited', 'presented', 'cleared', 'returned', 'cancelled'] as const
    for (const dir of ['incoming', 'outgoing'] as const) for (const a of st) for (const b of st) {
      const db = (await sup('select cheque_transition_ok($1,$2,$3) ok', [dir, a, b])).rows[0].ok
      expect(canTransition(dir, a, b), `${dir} ${a}->${b}`).toBe(db)
    }
  })
})

describe('Smart Inbox (0007): privacy of unfiled uploads, no deletes, relationships', () => {
  const ins = (u: string, extra = '') => as(u, `insert into document_inbox(company_id,uploaded_by,storage_path,file_name,mime_type,size_bytes,sha256${extra ? ',status' : ''}) values ($1, auth.uid(), 'p', 'passport.pdf', 'application/pdf', 10, 'h'${extra ? `,'${extra}'` : ''}) returning id`, [A])
  let pmItem: string, hrItem: string
  it('uploader must have documents.upload and can only insert as themselves', async () => {
    pmItem = (await ins(U.pmA)).rows[0].id
    hrItem = (await ins(U.hrA)).rows[0].id
    await fails(ins(U.viewerA), /row-level security/)
    await fails(as(U.pmA, `insert into document_inbox(company_id,uploaded_by,storage_path,file_name,mime_type,size_bytes,sha256) values ($1,$2,'p','x.pdf','application/pdf',1,'h')`, [A, U.hrA]), /row-level security/)
  })
  it('unfiled uploads (may hold passports) are visible to the uploader and HR/owner only', async () => {
    expect((await as(U.pmA, 'select id from document_inbox')).rows.map(r => r.id)).toEqual([pmItem])
    expect((await as(U.hrA, 'select count(*)::int n from document_inbox')).rows[0].n).toBe(2)
    expect((await as(U.ownerA, 'select count(*)::int n from document_inbox')).rows[0].n).toBe(2)
    expect((await as(U.accA, 'select count(*)::int n from document_inbox')).rows[0].n).toBe(0)
    expect((await as(U.ownerB, 'select count(*)::int n from document_inbox')).rows[0].n).toBe(0)
  })
  it('a PM cannot change someone else’s upload; nobody can delete', async () => {
    expect((await as(U.pmA, `update document_inbox set status='rejected' where id=$1`, [hrItem])).rowCount).toBe(0)
    expect((await as(U.ownerA, 'delete from document_inbox')).rowCount).toBe(0)
  })
  it('extractions (document text) follow the inbox item visibility', async () => {
    await as(U.hrA, `insert into document_extractions(company_id,inbox_id,engine,engine_version,doc_type,doc_type_confidence,text_excerpt) values ($1,$2,'rules','t','passport',0.9,'P<IND...')`, [A, hrItem])
    expect((await as(U.pmA, 'select count(*)::int n from document_extractions')).rows[0].n).toBe(0)
    expect((await as(U.hrA, 'select count(*)::int n from document_extractions')).rows[0].n).toBe(1)
    await fails(as(U.pmA, `insert into document_extractions(company_id,inbox_id,engine,engine_version,doc_type,doc_type_confidence) values ($1,$2,'rules','t','x',0.1)`, [A, hrItem]), /row-level security/)
  })
  it('inbox changes are audit-logged; extraction text is not copied into the audit log', async () => {
    const a = await sup(`select count(*)::int n from audit_logs where table_name='document_inbox'`)
    expect(a.rows[0].n).toBeGreaterThanOrEqual(2)
    expect((await sup(`select count(*)::int n from audit_logs where table_name='document_extractions'`)).rows[0].n).toBe(0)
  })
  it('documents can be archived; relationships respect document visibility', async () => {
    await as(U.ownerA, `update documents set status='archived' where id=$1`, [docCompany])
    await as(U.ownerA, `update documents set status='active' where id=$1`, [docCompany])
    await as(U.hrA, `insert into document_relationships(company_id,document_id,related_type,related_id) values ($1,$2,'employee',$3)`, [A, docEmpPassport, empRecA2])
    expect((await as(U.hrA, 'select count(*)::int n from document_relationships')).rows[0].n).toBe(1)
    expect((await as(U.pmA, 'select count(*)::int n from document_relationships')).rows[0].n).toBe(0)   // PM can't see employee ID docs, so not their links either
    await fails(as(U.viewerA, `insert into document_relationships(company_id,document_id,related_type) values ($1,$2,'company')`, [A, docCompany]), /row-level security/)
  })
  it('learned category mappings are per company', async () => {
    const cat = (await as(U.ownerA, `select id from document_categories where name='Trade License'`)).rows[0].id
    await as(U.ownerA, `insert into document_type_mappings(company_id,doc_type,category_id) values ($1,'trade_license',$2)`, [A, cat])
    expect((await as(U.ownerB, 'select count(*)::int n from document_type_mappings')).rows[0].n).toBe(0)
  })
})

describe('Sales documents, payments & projects (0008)', () => {
  let inv: string, qtn: string
  it('numbers documents per company, type and year without gaps', async () => {
    const n1 = (await as(U.accA, `select next_document_number('quotation') n`)).rows[0].n
    const n2 = (await as(U.accA, `select next_document_number('quotation') n`)).rows[0].n
    const i1 = (await as(U.accA, `select next_document_number('invoice') n`)).rows[0].n
    const b1 = (await as(U.ownerB, `select next_document_number('quotation') n`)).rows[0].n
    const yr = new Date().getFullYear()
    expect(n1).toBe(`AS-002600/${yr}`); expect(n2).toBe(`AS-002601/${yr}`); expect(i1).toBe('INV-610'); expect(b1).toBe(`AS-002600/${yr}`)
    await fails(as(U.viewerA, `select next_document_number('invoice')`), /insufficient privilege/)
    await fails(as(U.accA, `select next_document_number('bogus')`), /unknown document type/)
  })
  it('AS numbering: configurable by settings.manage only, skips numbers already used, continues across years', async () => {
    const yr = new Date().getFullYear()
    await fails(as(U.accA, `update document_number_formats set next_seq = 1 where doc_type='quotation' returning *`).then(r => { if (!r.rowCount) throw new Error('blocked') }))
    await as(U.ownerA, `update document_number_formats set next_seq = 30000 where doc_type='quotation'`)
    await as(U.accA, `insert into invoices(company_id,doc_type,number) values ($1,'quotation',$2)`, [A, `AS-030000/${yr}`])   // e.g. typed by hand earlier
    expect((await as(U.accA, `select next_document_number('quotation') n`)).rows[0].n).toBe(`AS-030001/${yr}`)
    await sup(`update document_number_formats set last_year = last_year - 1 where company_id=$1 and doc_type='quotation'`, [A])  // simulate a new year
    expect((await as(U.accA, `select next_document_number('quotation') n`)).rows[0].n).toBe(`AS-030002/${yr}`)
    expect((await sup(`select format_document_number('AS','00',5,7,'/',2027) n`)).rows[0].n).toBe('AS0000007/2027')
    expect((await sup(`select format_document_number_v2('AS','-','',6,7,'/','yy',2027) n`)).rows[0].n).toBe('AS-000007/27')
    expect((await sup(`select next_seq::int n from document_number_formats where company_id=$1 and doc_type='invoice'`, [A])).rows[0].n).toBe(611)   // invoices keep their own INV- series
  })
  it('payments: only on issued invoices, never above the balance; status follows the money', async () => {
    qtn = (await as(U.accA, `insert into invoices(company_id,doc_type,number,total,status) values ($1,'quotation','QTN-T-1',1050,'sent') returning id`, [A])).rows[0].id
    inv = (await as(U.accA, `insert into invoices(company_id,doc_type,number,total,status,due_date,quotation_id) values ($1,'invoice','INV-T-1',1050,'draft','2099-01-01',$2) returning id`, [A, qtn])).rows[0].id
    await as(U.accA, `insert into invoice_items(company_id,invoice_id,description,quantity,unit_price) values ($1,$2,'Staircase',1,1000)`, [A, inv])
    await fails(as(U.accA, `insert into payments(company_id,invoice_id,amount) values ($1,$2,100)`, [A, inv]), /issue the invoice/)
    await fails(as(U.accA, `insert into payments(company_id,invoice_id,amount) values ($1,$2,100)`, [A, qtn]), /tax invoices/)
    await as(U.accA, `update invoices set status='sent' where id=$1`, [inv])
    await as(U.accA, `insert into payments(company_id,invoice_id,amount,method) values ($1,$2,400,'cash')`, [A, inv])
    const st = async () => (await as(U.accA, `select i.status, b.paid, b.balance from invoices i join invoice_balances b on b.id=i.id where i.id=$1`, [inv])).rows[0]
    expect(await st()).toMatchObject({ status: 'partially_paid', paid: '400.00', balance: '650.00' })
    await fails(as(U.accA, `insert into payments(company_id,invoice_id,amount) values ($1,$2,700)`, [A, inv]), /exceeds the invoice balance/)
    const p2 = (await as(U.accA, `insert into payments(company_id,invoice_id,amount,method) values ($1,$2,650,'bank_transfer') returning id`, [A, inv])).rows[0].id
    expect((await st()).status).toBe('paid')
    await as(U.ownerA, `delete from payments where id=$1`, [p2])
    expect((await st()).status).toBe('partially_paid')
  })
  it('a payment cannot point at another company’s invoice', async () => {
    const binv = (await as(U.ownerB, `insert into invoices(company_id,doc_type,number,total,status) values ($1,'invoice','B-1',500,'sent') returning id`, [B])).rows[0].id
    await fails(as(U.accA, `insert into payments(company_id,invoice_id,amount) values ($1,$2,10)`, [A, binv]))
  })
  it('overdue job and reminders: unpaid balance surfaces, paid invoices drop out', async () => {
    const late = (await as(U.accA, `insert into invoices(company_id,doc_type,number,total,status,due_date) values ($1,'invoice','INV-T-LATE',300,'sent','2020-01-01') returning id`, [A])).rows[0].id
    await fails(as(U.accA, `select mark_overdue_invoices()`))
    await sup(`select mark_overdue_invoices()`)
    expect((await as(U.accA, `select status from invoices where id=$1`, [late])).rows[0].status).toBe('overdue')
    const src = (await as(U.accA, `select source_id, amount from reminder_sources where source_type='invoice'`)).rows
    expect(src.find(r => r.source_id === late)?.amount).toBe('300.00')
    expect(src.find(r => r.source_id === inv)?.amount).toBe('650.00')
  })
  it('line items, costs and milestones are tenant-isolated; costs need finance access', async () => {
    expect((await as(U.ownerB, `select count(*)::int n from invoice_items`)).rows[0].n).toBe(0)
    expect((await as(U.viewerA, `select count(*)::int n from invoice_items`)).rows[0].n).toBe(0)   // invoices hidden → items hidden
    const prj = (await as(U.pmA, `insert into projects(company_id,name,contract_value) values ($1,'Villa 22 staircase',100000) returning id`, [A])).rows[0].id
    await as(U.accA, `insert into project_expenses(company_id,project_id,category,description,amount) values ($1,$2,'material','MS hollow section',4000)`, [A, prj])
    await fails(as(U.accA, `insert into project_expenses(company_id,project_id,category,description,amount) values ($1,$2,'material','neg',-1)`, [A, prj]))
    expect((await as(U.pmA, `select count(*)::int n from project_expenses`)).rows[0].n).toBe(0)
    expect((await as(U.ownerB, `select count(*)::int n from project_expenses`)).rows[0].n).toBe(0)
    await as(U.pmA, `insert into project_milestones(company_id,project_id,title,due_date) values ($1,$2,'Delivery to site',current_date + 3)`, [A, prj])
    expect((await as(U.viewerA, `select count(*)::int n from reminder_sources where source_type='milestone'`)).rows[0].n).toBe(1)
    await fails(as(U.viewerA, `insert into project_milestones(company_id,project_id,title,due_date) values ($1,$2,'x',current_date)`, [A, prj]))
    expect((await as(U.ownerA, `select count(*)::int n from audit_logs where table_name in ('project_expenses','invoice_items')`)).rows[0].n).toBeGreaterThan(0)
  })
})

describe('AI document reader logs (0009)', () => {
  it('OCR / AI logs: insert as yourself only, append-only, admins see usage, other companies see nothing', async () => {
    await as(U.hrA, `insert into ocr_logs(company_id,provider,ok,chars,created_by) values ($1,'ocrspace',true,120,$2)`, [A, U.hrA])
    await as(U.hrA, `insert into ai_processing_logs(company_id,provider,model,purpose,ok,input_chars,redacted,created_by) values ($1,'gemini','gemini-2.5-flash','classify',true,900,true,$2)`, [A, U.hrA])
    await fails(as(U.hrA, `insert into ocr_logs(company_id,provider,ok,created_by) values ($1,'ocrspace',true,$2)`, [A, U.ownerA]))      // impersonation
    await fails(as(U.viewerA, `insert into ocr_logs(company_id,provider,ok,created_by) values ($1,'ocrspace',true,$2)`, [A, U.viewerA])) // no upload permission
    await fails(as(U.hrA, `insert into ai_processing_logs(company_id,provider,purpose,ok,created_by) values ($1,'gemini','other',true,$2)`, [A, U.hrA]))
    expect((await as(U.ownerA, `update ocr_logs set ok=false returning id`)).rowCount).toBe(0)
    expect((await as(U.ownerA, `delete from ai_processing_logs returning id`)).rowCount).toBe(0)
    const usage = (await as(U.ownerA, `select kind,provider,calls,volume from ai_usage_daily order by kind`)).rows
    expect(usage).toEqual([{ kind: 'ai', provider: 'gemini', calls: 1, volume: '900' }, { kind: 'ocr', provider: 'ocrspace', calls: 1, volume: '120' }])
    expect((await as(U.ownerB, `select count(*)::int n from ai_usage_daily`)).rows[0].n).toBe(0)
    expect((await as(U.viewerA, `select count(*)::int n from ocr_logs`)).rows[0].n).toBe(0)
  })
  it('inbox life-cycle statuses and the payment relationship type are accepted', async () => {
    const id = (await as(U.hrA, `insert into document_inbox(company_id,uploaded_by,storage_path,file_name,mime_type,size_bytes,sha256,status) values ($1,$2,'x/y.pdf','y.pdf','application/pdf',10,'abc','uploaded') returning id`, [A, U.hrA])).rows[0].id
    for (const s of ['processing', 'ocr_complete', 'classification_complete', 'needs_review']) await as(U.hrA, `update document_inbox set status=$2 where id=$1`, [id, s])
    await fails(as(U.hrA, `update document_inbox set status='bogus' where id=$1`, [id]))
    await as(U.hrA, `insert into document_relationships(company_id,document_id,related_type,related_id) values ($1,$2,'payment',gen_random_uuid())`, [A, docCompany])
  })
})

describe('ERP workflow (0012)', () => {
  it('concurrent numbering from two sessions never duplicates (Test C)', async () => {
    const nums = await Promise.all(Array.from({ length: 12 }, (_, i) => as(i % 2 ? U.accA : U.ownerA, `select next_document_number('quotation') n`).then(r => r.rows[0].n as string)))
    expect(new Set(nums).size).toBe(12)
    for (const n of nums) expect(n).toMatch(/^AS-\d{6}\/\d{4}$/)
  })
  it('project references and optional year', async () => {
    expect((await as(U.accA, `select next_document_number('project') n`)).rows[0].n).toMatch(/^PRJ-\d{4}-0001$/)
    expect((await sup(`select format_document_number('P','',4,12,'/',null) n`)).rows[0].n).toBe('P0012')
  })
  it('one idempotency key → one invoice / one payment (double-click protection, Test D)', async () => {
    const tok = uuid()
    await as(U.accA, `insert into invoices(company_id,doc_type,number,client_token) values ($1,'quotation','QT-IDEM-1',$2)`, [A, tok])
    await fails(as(U.accA, `insert into invoices(company_id,doc_type,number,client_token) values ($1,'quotation','QT-IDEM-2',$2)`, [A, tok]), /duplicate key/)
    const i = (await as(U.accA, `insert into invoices(company_id,doc_type,number,total,status,due_date) values ($1,'invoice','INV-IDEM',500,'sent','2099-01-01') returning id`, [A])).rows[0].id
    const k = uuid()
    await as(U.accA, `insert into payments(company_id,invoice_id,amount,idempotency_key) values ($1,$2,100,$3)`, [A, i, k])
    await fails(as(U.accA, `insert into payments(company_id,invoice_id,amount,idempotency_key) values ($1,$2,100,$3)`, [A, i, k]), /duplicate key/)
    expect((await as(U.accA, `select paid from invoice_balances where id=$1`, [i])).rows[0].paid).toBe('100.00')
  })
  it('credit notes reduce the balance, never exceed it, and drive the status', async () => {
    const i = (await as(U.accA, `insert into invoices(company_id,doc_type,number,total,status,due_date) values ($1,'invoice','INV-CN',1000,'sent','2099-01-01') returning id`, [A])).rows[0].id
    await as(U.accA, `insert into payments(company_id,invoice_id,amount) values ($1,$2,600)`, [A, i])
    const cn = (await as(U.accA, `insert into invoices(company_id,doc_type,number,total,status,source_invoice_id) values ($1,'credit_note','CN-1',500,'draft',$2) returning id`, [A, i])).rows[0].id
    await fails(as(U.accA, `update invoices set status='sent' where id=$1`, [cn]), /exceeds the invoice balance/)
    await as(U.accA, `update invoices set total=400, status='sent' where id=$1`, [cn])
    const b = (await as(U.accA, `select i.status, b.balance, b.credited from invoices i join invoice_balances b on b.id=i.id where i.id=$1`, [i])).rows[0]
    expect(b).toMatchObject({ status: 'paid', balance: '0.00', credited: '400.00' })
    await fails(as(U.accA, `insert into payments(company_id,invoice_id,amount) values ($1,$2,1)`, [A, i]), /exceeds/)
    await as(U.accA, `update invoices set status='cancelled' where id=$1`, [cn])
    expect((await as(U.accA, `select status from invoices where id=$1`, [i])).rows[0].status).toBe('partially_paid')
  })
  it('a cheque settles an invoice only once', async () => {
    const i = (await as(U.accA, `insert into invoices(company_id,doc_type,number,total,status,due_date) values ($1,'invoice','INV-CHQ',1000,'sent','2099-01-01') returning id`, [A])).rows[0].id
    const q = (await as(U.accA, `insert into cheques(company_id,cheque_no,direction,party_name,bank_name,amount,cheque_date,status,invoice_id) values ($1,'777','incoming','Client','ENBD',400,'2026-10-20','received',$2) returning id`, [A, i])).rows[0].id
    await as(U.accA, `insert into payments(company_id,invoice_id,amount,cheque_id,method) values ($1,$2,400,$3,'cheque')`, [A, i, q])
    await fails(as(U.accA, `insert into payments(company_id,invoice_id,amount,cheque_id,method) values ($1,$2,400,$3,'cheque')`, [A, i, q]), /duplicate key/)
  })
  it('trash: soft-deleted rows disappear everywhere, restore brings them back, purge is owner-only', async () => {
    const cu = (await as(U.accA, `insert into customers(company_id,name) values ($1,'Trash Test LLC') returning id`, [A])).rows[0].id
    await fails(as(U.accA, `select soft_delete('customer',$1)`, [cu]), /insufficient privilege/)   // accountant has no records.delete
    await as(U.ownerA, `select soft_delete('customer',$1)`, [cu])
    expect((await as(U.ownerA, `select count(*)::int n from customers where id=$1`, [cu])).rows[0].n).toBe(0)
    expect((await as(U.ownerA, `select entity from trash_list() where id=$1`, [cu])).rows[0].entity).toBe('customer')
    await fails(as(U.accA, `select * from trash_list()`), /insufficient privilege/)
    await as(U.ownerA, `select restore_deleted('customer',$1)`, [cu])
    expect((await as(U.accA, `select name from customers where id=$1`, [cu])).rows[0].name).toBe('Trash Test LLC')
    await fails(as(U.ownerA, `select purge_deleted('customer',$1)`, [cu]), /not found in trash/)   // must be in trash first
    await as(U.ownerA, `select soft_delete('customer',$1)`, [cu])
    await as(U.ownerA, `select purge_deleted('customer',$1)`, [cu])
    expect((await sup(`select count(*)::int n from customers where id=$1`, [cu])).rows[0].n).toBe(0)
    const actions = (await sup(`select action from audit_logs where record_id=$1 and action in ('TRASH','RESTORE','PURGE') order by id`, [cu])).rows.map(r => r.action)
    expect(actions).toEqual(['TRASH', 'RESTORE', 'TRASH', 'PURGE'])
  })
  it('issued invoices with payments cannot be trashed; drafts can', async () => {
    const d = (await as(U.accA, `insert into invoices(company_id,doc_type,number) values ($1,'invoice','INV-DRAFT-T') returning id`, [A])).rows[0].id
    const s = (await as(U.accA, `insert into invoices(company_id,doc_type,number,status,total) values ($1,'invoice','INV-SENT-T','sent',10) returning id`, [A])).rows[0].id
    await fails(as(U.ownerA, `select soft_delete('invoice',$1)`, [s]), /only draft or cancelled/)
    await as(U.ownerA, `select soft_delete('invoice',$1)`, [d])
    expect((await as(U.accA, `select count(*)::int n from invoices where id=$1`, [d])).rows[0].n).toBe(0)
  })
  it('partial delivery: delivered quantity per quotation line, cancelled DNs excluded', async () => {
    const q = (await as(U.accA, `insert into invoices(company_id,doc_type,number,status) values ($1,'quotation','QT-DLV','accepted') returning id`, [A])).rows[0].id
    const li = (await as(U.accA, `insert into invoice_items(company_id,invoice_id,description,quantity,unit_price) values ($1,$2,'Pipe',100,10) returning id`, [A, q])).rows[0].id
    const dn1 = (await as(U.accA, `insert into invoices(company_id,doc_type,number,status,quotation_id) values ($1,'delivery_note','DN-1','delivered',$2) returning id`, [A, q])).rows[0].id
    await as(U.accA, `insert into invoice_items(company_id,invoice_id,description,quantity,source_item_id) values ($1,$2,'Pipe',60,$3)`, [A, dn1, li])
    const dn2 = (await as(U.accA, `insert into invoices(company_id,doc_type,number,status,quotation_id) values ($1,'delivery_note','DN-2','cancelled',$2) returning id`, [A, q])).rows[0].id
    await as(U.accA, `insert into invoice_items(company_id,invoice_id,description,quantity,source_item_id) values ($1,$2,'Pipe',30,$3)`, [A, dn2, li])
    expect((await as(U.accA, `select ordered, delivered from quotation_delivery where item_id=$1`, [li])).rows[0]).toMatchObject({ ordered: '100.000', delivered: '60.000' })
  })
  it('revisions are immutable; follow-ups feed reminders; viewers see no sales data', async () => {
    const q = (await as(U.accA, `insert into invoices(company_id,doc_type,number,status,total) values ($1,'quotation','QT-REV','sent',99) returning id`, [A])).rows[0].id
    const r = (await as(U.accA, `insert into sales_doc_revisions(company_id,invoice_id,revision,snapshot) values ($1,$2,0,'{}') returning id`, [A, q])).rows[0].id
    const upd = await as(U.ownerA, `update sales_doc_revisions set revision=5 where id=$1`, [r]); expect(upd.rowCount).toBe(0)
    const del = await as(U.ownerA, `delete from sales_doc_revisions where id=$1`, [r]); expect(del.rowCount).toBe(0)
    await as(U.accA, `insert into sales_followups(company_id,invoice_id,due_date) values ($1,$2,'2026-01-01')`, [A, q])
    expect((await as(U.accA, `select count(*)::int n from reminder_sources where source_type='followup' and link=$1`, [`/invoices/${q}`])).rows[0].n).toBe(1)
    for (const t of ['sales_doc_revisions', 'sales_followups', 'catalog_items', 'sales_doc_events'])
      expect((await as(U.viewerA, `select count(*)::int n from ${t}`)).rows[0].n, t).toBe(0)
    await fails(as(U.viewerA, `insert into sales_doc_events(company_id,invoice_id,event) values ($1,$2,'printed')`, [A, q]))
    await as(U.accA, `insert into sales_doc_events(company_id,invoice_id,event) values ($1,$2,'printed')`, [A, q])
  })
  it('asset maintenance updates last/next service and inspection dates', async () => {
    const a = (await as(U.ownerA, `insert into assets(company_id,kind,name) values ($1,'vehicle','Pickup 1') returning id`, [A])).rows[0].id
    await as(U.ownerA, `insert into asset_maintenance(company_id,asset_id,performed_on,kind,description,cost,next_due) values ($1,$2,'2026-09-01','service','Oil change',250,'2026-12-01')`, [A, a])
    await as(U.ownerA, `insert into asset_maintenance(company_id,asset_id,performed_on,kind,description,next_due) values ($1,$2,'2026-09-02','inspection','RTA test','2027-09-01')`, [A, a])
    const r = (await as(U.ownerA, `select last_service_date::text l, next_service_date::text n, inspection_expiry::text i from assets where id=$1`, [a])).rows[0]
    expect(r).toEqual({ l: '2026-09-01', n: '2026-12-01', i: '2027-09-01' })
  })
})

describe('Vehicles & Assets + Reports (0013)', () => {
  it('assignment history: every change of assigned_to closes the open row and opens a new one', async () => {
    const e1 = (await as(U.ownerA, `insert into employees(company_id,employee_no,full_name) values ($1,'AS-1','Driver One') returning id`, [A])).rows[0].id
    const e2 = (await as(U.ownerA, `insert into employees(company_id,employee_no,full_name) values ($1,'AS-2','Driver Two') returning id`, [A])).rows[0].id
    const a = (await as(U.ownerA, `insert into assets(company_id,kind,name,assigned_to) values ($1,'vehicle','Hilux',$2) returning id`, [A, e1])).rows[0].id
    await as(U.ownerA, `update assets set assigned_to=$2 where id=$1`, [a, e2])
    await as(U.ownerA, `update assets set location='Yard' where id=$1`, [a])   // not an assignment change
    const rows = (await as(U.ownerA, `select employee_id, returned_on is null open from asset_assignments where asset_id=$1 order by created_at`, [a])).rows
    expect(rows.map(r => [r.employee_id, r.open])).toEqual([[e1, false], [e2, true]])
    await fails(as(U.ownerA, `insert into asset_assignments(company_id,asset_id,employee_id) values ($1,$2,$3)`, [A, a, e1]), /duplicate key/)   // one current assignment
    expect((await as(U.ownerB, `select count(*)::int n from asset_assignments where asset_id=$1`, [a])).rows[0].n).toBe(0)   // other tenant sees nothing
  })
  it('odometer in a service record moves mileage forward and sets the next service km', async () => {
    const a = (await as(U.ownerA, `insert into assets(company_id,kind,name,current_mileage,service_interval_km) values ($1,'vehicle','Navara',40000,10000) returning id`, [A])).rows[0].id
    await as(U.ownerA, `insert into asset_maintenance(company_id,asset_id,performed_on,kind,description,odometer) values ($1,$2,'2026-10-01','service','Oil',41200)`, [A, a])
    await as(U.ownerA, `insert into asset_maintenance(company_id,asset_id,performed_on,kind,description,odometer) values ($1,$2,'2026-09-01','repair','Old receipt',39000)`, [A, a])   // older reading never rolls back
    expect((await as(U.ownerA, `select current_mileage, next_service_km from assets where id=$1`, [a])).rows[0]).toMatchObject({ current_mileage: 41200, next_service_km: 51200 })
  })
  it('report_summary: RLS-scoped, finance sections only with finance.view, money summed in the database', async () => {
    await as(U.accA, `insert into invoices(company_id,doc_type,number,status,issue_date,subtotal,vat_amount,total) values ($1,'invoice','INV-REP-1','sent','2031-03-05',1000,50,1050),($1,'invoice','INV-REP-2','draft','2031-03-06',500,25,525)`, [A])
    const r = (await as(U.accA, `select report_summary('2031-03-01','2031-03-31','2031-03-10') r`)).rows[0].r
    expect(r.sales).toMatchObject({ count: 1, net: 1000, vat: 50, total: 1050 })   // draft excluded
    const other = (await as(U.ownerB, `select report_summary('2031-03-01','2031-03-31','2031-03-10') r`)).rows[0].r
    expect(other.sales.count).toBe(0)   // company B never sees company A's invoices
    const viewer = (await as(U.viewerA, `select report_summary('2031-03-01','2031-03-31','2031-03-10') r`)).rows[0].r
    expect(viewer.sales).toBeUndefined(); expect(viewer.receivables).toBeUndefined(); expect(viewer.documents).toBeDefined()
    await fails(as(null, `select report_summary('2031-03-01','2031-03-31','2031-03-10')`, [], 'anon'), /permission denied/)
  })
})

describe('Phase 1 operations (0014)', () => {
  it('leads: numbered, stage changes logged with won / lost stamps; CRM hidden from roles without crm.view', async () => {
    const no = (await as(U.ownerA, `select next_document_number('lead') n`)).rows[0].n
    expect(no).toMatch(/^LD-\d{4}-\d{4}$/)
    const l = (await as(U.pmA, `insert into leads(company_id,number,company_name,source,estimated_value) values ($1,$2,'Villa 22 Owner','instagram',48000) returning id`, [A, no])).rows[0].id
    await as(U.pmA, `update leads set stage='quotation_sent' where id=$1`, [l])
    await as(U.pmA, `update leads set stage='won' where id=$1`, [l])
    const acts = (await as(U.pmA, `select from_stage,to_stage from lead_activities where lead_id=$1 and kind='stage' order by id`, [l])).rows
    expect(acts.map(a => `${a.from_stage}>${a.to_stage}`)).toEqual(['new>quotation_sent', 'quotation_sent>won'])
    expect((await as(U.pmA, `select won_at is not null w from leads where id=$1`, [l])).rows[0].w).toBe(true)
    expect((await as(U.hrA, `select count(*)::int n from leads`)).rows[0].n).toBe(0)       // HR has no crm.view
    expect((await as(U.empA, `select count(*)::int n from leads`)).rows[0].n).toBe(0)
    expect((await as(U.ownerB, `select count(*)::int n from leads where company_id=$1`, [A])).rows[0].n).toBe(0)
    await fails(as(U.viewerA, `update leads set stage='lost' where id=$1 returning id`, [l]).then(r => { if (!r.rowCount) throw new Error('no rows') }))   // viewer is read-only
    await fails(as(U.pmA, `delete from lead_activities where lead_id=$1 returning id`, [l]).then(r => { if (!r.rowCount) throw new Error('immutable') }), /immutable/)
  })
  it('tasks: completion stamps 100%; an assignee without other rights sees and updates only their own task', async () => {
    const mine = (await as(U.ownerA, `insert into tasks(company_id,title,owner_id,due_date) values ($1,'Weld stringers',$2,'2026-10-10') returning id`, [A, U.empA])).rows[0].id
    await as(U.ownerA, `insert into tasks(company_id,title,owner_id) values ($1,'Office task',$2)`, [A, U.accA])
    expect((await as(U.empA, `select title from tasks`)).rows.map(r => r.title)).toEqual(['Weld stringers'])
    await as(U.empA, `update tasks set status='completed' where id=$1`, [mine])
    expect((await as(U.ownerA, `select completion, completed_at is not null done from tasks where id=$1`, [mine])).rows[0]).toMatchObject({ completion: 100, done: true })
    await fails(as(U.empA, `update tasks set owner_id=$2 where id=$1`, [mine, U.accA]), /row-level security/)   // cannot hand it to someone else
  })
  it('site visits need a lead, customer or project; soft-deleted records disappear and restore through the trash RPCs', async () => {
    await fails(as(U.ownerA, `insert into site_visits(company_id,number,scheduled_date) values ($1,'SV-X','2026-10-12')`, [A]), /check constraint/)
    const p = (await as(U.ownerA, `insert into projects(company_id,name) values ($1,'Staircase job') returning id`, [A])).rows[0].id
    const v = (await as(U.ownerA, `insert into site_visits(company_id,number,scheduled_date,project_id) values ($1,'SV-1','2026-10-12',$2) returning id`, [A, p])).rows[0].id
    await as(U.ownerA, `select soft_delete('site_visit',$1)`, [v])
    expect((await as(U.ownerA, `select count(*)::int n from site_visits where id=$1`, [v])).rows[0].n).toBe(0)
    expect((await as(U.ownerA, `select count(*)::int n from trash_list() where entity='site_visit'`)).rows[0].n).toBe(1)
    await as(U.ownerA, `select restore_deleted('site_visit',$1)`, [v])
    expect((await as(U.ownerA, `select count(*)::int n from site_visits where id=$1`, [v])).rows[0].n).toBe(1)
  })
  it('reminder_sources includes lead follow-ups, visits, open tasks and work-order targets only while they are open', async () => {
    const r = (await as(U.ownerA, `select source_type, count(*)::int n from reminder_sources where source_type in ('lead_followup','site_visit','task','work_order') group by 1`)).rows
    const m = Object.fromEntries(r.map(x => [x.source_type, x.n]))
    expect(m.site_visit).toBeGreaterThanOrEqual(1)
    expect(m.task ?? 0).toBe(0)   // the only dated task is completed
    const l = (await as(U.ownerA, `insert into leads(company_id,number,company_name,next_followup) values ($1,'LD-T','Follow me','2026-10-15') returning id`, [A])).rows[0].id
    expect((await as(U.ownerA, `select count(*)::int n from reminder_sources where source_type='lead_followup' and source_id=$1`, [l])).rows[0].n).toBe(1)
    await as(U.ownerA, `update leads set stage='lost', lost_reason='price' where id=$1`, [l])
    expect((await as(U.ownerA, `select count(*)::int n from reminder_sources where source_type='lead_followup' and source_id=$1`, [l])).rows[0].n).toBe(0)
  })
  it('project budgets need finance.view to read; crew rows are removable with edit rights', async () => {
    const p = (await as(U.ownerA, `insert into projects(company_id,name) values ($1,'Budget job') returning id`, [A])).rows[0].id
    await as(U.accA, `insert into project_budgets(company_id,project_id,category,amount) values ($1,$2,'material',12000)`, [A, p])
    expect((await as(U.pmA, `select count(*)::int n from project_budgets where project_id=$1`, [p])).rows[0].n).toBe(0)
    expect((await as(U.accA, `select count(*)::int n from project_budgets where project_id=$1`, [p])).rows[0].n).toBe(1)
    const w = (await as(U.pmA, `insert into work_orders(company_id,number,title,project_id) values ($1,'WO-1','Fabricate',$2) returning id`, [A, p])).rows[0].id
    await as(U.pmA, `insert into work_order_members(company_id,work_order_id,employee_id) values ($1,$2,$3)`, [A, w, empRecA2])
    expect((await as(U.pmA, `delete from work_order_members where work_order_id=$1 returning employee_id`, [w])).rowCount).toBe(1)
  })
})

describe('Approvals, saved views, custom fields & statuses (0016)', () => {
  it('quotation approval mirrors into approval_requests and back, with notifications', async () => {
    const q = (await as(U.accA, `insert into invoices(company_id,doc_type,number,total,status) values ($1,'quotation','APR-Q-1',2100,'draft') returning id`, [A])).rows[0].id
    await as(U.accA, `update invoices set approval_status='pending' where id=$1`, [q])
    const r = (await sup(`select * from approval_requests where entity_id=$1`, [q])).rows
    expect(r).toHaveLength(1); expect(r[0].status).toBe('pending'); expect(r[0].requested_by).toBe(U.accA)
    expect((await sup(`select count(*)::int n from in_app_notifications where user_id=$1 and dedupe_key=$2`, [U.ownerA, 'approval:' + r[0].id])).rows[0].n).toBe(1)
    // the accountant cannot decide; the owner can (via the document, as the editor does)
    await fails(as(U.accA, `update approval_requests set status='approved' where id=$1`, [r[0].id]), /not allowed to decide/)
    await as(U.ownerA, `update invoices set approval_status='approved', approved_by=auth.uid(), approved_at=now() where id=$1`, [q])
    const d = (await sup(`select status, decided_by from approval_requests where id=$1`, [r[0].id])).rows[0]
    expect(d.status).toBe('approved'); expect(d.decided_by).toBe(U.ownerA)
    expect((await sup(`select count(*)::int n from in_app_notifications where user_id=$1 and dedupe_key=$2`, [U.accA, 'approval_decided:' + r[0].id])).rows[0].n).toBe(1)
    await fails(as(U.ownerA, `update approval_requests set status='rejected' where id=$1`, [r[0].id]), /already decided/)
  })
  it('expense and outgoing-cheque thresholds create requests; a pending cheque cannot move on', async () => {
    await as(U.ownerA, `insert into app_settings(company_id,key,value) values ($1,'approvals.expense_threshold','5000'),($1,'approvals.cheque_threshold','10000') on conflict (company_id,key) do update set value=excluded.value`, [A])
    const small = (await as(U.accA, `insert into project_expenses(company_id,category,description,amount) values ($1,'material','Bolts',300) returning id, approval_status`, [A])).rows[0]
    const big = (await as(U.accA, `insert into project_expenses(company_id,category,description,amount) values ($1,'material','Steel plates',7500) returning id, approval_status`, [A])).rows[0]
    expect(small.approval_status).toBeNull(); expect(big.approval_status).toBe('pending')
    expect((await sup(`select count(*)::int n from approval_requests where entity_type='expense' and entity_id=$1 and status='pending'`, [big.id])).rows[0].n).toBe(1)
    const chq = (await as(U.accA, `insert into cheques(company_id,cheque_no,direction,party_name,bank_name,amount,cheque_date,status) values ($1,'APR-1','outgoing','Steel Co','ENBD',12000,'2026-11-01','issued') returning id, approval_status`, [A])).rows[0]
    expect(chq.approval_status).toBe('pending')
    await fails(as(U.accA, `update cheques set status='presented' where id=$1`, [chq.id]), /waiting for approval/)
    await as(U.ownerA, `update cheques set approval_status='approved' where id=$1`, [chq.id])
    await as(U.accA, `update cheques set status='presented' where id=$1`, [chq.id])
    const inc = (await as(U.accA, `insert into cheques(company_id,cheque_no,direction,party_name,bank_name,amount,cheque_date,status) values ($1,'APR-2','incoming','Client','ADCB',50000,'2026-11-01','received') returning approval_status`, [A])).rows[0]
    expect(inc.approval_status).toBeNull()   // incoming cheques never need approval
    await sup(`delete from app_settings where company_id=$1 and key in ('approvals.expense_threshold','approvals.cheque_threshold')`, [A])
  })
  it('free-form requests: requester may cancel own; other tenants see nothing', async () => {
    const id = (await as(U.pmA, `insert into approval_requests(company_id,entity_type,title,amount) values ($1,'other','Buy 2 grinders',1800) returning id`, [A])).rows[0].id
    expect((await as(U.ownerB, `select count(*)::int n from approval_requests where id=$1`, [id])).rows[0].n).toBe(0)
    await fails(as(U.viewerA, `insert into approval_requests(company_id,entity_type,title) values ($1,'other','x')`, [A]), /row-level security/)
    await fails(as(U.hrA, `update approval_requests set status='cancelled' where id=$1 returning id`, [id]).then(r => { if (!r.rowCount) throw new Error('blocked') }))
    await as(U.pmA, `update approval_requests set status='cancelled' where id=$1`, [id])
    expect((await sup(`select status from approval_requests where id=$1`, [id])).rows[0].status).toBe('cancelled')
  })
  it('saved views are private unless shared; shared views need an editor', async () => {
    await as(U.pmA, `insert into saved_views(company_id,user_id,page,name,query) values ($1,auth.uid(),'/tasks','Mine','view=mine')`, [A])
    await as(U.pmA, `insert into saved_views(company_id,user_id,page,name,query,shared) values ($1,auth.uid(),'/tasks','Team overdue','view=overdue',true)`, [A])
    expect((await as(U.accA, `select name from saved_views where page='/tasks' order by name`)).rows.map(r => r.name)).toEqual(['Team overdue'])
    await fails(as(U.viewerA, `insert into saved_views(company_id,user_id,page,name,shared) values ($1,auth.uid(),'/tasks','x',true)`, [A]), /row-level security/)
    await fails(as(U.accA, `insert into saved_views(company_id,user_id,page,name) values ($1,$2,'/tasks','spoof')`, [A, U.pmA]), /row-level security/)
    await fails(as(U.pmA, `insert into saved_views(company_id,user_id,page,name) values ($1,auth.uid(),'javascript:alert(1)','x')`, [A]))
  })
  it('custom fields: settings.manage defines, editors fill, readers follow the record permission', async () => {
    await fails(as(U.accA, `insert into custom_field_defs(company_id,entity,key,label,field_type) values ($1,'project','supervisor','Supervisor','text')`, [A]), /row-level security/)
    await as(U.ownerA, `insert into custom_field_defs(company_id,entity,key,label,field_type) values ($1,'employee','shoe_size','Shoe size','number')`, [A])
    await as(U.hrA, `insert into custom_field_values(company_id,entity,record_id,data) values ($1,'employee',$2,'{"shoe_size":42}')`, [A, empRecA])
    expect((await as(U.viewerA, `select data from custom_field_values where record_id=$1`, [empRecA])).rows[0].data).toEqual({ shoe_size: 42 })
    expect((await as(U.empA, `select count(*)::int n from custom_field_values where record_id=$1`, [empRecA])).rows[0].n).toBe(0)
    await fails(as(U.viewerA, `update custom_field_values set data='{}' where record_id=$1 returning 1`, [empRecA]).then(r => { if (!r.rowCount) throw new Error('blocked') }))
    expect((await sup(`select count(*)::int n from audit_logs where table_name='custom_field_values' and record_id=$1`, [empRecA])).rows[0].n).toBe(1)
  })
  it('custom statuses set the standard status they map to, and clear when it changes', async () => {
    const st = (await as(U.ownerA, `insert into custom_statuses(company_id,entity,label,base_status) values ($1,'task','Waiting for material','waiting') returning id`, [A])).rows[0].id
    const other = (await as(U.ownerA, `insert into custom_statuses(company_id,entity,label,base_status) values ($1,'project','Painting','active') returning id`, [A])).rows[0].id
    const t = (await as(U.pmA, `insert into tasks(company_id,title) values ($1,'Weld frame') returning id`, [A])).rows[0].id
    await as(U.pmA, `update tasks set custom_status_id=$2 where id=$1`, [t, st])
    expect((await sup(`select status, custom_status_id from tasks where id=$1`, [t])).rows[0]).toMatchObject({ status: 'waiting', custom_status_id: st })
    await fails(as(U.pmA, `update tasks set custom_status_id=$2 where id=$1`, [t, other]), /another record type/)
    await as(U.pmA, `update tasks set status='completed' where id=$1`, [t])
    expect((await sup(`select status, custom_status_id from tasks where id=$1`, [t])).rows[0]).toMatchObject({ status: 'completed', custom_status_id: null })
  })
  it('user preferences are private to each user', async () => {
    await as(U.pmA, `insert into user_preferences(user_id,key,value) values (auth.uid(),'dashboard.layout','{"items":[]}')`)
    expect((await as(U.ownerA, `select count(*)::int n from user_preferences where user_id=$1`, [U.pmA])).rows[0].n).toBe(0)
    await fails(as(U.ownerA, `insert into user_preferences(user_id,key,value) values ($1,'dashboard.layout','{}')`, [U.pmA]), /row-level security/)
  })
})

describe('Secure links & public forms (0017)', () => {
  const h = (n: number) => n.toString(16).padStart(64, 'a')
  it('links: finance users create portals, editors create document requests; tenants isolated; hash only', async () => {
    const cu = (await as(U.accA, `insert into customers(company_id,name) values ($1,'Portal Client') returning id`, [A])).rows[0].id
    await as(U.accA, `insert into share_links(company_id,kind,token_hash,customer_id,expires_at) values ($1,'customer_portal',$2,$3,now()+interval '30 days')`, [A, h(1), cu])
    await fails(as(U.pmA, `insert into share_links(company_id,kind,token_hash,customer_id,expires_at) values ($1,'customer_portal',$2,$3,now()+interval '30 days')`, [A, h(2), cu]), /row-level security/)
    await as(U.pmA, `insert into share_links(company_id,kind,token_hash,customer_id,items,expires_at) values ($1,'document_request',$2,$3,'{"Trade licence"}',now()+interval '7 days')`, [A, h(3), cu])
    await fails(as(U.accA, `insert into share_links(company_id,kind,token_hash,customer_id,expires_at) values ($1,'customer_portal','not-a-hash',$2,now()+interval '1 day')`, [A, cu]))
    await fails(as(U.accA, `insert into share_links(company_id,kind,token_hash,customer_id,expires_at) values ($1,'customer_portal',$2,$3,now()+interval '2 years')`, [A, h(4), cu]))
    await fails(as(U.accA, `insert into share_links(company_id,kind,token_hash,expires_at) values ($1,'customer_portal',$2,now()+interval '1 day')`, [A, h(5)]))   // portal without a customer
    expect((await as(U.ownerB, `select count(*)::int n from share_links`)).rows[0].n).toBe(0)
    expect((await as(U.viewerA, `select count(*)::int n from share_links`)).rows[0].n).toBe(0)
    expect(await as(null, `select count(*)::int n from share_links`, [], 'anon').then(r => r.rows[0].n, e => /permission denied/.test(e.message) ? 0 : -1)).toBe(0)   // anon: no rows (or no grant at all)
  })
  it('issue_document_number is service-only; next_document_number still checks the caller', async () => {
    await fails(as(U.ownerA, `select issue_document_number($1,'lead')`, [A]), /permission denied/)
    const r = await pool.connect()
    try { await r.query('begin'); await r.query('set local role service_role'); expect((await r.query(`select issue_document_number($1,'lead') n`, [A])).rows[0].n).toMatch(/^LD-/); await r.query('rollback') } finally { r.release() }
    expect((await as(U.accA, `select next_document_number('lead') n`)).rows[0].n).toMatch(/^LD-/)
    await fails(as(U.viewerA, `select next_document_number('lead')`), /insufficient privilege/)
  })
  it('public forms: settings.manage only, unique slug; submissions readable by CRM users', async () => {
    await fails(as(U.accA, `insert into public_forms(company_id,slug,title) values ($1,'acc-form','x')`, [A]), /row-level security/)
    const f = (await as(U.ownerA, `insert into public_forms(company_id,slug,title) values ($1,'al-saqr-quote','Request a quotation') returning id`, [A])).rows[0].id
    await fails(as(U.ownerB, `insert into public_forms(company_id,slug,title) values ($1,'al-saqr-quote','copy')`, [B]), /duplicate|unique/)
    await fails(as(U.ownerA, `insert into public_forms(company_id,slug,title) values ($1,'Bad Slug!','x')`, [A]))
    await sup(`insert into public_form_submissions(company_id,form_id,ip_hash) values ($1,$2,'abc')`, [A, f])
    expect((await as(U.accA, `select count(*)::int n from public_form_submissions`)).rows[0].n).toBe(1)
    expect((await as(U.hrA, `select count(*)::int n from public_form_submissions`)).rows[0].n).toBe(0)
  })
})

describe('Service tickets, warranties & knowledge base (0018)', () => {
  it('tickets: numbered ST-, warranty found automatically, due date from priority, resolve timestamps', async () => {
    const cu = (await as(U.ownerA, `insert into customers(company_id,name) values ($1,'Warranty Client') returning id`, [A])).rows[0].id
    const wr = (await as(U.accA, `insert into warranties(company_id,number,customer_id,title,start_date,end_date) values ($1,$2,$3,'Gate and motor',current_date - 30,current_date + 335) returning id`, [A, (await as(U.accA, `select next_document_number('warranty') n`)).rows[0].n, cu])).rows[0].id
    const n = (await as(U.accA, `select next_document_number('service_ticket') n`)).rows[0].n
    expect(n).toMatch(/^ST-\d{4}-\d{4}$/)
    const t = (await as(U.accA, `insert into service_tickets(company_id,number,title,customer_id,priority) values ($1,$2,'Gate not closing',$3,'urgent') returning *`, [A, n, cu])).rows[0]
    expect(t.warranty_id).toBe(wr); expect(t.under_warranty).toBe(true)
    expect(String(t.due_date.toISOString?.() ?? t.due_date).slice(0, 10)).toBe(new Date(Date.now() + 4 * 3600e3 + 864e5).toISOString().slice(0, 10))   // urgent: +1 day (Dubai date)
    const up = (await as(U.accA, `update service_tickets set status='resolved', resolution='Limit switch replaced' where id=$1 returning resolved_at, closed_at`, [t.id])).rows[0]
    expect(up.resolved_at).not.toBeNull(); expect(up.closed_at).toBeNull()
    const re = (await as(U.accA, `update service_tickets set status='in_progress' where id=$1 returning resolved_at`, [t.id])).rows[0]
    expect(re.resolved_at).toBeNull()
  })
  it('a technician without office access sees and updates only tickets assigned to them; viewers cannot create', async () => {
    const a = (await as(U.accA, `insert into service_tickets(company_id,number,title,assigned_to) values ($1,'ST-T-1','Assigned to field worker',$2) returning id`, [A, U.empA])).rows[0].id
    await as(U.accA, `insert into service_tickets(company_id,number,title) values ($1,'ST-T-2','Somebody else')`, [A])
    expect((await as(U.empA, `select number from service_tickets order by number`)).rows.map(r => r.number)).toEqual(['ST-T-1'])
    await as(U.empA, `update service_tickets set status='in_progress' where id=$1`, [a])
    await as(U.empA, `insert into ticket_events(company_id,ticket_id,kind,body,user_id) values ($1,$2,'note','On site now',auth.uid())`, [A, a])
    await fails(as(U.viewerA, `insert into service_tickets(company_id,number,title) values ($1,'ST-T-3','x')`, [A]), /row-level security/)
    expect((await as(U.ownerB, `select count(*)::int n from service_tickets`)).rows[0].n).toBe(0)
  })
  it('trash: tickets, warranties and articles disappear when trashed and come back on restore', async () => {
    const t = (await as(U.accA, `insert into service_tickets(company_id,number,title) values ($1,'ST-T-9','To trash') returning id`, [A])).rows[0].id
    await as(U.ownerA, `select soft_delete('service_ticket',$1)`, [t])
    expect((await as(U.accA, `select count(*)::int n from service_tickets where id=$1`, [t])).rows[0].n).toBe(0)
    expect((await as(U.ownerA, `select count(*)::int n from trash_list() where entity='service_ticket' and id=$1`, [t])).rows[0].n).toBe(1)
    await as(U.ownerA, `select restore_deleted('service_ticket',$1)`, [t])
    expect((await as(U.accA, `select count(*)::int n from service_tickets where id=$1`, [t])).rows[0].n).toBe(1)
  })
  it('knowledge base: everyone reads published, drafts only editors, every edit keeps a version', async () => {
    const pub = (await as(U.pmA, `insert into kb_articles(company_id,title,body) values ($1,'Hot work permit','1. Get permit') returning id`, [A])).rows[0].id
    await as(U.pmA, `insert into kb_articles(company_id,title,body,status) values ($1,'Draft SOP','wip','draft')`, [A])
    expect((await as(U.empA, `select title from kb_articles order by title`)).rows.map(r => r.title)).toEqual(['Hot work permit'])
    expect((await as(U.pmA, `select count(*)::int n from kb_articles`)).rows[0].n).toBe(2)
    await fails(as(U.empA, `insert into kb_articles(company_id,title) values ($1,'x')`, [A]), /row-level security/)
    const v = (await as(U.pmA, `update kb_articles set body='1. Get permit\n2. Fire watch' where id=$1 returning version`, [pub])).rows[0].version
    expect(v).toBe(2)
    expect((await as(U.pmA, `select version, body from kb_article_versions where article_id=$1`, [pub])).rows).toEqual([{ version: 1, body: '1. Get permit' }])
    expect((await as(U.empA, `select count(*)::int n from kb_article_versions`)).rows[0].n).toBe(0)
    expect((await as(U.ownerB, `select count(*)::int n from kb_articles`)).rows[0].n).toBe(0)
  })
})

describe('Platform: sign-in history, sessions, events, integrations (0019)', () => {
  const svc = async (sql: string, p: unknown[] = []) => as(null, sql, p, 'service_role')
  it('sign-in history: own rows for everyone, the company’s rows for user managers, nothing across companies; no direct writes', async () => {
    await sup(`insert into login_events(company_id,user_id,email,event,ip) values ($1,$2,'o@x','sign_in','1.2.3.4'),($1,$3,'h@x','sign_in_failed','5.6.7.8')`, [A, U.ownerA, U.hrA])
    expect((await as(U.ownerA, `select count(*)::int n from login_events where company_id=$1`, [A])).rows[0].n).toBeGreaterThanOrEqual(2)
    expect((await as(U.hrA, `select distinct user_id from login_events`)).rows).toEqual([{ user_id: U.hrA }])
    expect((await as(U.ownerB, `select count(*)::int n from login_events where company_id=$1`, [A])).rows[0].n).toBe(0)
    await fails(as(U.hrA, `insert into login_events(company_id,user_id,event) values ($1,$2,'sign_in')`, [A, U.hrA]))
    expect((await svc(`select * from profile_for_email('ownerA@test.local')`)).rows).toEqual([{ id: U.ownerA, company_id: A }])
    await fails(as(U.ownerA, `select * from profile_for_email('ownerA@test.local')`), /permission denied/)
  })
  it('device sessions: registered on first use, revocable by the owner or a user manager, never hijacked by another user', async () => {
    const s1 = uuid(), s2 = uuid(), s3 = uuid()
    expect((await as(U.hrA, `select touch_session($1,'1.1.1.1','UA') r`, [s1])).rows[0].r).toBe(false)
    expect((await as(U.hrA, `select touch_session($1,'1.1.1.1','UA') r`, [s2])).rows[0].r).toBe(false)
    expect((await as(U.ownerB, `select touch_session($1,'9.9.9.9','evil') r`, [s1])).rows[0].r).toBe(false)
    expect((await sup(`select user_id, ip from user_sessions where id=$1`, [s1])).rows[0]).toEqual({ user_id: U.hrA, ip: '1.1.1.1' })
    await fails(as(U.accA, `select revoke_session($1)`, [s1]), /insufficient privilege/)
    expect((await as(U.ownerA, `select revoke_session($1) r`, [s1])).rows[0].r).toBe(true)
    expect((await as(U.hrA, `select touch_session($1,null,null) r`, [s1])).rows[0].r).toBe(true)
    expect((await as(U.hrA, `select touch_session($1,null,null) r`, [s2])).rows[0].r).toBe(false)
    expect((await as(U.hrA, `select touch_session($1,null,null) r`, [s3])).rows[0].r).toBe(false)
    expect((await as(U.hrA, `select revoke_other_sessions($1) n`, [s3])).rows[0].n).toBe(1)
    expect((await as(U.hrA, `select id from user_sessions where revoked_at is null`)).rows).toEqual([{ id: s3 }])
    await fails(as(U.accA, `select revoke_other_sessions(null, $1)`, [U.hrA]), /insufficient privilege/)
    await fails(as(U.ownerB, `select revoke_other_sessions(null, $1)`, [U.hrA]), /insufficient privilege/)
    expect((await as(U.ownerB, `select count(*)::int n from user_sessions where company_id=$1`, [A])).rows[0].n).toBe(0)
    expect((await as(U.hrA, `select event from login_events where user_id=$1 and event like 'session%' order by id`, [U.hrA])).rows.map(r => r.event)).toEqual(['session_revoked', 'sessions_revoked'])
  })
  it('events: sales, payments, customers, cheques; imports do not raise per-row events; only admins read them; workers only via service role', async () => {
    const cu = (await sup(`insert into customers(company_id,name) values ($1,'Event Client LLC') returning id`, [A])).rows[0].id
    const q = (await sup(`insert into invoices(company_id,doc_type,number,customer_id,customer_name,total,status) values ($1,'quotation','EVQ-1',$2,'Event Client LLC',52500,'draft') returning id`, [A, cu])).rows[0].id
    await sup(`update invoices set status='sent' where id=$1`, [q]); await sup(`update invoices set notes='x' where id=$1`, [q]); await sup(`update invoices set status='accepted' where id=$1`, [q])
    const inv = (await sup(`insert into invoices(company_id,doc_type,number,customer_name,total,status) values ($1,'invoice','EVI-1','Event Client LLC',1000,'sent') returning id`, [A])).rows[0].id
    await sup(`insert into payments(company_id,invoice_id,amount) values ($1,$2,400)`, [A, inv])
    const ib = (await sup(`insert into import_batches(company_id,entity) values ($1,'customers') returning id`, [A])).rows[0].id
    const imp = (await sup(`insert into customers(company_id,name,import_batch_id) values ($1,'Imported Co',$2) returning id`, [A, ib])).rows[0].id
    await sup(`update cheques set status='returned' where id=$1`, [chequeA]).catch(() => null)
    const ev = (await as(U.ownerA, `select event, entity_id, data from app_events where entity_id = any($1) or (event = 'payment.received' and data->>'number' = 'EVI-1') order by id`, [[cu, q, inv, imp]])).rows
    expect(ev.map(e => e.event)).toEqual(['customer.created', 'quotation.created', 'quotation.sent', 'quotation.accepted', 'invoice.created', 'payment.received'])
    expect(ev.find(e => e.event === 'quotation.accepted').data).toMatchObject({ number: 'EVQ-1', party: 'Event Client LLC', amount: 52500, status: 'accepted' })
    expect(ev.find(e => e.event === 'payment.received')).toMatchObject({ entity_id: expect.any(String), data: { amount: 400, number: 'EVI-1' } })
    expect((await as(U.accA, `select count(*)::int n from app_events`)).rows[0].n).toBe(0)
    expect((await as(U.ownerB, `select count(*)::int n from app_events where company_id=$1`, [A])).rows[0].n).toBe(0)
    await fails(as(U.ownerA, `select * from claim_app_events(10)`), /permission denied/)
    await fails(as(U.ownerA, `select * from claim_webhook_deliveries(10)`), /permission denied/)
    const claimed = (await svc(`select id from claim_app_events(1000)`)).rows.length
    expect(claimed).toBeGreaterThan(0)
    expect((await svc(`select count(*)::int n from claim_app_events(1000)`)).rows[0].n).toBe(0)   // claimed rows are not handed out twice
  })
  it('rules, webhooks, API keys, schedules: settings managers only, secrets never readable, constraints hold', async () => {
    const rec = (await sup(`insert into notification_recipients(company_id,name,channels) values ($1,'Owner',array['in_app']) returning id`, [A])).rows[0].id
    await as(U.ownerA, `insert into notification_rules(company_id,name,event,channels,recipient_ids) values ($1,'Big wins','quotation.accepted',array['in_app','email'],array[$2::uuid])`, [A, rec])
    await fails(as(U.accA, `insert into notification_rules(company_id,name,event,channels,recipient_ids) values ($1,'x','invoice.paid',array['in_app'],array[$2::uuid])`, [A, rec]))
    await fails(as(U.ownerA, `insert into notification_rules(company_id,name,event,channels,recipient_ids) values ($1,'x','invoice.paid',array['sms'],array[$2::uuid])`, [A, rec]), /check/)
    expect((await as(U.accA, `select count(*)::int n from notification_rules`)).rows[0].n).toBe(0)
    const ep = (await as(U.ownerA, `insert into webhook_endpoints(company_id,url,events) values ($1,'https://hooks.example.com/a',array['*']) returning id`, [A])).rows[0].id
    await sup(`insert into webhook_secrets(endpoint_id,company_id,secret) values ($1,$2,$3)`, [ep, A, 'whsec_' + 'x'.repeat(32)])
    expect((await as(U.ownerA, `select count(*)::int n from webhook_secrets`).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n).toBe(0)
    await fails(as(U.ownerA, `insert into webhook_endpoints(company_id,url,events) values ($1,'ftp://x',array['*'])`, [A]), /check/)
    expect((await as(U.ownerB, `select count(*)::int n from webhook_endpoints`)).rows[0].n).toBe(0)
    await as(U.ownerA, `insert into api_keys(company_id,name,prefix,key_hash,scopes) values ($1,'Sync','avq_abcdefgh',$2,array['customers.read'])`, [A, 'a'.repeat(64)])
    await fails(as(U.ownerA, `insert into api_keys(company_id,name,prefix,key_hash,scopes) values ($1,'Bad','avq_abcdefgh',$2,array['salaries.read'])`, [A, 'b'.repeat(64)]), /check/)
    await fails(as(U.accA, `insert into api_keys(company_id,name,prefix,key_hash,scopes) values ($1,'Sync','avq_abcdefgh',$2,array['customers.read'])`, [A, 'c'.repeat(64)]))
    expect((await as(U.accA, `select count(*)::int n from api_keys`)).rows[0].n).toBe(0)
    await fails(as(U.ownerA, `insert into report_schedules(company_id,name,frequency,sections,channels,recipient_ids) values ($1,'W','weekly',array['sales'],array['email'],array[$2::uuid])`, [A, rec]), /check/)
    await as(U.ownerA, `insert into report_schedules(company_id,name,frequency,weekday,sections,channels,recipient_ids) values ($1,'W','weekly',1,array['sales'],array['email'],array[$2::uuid])`, [A, rec])
    expect((await as(U.ownerB, `select count(*)::int n from report_schedules`)).rows[0].n).toBe(0)
  })
  it('import batches: editors only; scheduler health: settings managers only', async () => {
    await as(U.pmA, `insert into import_batches(company_id,entity,file_name) values ($1,'leads','leads.xlsx')`, [A])
    await fails(as(U.viewerA, `insert into import_batches(company_id,entity) values ($1,'leads')`, [A]))
    expect((await as(U.viewerA, `select count(*)::int n from import_batches`)).rows[0].n).toBe(0)
    await sup(`insert into system_runs(job,ok,detail) values ('cron',true,'12 ms')`)
    expect((await as(U.ownerA, `select count(*)::int n from system_runs`)).rows[0].n).toBeGreaterThan(0)
    expect((await as(U.accA, `select count(*)::int n from system_runs`)).rows[0].n).toBe(0)
  })
})
