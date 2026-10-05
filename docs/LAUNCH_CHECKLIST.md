# Launch Checklist and Pilot Recommendation

**Status:** Stage 7 (2026‑10‑04). Three separate questions (spec §23): is the software ready, have the providers
approved us, and are the business/legal decisions made? “Verified” below means automated tests or a real browser run
against a real database in this repository — **not** a live provider.

## 1. Technical readiness
| Area | Status | Evidence |
|---|---|---|
| Company isolation (database‑enforced), roles, packages | ✅ Verified | isolation/authorization/crm/messaging/sequences/booking/ads/operations tests; forced RLS on all 52 tables |
| Website intake, duplicates, retries, rate limit | ✅ Verified | intake tests; load test 5/s, burst 50, 0 lost (CAPACITY.md) |
| Acknowledgments, inbox, opt‑outs, emergency stop | ✅ Verified (simulated delivery) | messaging tests, browser tests |
| Follow‑ups, stop rules, late‑step pause | ✅ Verified (simulated) | sequences tests, operations test |
| Booking (Cal.com webhook), reminders | ✅ Verified (simulated) | booking tests |
| Ad lead forms + reporting | ✅ Verified (simulated) | ads tests |
| Monitoring: health endpoint, grouped alerts + recovery emails | ✅ Verified | operations test, stage7 browser test |
| Backups: restore drill incl. isolation, at 1‑year volume | ✅ Verified **locally** (41 s) | RECOVERY.md; self‑test caught a broken copy |
| Capacity at pilot targets | ✅ Verified **locally** | CAPACITY.md |
| Support requests, service notices, billing records, retention/deletion, demo workspaces | ✅ Verified | operations tests, stage7 browser tests |
| Platform Studio and Sequence Library | ✅ Verified (simulated sending) | studio/library tests, stage8 browser tests |
| External CRM sync | ⏸ Not built (Stage 6 — waiting for which CRM) | Built‑in CRM covers pilot |
| Error tracking (Sentry) | ⬜ Not wired | Optional for pilot; health + alerts cover outages |

## 2. Deployment steps still to do (owner + developer, with your approval for each purchase)
- [ ] Create Supabase (Pro for production; free/extra projects for staging & demo) and Vercel Pro (DEPLOYMENT.md §1–3).
- [ ] Domain: `app.`, `staging.`, `demo.` + HTTPS (automatic).
- [ ] Scheduler (Supabase Cron → `/api/jobs/run`) with `JOB_TRIGGER_SECRET`.
- [ ] Postmark: verify the sending domain (system emails + client email acknowledgments).
- [ ] Uptime monitor on `/api/health` + status page (free tier) alerting to your phone.
- [ ] Vercel Firewall rate‑limit rules for `/login`, `/api/intake/*` and `/api/webhooks/*` (check Vercel's current firewall pricing first).
- [ ] **On staging:** run the browser tests, the load test (`--url https://staging…`) and a restore drill from a real
      Supabase backup into a separate project; record both on Admin → Health.
- [ ] Walk through the *Site outage*, *Broken deployment* and *Stopped background jobs* playbooks once on staging.
- [ ] Create your administrator account (CLI), enrol two‑step verification; create a second administrator.
- [ ] Demo site: separate Vercel + Supabase project with `APP_ENV=demo`.

## 3. Provider approvals (outside parties — timelines are theirs)
| Provider | Needed for | Status |
|---|---|---|
| Twilio A2P 10DLC brand + campaign **per client** | Real texts (Connect and Engage) | ⛔ Not started (needs each client's business details; typically days–weeks) |
| Postmark account review | Real emails | ⛔ Not started (usually quick once the domain is verified) |
| Cal.com | Booking (Engage) | No approval — each client uses their own account; live webhook check pending |
| Meta Business verification + App Review | Facebook/Instagram lead forms & ad reporting | ⛔ Not started (weeks) |
| Google Ads developer token + OAuth verification | Google ad reporting (Insight) | ⛔ Not started (weeks) |
| Google lead‑form webhook | Google lead forms | No approval — only a deployed address |

## 4. Business and legal decisions (owner)
- [ ] **Legal review** of texting consent wording, privacy policy, terms, retention policy (D‑18, D‑38). Live sending stays
      off until you confirm.
- [ ] **Prices** per package and text limits per client (BILLING.md). The app records them; it never charges.
- [ ] Service agreement: support hours (7am–1am ET), response targets (SUPPORT.md), data export & deletion terms.
- [ ] Which CRM pilot clients use (only if they need sync — Stage 6).

## 5. What can actually be sold now
| Package | Can sell for a pilot? | Condition |
|---|---|---|
| **Bluewater Connect (instant response)** | **Yes, after deployment** | Email acknowledgments work as soon as Postmark is verified; **texts** only after each client's A2P approval and your go‑live (legal review). Website forms, Google lead forms, manual/CSV leads, built‑in CRM, inbox. Facebook lead forms need Meta App Review. |
| **Bluewater Engage (follow-up & booking)** | **Yes, after deployment** | Same messaging conditions as Bluewater Connect; Cal.com per client (their own account). |
| **Bluewater Insight (performance reporting)** | **Not yet as a live product** | Ad spend reporting needs Meta and/or Google API approvals. Can be shown in the demo (clearly labeled sample numbers). |

## 6. Pilot recommendation
Start with **3–5 clients on Bluewater Connect and Engage**, built‑in CRM, website forms (+ Google lead forms):
1. Weeks 1–2: deploy staging + production, run the staging drills, onboard clients with **email acknowledgments** while
   their Twilio A2P registrations are reviewed; legal review in parallel.
2. When A2P is approved and you've confirmed the legal review: switch on texting per client (sender verified on the
   company page), watch Health daily for the first week.
3. Measured local capacity is far above this pilot (5 leads/s sustained vs ~500/day target), so capacity is not the
   limit — provider approvals and your support time are. Grow to 10 clients after a month without open incidents.
4. Bluewater Insight when Meta/Google approvals arrive; Stage 6 when a pilot client needs CRM sync.
