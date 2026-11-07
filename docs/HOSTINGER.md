# Running Averiqo on a Hostinger VPS

One Hostinger KVM VPS runs the Averiqo app and the Evolution API WhatsApp server, behind Caddy (automatic HTTPS).
The database, logins and files **stay on Supabase**: nothing is copied or migrated, so no data is at risk.

```
browser ──https──> app.yourcompany.com ─┐
                                        ├─ Caddy ─> Averiqo app (Next.js) ──> Supabase (database, auth, files)
WhatsApp server <──https── wa.yourcompany.com ─┘     Evolution API + Postgres + Redis (WhatsApp session only)
```

## Requirements

* Hostinger **KVM 2 or larger** recommended (KVM 1 works; the installer adds swap for the build). OS template: **Ubuntu 24.04**.
* Two subdomains of a domain you control, e.g. `app.yourcompany.com` and `wa.yourcompany.com`.
* From Supabase → Project Settings → API Keys: the project URL, the publishable key and the **secret** key.
* The `SETTINGS_ENCRYPTION_KEY` you created for Vercel (use the same value, so stored keys stay readable).
* Optional: your OCR.space and Gemini API keys (receipt scanning); without them the built-in local OCR is used.

## Steps

1. **DNS** (hPanel → Domains → your domain → DNS / Nameservers): add two **A** records, `app` and `wa`, both pointing
   to the VPS IP (hPanel → VPS → Overview). Wait a few minutes.
2. **Log in**: hPanel → VPS → *Browser terminal*, or `ssh root@<VPS IP>`.
3. **Run the installer** (with your two subdomains):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/Irfanchy2/saqrflow/main/deploy/hostinger/install.sh -o install.sh
   sudo bash install.sh app.yourcompany.com wa.yourcompany.com
   ```

   To run the app on the main domain instead, use `sudo bash install.sh yourcompany.com wa.yourcompany.com` and add A
   records for `@`, `www` and `wa`; `www` then redirects to the main address.

   It asks for the Supabase values and keys (hidden input, stored only in `/opt/averiqo/app.env`, root-only), builds the
   app (10–20 minutes the first time), starts everything, schedules the daily jobs and prints the next steps.
4. **Supabase → Authentication → URL Configuration**: Site URL `https://app.yourcompany.com`, and add
   `https://app.yourcompany.com/**` to Redirect URLs (sign-up, invitation and password-reset emails).
5. **Open `https://app.yourcompany.com`** and sign in (sessions do not carry over from the Vercel address).
6. **WhatsApp**: Settings → WhatsApp via Evolution API → tick the box, Server URL `https://wa.yourcompany.com`,
   the API key the installer printed, an instance name → Save → Link WhatsApp → scan → Test connection.
7. When everything works, stop using the Vercel address (you can keep the Vercel project as a fallback or pause it).

## Daily jobs

Vercel Cron is replaced by `/etc/cron.d/averiqo`: reminders, rule alerts, scheduled reports and attendance auto-close
at 04:00 UTC (08:00 UAE), plus a 10-minute sweep for webhook retries and queued alerts. Log: `/var/log/averiqo-cron.log`.
Run one now: `/opt/averiqo/cron.sh reminders`.

## Day-to-day

| Task | Command |
|---|---|
| Update to the latest code (after merging a PR) | `sudo averiqo-update` |
| Status | `cd /opt/averiqo && docker compose ps` |
| App log | `cd /opt/averiqo && docker compose logs -f --tail 100 app` |
| Restart everything | `cd /opt/averiqo && docker compose restart` |
| Change a key | edit `/opt/averiqo/app.env`, then `docker compose up -d app` (for `NEXT_PUBLIC_*` values run `sudo averiqo-update`) |

Running the installer again is safe: it pulls the latest code and keeps every secret and the WhatsApp session.

## Security notes

* Only ports 22, 80 and 443 are needed; the app, Evolution, Postgres and Redis are not exposed directly.
* `app.env` and `evolution.env` are readable by root only. Keep a copy of `SETTINGS_ENCRYPTION_KEY` in a password manager.
* Turn on Hostinger's weekly VPS backups (hPanel → VPS → Backups); the business data itself is backed up by Supabase.
