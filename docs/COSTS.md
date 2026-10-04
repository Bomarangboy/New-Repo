# Expected Operating Costs

**These are estimates from providers' published list prices found on 2026‑10‑04 (via search; the sandbox
could not open the pricing pages directly). Re‑check every figure on the linked page before approving.**
Taxes, overages and price changes are not included. Nothing has been purchased.

## Fixed platform costs (pilot: up to ~10 client companies)

| Item | Plan | Listed price | Notes / source |
|---|---|---|---|
| Vercel | Pro (commercial use requires a paid plan) | $20 / member / month | [vercel.com/pricing](https://vercel.com/pricing) — usage beyond included amounts billed extra |
| Supabase (production) | Pro | from $25 / month | includes $10 compute credit (one Micro instance); [supabase.com/pricing](https://supabase.com/pricing) |
| Supabase (staging, demo) | extra projects in the same org | compute per project (~Micro size) | verify per‑project compute price on the pricing page |
| Supabase PITR (optional) | add‑on | $100 / month per 7 days retention | only if a <24 h recovery point is required |
| Postmark | Basic | $15 / month (10,000 emails) | free developer tier: 100 emails/month; [postmarkapp.com/pricing](https://postmarkapp.com/pricing) |
| Domain | registrar | ~$10–20 / year | varies by registrar |
| Uptime monitor + status page / error tracking | free tiers to start (UptimeRobot or Better Stack; Sentry) | $0 | upgrade if alert or monitor limits are hit |
| Off‑platform backup copy | your existing cloud drive | $0 | weekly encrypted `pg_dump` (RECOVERY.md) |

**Rough fixed floor for production:** ≈ $60–80/month before messaging usage and extra environments.
**Development right now:** $0 (local machine; Supabase Free is fine for a personal test project).

## Per‑client texting costs (Twilio, US) — from Twilio help‑center search results

| Item | Listed amount | When |
|---|---|---|
| A2P brand registration | $4.50 (sole prop / low‑volume standard) or $46 (standard) | once per client business |
| Campaign vetting | $15 | per campaign registration |
| Campaign monthly fee | ~$1.50–$10 / month | per campaign |
| Phone number | not verified — check pricing page | monthly per number |
| Per message segment + carrier fees | not verified — check [Twilio US SMS pricing](https://www.twilio.com/en-us/sms/pricing/us) | per segment |

## Usage example to fill in once SMS prices are confirmed
Assumptions: 10 clients × 100 leads/month × (1 acknowledgment + 3 follow‑ups) ≈ 4,000 SMS segments/month
+ replies + ~4,000 emails/month (fits Postmark Basic). SMS cost = 4,000 × (per‑segment price + carrier fee).

## Booking (Package 2)
Bluewater pays nothing for Cal.com: each client uses their own account. Follow‑ups and reminders add texts:
the usage example above already assumes 3 follow‑ups per lead; add ~2 reminder texts per booked appointment.

## Tracking actual costs in the app (Stage 7)
Admin → Usage & Billing counts real text segments and emails per client per month. Enter the unit prices you confirm
on the Twilio and Postmark pricing pages and it estimates provider cost per client (shown as “—” until you do).

## What could change these numbers
More Vercel team members; higher database compute; PITR; dedicated email IPs (only at high volume);
Package 3 adds no direct fees for Meta/Google APIs, but their approvals take time.
