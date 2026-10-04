# Website form integration (technical reference)

For the client's web designer. The owner finds the exact address and a copy-paste example under
**Connected Accounts → Website forms → Setup instructions**.

## Endpoint
`POST https://<app-address>/api/intake/<form-key>` — `Content-Type: application/json` or
`application/x-www-form-urlencoded` (a normal HTML form). Max 32 KB.

| Field | Meaning |
|---|---|
| `name` *or* `first_name` + `last_name` | Person's name |
| `email`, `phone` | At least one is required. US phone numbers in any common format. |
| `service`, `message` | What they asked for |
| `consent_sms`, `consent_email` | Checkbox values (`on`/`true`/`yes` = agreed). Recorded with time, page, IP and browser as evidence. |
| `consent_text` | The exact wording shown next to the checkbox (recommended) |
| `page_url` / `landing_page`, `referrer` | Where the form was submitted |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `gclid`, `gbraid`, `wbraid`, `fbclid`, `msclkid` | Campaign tracking; stored unchanged |
| `submission_id` | Optional unique ID; retries with the same ID are recognised (same as the `Idempotency-Key` header) |
| `_redirect` | HTML forms only: thank-you page; must be on an allowed website |
| `_bw_hp` | Spam trap. Keep the input hidden and empty |

## Responses
| Status | Meaning | Sender should |
|---|---|---|
| 201 `{status:"received", id}` | Stored and turned into a lead | — |
| 202 `{status:"received", id}` | Stored; processing delayed (Bluewater retries) | Nothing; don't resend |
| 200 `{status:"duplicate", id}` | Same submission already received | Nothing |
| 422 `{error, problems[]}` | Stored but not a usable lead (e.g. no email or phone) | Fix the form |
| 400 / 413 | Unreadable or too large | Fix the request |
| 401 / 403 | Bad signature / website not allowed | Check configuration |
| 404 | Unknown or turned-off form key | Check the address |
| 410 | The account no longer accepts submissions | Stop sending |
| 429 | More than 30 submissions/minute for this form | Retry after `Retry-After` seconds |

**Durability:** a 2xx response is only sent after the submission is saved permanently. Anything else means it
was not accepted; the sender should retry (with the same `Idempotency-Key`) on 429/5xx.

## Duplicate protection
- `Idempotency-Key` header (or `submission_id`): the same key for the same form is accepted once.
- Without a key: an identical submission to the same form within 10 minutes is treated as a duplicate
  (double-clicks, browser re-posts). The same person submitting again later is a new (repeat) inquiry.

## Signed (server-to-server) submissions
Turn on "Require signed submissions" for the form and store the secret on your server only. Send:
```
X-Bluewater-Timestamp: <unix seconds>
X-Bluewater-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
```
Requests older than 5 minutes or with a wrong signature get 401. Never put the secret in browser code.

## Account status
Onboarding, paused or suspended accounts still **store** leads but never send automatic messages for them,
even after activation. Churned/archived accounts answer 410 so nothing is lost silently.
