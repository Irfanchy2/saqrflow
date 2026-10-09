#!/usr/bin/env bash
# End-to-end: Postgres + REAL PostgREST + fake auth/storage gateway + production Next.js build + headless Chromium.
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
WORK=${E2E_WORK:-/var/tmp/saqrflow-e2e}; rm -rf "$WORK"; mkdir -p "$WORK"; chmod 777 "$WORK"
PGRST_BIN=${PGRST_BIN:-/tmp/claude-0/pgrst/postgrest}
if [ ! -x "$PGRST_BIN" ]; then
  mkdir -p "$(dirname "$PGRST_BIN")"; curl -sSL -o "$(dirname "$PGRST_BIN")/p.tar.xz" https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz
  tar -xf "$(dirname "$PGRST_BIN")/p.tar.xz" -C "$(dirname "$PGRST_BIN")"
fi
PGPORT=54330; export JWT_SECRET="e2e-secret-e2e-secret-e2e-secret-0123456789"
as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
PIDS=()
pkill -f next-server 2>/dev/null || true; pkill -f fake-supabase 2>/dev/null || true; pkill -x postgrest 2>/dev/null || true
cleanup() { pkill -f next-server 2>/dev/null || true; for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; as_pg "$PGBIN/pg_ctl -D $WORK/data stop -m immediate" >/dev/null 2>&1 || true; }
trap cleanup EXIT
as_pg "$PGBIN/initdb -D $WORK/data -A trust -U postgres" >/dev/null
as_pg "$PGBIN/pg_ctl -D $WORK/data -o '-p $PGPORT -k /tmp' -l $WORK/pg.log -w start" >/dev/null
export PGHOST=/tmp PGPORT PGUSER=postgres
psql -qc "create database e2e" postgres; export PGDATABASE=e2e
psql -q -v ON_ERROR_STOP=1 -f tests/db/supabase_stub.sql >/dev/null
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done

PGRST_DB_URI="postgres://authenticator:authpass@localhost:$PGPORT/e2e?host=/tmp" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon \
  PGRST_JWT_SECRET="$JWT_SECRET" PGRST_SERVER_PORT=54331 PGRST_DB_MAX_ROWS=5000 "$PGRST_BIN" >"$WORK/pgrst.log" 2>&1 & PIDS+=($!)
DATABASE_URL="postgresql://postgres@localhost:$PGPORT/e2e?host=/tmp" PGRST_URL=http://127.0.0.1:54331 PORT=54399 node tests/e2e/fake-supabase.mjs >"$WORK/gw.log" 2>&1 & PIDS+=($!)
sleep 2

mint() { node -e "const c=require('crypto'),b=x=>Buffer.from(x).toString('base64url'),h=b(JSON.stringify({alg:'HS256',typ:'JWT'})),p=b(JSON.stringify({role:'$1',iss:'e2e',exp:4102444800}));console.log(h+'.'+p+'.'+c.createHmac('sha256',process.env.JWT_SECRET).update(h+'.'+p).digest('base64url'))"; }
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 NEXT_PUBLIC_SUPABASE_ANON_KEY=$(mint anon) SUPABASE_SERVICE_ROLE_KEY=$(mint service_role)
export NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100 CRON_SECRET=e2e-cron-secret-0123456789 SETTINGS_ENCRYPTION_KEY=$(node -e "console.log(Buffer.alloc(32,9).toString('base64'))")
# OCR.Space + Gemini point at the gateway's /mock endpoints (same HTTP contract as the real APIs)
export OCR_SPACE_API_KEY=test-ocr-key OCR_SPACE_ENDPOINT=http://127.0.0.1:54399/mock/ocrspace/parse/image GEMINI_API_KEY=test-gemini-key GEMINI_ENDPOINT=http://127.0.0.1:54399/mock/gemini GEMINI_MODEL=gemini-2.5-flash
export WHATSAPP_GRAPH_URL=http://127.0.0.1:54399/mock/graph   # WhatsApp Cloud API stand-in (gateway), same contract as graph.facebook.com
export WEBHOOK_ALLOW_PRIVATE=1   # webhooks to the local test receiver only (never set in production)
export DATABASE_URL="postgresql://postgres@localhost:$PGPORT/e2e?host=/tmp" WHATSAPP_APP_SECRET=e2e-app-secret WHATSAPP_VERIFY_TOKEN=e2e-verify E2E_BASE=http://127.0.0.1:3100 E2E_GATEWAY=http://127.0.0.1:54399
rm -rf .next; NEXT_TELEMETRY_DISABLED=1 npx next build >"$WORK/build.log" 2>&1   # NEXT_PUBLIC_* are inlined at build time
NEXT_TELEMETRY_DISABLED=1 npx next start -p 3100 >"$WORK/next.log" 2>&1 & PIDS+=($!)
for i in $(seq 1 40); do curl -sf http://127.0.0.1:3100/api/health >/dev/null && break; sleep 1; done
mkdir -p tests/e2e/shots
if [ -n "${E2E_HOLD:-}" ]; then echo READY; sleep 3600; exit 0; fi   # keep the stack up for debugging
if [ -n "${E2E_ONLY:-}" ]; then set +e; node "tests/e2e/$E2E_ONLY"; RC=$?; set -e; exit $RC; fi   # run a single suite
set +e; node tests/e2e/smoke.mjs; RC=$?; node tests/e2e/inbox.mjs; RC2=$?; node tests/e2e/sales.mjs; RC3=$?; node tests/e2e/ai-reader.mjs; RC4=$?; node tests/e2e/print.mjs; RC5=$?; if [ $RC5 -ne 0 ]; then RC=$RC5; fi; node tests/e2e/erp.mjs; RC6=$?; if [ $RC6 -ne 0 ]; then RC=$RC6; fi; node tests/e2e/averiqo.mjs; RC7=$?; if [ $RC7 -ne 0 ]; then RC=$RC7; fi; node tests/e2e/operations.mjs; RC8=$?; if [ $RC8 -ne 0 ]; then RC=$RC8; fi; node tests/e2e/advanced.mjs; RC9=$?; if [ $RC9 -ne 0 ]; then RC=$RC9; fi; node tests/e2e/portals.mjs; RC10=$?; if [ $RC10 -ne 0 ]; then RC=$RC10; fi; node tests/e2e/service.mjs; RC11=$?; if [ $RC11 -ne 0 ]; then RC=$RC11; fi; node tests/e2e/platform.mjs; RC12=$?; if [ $RC12 -ne 0 ]; then RC=$RC12; fi; node tests/e2e/extras.mjs; RC13=$?; if [ $RC13 -ne 0 ]; then RC=$RC13; fi; node tests/e2e/whatsapp.mjs; RC14=$?; if [ $RC14 -ne 0 ]; then RC=$RC14; fi; set -e; if [ $RC4 -ne 0 ]; then RC=$RC4; fi; if [ $RC2 -ne 0 ]; then RC=$RC2; fi; if [ $RC3 -ne 0 ]; then RC=$RC3; fi
echo "--- logs: $WORK (next.log, pgrst.log) ---"; grep -iE "error|PGRST" "$WORK/next.log" | head -20 || true
exit $RC
