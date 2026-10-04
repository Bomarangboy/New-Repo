# How the numbers are calculated

Every figure is computed from stored records when the page loads (not cached, not estimated). The page
shows the time it was calculated. Values that have no data source yet show **"No data yet"** — never 0.

**Periods.** "Last 7 / 30 / 90 days" run from local midnight at the start of the first day to *now*, in the
**company's timezone** (Settings). Daylight-saving changes are handled by the timezone database. The
"previous period" is the same number of days immediately before.

| Metric | Definition | Notes |
|---|---|---|
| New inquiries | Count of inquiries whose **submission time** falls in the period. Includes every source (website forms, manual entry, imports). | Imported history counts on its original date. A repeat inquiry from a known contact counts again — it is a new inquiry. |
| Change vs previous | (current − previous) ÷ previous, rounded. | Shown only when the previous period had at least one inquiry; otherwise "No earlier data to compare". |
| Lead activity (chart) | New inquiries per local calendar day. | The table view lists the exact values. A day with no inquiries shows as no bar. |
| Lead sources | New inquiries in the period grouped by source (website forms by their name). Percentages of the period total. | The parts always add up to "New inquiries". |
| Connected forms | Each website form connection, whether it's on, and when its last lead arrived. | "Leads in the last 7 days" on Connected Accounts counts leads created from that form; rejected/delayed submissions are listed separately. |
| Pipeline (Package 2+) | **Current** stage of the inquiries received in the period (an acquisition cohort). | Adds up to "New inquiries". Not "stage changes that happened in the period". |
| Open leads with no one assigned | Inquiries in New or Contacted with no assignee, regardless of date. | |
| Recorded sales (Package 3) | Sum of sale values on inquiries marked **Won** whose won date falls in the period (events in the period). | USD only. Won leads without a recorded value are counted and flagged; the total is then marked incomplete. These are sales recorded in Bluewater — not revenue attributed to advertising. |
| Acknowledgments sent | Automatic acknowledgments accepted by the provider (or simulated) for inquiries **submitted in the period**. | "Accepted" is not proof of delivery; delivery reports are shown per message. Simulated sends are labeled. |
| Failed acknowledgments | Acknowledgments the provider rejected, plus "unconfirmed" ones (interrupted sends being checked). | Inquiries that couldn't be acknowledged at all (no permission/address) are not counted here; the team is alerted for each. |
| Acknowledgment time | Median time from Bluewater recording the inquiry to the provider accepting the acknowledgment. | Automatic only. Excludes inquiries that weren't acknowledged. |
| Team's first reply time | Median time from the inquiry to the first message a **person** sent that contact. | Kept separate from the automatic acknowledgment. Phone calls aren't tracked, so a lead called first looks slower. Imports excluded. |
| Waiting for your reply | Conversations where the lead wrote last and nobody has replied or marked it handled. | Current count, not period-based. |
| Team alerts | When the last alert email went out; failed alert emails in the period. | |
| Active follow-ups (Package 2+) | People whose follow-up is running right now; paused ones listed separately. | Current count, not period-based. "Next message" times are when the next step is due — it is re-checked before sending, so it may not go out. |
| Follow-up results | Follow-up messages accepted by the provider (or simulated) in the period; follow-ups that finished all steps in the period; follow-ups that stopped early in the period, by reason. | Events in the period (by when they happened, not when the lead arrived). Stopping because the person replied or booked is a good outcome. |
| Upcoming appointments | Scheduled (not cancelled) appointments starting in the next 7 days, from Cal.com, entered by the team, or simulated (labeled). | Times shown in the company's timezone. |

**What these numbers do not claim.** A lead's campaign details are shown only when they arrived with the
inquiry (UTM tags, Google/Facebook click IDs, lead-form IDs). Many inquiries can't be linked to a specific ad;
that is normal and shown as such. Advertising spend, cost per lead and attributed revenue arrive with ad
reporting (Package 3, Stage 5) and will keep platform-reported conversions separate from sales recorded here.
