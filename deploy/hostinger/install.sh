#!/usr/bin/env bash
# Averiqo on a Hostinger KVM VPS (Ubuntu / Debian): the app + the Evolution API WhatsApp server, behind Caddy (HTTPS).
# The database and files stay on Supabase.
#
#   sudo bash install.sh app.yourcompany.com wa.yourcompany.com
#   sudo bash install.sh yourcompany.com wa.yourcompany.com      (app on the main domain; www redirects when its DNS is set)
#
# Safe to run again (it then updates the code and keeps every secret and the WhatsApp session).
# Secrets are typed here, on the server (hidden input); nothing is sent anywhere else.
set -euo pipefail

APP="${1:-}"; WA="${2:-}"; APP="${APP,,}"; WA="${WA,,}"
REPO="https://github.com/Irfanchy2/saqrflow.git"
EVO_IMAGE="evoapicloud/evolution-api:v2.3.7"
DIR=/opt/averiqo
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }
ask() { local v; read -r -p "   $1: " v </dev/tty; printf '%s' "$v"; }
ask_secret() { local v; read -r -s -p "   $1: " v </dev/tty; echo >&2; printf '%s' "$v"; }
RE='^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'

[ "$(id -u)" = 0 ] || die "run it as root:  sudo bash install.sh app.yourcompany.com wa.yourcompany.com"
[[ "$APP" =~ $RE && "$WA" =~ $RE && "$APP" != "$WA" ]] || die "give two different subdomains, e.g.:  sudo bash install.sh app.yourcompany.com wa.yourcompany.com"
command -v apt-get >/dev/null || die "this script supports Ubuntu / Debian only"

say "1/8  Checking DNS"
apt-get update -qq >/dev/null && apt-get install -y -qq curl openssl dnsutils ca-certificates git >/dev/null
MYIP=$(curl -4 -fsS --max-time 10 https://api.ipify.org || true)
for d in "$APP" "$WA"; do
  ip=$(dig +short A "$d" | tail -1); echo "   $d -> ${ip:-nothing}   (this server: ${MYIP:-unknown})"
  [ -n "$ip" ] && [ "$ip" = "$MYIP" ] || die "add an A record for $d pointing to ${MYIP:-the server IP} (hPanel -> Domains -> DNS / Nameservers), wait a few minutes and run this again"
done
# www.<app domain>: served (redirecting to the main address) only when its DNS record already points here
WWW=
if [ "$(dig +short A "www.$APP" | tail -1)" = "$MYIP" ]; then WWW="www.$APP"; echo "   www.$APP -> this server: will redirect to https://$APP"; fi

say "2/8  Memory and Docker"
if [ "$(swapon --show --noheadings | wc -l)" = 0 ] && [ "$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)" -lt 7000 ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "   added 4 GB swap (building the app needs it on small plans)"
fi
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then curl -fsSL https://get.docker.com | sh >/dev/null; fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version

say "3/8  Code"
mkdir -p "$DIR"; cd "$DIR"
if [ -d src/.git ]; then git -C src fetch -q origin main && git -C src reset -q --hard origin/main; else git clone -q --depth 1 "$REPO" src; fi
echo "   $(git -C src log --oneline -1)"

say "4/8  App settings"
umask 077
if [ ! -f app.env ]; then
  echo "   Values from Supabase -> Project Settings -> API Keys, and the encryption key you saved for Vercel."
  SB_URL=$(ask "Supabase URL (https://xxxx.supabase.co)")
  [[ "$SB_URL" =~ ^https://[a-z0-9]+\.supabase\.co$ ]] || die "that is not a Supabase URL"
  SB_PUB=$(ask "Supabase publishable key (sb_publishable_...)")
  [ -n "$SB_PUB" ] || die "the publishable key is required"
  SB_SECRET=$(ask_secret "Supabase secret key (sb_secret_... or service_role; hidden)")
  [ ${#SB_SECRET} -ge 20 ] || die "the secret key is required"
  ENC=$(ask_secret "SETTINGS_ENCRYPTION_KEY (the same value as on Vercel; hidden)")
  [ "$(printf '%s' "$ENC" | base64 -d 2>/dev/null | wc -c)" = 32 ] || die "SETTINGS_ENCRYPTION_KEY must be the 44-character value you created (32 bytes, base64)"
  OCR=$(ask_secret "OCR.space API key (optional, Enter to skip; hidden)")
  GEM=$(ask_secret "Gemini API key (optional, Enter to skip; hidden)")
  cat > app.env <<EOF
NEXT_PUBLIC_SUPABASE_URL=$SB_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$SB_PUB
NEXT_PUBLIC_APP_URL=https://$APP
SUPABASE_SECRET_KEY=$SB_SECRET
SETTINGS_ENCRYPTION_KEY=$ENC
CRON_SECRET=$(openssl rand -hex 32)
${OCR:+OCR_SPACE_API_KEY=$OCR}
${GEM:+GEMINI_API_KEY=$GEM}
EOF
  echo "   saved $DIR/app.env (root only)"
else
  sed -i "s#^NEXT_PUBLIC_APP_URL=.*#NEXT_PUBLIC_APP_URL=https://$APP#" app.env
  echo "   app.env exists: keeping it"
fi
chmod 600 app.env
getv() { grep "^$1=" "$2" | head -1 | cut -d= -f2-; }

say "5/8  WhatsApp server settings"
if [ ! -f evolution.env ]; then
  if [ -f /opt/evolution/.env ]; then cp /opt/evolution/.env evolution.env; echo "   reusing the existing Evolution API key and database password"
  else
    PG=$(openssl rand -hex 24)
    cat > evolution.env <<EOF
POSTGRES_PASSWORD=$PG
SERVER_TYPE=http
SERVER_PORT=8080
SERVER_URL=https://$WA
SERVER_DISABLE_DOCS=true
AUTHENTICATION_API_KEY=$(openssl rand -hex 32)
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
  fi
fi
sed -i "s#^SERVER_URL=.*#SERVER_URL=https://$WA#" evolution.env; chmod 600 evolution.env

# values docker compose substitutes into docker-compose.yml (build arguments and the Postgres password)
cat > .env <<EOF
NEXT_PUBLIC_SUPABASE_URL=$(getv NEXT_PUBLIC_SUPABASE_URL app.env)
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$(getv NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY app.env)
NEXT_PUBLIC_APP_URL=https://$APP
POSTGRES_PASSWORD=$(getv POSTGRES_PASSWORD evolution.env)
EOF
chmod 600 .env

cat > Caddyfile <<EOF
$APP {
	encode zstd gzip
	reverse_proxy app:3000
}
$WA {
	reverse_proxy evolution:8080
}
EOF
[ -n "$WWW" ] && printf '%s {\n\tredir https://%s{uri} permanent\n}\n' "$WWW" "$APP" >> Caddyfile

cat > docker-compose.yml <<'EOF'
services:
  app:
    build:
      context: ./src
      args:
        NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL}
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}
        NEXT_PUBLIC_APP_URL: ${NEXT_PUBLIC_APP_URL}
    image: averiqo-app:latest
    restart: always
    env_file: app.env
  evolution:
    image: EVO_IMAGE_PLACEHOLDER
    restart: always
    env_file: evolution.env
    volumes: [evolution_instances:/evolution/instances]
    depends_on: [postgres, redis]
  postgres:
    image: postgres:15
    restart: always
    environment:
      POSTGRES_DB: evolution
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
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
    volumes: [./Caddyfile:/etc/caddy/Caddyfile:ro, caddy:/data]
    depends_on: [app, evolution]
volumes:
  # fixed names: the same WhatsApp session / data as a stand-alone Evolution install (deploy/evolution) is reused
  evolution_instances: { name: evolution_evolution_instances }
  pg: { name: evolution_pg }
  redis: { name: evolution_redis }
  caddy: { name: averiqo_caddy }
EOF
sed -i "s#EVO_IMAGE_PLACEHOLDER#$EVO_IMAGE#" docker-compose.yml

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi

say "6/8  Building the app (10-20 minutes the first time)"
docker compose build app

say "7/8  Starting"
if [ -f /opt/evolution/docker-compose.yml ]; then (cd /opt/evolution && docker compose down) || true; echo "   stopped the stand-alone Evolution install (its data is kept and reused)"; fi
docker compose pull -q evolution postgres redis caddy
docker compose up -d --remove-orphans

# daily jobs (reminders, alerts, scheduled reports, attendance auto-close) and a 10-minute sweep (webhooks, queued alerts)
cat > cron.sh <<'EOF'
#!/usr/bin/env bash
S=$(grep '^CRON_SECRET=' /opt/averiqo/app.env | cut -d= -f2-); U=$(grep '^NEXT_PUBLIC_APP_URL=' /opt/averiqo/app.env | cut -d= -f2-)
curl -fsS -m 600 -H "Authorization: Bearer $S" "$U/api/cron/$1" >> /var/log/averiqo-cron.log 2>&1; echo " $(date -Is) $1" >> /var/log/averiqo-cron.log
EOF
chmod 700 cron.sh
cat > /etc/cron.d/averiqo <<'EOF'
0 4 * * * root /opt/averiqo/cron.sh reminders
*/10 * * * * root /opt/averiqo/cron.sh events
EOF
chmod 644 /etc/cron.d/averiqo
cp -f src/deploy/hostinger/update.sh /usr/local/bin/averiqo-update && chmod 755 /usr/local/bin/averiqo-update

say "8/8  Waiting for https://$APP and https://$WA"
OK=
for i in $(seq 1 72); do
  if curl -fsS --max-time 5 "https://$APP/api/health" 2>/dev/null | grep -q '"admin":true' && curl -fsS --max-time 5 "https://$WA" 2>/dev/null | grep -qi evolution; then OK=1; break; fi
  sleep 5
done
[ -n "$OK" ] || die "not answering yet. Check:  cd $DIR && docker compose ps && docker compose logs --tail 60 caddy app evolution"

say "Done."
cat <<EOF

  App:              https://$APP
  WhatsApp server:  https://$WA

  1. Supabase -> Authentication -> URL Configuration:
       Site URL       https://$APP
       Redirect URLs  add  https://$APP/**
     (sign-up, invitation and password-reset emails then link to the new address)

  2. In the app: Settings -> WhatsApp via Evolution API
       Server URL  https://$WA
       API key     $(getv AUTHENTICATION_API_KEY evolution.env)
     Save -> Link WhatsApp -> scan the QR code -> Test connection.

  Daily jobs run at 04:00 UTC (log: /var/log/averiqo-cron.log). Run one now:  /opt/averiqo/cron.sh reminders
  Update to the latest code later:  sudo averiqo-update
  Secrets are in $DIR/app.env and $DIR/evolution.env (root only). Do not share them.
EOF
