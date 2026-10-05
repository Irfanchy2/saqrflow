#!/usr/bin/env bash
# Spins up a throwaway Postgres cluster, applies supabase stub + all migrations, runs DB tests (RLS, tenant isolation, etc.)
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
DIR=$(mktemp -d); PORT=${PGTEST_PORT:-54329}
RUNAS=""; if [ "$(id -u)" = "0" ]; then chown "postgres" "$DIR" 2>/dev/null || true; RUNAS="su postgres -c"; fi
run() { if [ -n "$RUNAS" ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
cleanup() { run "$PGBIN/pg_ctl -D $DIR/data stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
run "$PGBIN/initdb -D $DIR/data -A trust -U postgres" >/dev/null
run "$PGBIN/pg_ctl -D $DIR/data -o '-p $PORT -k /tmp' -l $DIR/log -w start" >/dev/null
export PGHOST=/tmp PGPORT=$PORT PGUSER=postgres
psql -qv ON_ERROR_STOP=1 -c "create database saqrflow_test" postgres
export PGDATABASE=saqrflow_test
psql -q -v ON_ERROR_STOP=1 -f tests/db/supabase_stub.sql
for f in supabase/migrations/*.sql; do echo "applying $f"; psql -q -v ON_ERROR_STOP=1 -f "$f"; done
export DATABASE_URL="postgresql://postgres@localhost:$PORT/saqrflow_test?host=/tmp"
npx vitest run --config vitest.db.config.ts
