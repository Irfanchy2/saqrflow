# WhatsApp through Evolution API (self-hosted)

Averiqo can send WhatsApp messages in two ways (Settings → WhatsApp):

| | Meta Cloud API (official) | Evolution API (self-hosted) |
|---|---|---|
| Number | WhatsApp Business Platform number, verified in Meta | Any normal WhatsApp / WhatsApp Business app number |
| Set-up | Meta Business account, app, permanent token | Your own small server + scan a QR code |
| Message text | Only Meta-approved templates, custom text only within 24 h of the customer's last message | Any text at any time |
| PDF | Template with a document header | The PDF itself as a WhatsApp document, the message as its caption |
| Cost | Per conversation, billed by Meta | Server only (~5–10 USD / month) |
| Risk | None (official) | Unofficial WhatsApp Web connection: a number that spams can be banned |

Evolution API (github.com/EvolutionAPI/evolution-api, Apache-2.0) keeps a WhatsApp Web session open and exposes it as an
HTTP API. It **cannot run on Vercel**: it needs a server that is always on. Averiqo only talks to it over HTTPS.

## 1. Run the server

Any small Linux VPS (1 vCPU, 2 GB RAM: Hetzner, DigitalOcean, Contabo, AWS Lightsail…) with Docker and a domain name
pointing at it, e.g. `wa.yourcompany.com`. Railway or Render also work with the same image and variables.

### Quickest: the installer (Ubuntu / Debian VPS)

1. At your domain's DNS provider add an **A record**: name `wa` (or any subdomain), value = the VPS IP address
   (Cloudflare: proxy **off**, grey cloud).
2. Log in to the VPS (`ssh root@<server IP>`) and run:

```bash
curl -fsSL https://raw.githubusercontent.com/Irfanchy2/saqrflow/main/deploy/evolution/install.sh -o install.sh
sudo bash install.sh wa.yourcompany.com
```

It checks the DNS record, installs Docker, creates `/opt/evolution` with random secrets generated on the server,
starts Evolution API v2.3.7 + Postgres + Redis + Caddy (automatic HTTPS), waits until `https://wa.yourcompany.com`
answers and prints the server URL and API key to paste into Averiqo. Running it again keeps the existing secrets,
WhatsApp session and data. Chat history is not stored on the server (only what delivery receipts need), and the
project's telemetry is switched off.

### Manually

`docker-compose.yml` (Caddy gets the HTTPS certificate automatically):

```yaml
services:
  evolution:
    image: evoapicloud/evolution-api:v2.3.7
    restart: always
    env_file: .env
    volumes: [evolution_instances:/evolution/instances]
    depends_on: [postgres, redis]
  postgres:
    image: postgres:15
    restart: always
    environment: { POSTGRES_DB: evolution, POSTGRES_USER: evolution, POSTGRES_PASSWORD: ${POSTGRES_PASSWORD} }
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
    command: caddy reverse-proxy --from wa.yourcompany.com --to evolution:8080
    volumes: [caddy:/data]
volumes: { evolution_instances: {}, pg: {}, redis: {}, caddy: {} }
```

`.env` next to it (generate the two secrets with `openssl rand -hex 32`; never commit this file):

```
POSTGRES_PASSWORD=<random>
SERVER_URL=https://wa.yourcompany.com
AUTHENTICATION_API_KEY=<random, this is the API key you paste into Averiqo>
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://evolution:<POSTGRES_PASSWORD>@postgres:5432/evolution
DATABASE_SAVE_DATA_INSTANCE=true
CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=redis://redis:6379
CACHE_LOCAL_ENABLED=false
DEL_INSTANCE=false
LANGUAGE=en
CONFIG_SESSION_PHONE_CLIENT=Averiqo
CONFIG_SESSION_PHONE_NAME=Chrome
```

Then `docker compose up -d`. `https://wa.yourcompany.com` should answer with a JSON welcome message.

## 2. Connect it in Averiqo

Settings → **WhatsApp via Evolution API**:

1. Tick *Send WhatsApp messages through Evolution API*.
2. **Server URL**: `https://wa.yourcompany.com`. **Instance name**: any short name, e.g. `alsaqr-main`. **API key**: the
   `AUTHENTICATION_API_KEY`. Save. The key is encrypted (AES-GCM, `SETTINGS_ENCRYPTION_KEY`) and never shown again.
3. **Link WhatsApp**: Averiqo creates the instance, points its webhook at
   `<NEXT_PUBLIC_APP_URL>/api/webhooks/evolution/<company id>` with a random secret header, and shows the QR code.
   On the company phone: WhatsApp → Settings → Linked devices → Link a device → scan. The card switches to *Linked · live*.
4. **Test connection** confirms the link. Make sure *Force sandbox mode* (Meta section) is off, otherwise nothing is sent.

Vercel needs `NEXT_PUBLIC_APP_URL` and `SETTINGS_ENCRYPTION_KEY` set (both already used by other features).

## What changes when Evolution API is selected

* Every *Send via WhatsApp* button (invoices, quotations, delivery notes, receipts, salary receipts, statements, reminders,
  cheques, projects, document expiry) sends through your server. PDFs are sent as real documents.
* No Meta templates to submit and no 24-hour window: *Write a custom message* is always available.
* Internal notifications (reminders, daily summary, alerts, test messages) are sent as plain WhatsApp text.
* Delivery receipts (sent → delivered → read) and STOP / START replies come back through the webhook; a tax invoice
  read on WhatsApp is marked *Viewed*. STOP opts the number out for this company only.
* If the phone is offline or unlinked, messages are kept and retried automatically (up to 4 attempts) and the error is
  shown. A number that is not on WhatsApp fails at once with a clear reason.
* Untick the box to go back to the Meta Cloud API. Nothing is deleted.

## Security

* Only users with *settings.manage* can change the connection; the shared demo company can never send.
* The server URL must be `https://` and resolve to a public address (blocks requests to internal networks).
* The API key and webhook secret are stored encrypted in `integration_secrets` (service-role only, no RLS policies).
* Webhook calls without the right `x-averiqo-token` header are rejected (401) and logged as security events. Events for
  another instance name are ignored.
* ID, passport, IBAN and card numbers are masked in every message as before; salary amounts are never in message text.

## Keeping the number safe

WhatsApp does not officially support WhatsApp Web automation for businesses. Use a dedicated company number, message
people who expect to hear from you (customers, staff), honour STOP replies (Averiqo does this automatically) and avoid
bulk marketing. Keep the phone charged and online; if WhatsApp logs it out, link it again from Settings.
