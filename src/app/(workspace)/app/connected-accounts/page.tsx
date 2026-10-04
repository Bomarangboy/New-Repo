import { CalendarDays, Database, Globe, Megaphone } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/authz/guard";
import { roleCan } from "@/lib/authz/permissions";
import { hasFeature } from "@/lib/authz/entitlements";
import { env } from "@/lib/env";
import { formatInZone } from "@/lib/timezones";
import { listIntakeSources, recentIntakeProblems } from "@/server/intake/sources";
import { HONEYPOT_FIELD } from "@/server/intake/website";
import { createSourceAction, removeSecretAction, updateSourceAction } from "./actions";
import { SecretForm } from "./secret-form";

export const metadata = { title: "Connected Accounts" };

function Unavailable({ icon: Icon, name, what, why }: { icon: typeof Globe; name: string; what: string; why: string }) {
  return (
    <div className="flex items-start gap-4 rounded-2xl border border-dashed border-line p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-canvas text-slate-500"><Icon className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">{name} <Badge>Not available yet</Badge></p>
        <p className="text-sm text-muted">{what}</p>
        <p className="mt-1 text-xs text-muted">{why}</p>
      </div>
    </div>
  );
}

export default async function ConnectedAccountsPage({ searchParams }: { searchParams: Promise<{ created?: string }> }) {
  const ctx = await pageContext("integration.view", "lead_sources");
  const { created } = await searchParams;
  const sources = await listIntakeSources(ctx);
  const problems = await recentIntakeProblems(ctx, 10);
  const canManage = roleCan(ctx.role, "integration.manage") && ctx.policy.login === "full";
  const base = env().APP_BASE_URL;

  return (
    <>
      <PageHeader title="Connected Accounts" subtitle="Where your leads come from, and the tools linked to Bluewater. Bluewater never asks for your account passwords." />

      {created && <p role="status" className="mb-6 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Form connection created. Send the setup instructions below to whoever manages your website.</p>}
      <Card title="Website forms" className="mb-6">
        <p className="-mt-2 mb-4 text-sm text-muted">Send inquiries from your website&apos;s contact or quote form straight into Bluewater.</p>
        {sources.length === 0 && <p className="mb-4 rounded-xl bg-canvas px-4 py-3 text-sm">No website form is connected yet.</p>}
        <div className="space-y-5">
          {sources.map((s) => {
            const url = `${base}/api/intake/${s.publicKey}`;
            const received = s.last7Days.received ?? 0;
            const rejected = s.last7Days.rejected ?? 0;
            const failed = s.last7Days.failed ?? 0;
            return (
              <section key={s.id} className="rounded-2xl border border-line p-4 sm:p-5" aria-label={s.name}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Globe className="size-5 text-brand-500" />
                  <h3 className="font-semibold">{s.name}</h3>
                  {s.active ? (s.lastReceivedAt ? <Badge tone="green" dot>Receiving leads</Badge> : <Badge tone="amber" dot>Waiting for first lead</Badge>) : <Badge>Turned off</Badge>}
                  {s.signed && <Badge tone="purple">Signed submissions only</Badge>}
                </div>
                <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-3">
                  <div><dt className="text-muted">Last lead</dt><dd>{s.lastReceivedAt ? formatInZone(s.lastReceivedAt, ctx.timezone) : "—"}</dd></div>
                  <div><dt className="text-muted">Leads in the last 7 days</dt><dd>{received} received{rejected ? ` · ${rejected} rejected` : ""}{failed ? ` · ${failed} delayed` : ""}</dd></div>
                  <div><dt className="text-muted">Allowed websites</dt><dd className="truncate">{s.allowedOrigins.length ? s.allowedOrigins.join(", ") : "Any website"}</dd></div>
                </dl>
                <details className="group mb-3 rounded-xl bg-canvas p-3 text-sm" open={created === s.id}>
                  <summary className="cursor-pointer font-medium">Setup instructions for your web designer</summary>
                  <div className="mt-3 space-y-3">
                    <p>Submission address (POST): <code className="break-all rounded bg-white px-1.5 py-0.5 font-mono text-xs">{url}</code></p>
                    <p>Simplest option — point your existing HTML form at it. Field names Bluewater understands: <code className="font-mono text-xs">name</code> (or first_name/last_name), <code className="font-mono text-xs">email</code>, <code className="font-mono text-xs">phone</code>, <code className="font-mono text-xs">service</code>, <code className="font-mono text-xs">message</code>, <code className="font-mono text-xs">consent_sms</code>, <code className="font-mono text-xs">consent_email</code>, <code className="font-mono text-xs">consent_text</code> (the exact wording next to the checkbox), and campaign fields <code className="font-mono text-xs">utm_*</code>, <code className="font-mono text-xs">gclid</code>, <code className="font-mono text-xs">fbclid</code>.</p>
                    <pre className="overflow-x-auto rounded-lg bg-navy-950 p-3 font-mono text-xs leading-relaxed text-white">{`<form action="${url}" method="post">
  <input name="name" required>
  <input name="email" type="email">
  <input name="phone" type="tel">
  <input name="service">
  <textarea name="message"></textarea>
  <label><input type="checkbox" name="consent_sms">
    Text me about my request. Msg & data rates may apply. Reply STOP to opt out.</label>
  <input type="hidden" name="consent_text" value="Text me about my request. Msg & data rates may apply. Reply STOP to opt out.">
  <input type="hidden" name="_redirect" value="https://YOUR-SITE/thank-you">
  <!-- spam trap: keep hidden and empty -->
  <input name="${HONEYPOT_FIELD}" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px">
  <button>Send</button>
</form>`}</pre>
                    <p className="text-xs text-muted">The redirect only works for websites in the &quot;Allowed websites&quot; list. Full technical reference (JSON, signed server-to-server submissions, retries): see the Bluewater intake guide your Bluewater contact can provide. Have your attorney approve the consent wording.</p>
                  </div>
                </details>
                {canManage && (
                  <details className="text-sm">
                    <summary className="cursor-pointer font-medium text-brand-600">Settings</summary>
                    <div className="mt-3 grid gap-5 md:grid-cols-2">
                      <ActionForm action={updateSourceAction}>
                        <input type="hidden" name="sourceId" value={s.id} />
                        <Field label="Name" name="name" defaultValue={s.name} required />
                        <Field label="Allowed websites" name="allowedOrigins" defaultValue={s.allowedOrigins.join(" ")} placeholder="https://www.yourbusiness.com" hint="Separate with spaces. Leave empty to accept from any website." />
                        <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={s.active} className="accent-brand-500" /> Accept submissions</label>
                        <SubmitButton variant="secondary">Save</SubmitButton>
                      </ActionForm>
                      <div className="space-y-3">
                        <p className="text-muted">For websites that send submissions from their own server, require a signature so nobody else can post to this address.</p>
                        <SecretForm sourceId={s.id} hasSecret={s.signed} />
                        {s.signed && <ActionForm action={removeSecretAction}><input type="hidden" name="sourceId" value={s.id} /><SubmitButton variant="secondary">Turn off signing</SubmitButton></ActionForm>}
                      </div>
                    </div>
                  </details>
                )}
              </section>
            );
          })}
        </div>
        {canManage && (
          <details className="mt-5" open={sources.length === 0}>
            <summary className="cursor-pointer font-medium text-brand-600">+ Connect a website form</summary>
            <ActionForm action={createSourceAction} className="mt-3 grid gap-4 md:max-w-xl">
              <Field label="Name" name="name" placeholder="e.g. Contact page" required />
              <Field label="Allowed websites (recommended)" name="allowedOrigins" placeholder="https://www.yourbusiness.com" hint="Only these websites can send to this form. Separate several with spaces." />
              <SubmitButton>Create form connection</SubmitButton>
            </ActionForm>
          </details>
        )}
        {problems.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-semibold">Recent submissions that need attention</h3>
            <ul className="divide-y divide-line rounded-xl border border-line text-sm">
              {problems.map((p) => (
                <li key={p.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                  <span>{p.sourceName}: {p.status === "failed" ? "stored but not yet processed — Bluewater will retry" : p.error === "account_closed" ? "refused because the account is closed" : p.error}</span>
                  <span className="text-xs text-muted">{formatInZone(p.receivedAt, ctx.timezone)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card title="Advertising accounts" className="mb-6">
        <div className="space-y-3">
          <Unavailable icon={Megaphone} name="Meta (Facebook & Instagram)" what="Receive Facebook and Instagram lead-form leads automatically. Package 3 adds ad spend and results."
            why="Bluewater's Meta connection is waiting for Meta's app review and business verification. You'll connect by signing in to Meta — never by sharing a password." />
          <Unavailable icon={Megaphone} name="Google Ads" what="Receive Google lead-form leads. Package 3 adds ad spend, clicks and results."
            why="Bluewater's Google Ads connection is waiting for Google's API access approval." />
        </div>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Customer records (CRM)">
          <div className="flex items-start gap-3"><Database className="mt-0.5 size-5 text-brand-500" /><div><p className="font-medium">Bluewater built-in CRM <Badge tone="green">In use</Badge></p><p className="text-sm text-muted">Connections to outside CRMs are added for specific systems on request.</p></div></div>
        </Card>
        <Card title="Scheduling">
          {hasFeature(ctx.package, "booking")
            ? <Unavailable icon={CalendarDays} name="Booking tool" what="Booking links, appointment updates and reminders." why="The first scheduling connection is being chosen and built." />
            : <p className="text-sm text-muted">Booking links and appointment reminders are part of Package 2.</p>}
        </Card>
      </div>
    </>
  );
}
