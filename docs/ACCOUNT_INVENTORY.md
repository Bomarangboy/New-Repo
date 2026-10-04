# Account Inventory

Every outside account Bluewater depends on. **No passwords, keys or tokens belong in this file** — keep them
in a password manager (e.g. 1Password/Bitwarden) under a Bluewater business vault, with two‑step
verification on every account. Register all accounts to a Bluewater business email (not a personal one), so
the business — not an individual — owns them.

| Account | Purpose | Owner (who controls login) | Billing | Renewal | Recovery | Support | Status |
|---|---|---|---|---|---|---|---|
| GitHub (`Bomarangboy/New-Repo`) | Source code | You | Free/Team | — | GitHub account recovery codes | github.com/support | Exists |
| Password manager | All secrets & recovery codes | You | Monthly/annual | Annual | Emergency kit stored offline | vendor | **To create** |
| Domain registrar | `yourdomain.com` | You | Annual | Annual (auto‑renew on) | Registrar 2FA codes | registrar | **To choose** |
| Supabase org | Database, sign‑in, backups, cron | You (developer as member) | Monthly (Pro for prod) | Monthly | Org owner email + 2FA | supabase.com/support | **To create** |
| Vercel team | Web hosting, HTTPS | You (developer as member) | Pro monthly | Monthly | Owner email + 2FA | vercel.com/help | **To create** |
| Postmark | Bluewater + client email | You | Monthly | Monthly | Owner email + 2FA | postmarkapp.com/support | **To create** |
| Twilio | Texting (subaccount per client) | You | Usage + monthly fees | Monthly | Owner email + 2FA; recovery code | twilio.com/help | **To create** |
| Meta for Developers / Business Manager | Lead forms + ad reporting app | You (Business Manager admin) | Free | App review renewals | Business Manager admins (keep 2) | developers.facebook.com/support | **To create** (Stage 5) |
| Google Cloud + Google Ads API | Ad reporting / lead forms | You | Free (API) | — | Google account 2FA | developers.google.com/google-ads/api/support | **To create** (Stage 5) |
| Scheduling tool (e.g. Cal.com) | Booking connector | You / client | TBD (D‑10) | — | — | vendor | Decision pending |
| Uptime monitor | Independent alerts | You | Free tier | — | — | vendor | **To create** (Stage 7) |
| Error tracking (e.g. Sentry) | Error reports | You | Free tier | — | — | vendor | **To create** (Stage 7) |

Keep at least **two** people (you and a trusted backup) able to recover the critical accounts (registrar,
Supabase, Vercel, GitHub, password manager). Losing the `ENCRYPTION_KEY` makes stored MFA secrets and
integration tokens unreadable (users would re‑enroll and reconnect) — store it in the password manager.

## Runtime dependencies & portability
- Next.js app → can run on any Node.js host (Render, Railway, Fly.io, a VPS) with minor config changes.
- PostgreSQL → standard; dump/restore to any Postgres 15+ host (RLS and roles included in migrations).
- Supabase Auth → main lock‑in; users exportable, passwords need resetting after a move.
- Supabase Cron trigger → replaceable by Vercel Cron or any scheduler calling the same endpoint.
- No AI services are used at runtime. (Claude is used only for development and is not a runtime dependency.)
