#!/usr/bin/env bash
# Pull the latest Averiqo code, rebuild the app and restart it (WhatsApp server, secrets and data are untouched).
#   sudo averiqo-update
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run: sudo averiqo-update" >&2; exit 1; }
cd /opt/averiqo
git -C src fetch -q origin main && git -C src reset -q --hard origin/main
echo "code: $(git -C src log --oneline -1)"
docker compose build app
docker compose up -d app
cp -f src/deploy/hostinger/update.sh /usr/local/bin/averiqo-update
docker image prune -f >/dev/null
for i in $(seq 1 30); do docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null && { echo "updated and running"; exit 0; }; sleep 3; done
echo "the app did not come back; see: cd /opt/averiqo && docker compose logs --tail 80 app" >&2; exit 1
