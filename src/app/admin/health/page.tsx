import { Activity, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/authz/guard";
import { formatInZone } from "@/lib/timezones";
import { healthSnapshot } from "@/server/health";
import { cancelJobAction, resolveUnknownAction, retryJobAction } from "../actions";

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
      <PageHeader title="Health" subtitle="Background work and messaging across all companies. Times in Eastern." />
      <p className="mb-6 rounded-2xl bg-canvas px-4 py-3 text-xs text-muted">This page loading only proves the app and database respond. Independent uptime alerts (set up at deployment) watch the site from outside.</p>
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
        <Card title="Messages, last 24 hours">
          {h.messages24h.length === 0 ? <p className="text-sm text-muted">None.</p> : (
            <ul className="space-y-1 text-sm">{h.messages24h.map((r) => <li key={`${r.status}${r.transport}`} className="flex justify-between"><span>{r.status} <span className="text-muted">({r.transport})</span></span><span className="tabular-nums">{r.n}</span></li>)}</ul>
          )}
        </Card>
      </div>

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
