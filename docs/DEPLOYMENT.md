# Deployment Guide (Supabase + Vercel)

**Nothing here has been done yet. Each step that creates an account or a charge needs your approval first.**
Steps marked 🔐 involve secrets: type them only into the Supabase/Vercel dashboards — never into chat, email
or a file in the repository.

## Environments

| | Staging | Sales demo | Production |
|---|---|---|---|
| Address | `staging.yourdomain.com` | `demo.yourdomain.com` | `app.yourdomain.com` |
| Supabase project | `bluewater-staging` | `bluewater-demo` | `bluewater-prod` (Pro plan) |
| Vercel project | `bluewater` (Preview, `staging` branch) | `bluewater-demo` | `bluewater` (Production, `main` branch) |
| `APP_ENV` | `staging` | `demo` | `production` |
| Real messages | never | **impossible** (enforced in code) | only after go‑live approval |

## 1. Supabase project (repeat per environment)

1. Create an organization **Bluewater Collective** at supabase.com using a Bluewater business email.
   Production needs the **Pro** plan (backups; no pausing). Choose a US region near your clients.
2. **Authentication → Providers → Email:** enable email/password; **disable "Allow new users to sign up"**
   (accounts come only from invitations); require email confirmation.
3. **Authentication → Multi‑Factor:** enable **TOTP**.
4. **Authentication → URL Configuration:** Site URL = the environment address; add `/reset-password` to
   redirect URLs.
5. **Authentication → Email Templates → Reset password:** set the link to
   `{{ .SiteURL }}/reset-password?token={{ .TokenHash }}`.
6. **Authentication → SMTP:** use Postmark SMTP so emails come from your domain (after Postmark setup).
7. 🔐 **Project Settings → API keys:** note the *publishable* key (safe for browsers) and the *secret* key
   (server only). Put them into Vercel (step 3), nowhere else.
8. 🔐 **Database:** copy the connection strings. Migrations use the `postgres` (owner) connection; the app
   uses the role `bluewater_app` via the **transaction pooler** (port 6543, user `bluewater_app.<project-ref>`).

## 2. Run migrations

From your computer (or a CI job) with the owner connection — the password stays in your terminal session:
```bash
DATABASE_MIGRATION_URL='postgres://postgres.<ref>:<password>@<pooler-host>:5432/postgres' \
APP_DB_ROLE_PASSWORD='<new long random password for bluewater_app>' \
npm run db:migrate
```
This creates the `app` schema, row‑level security, and sets the `bluewater_app` password.
**Live check (pending):** confirm the app role connects through the pooler; if Supabase's pooler rejects
custom roles, fall back to the session pooler or direct connection and record it in DECISIONS.md.

## 3. Vercel project

1. Create a Vercel account/team (Pro plan for commercial use) and **Import** the GitHub repository.
2. 🔐 **Settings → Environment Variables** (per environment), from `.env.example`:
   `APP_ENV`, `APP_BASE_URL`, `DATABASE_URL` (app role, pooler), `AUTH_PROVIDER=supabase`,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
   `ENCRYPTION_KEY` (new random value per environment — store a copy in your password manager),
   `SYSTEM_EMAIL_TRANSPORT=postmark`, `SYSTEM_EMAIL_FROM`, `POSTMARK_SERVER_TOKEN`, `LIVE_SENDING_ENABLED=false`.
   Do **not** set `DATABASE_MIGRATION_URL` in Vercel.
3. Deploy. The app refuses to start with an unsafe configuration (e.g. local login on a hosted site).
4. Create the first administrator: create the user in Supabase → Authentication → Users, then run
   `ADMIN_EMAIL=… ADMIN_AUTH_USER_ID=<id> DATABASE_URL=<app url> npm run admin:create`. Sign in and set up
   two‑step verification.

## 4. Domain and HTTPS

1. Buy/keep the domain in an account you own (registrar login in your password manager).
2. Vercel → Project → **Domains** → add `app.yourdomain.com` (and `demo.`, `staging.`). Vercel shows the DNS
   record to create at your registrar (usually a CNAME). HTTPS certificates are issued and renewed
   automatically once DNS is correct.
3. Update `APP_BASE_URL` and Supabase Site URL to the new address.

## 5. Monitoring and backups

- External uptime check on `https://app.yourdomain.com/login` (and `/api/health` once added in Stage 7) with
  alerts to your phone directly from the monitoring service.
- Error tracking (Sentry or similar) — Stage 7.
- Supabase Pro daily backups (7 days). Optional PITR add‑on. Stage 7 adds an off‑platform encrypted
  `pg_dump` copy and a documented, tested restore.

## Release, verification and rollback

1. Work happens on a branch → pull request → automated checks (`typecheck`, `lint`, `test`, `build`).
2. Merge to `staging` → Vercel deploys staging → run the browser tests against staging → manual smoke test.
3. Merge to `main` → production deploy. Run migrations **before** deploying code that needs them; write
   migrations to be backward‑compatible (add columns first, remove later).
4. **Rollback:** Vercel → Deployments → previous deployment → *Promote to Production* (instant). This rolls
   back **code only**. Database changes are not undone — every migration must note whether it is reversible
   and how; irreversible ones (dropping data) need a backup taken immediately beforehand and your approval.

## Maintenance schedule (proposed)

| Frequency | Task |
|---|---|
| Daily (automatic) | Backups; uptime checks; error alerts |
| Weekly | Review errors and failed jobs; check message failure rates (Stage 3+) |
| Monthly | Dependency/security updates on staging first; review costs vs. budget; review admin access list |
| Quarterly | Restore test into an isolated project; review Meta/Google API version deprecations; rotate keys |
| Yearly | Domain renewal; A2P registrations review; legal/terms review |
