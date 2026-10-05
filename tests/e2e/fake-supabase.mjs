// Minimal local stand-in for the Supabase gateway, used ONLY by the end-to-end harness (never shipped to production):
//   /rest/v1/*    → real PostgREST (talking to local Postgres with the real migrations + RLS)
//   /auth/v1/*    → tiny GoTrue clone (password sign-up / sign-in / user / refresh / logout), HS256 JWTs
//   /storage/v1/* → in-memory object store with signed URLs
import http from 'node:http'
import crypto from 'node:crypto'
import pg from 'pg'

const { JWT_SECRET, PGRST_URL, DATABASE_URL, PORT = '54399' } = process.env
const b64 = b => Buffer.from(b).toString('base64url')
const sign = claims => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify(claims)); return `${h}.${p}.${crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')}` }
const verify = t => { try { const [h, p, s] = t.split('.'); if (crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url') !== s) return null; const c = JSON.parse(Buffer.from(p, 'base64url')); return c.exp * 1000 > Date.now() ? c : null } catch { return null } }
const pool = new pg.Pool({ connectionString: DATABASE_URL })
const passwords = new Map(), refresh = new Map(), objects = new Map(), tokens = new Map()
const now = () => Math.floor(Date.now() / 1000)
const session = u => {
  const exp = now() + 3600
  const access_token = sign({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', aal: 'aal1', exp, session_id: crypto.randomUUID() })
  const refresh_token = crypto.randomUUID(); refresh.set(refresh_token, u.id)
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token, user: user(u) }
}
const user = u => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, factors: [], created_at: new Date().toISOString() })
const body = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))) })
const json = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); const path = url.pathname
  try {
    if (path.startsWith('/rest/v1/')) {                                   // ── PostgREST proxy
      const buf = await body(req); const headers = { ...req.headers }; delete headers.host; delete headers.connection
      const up = await fetch(PGRST_URL + path.slice('/rest/v1'.length) + url.search, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : buf })
      const out = Buffer.from(await up.arrayBuffer()); const h = Object.fromEntries(up.headers); delete h['content-encoding']; delete h['content-length']; delete h['transfer-encoding']
      res.writeHead(up.status, h); return res.end(out)
    }
    if (path === '/auth/v1/signup' && req.method === 'POST') {
      const { email, password } = JSON.parse((await body(req)).toString()); if (passwords.has(email)) return json(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' })
      const { rows } = await pool.query('insert into auth.users(email) values ($1) returning id,email', [email]); passwords.set(email, password); return json(res, 200, session(rows[0]))
    }
    if (path === '/auth/v1/token' && req.method === 'POST') {
      const grant = url.searchParams.get('grant_type'); const b = JSON.parse((await body(req)).toString())
      if (grant === 'password') { const { rows } = await pool.query('select id,email from auth.users where email=$1', [b.email]); if (!rows[0] || passwords.get(b.email) !== b.password) return json(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }); return json(res, 200, session(rows[0])) }
      if (grant === 'refresh_token') { const id = refresh.get(b.refresh_token); if (!id) return json(res, 400, { error: 'invalid_grant' }); const { rows } = await pool.query('select id,email from auth.users where id=$1', [id]); return json(res, 200, session(rows[0])) }
    }
    if (path === '/auth/v1/user') {
      const c = verify((req.headers.authorization ?? '').replace(/^Bearer /, '')); if (!c || c.role !== 'authenticated') return json(res, 401, { code: 401, msg: 'invalid JWT' })
      return json(res, 200, user({ id: c.sub, email: c.email }))
    }
    if (path === '/auth/v1/logout') { res.writeHead(204); return res.end() }

    let m
    if ((m = path.match(/^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/)) && req.method === 'POST') {     // create signed URL
      const key = `${m[1]}/${decodeURIComponent(m[2])}`; if (!objects.has(key)) return json(res, 404, { error: 'not_found', message: 'Object not found', statusCode: '404' })
      const token = crypto.randomUUID(); tokens.set(token, { key, exp: Date.now() + JSON.parse((await body(req)).toString() || '{}').expiresIn * 1000 })
      return json(res, 200, { signedURL: `/object/sign/${m[1]}/${m[2]}?token=${token}` })
    }
    if ((m = path.match(/^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/)) && req.method === 'GET') {        // fetch via signed URL
      const t = tokens.get(url.searchParams.get('token')); if (!t || t.exp < Date.now()) return json(res, 400, { error: 'InvalidJWT', message: 'expired or invalid token' })
      const o = objects.get(t.key); const h = { 'content-type': o.type }; if (url.searchParams.has('download')) h['content-disposition'] = `attachment; filename="${url.searchParams.get('download')}"`
      res.writeHead(200, h); return res.end(o.buf)
    }
    if ((m = path.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/)) && req.method === 'POST') {            // upload
      const c = verify((req.headers.authorization ?? '').replace(/^Bearer /, '')); if (!c) return json(res, 401, { error: 'Unauthorized', statusCode: '401' })
      const key = `${m[1]}/${decodeURIComponent(m[2])}`; if (objects.has(key)) return json(res, 400, { error: 'Duplicate', message: 'The resource already exists', statusCode: '409' })
      objects.set(key, { buf: await body(req), type: req.headers['content-type'] ?? 'application/octet-stream' }); return json(res, 200, { Key: key, Id: crypto.randomUUID() })
    }
    if ((m = path.match(/^\/storage\/v1\/object\/(?:authenticated\/)?([^/]+)\/(.+)$/)) && req.method === 'GET') {   // authenticated download (service role)
      const c = verify((req.headers.authorization ?? '').replace(/^Bearer /, '')); if (!c || c.role !== 'service_role') return json(res, 403, { error: 'Unauthorized', statusCode: '403' })
      const o = objects.get(`${m[1]}/${decodeURIComponent(m[2])}`); if (!o) return json(res, 404, { error: 'not_found', statusCode: '404' })
      res.writeHead(200, { 'content-type': o.type }); return res.end(o.buf)
    }
    if (path === '/__objects') return json(res, 200, [...objects.keys()])            // test introspection
    json(res, 404, { error: 'not found', path })
  } catch (e) { console.error(e); json(res, 500, { error: String(e) }) }
}).listen(Number(PORT), () => console.log('fake supabase gateway on', PORT))
