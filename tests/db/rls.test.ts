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
