import { FlaskConical, Megaphone } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge } from "@/components/ui";
import { formatInZone } from "@/lib/timezones";
import type { adsOverview } from "@/server/ads/connections";
import { connectAdsAction, disconnectAdsAction, googleWebhookOffAction, pageReceivingAction, selectAccountsAction, simulatedAdLeadAction } from "./ads-actions";
import { GoogleWebhookSetup } from "./google-webhook";

type Platform = Awaited<ReturnType<typeof adsOverview>>[number];

const WAITING: Record<string, string> = {
  meta: "Live Facebook/Instagram connections are waiting for Meta's app review and business verification. You'll connect by signing in to Meta — never by sharing a password.",
  google: "Live Google Ads reporting is waiting for Google's API access approval. Google lead forms can already be connected below by webhook.",
};

function StatusBadge({ p }: { p: Platform }) {
  const c = p.connection;
  if (!c) return p.mode === "unavailable" ? <Badge>Not available yet</Badge> : <Badge dot>Not connected</Badge>;
  if (c.status === "needs_reconnect") return <Badge tone="red" dot>Needs reconnecting</Badge>;
  if (c.status === "error") return <Badge tone="amber" dot>Problem</Badge>;
  return c.mode === "simulated" ? <Badge tone="amber"><FlaskConical className="size-3" /> Connected — simulated</Badge> : <Badge tone="green" dot>Connected</Badge>;
}

export function AdPlatformSection({ p, tz, canManage }: { p: Platform; tz: string; canManage: boolean }) {
  const c = p.connection;
  const pages = p.sources.filter((s) => s.kind === "meta_page");
  const google = p.sources.find((s) => s.kind === "google_webhook");
  const expiringSoon = c?.expiresSoon;
  const simulated = c?.mode === "simulated" || (!c && p.mode === "simulated");
  return (
    <section className="rounded-2xl border border-line p-4 sm:p-5" aria-label={p.name}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Megaphone className="size-5 text-brand-500" />
        <h3 className="font-semibold">{p.name}</h3>
        <StatusBadge p={p} />
      </div>
      <p className="mb-3 text-sm text-muted">
        {p.platform === "meta" ? "Facebook and Instagram lead-form leads arrive in Bluewater automatically." : "Google lead-form leads arrive in Bluewater automatically."}
        {p.reportingIncluded ? " Ad spend, clicks and results appear under Reports." : " Ad spend reporting is part of Bluewater Insight."}
      </p>

      {!c && p.mode === "unavailable" && <p className="mb-3 rounded-xl bg-canvas px-3 py-2 text-xs text-muted">{WAITING[p.platform]}</p>}
      {simulated && <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">This environment uses a <b>simulated</b> {p.platform === "meta" ? "Meta" : "Google"} account with sample numbers. Nothing here comes from a real ad account.</p>}

      {c && (
        <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-muted">Connected as</dt><dd>{c.accountLabel ?? "—"}</dd></div>
          <div><dt className="text-muted">Connected</dt><dd>{formatInZone(c.connectedAt, tz, { dateStyle: "medium" })}</dd></div>
          {p.reportingIncluded && <div><dt className="text-muted">Numbers last updated</dt><dd>{c.lastSyncOkAt ? formatInZone(c.lastSyncOkAt, tz) : "Not yet"}</dd></div>}
          {c.lastError && <div className="sm:col-span-3"><dt className="text-muted">Last problem</dt><dd className="text-red-700">{c.lastError}{c.lastErrorAt ? ` (${formatInZone(c.lastErrorAt, tz)})` : ""}</dd></div>}
          {expiringSoon && <div className="sm:col-span-3"><dd className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Meta access ends {formatInZone(c.tokenExpiresAt, tz, { dateStyle: "medium" })}. Press Reconnect before then so leads keep arriving.</dd></div>}
        </dl>
      )}

      {c && pages.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-sm font-medium">Facebook Pages</p>
          <ul className="divide-y divide-line rounded-xl border border-line text-sm">
            {pages.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{s.name}</span>{" "}
                  {s.active ? <Badge tone="green" dot>Receiving leads</Badge> : <Badge>Off</Badge>}
                  <span className="block text-xs text-muted">{s.active ? `${s.last7Days} in the last 7 days · last lead ${s.lastLeadAt ? formatInZone(s.lastLeadAt, tz) : "—"}` : "Turn on to receive this Page's lead-form leads."}
                    {s.failed ? ` · ${s.failed} couldn't be fetched (Bluewater retries)` : ""}{s.lastError ? ` · ${s.lastError}` : ""}</span>
                </span>
                {canManage && (
                  <span className="flex gap-2">
                    <ActionForm action={pageReceivingAction} className=""><input type="hidden" name="sourceId" value={s.id} /><input type="hidden" name="on" value={s.active ? "0" : "1"} /><SubmitButton variant="secondary" className="px-3 py-1.5 text-sm">{s.active ? "Turn off" : "Receive leads"}</SubmitButton></ActionForm>
                    {s.active && simulated && <ActionForm action={simulatedAdLeadAction} className=""><input type="hidden" name="sourceId" value={s.id} /><SubmitButton variant="secondary" className="px-3 py-1.5 text-sm">Send a simulated lead</SubmitButton></ActionForm>}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {c && p.reportingIncluded && p.accounts.length > 0 && (
        <ActionForm action={selectAccountsAction} className="mb-4 space-y-2">
          <input type="hidden" name="platform" value={p.platform} />
          <fieldset disabled={!canManage} className="space-y-1.5">
            <legend className="mb-1 text-sm font-medium">Ad accounts included in reports</legend>
            {p.accounts.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="accountId" value={a.id} defaultChecked={a.selected} className="size-4 accent-brand-500" />
                {a.name} <span className="text-xs text-muted">{a.currency ?? "currency unknown"}{a.timezone ? ` · ${a.timezone}` : ""}</span>
              </label>
            ))}
          </fieldset>
          {canManage && <SubmitButton variant="secondary">Save accounts</SubmitButton>}
        </ActionForm>
      )}

      {canManage && p.mode !== "unavailable" && (
        <div className="flex flex-wrap items-start gap-3">
          <form action={connectAdsAction}>
            <input type="hidden" name="platform" value={p.platform} />
            <SubmitButton variant={c ? "secondary" : "primary"}>
              {c ? "Reconnect" : simulated ? `Connect a sample ${p.platform === "meta" ? "Meta" : "Google Ads"} account (simulated)` : `Connect ${p.platform === "meta" ? "Facebook & Instagram" : "Google Ads"}`}
            </SubmitButton>
          </form>
          {c && <ActionForm action={disconnectAdsAction} className=""><input type="hidden" name="platform" value={p.platform} /><SubmitButton variant="secondary">Disconnect</SubmitButton></ActionForm>}
        </div>
      )}

      {p.platform === "google" && (
        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium">Google lead forms (webhook)
            {google?.active ? (google.lastLeadAt ? <Badge tone="green" dot>Receiving leads</Badge> : google.verifiedAt ? <Badge tone="green" dot>Test received</Badge> : <Badge tone="amber" dot>Waiting for Google&apos;s test</Badge>) : <Badge dot>Not set up</Badge>}
          </p>
          <p className="mb-3 text-xs text-muted">Works without connecting a Google account: Google sends each lead-form submission straight to Bluewater.
            {google?.active ? ` ${google.last7Days} in the last 7 days · last lead ${google.lastLeadAt ? formatInZone(google.lastLeadAt, tz) : "—"}` : ""}
            {google?.failed ? ` · ${google.failed} couldn't be recorded` : ""}</p>
          {google?.lastError && <p className="mb-3 text-xs text-red-700">{google.lastError}</p>}
          {canManage && (
            <div className="flex flex-wrap items-start gap-3">
              <GoogleWebhookSetup configured={Boolean(google?.active)} />
              {google?.active && <ActionForm action={googleWebhookOffAction} className=""><SubmitButton variant="secondary">Turn off</SubmitButton></ActionForm>}
              {google?.active && simulated && <ActionForm action={simulatedAdLeadAction} className=""><input type="hidden" name="sourceId" value={google.id} /><SubmitButton variant="secondary">Send a simulated lead</SubmitButton></ActionForm>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
