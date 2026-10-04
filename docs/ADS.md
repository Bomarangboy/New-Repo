# Advertising connections: Meta & Google Ads (Stage 5)

Code: `src/server/ads/*`, routes `src/app/api/oauth/[platform]/callback`, `src/app/api/webhooks/meta`,
`src/app/api/webhooks/google-leads/[key]`. Tests: `tests/integration/ads.test.ts`, `tests/unit/ads-rules.test.ts`,
`tests/e2e/stage5.spec.ts`. Decisions: D‑31 … D‑35.

**Status:** built and tested against **simulated** platforms and faked platform responses. **Live use is blocked**
until Meta and Google approve Bluewater's apps (below), and the owner switches on `ADS_LIVE_ENABLED`.
Google lead‑form **webhooks** are the exception: they need no API approval and can be used as soon as Bluewater is deployed.

## What each connection does (support matrix)

| Capability | Meta (Facebook & Instagram) | Google Ads | Package |
|---|---|---|---|
| Lead‑form leads into Bluewater | ✅ webhook + fetch with the Page's token; hourly missed‑lead check | ✅ lead‑form webhook (no Google account connection needed) | All |
| Ad spend, impressions, clicks per campaign per day | ✅ Marketing API insights | ✅ Google Ads API (GAQL) | 3 |
| Platform's own lead / conversion counts | ✅ "lead" action count (shown as the platform's number) | ✅ conversions (Google's definition) | 3 |
| Leads credited to a campaign | ✅ when the campaign id comes with the lead | ✅ same | 3 |
| Website capture | — (separate: website forms, Stage 2) | — | All |
| Messages / replies | — not via ad platforms | — | — |
| Bookings | — (Cal.com, Stage 4) | — | 2+ |
| Sales outcomes | Recorded by your team in Bluewater; never taken from the platforms | same | 3 |
| Sending conversions back to the platforms | Not built (would need separate approval & consent review) | Not built | — |

A connected account does not imply every function: e.g. Package 1 and 2 connections only receive leads.

## Modes (D‑31)

| Mode | When | What happens |
|---|---|---|
| **Live** | `ADS_LIVE_ENABLED=true` (staging/production only; refused elsewhere), Bluewater's app credentials set, real customer company | Owner signs in to Meta/Google (OAuth). Real data. |
| **Simulated** | development, test, demo, and demo/test companies | "Connect a sample account (simulated)". Sample accounts, Pages and numbers; labeled *simulated* on every screen and in lead sources. |
| **Unavailable** | real customer in production before live is switched on | Card says "Not available yet — waiting for approval". No simulated data is ever shown to a real customer. |

## Connecting (live)

1. Owner (or Bluewater in a support session with edit access) presses **Connect** on Connected Accounts.
2. Bluewater sends them to Meta's/Google's own sign‑in with a signed, 10‑minute "state" tied to the company, the
   user and a browser cookie. On return, all four are re‑checked before anything is saved (tested).
3. Tokens are stored **encrypted**; they never reach the browser, logs or activity log. Meta calls include
   `appsecret_proof`. Google access tokens are refreshed automatically; Meta's long‑lived token lasts ~60 days —
   the card warns 14 days before it ends, and an expired token marks the connection **Needs reconnecting**.
4. Meta: choose which **Pages** send leads (each Page can feed only one Bluewater company — a database rule).
   Package 3: choose which **ad accounts** are included in reports.
5. **Disconnect** revokes access at the platform (best effort), deletes tokens, stops receiving and syncing; leads
   and imported numbers stay.

## Lead forms

- Meta: one webhook for Bluewater's app (`/api/webhooks/meta`), signature `X-Hub-Signature-256` checked with the
  app secret. The notification only carries the lead id; a job fetches the answers with the Page's token.
  An hourly job asks Meta for leads created since the last check (1‑hour overlap), so a missed notification is
  caught. Meta keeps leads for 90 days.
- Google: per‑company secret address plus a `google_key` the client pastes into the lead form. Google's
  **Send test data** marks the connection verified without creating a lead.
- Every lead is recorded **once** per platform lead id, through the same `recordInquiry()` as every other lead
  (duplicate contacts matched by email/phone), with `lead_id`, `form_id`, `campaign_id`, `adset_id`, `ad_id`
  (and `gclid` for Google) kept. Answers other than name/email/phone are kept in the inquiry's message.
- **Text permission (D‑32):** lead forms don't record permission to text, so the automatic acknowledgment goes by
  **email**; a team member can still call. If a client adds an explicit SMS consent question, mapping it is a
  later, legally reviewed change.
- Account status rules are the same as website forms: Active → automatic messages; Onboarding/Paused → stored,
  not messaged; service ended → not recorded (the platform still keeps the lead).

## Reporting (Package 3)

- First import: last 90 days. Then every 6 hours: the last 7 days, **replacing** those days (platforms revise
  recent numbers) — re‑imports never double count. Import history is kept (`ad_sync_runs`).
- Numbers stay in the ad account's currency and calendar days; currencies are never added together; sales
  (USD) are only compared with USD spend.
- Rate limits: the job waits and retries later; pagination is followed to the end (with safety caps).
- Freshness: Reports and Overview warn when a connection hasn't updated for more than 30 hours.
- Definitions: METRICS.md → Advertising.

## Approvals Bluewater needs before live use (owner actions — nothing has been applied for)

**Meta** (developers.facebook.com, Bluewater's Business Manager):
1. Create a Business‑type app; add Facebook Login for Business, Webhooks and Marketing API products.
2. Business verification of Bluewater.
3. App Review for: `leads_retrieval`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`,
   `ads_read`, `business_management` (screencasts of the flow are required).
4. Webhooks → Page → subscribe to `leadgen`, callback `https://app.yourdomain.com/api/webhooks/meta`, verify
   token = `META_WEBHOOK_VERIFY_TOKEN`.
5. Set `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` in Vercel (never in chat or code).

**Google**:
1. Google Ads manager account for Bluewater → API Center → developer token; apply for **Basic access**.
2. Google Cloud project → OAuth consent screen (external, verification for the `adwords` scope) → OAuth client
   (web) with redirect `https://app.yourdomain.com/api/oauth/google/callback`.
3. Set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN` (and
   `GOOGLE_ADS_LOGIN_CUSTOMER_ID` if clients are linked under Bluewater's manager account).

API versions are settings (`META_GRAPH_VERSION`, default v26.0; `GOOGLE_ADS_API_VERSION`, default v25). Both
platforms retire versions regularly — check quarterly (DEPLOYMENT.md maintenance schedule).
