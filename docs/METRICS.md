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
| Acknowledgments sent / failed, unread replies | Not available until automatic messaging is set up (Stage 3). | Shown as "No data yet". |

**What these numbers do not claim.** A lead's campaign details are shown only when they arrived with the
inquiry (UTM tags, Google/Facebook click IDs, lead-form IDs). Many inquiries can't be linked to a specific ad;
that is normal and shown as such. Advertising spend, cost per lead and attributed revenue arrive with ad
reporting (Package 3, Stage 5) and will keep platform-reported conversions separate from sales recorded here.
