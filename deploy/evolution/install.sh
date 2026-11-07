#!/usr/bin/env bash
# Averiqo: installs an Evolution API server (WhatsApp gateway) on a fresh Ubuntu / Debian VPS.
#
#   sudo bash install.sh wa.yourcompany.com
#
# What it does (safe to run again; existing secrets and data are kept):
#   1. checks the domain points at this server
#   2. installs Docker if it is missing
#   3. creates /opt/evolution with random secrets (generated here, never shown anywhere else)
#   4. starts Evolution API + Postgres + Redis + Caddy (automatic HTTPS certificate)
#   5. waits until https://<domain> answers and prints what to paste into Averiqo
set -euo pipefail

DOMAIN="${1:-}"; DOMAIN="${DOMAIN,,}"
IMAGE="evoapicloud/evolution-api:v2.3.7"
DIR=/opt/evolution
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run it as root: sudo bash install.sh $DOMAIN"
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || die "give your subdomain, e.g.: sudo bash install.sh wa.yourcompany.com"
command -v apt-get >/dev/null || die "this script supports Ubuntu / Debian only"

say "1/5  Checking that $DOMAIN points at this server"
apt-get update -qq >/dev/null && apt-get install -y -qq curl openssl dnsutils ca-certificates >/dev/null
MYIP=$(curl -4 -fsS --max-time 10 https://api.ipify.org || true)
DNSIP=$(dig +short A "$DOMAIN" | tail -1)
echo "   this server: ${MYIP:-unknown}   $DOMAIN -> ${DNSIP:-nothing}"
if [ -z "$DNSIP" ] || [ "$DNSIP" != "$MYIP" ]; then
  die "add a DNS record first:  type A,  name ${DOMAIN%%.*},  value ${MYIP:-<this server IP>}  (turn the Cloudflare proxy OFF / grey cloud), wait a few minutes, then run this again"
fi

say "2/5  Docker"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version

say "3/5  Configuration in $DIR"
mkdir -p "$DIR"; cd "$DIR"
if [ ! -f .env ]; then
  PG=$(openssl rand -hex 24); KEY=$(openssl rand -hex 32)
  umask 077
  cat > .env <<EOF
# Evolution API settings (created by the Averiqo installer). Keep this file private.
POSTGRES_PASSWORD=$PG
SERVER_TYPE=http
SERVER_PORT=8080
SERVER_URL=https://$DOMAIN
SERVER_DISABLE_DOCS=true
AUTHENTICATION_API_KEY=$KEY
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://evolution:$PG@postgres:5432/evolution
DATABASE_CONNECTION_CLIENT_NAME=evolution
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=true
DATABASE_SAVE_MESSAGE_UPDATE=true
DATABASE_SAVE_DATA_CONTACTS=false
DATABASE_SAVE_DATA_CHATS=false
DATABASE_SAVE_DATA_HISTORIC=false
DATABASE_SAVE_DATA_LABELS=false
CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=redis://redis:6379
CACHE_REDIS_PREFIX_KEY=evolution
CACHE_REDIS_SAVE_INSTANCES=false
CACHE_LOCAL_ENABLED=false
DEL_INSTANCE=false
LANGUAGE=en
LOG_LEVEL=ERROR,WARN,INFO
TELEMETRY_ENABLED=false
WEBHOOK_GLOBAL_ENABLED=false
CONFIG_SESSION_PHONE_CLIENT=Averiqo
CONFIG_SESSION_PHONE_NAME=Chrome
QRCODE_LIMIT=30
EOF
  echo "   created .env with new random secrets"
else
  echo "   .env already exists: keeping the existing secrets"
  sed -i "s#^SERVER_URL=.*#SERVER_URL=https://$DOMAIN#" .env
fi
chmod 600 .env

cat > docker-compose.yml <<EOF
services:
  evolution:
    image: $IMAGE
    restart: always
    env_file: .env
    volumes: [evolution_instances:/evolution/instances]
    depends_on: [postgres, redis]
  postgres:
    image: postgres:15
    restart: always
    environment:
      POSTGRES_DB: evolution
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    volumes: [pg:/var/lib/postgresql/data]
  redis:
    image: redis:7
    restart: always
    command: redis-server --appendonly yes
    volumes: [redis:/data]
  caddy:
    image: caddy:2
    restart: always
    ports: ["80:80", "443:443"]
    command: caddy reverse-proxy --from $DOMAIN --to evolution:8080
    volumes: [caddy:/data]
volumes: { evolution_instances: {}, pg: {}, redis: {}, caddy: {} }
EOF

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; echo "   firewall: opened 80 and 443"
fi

say "4/5  Starting (first start downloads about 1 GB, give it a few minutes)"
docker compose pull -q
docker compose up -d

say "5/5  Waiting for https://$DOMAIN"
for i in $(seq 1 60); do
  if curl -fsS --max-time 5 "https://$DOMAIN" 2>/dev/null | grep -qi "evolution"; then OK=1; break; fi
  sleep 5
done
[ "${OK:-}" = 1 ] || die "not answering yet. Check:  cd $DIR && docker compose logs --tail 50 caddy evolution   (ports 80/443 must be open in your provider's firewall too)"

KEY=$(grep '^AUTHENTICATION_API_KEY=' .env | cut -d= -f2)
say "Done. Evolution API is running at https://$DOMAIN"
cat <<EOF

  In Averiqo: Settings -> WhatsApp via Evolution API
    [x] Send WhatsApp messages through Evolution API
    Server URL     https://$DOMAIN
    Instance name  any short name, e.g. company-main
    API key        $KEY

  Then Save -> Link WhatsApp -> scan the QR code with the company phone -> Test connection.

  The key is also in $DIR/.env (readable by root only). Do not share it.
  Useful:  cd $DIR && docker compose ps      (status)
           cd $DIR && docker compose logs -f evolution   (live log)
           cd $DIR && docker compose pull && docker compose up -d   (update)
EOF
