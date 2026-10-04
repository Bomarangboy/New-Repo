import { Activity, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/authz/guard";
import { formatInZone } from "@/lib/timezones";
import { healthSnapshot } from "@/server/health";
import { cancelJobAction, recordOpsCheckAction, reimportAdsAction, resolveUnknownAction, retryAdLeadsAction, retryIntakeAction, retryJobAction } from "../actions";

export const metadata = { title: "Health" };
export const dynamic = "force-dynamic";

function State({ level, children }: { level: "ok" | "warn" | "bad"; children: React.ReactNode }) {
  const Icon = level === "ok" ? CheckCircle2 : level === "warn" ? AlertTriangle : XCircle;
  return <p className={`flex items-start gap-2 text-sm ${level === "ok" ? "text-emerald-700" : level === "warn" ? "text-amber-800" : "text-red-700"}`}><Icon className="mt-0.5 size-4 shrink-0" />{children}</p>;
}

export default async function HealthPage() {
  const ctx = await requirePlatformAdmin();
  const h = await healthSnapshot(ctx);
  const tz = "America/New_York";
  const maintAge = h.lastMaintenanceMinutesAgo;
  return (
    <>
      <PageHeader title="Health & Recovery" subtitle="Everything that runs in the background, across all companies. Times in Eastern." />
      <p className="mb-6 rounded-2xl bg-canvas px-4 py-3 text-xs text-muted">This page loading only proves the app and database respond. The external uptime monitor watches <code>/api/health</code> from outside and alerts you independently (docs/MONITORING.md).</p>

      <Card title={`Alerts (${h.alerts.filter((a) => a.status === "open").length} open)`} className="mb-6">
        {h.alerts.length === 0 ? <State level="ok">No problems detected. Administrators are emailed when one opens and again when it recovers.</State> : (
          <ul className="divide-y divide-line text-sm">
            {h.alerts.map((a) => (
              <li key={a.id} className="py-2.5">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {a.status === "open" ? <Badge tone={a.severity === "critical" ? "red" : "amber"} dot>{a.severity}</Badge> : <Badge tone="green" dot>recovered</Badge>}{a.title}
                </p>
                <p className="text-xs text-muted">{a.detail} · since {formatInZone(a.firstSeenAt, tz)}{a.resolvedAt ? ` · recovered ${formatInZone(a.resolvedAt, tz)}` : ""}{a.notifiedAt ? " · admins emailed" : ""}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Background processing">
          <div className="space-y-2">
            <State level={h.dbMs < 500 ? "ok" : "warn"}>Database answered in {h.dbMs} ms.</State>
            {maintAge == null ? <State level="warn">The scheduler hasn&apos;t run yet (it starts once deployed; locally run <code>npm run jobs:work</code>).</State>
              : <State level={maintAge < 5 ? "ok" : "bad"}>Scheduler last ran {formatInZone(h.lastMaintenance, tz)}{maintAge >= 5 ? " — it should run every minute; check the scheduler." : "."}</State>}
            <State level={h.queue.oldestDueSeconds == null || h.queue.oldestDueSeconds < 180 ? "ok" : "bad"}>
              {h.queue.due} jobs due now{h.queue.oldestDueSeconds != null ? `, oldest waiting ${Math.round(h.queue.oldestDueSeconds / 60)} min` : ""} · {h.queue.queued} scheduled · {h.queue.running} running
            </State>
            <State level={h.queue.dead ? "bad" : "ok"}>{h.queue.dead} jobs gave up after retrying.</State>
          </div>
        </Card>
        <Card title="Sending mode">
          {h.sending.simulated
            ? <State level="ok">Simulated — no real texts or emails can be sent from this environment ({h.sending.appEnv}).</State>
            : <State level="warn">LIVE — real messages go to customers whose senders are verified.</State>}
          <p className="mt-2 text-xs text-muted">Live sending needs production, the owner-approved switch, a real customer company and a verified sender.</p>
        </Card>
        <Card title="Advertising connections">
          {h.ads.live ? <State level="warn">LIVE ad connections are switched on.</State> : <State level="ok">Simulated — real Meta/Google accounts can&apos;t be connected from this environment.</State>}
          <p className="mt-2 text-xs text-muted">Meta app credentials: {h.ads.metaApp ? "set" : "not set"} · Google Ads credentials: {h.ads.googleApp ? "set" : "not set"}. Google lead-form webhooks work without either.</p>
          {h.adProblems.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-sm">
              {h.adProblems.map((r) => <li key={`${r.company}${r.platform}`}><span className="font-medium">{r.company}</span> · {r.platform === "meta" ? "Meta" : "Google"} · {r.status.replace("_", " ")}{r.failed_leads ? ` · ${r.failed_leads} lead(s) not recorded` : ""}{r.last_error ? <span className="block text-xs text-red-700">{r.last_error}</span> : null}</li>)}
            </ul>
          )}
        </Card>
        <Card title="Database & capacity">
          <div className="space-y-2">
            <State level={h.database.gb < 6 ? "ok" : "warn"}>{h.database.gb.toFixed(2)} GB used (Supabase Pro includes 8 GB; alert at 6 GB).</State>
            <State level={h.database.connections < h.database.maxConnections * 0.8 ? "ok" : "warn"}>{h.database.connections} of {h.database.maxConnections} database connections in use.</State>
          </div>
          <ul className="mt-3 space-y-0.5 text-xs text-muted">{h.tables.map((t) => <li key={t.name} className="flex justify-between"><span>{t.name.replaceAll("_", " ")}</span><span className="tabular-nums">≈ {t.rows.toLocaleString("en-US")} rows</span></li>)}</ul>
          <p className="mt-2 text-xs text-muted">Launch targets and measured load-test results: docs/CAPACITY.md.</p>
        </Card>
        <Card title="Lead capture">
          <State level={h.intake.failed ? "bad" : "ok"}>{h.intake.failed} website submission(s) stored but not processed.</State>
          <State level={h.intake.waiting ? "warn" : "ok"}>{h.intake.waiting} waiting more than 5 minutes.</State>
          {h.intake.failed > 0 && (
            <ActionForm action={retryIntakeAction} className="mt-3 space-y-2">
              <p className="text-xs text-muted">Turns them into leads using the normal rules (duplicates matched, account status respected). Nothing is lost if it fails again.</p>
              <SubmitButton variant="secondary">Retry stored submissions</SubmitButton>
            </ActionForm>
          )}
          {h.adProblems.some((r) => r.failed_leads > 0) && (
            <ActionForm action={retryAdLeadsAction} className="mt-3 space-y-2">
              <p className="text-xs text-muted">Queues failed Facebook/Google lead-form leads again; each is still recorded only once.</p>
              <SubmitButton variant="secondary">Retry failed ad leads</SubmitButton>
            </ActionForm>
          )}
        </Card>
        <Card title="Messages, last 24 hours">
          {h.messages24h.length === 0 ? <p className="text-sm text-muted">None.</p> : (
            <ul className="space-y-1 text-sm">{h.messages24h.map((r) => <li key={`${r.status}${r.transport}`} className="flex justify-between"><span>{r.status} <span className="text-muted">({r.transport})</span></span><span className="tabular-nums">{r.n}</span></li>)}</ul>
          )}
        </Card>
      </div>

      {h.pausedAfterDelay.length > 0 && (
        <Card title="Follow-ups paused after a delay" className="mt-6">
          <p className="-mt-2 mb-3 text-sm text-muted">A follow-up step more than a day late (for example after an outage) is never sent automatically; it&apos;s paused so the client can resume it on the lead page if still appropriate.</p>
          <ul className="space-y-1 text-sm">{h.pausedAfterDelay.map((r) => <li key={r.company} className="flex justify-between"><span>{r.company}</span><span className="tabular-nums">{r.n}</span></li>)}</ul>
        </Card>
      )}

      {h.adConnectionsList.length > 0 && (
        <Card title="Re-import advertising numbers" className="mt-6">
          <p className="-mt-2 mb-3 text-sm text-muted">Replaces a range of days with fresh numbers from the platform (for example after an outage or a correction). It never adds to existing numbers. At most 90 days at a time.</p>
          <ActionForm action={reimportAdsAction} className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
            <div><label className="label" htmlFor="ri-co">Company &amp; platform</label>
              <select id="ri-co" name="pick" className="input">{h.adConnectionsList.map((c) => <option key={`${c.company_id}:${c.platform}`} value={`${c.company_id}:${c.platform}`}>{c.company} — {c.platform === "meta" ? "Meta" : "Google Ads"} ({c.status.replace("_", " ")})</option>)}</select></div>
            <Field label="From" name="from" type="date" required />
            <Field label="To" name="to" type="date" required />
            <SubmitButton variant="secondary">Re-import</SubmitButton>
          </ActionForm>
        </Card>
      )}

      <Card title="Backups, restore tests and load tests" className="mt-6">
        <p className="-mt-2 mb-3 text-sm text-muted">Evidence of the last check of each kind. The procedures are in docs/RECOVERY.md and docs/CAPACITY.md; record the result here after each one.</p>
        <ul className="mb-4 space-y-2 text-sm">
          {(["backup_check", "restore_test", "load_test", "deploy_check"] as const).map((k) => {
            const r = h.records.find((x) => x.kind === k);
            return (
              <li key={k} className="flex flex-wrap items-start gap-2">
                <span className="w-32 font-medium">{k.replace("_", " ")}</span>
                {r ? <><Badge tone={r.result === "passed" ? "green" : r.result === "partial" ? "amber" : "red"}>{r.result}</Badge><span className="min-w-0 flex-1 text-muted">{formatInZone(r.recordedAt, tz, { dateStyle: "medium" })} · {r.environment} · {r.summary}</span></>
                  : <span className="text-amber-800">Never recorded</span>}
              </li>
            );
          })}
        </ul>
        <ActionForm action={recordOpsCheckAction} className="grid gap-3 md:grid-cols-[1fr_1fr_3fr_auto] md:items-end">
          <div><label className="label" htmlFor="oc-kind">Check</label><select id="oc-kind" name="kind" className="input"><option value="backup_check">Backup check</option><option value="restore_test">Restore test</option><option value="load_test">Load test</option><option value="deploy_check">Deployment check</option></select></div>
          <div><label className="label" htmlFor="oc-res">Result</label><select id="oc-res" name="result" className="input"><option value="passed">Passed</option><option value="partial">Partly passed</option><option value="failed">Failed</option></select></div>
          <Field label="What was checked and what you saw" name="summary" required minLength={10} />
          <SubmitButton variant="secondary">Record</SubmitButton>
        </ActionForm>
      </Card>

      <Card title={`Unconfirmed messages (${h.unknown.length})`} className="mt-6">
        <p className="-mt-2 mb-4 text-sm text-muted">Sends that were interrupted, so we can&apos;t tell whether they went out. They are never re-sent automatically. Check the provider&apos;s log, then record what happened.</p>
        {h.unknown.length === 0 ? <p className="text-sm text-muted">None.</p> : (
          <ul className="divide-y divide-line">
            {h.unknown.map((m) => (
              <li key={m.id} className="grid gap-3 py-3 md:grid-cols-[1fr_auto] md:items-end">
                <div className="text-sm"><p className="font-medium">{m.company} · {m.channel} to {m.to}</p><p className="text-xs text-muted">{formatInZone(m.createdAt, tz)} · {m.transport}{m.providerId ? ` · provider id ${m.providerId}` : ""} · {m.reason}</p></div>
                <ActionForm action={resolveUnknownAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="messageId" value={m.id} />
                  <div><Field label="What the provider shows" name="note" required minLength={5} /></div>
                  <select name="outcome" className="input w-auto" aria-label="Outcome"><option value="submitted">It was sent</option><option value="failed">It was not sent</option></select>
                  <SubmitButton variant="secondary">Record</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Jobs that gave up (${h.deadJobs.length})`} className="mt-6">
        {h.deadJobs.length === 0 ? <p className="text-sm text-muted">None.</p> : (
          <ul className="divide-y divide-line text-sm">
            {h.deadJobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-3 py-3">
                <Activity className="size-4 text-red-600" />
                <span className="min-w-0 flex-1"><span className="font-medium">{j.kind.replaceAll("_", " ")}</span> <span className="text-muted">· {j.company ?? "platform"} · {j.attempts} tries · {formatInZone(j.updatedAt, tz)}</span><span className="block truncate text-xs text-red-700">{j.lastError}</span></span>
                <form action={retryJobAction}><input type="hidden" name="jobId" value={j.id} /><button className="btn-secondary px-3 py-1.5 text-xs">Retry</button></form>
                <form action={cancelJobAction}><input type="hidden" name="jobId" value={j.id} /><button className="btn-secondary px-3 py-1.5 text-xs">Cancel</button></form>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">Retrying a message job re-checks everything (opt-outs, replies, timing) before anything is sent. <Badge>Logged</Badge></p>
      </Card>
    </>
  );
}
