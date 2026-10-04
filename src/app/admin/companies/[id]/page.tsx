import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, Card, LIFECYCLE_TONES, PageHeader } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/authz/guard";
import { PACKAGE_LABELS, PACKAGES } from "@/lib/authz/entitlements";
import { accountPolicy } from "@/lib/authz/account-policy";
import { formatInZone } from "@/lib/timezones";
import { canTransition, getCompanyForAdmin, LIFECYCLE, SUPPORT_MAX_MINUTES } from "@/server/companies";
import { getSenders } from "@/server/senders";
import { EmailSenderForm } from "./senders";
import { saveSmsSenderAction } from "../../actions";
import { changeLifecycleAction, changePackageAction, endSupportAction, inviteOwnerAction, scheduleCancellationAction, startSupportAction, suspendAction, withdrawCancellationAction } from "../../actions";

export const metadata = { title: "Company" };

const yes = (b: boolean) => (b ? <Badge tone="green">Yes</Badge> : <Badge>No</Badge>);

export default async function CompanyAdminPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requirePlatformAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await getCompanyForAdmin(ctx, id);
  if (!data) notFound();
  const { company: c, team, packages, lifecycle, activeGrant } = data;
  const { created } = await searchParams;
  const policy = accountPolicy(c);
  const owner = team.find((t) => t.role === "owner" && t.status === "active");
  const nextStatuses = LIFECYCLE.filter((s) => canTransition(c.lifecycleStatus, s));
  const tz = "America/New_York";
  const senders = await getSenders(ctx, c.id);
  const smsS = senders.find((x) => x.channel === "sms");
  const emailS = senders.find((x) => x.channel === "email");
  const senderBadge = (st?: string) => st === "verified" ? <Badge tone="green">Verified</Badge> : st === "pending_verification" ? <Badge tone="amber">Pending verification</Badge> : st === "disabled" ? <Badge tone="red">Disabled</Badge> : <Badge>Not configured</Badge>;

  return (
    <>
      <Link href="/admin" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> All customers</Link>
      <PageHeader title={c.name} subtitle={`${PACKAGE_LABELS[c.package]} · ${c.timezone}`} actions={<><Badge tone={LIFECYCLE_TONES[c.lifecycleStatus]} dot>{c.lifecycleStatus}</Badge>{c.suspended && <Badge tone="red">Suspended</Badge>}{c.kind !== "customer" && <Badge>{c.kind.replace("_", " ")}</Badge>}</>} />
      {created && <p className="mb-6 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Company created. Next: invite the owner.</p>}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="What this account can do right now">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-muted">Client sign-in</dt><dd><Badge tone={policy.login === "full" ? "green" : policy.login === "read_only" ? "amber" : "red"}>{policy.login.replace("_", " ")}</Badge></dd>
            <dt className="text-muted">New leads</dt><dd><Badge tone={policy.intake === "process" ? "green" : policy.intake === "store_only" ? "amber" : "red"}>{policy.intake === "process" ? "processed" : policy.intake === "store_only" ? "stored only" : "rejected"}</Badge></dd>
            <dt className="text-muted">Automatic messages</dt><dd>{yes(policy.automatedSending)}</dd>
            <dt className="text-muted">Manual messages</dt><dd>{yes(policy.manualSending)}</dd>
            <dt className="text-muted">Integration sync</dt><dd>{yes(policy.sync)}</dd>
          </dl>
          {c.suspended && <p className="mt-3 text-sm text-red-700">Suspended: {c.suspendedReason}</p>}
          {c.churnReason && <p className="mt-3 text-sm text-muted">Churn reason: {c.churnReason} · Service ended {formatInZone(c.serviceEndsAt, tz, { dateStyle: "medium" })}</p>}
        </Card>

        <Card title="Team">
          <ul className="mb-4 divide-y divide-line text-sm">
            {team.length === 0 && <li className="py-2 text-muted">No one has joined yet.</li>}
            {team.map((t) => (
              <li key={t.userId} className="flex items-center gap-2 py-2"><span className="flex-1 truncate">{t.fullName || t.email} <span className="text-muted">· {t.email}</span></span><Badge tone={t.role === "owner" ? "blue" : "neutral"}>{t.role}</Badge>{t.status !== "active" && <Badge>removed</Badge>}</li>
            ))}
          </ul>
          {!owner && (
            <ActionForm action={inviteOwnerAction}>
              <input type="hidden" name="companyId" value={c.id} />
              <Field label="Invite the owner" name="email" type="email" required placeholder="owner@business.com" />
              <SubmitButton>Send owner invitation</SubmitButton>
            </ActionForm>
          )}
        </Card>

        <Card title="Package">
          <ActionForm action={changePackageAction}>
            <input type="hidden" name="companyId" value={c.id} />
            <select name="package" defaultValue={c.package} className="input">{PACKAGES.map((p) => <option key={p} value={p}>{PACKAGE_LABELS[p]}</option>)}</select>
            <Field label="Note (shown in history)" name="note" placeholder="e.g. Upgraded after 30-day pilot" />
            <p className="text-xs text-muted">Billing is manual for now: changing the package does not create or change any charge.</p>
            <SubmitButton>Update package</SubmitButton>
          </ActionForm>
        </Card>

        <Card title="Account status">
          {nextStatuses.length > 0 ? (
            <ActionForm action={changeLifecycleAction}>
              <input type="hidden" name="companyId" value={c.id} />
              <select name="status" className="input">{nextStatuses.map((s) => <option key={s} value={s}>{c.lifecycleStatus === "churned" && s === "onboarding" ? "Reactivate (back to onboarding)" : s}</option>)}</select>
              <Field label="Reason (required when churning)" name="reason" />
              <Field label="Service end date (when churning)" name="serviceEndsAt" type="date" />
              <p className="text-xs text-muted">Churning keeps all records (read-only for export) and never deletes data. Reactivation never resumes old queued messages.</p>
              <SubmitButton variant="secondary">Change status</SubmitButton>
            </ActionForm>
          ) : <p className="text-sm text-muted">No status changes available.</p>}
          <hr className="my-5 border-line" />
          {c.cancellationRequestedAt && c.lifecycleStatus !== "churned" && c.lifecycleStatus !== "archived" ? (
            <ActionForm action={withdrawCancellationAction}>
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Cancellation requested {formatInZone(c.cancellationRequestedAt, tz, { dateStyle: "medium" })}; service ends {formatInZone(c.serviceEndsAt, "UTC", { dateStyle: "medium" })}. Reason: {c.churnReason}</p>
              <input type="hidden" name="companyId" value={c.id} />
              <SubmitButton variant="secondary">Withdraw cancellation</SubmitButton>
            </ActionForm>
          ) : c.lifecycleStatus !== "churned" && c.lifecycleStatus !== "archived" ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium text-brand-600">Record a cancellation request</summary>
              <ActionForm action={scheduleCancellationAction} className="mt-3 space-y-3">
                <input type="hidden" name="companyId" value={c.id} />
                <Field label="Service ends on" name="effectiveDate" type="date" required />
                <Field label="Reason" name="reason" required />
                <p className="text-xs text-muted">Service continues until the end date. Then the account becomes Churned automatically: read-only, nothing sent, records kept.</p>
                <SubmitButton variant="secondary">Schedule cancellation</SubmitButton>
              </ActionForm>
            </details>
          ) : null}
          <hr className="my-5 border-line" />
          <ActionForm action={suspendAction}>
            <input type="hidden" name="companyId" value={c.id} />
            <input type="hidden" name="suspend" value={c.suspended ? "0" : "1"} />
            {!c.suspended && <Field label="Technical suspension reason" name="reason" placeholder="e.g. Sender flagged by carrier; investigating" />}
            <SubmitButton variant={c.suspended ? "secondary" : "danger"}>{c.suspended ? "Lift suspension" : "Suspend account"}</SubmitButton>
          </ActionForm>
        </Card>

        <Card title="Support access" className="xl:col-span-2">
          {activeGrant ? (
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone="purple"><Eye className="size-3.5" /> Active until {formatInZone(activeGrant.expiresAt, tz, { timeStyle: "short" })} ET</Badge>
              <span className="text-sm text-muted">Reason: {activeGrant.reason}</span>
              <Link href="/app" className="btn-primary ml-auto">Open workspace</Link>
              <form action={endSupportAction}><input type="hidden" name="companyId" value={c.id} /><button className="btn-secondary">End access</button></form>
            </div>
          ) : (
            <ActionForm action={startSupportAction} className="grid gap-4 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
              <input type="hidden" name="companyId" value={c.id} />
              <Field label="Reason (shown to the client)" name="reason" required minLength={10} placeholder="e.g. Owner reported a missing lead from June 3" />
              <div><label className="label" htmlFor="mode">Access</label><select id="mode" name="mode" className="input"><option value="read">View only</option><option value="edit">View and edit settings</option></select></div>
              <div><label className="label" htmlFor="minutes">Duration</label><select id="minutes" name="minutes" className="input" defaultValue="30">{[15, 30, SUPPORT_MAX_MINUTES].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select></div>
              <SubmitButton>Start support session</SubmitButton>
            </ActionForm>
          )}
          <p className="mt-3 text-xs text-muted">Support sessions never allow exports, invitations, ownership changes, messaging or deletion, and are recorded in the client&apos;s own activity log.</p>
        </Card>

        <Card title="Senders (Bluewater-managed)" className="xl:col-span-2">
          <p className="-mt-2 mb-4 text-sm text-muted">Real messages go out only in production, after go-live approval, from a <b>verified</b> sender. Secrets are stored encrypted and never shown again.</p>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="mb-2 flex items-center gap-2 font-semibold">Text (Twilio) {senderBadge(smsS?.status)}</h3>
              <ActionForm action={saveSmsSenderAction} className="space-y-3 text-sm">
                <input type="hidden" name="companyId" value={c.id} />
                <select name="status" defaultValue={smsS?.status ?? "not_configured"} className="input" aria-label="Text sender status">
                  <option value="not_configured">Not configured</option><option value="pending_verification">Pending verification (A2P registration in review)</option><option value="verified">Verified (can send for real)</option><option value="disabled">Disabled</option>
                </select>
                <input name="twilioAccountSid" defaultValue={smsS?.twilioAccountSid ?? ""} placeholder="Subaccount SID (AC…)" className="input" />
                <input name="twilioAuthToken" type="password" autoComplete="off" placeholder={smsS?.hasTwilioToken ? "Auth token saved — leave blank to keep" : "Subaccount auth token"} className="input" />
                <input name="messagingServiceSid" defaultValue={smsS?.messagingServiceSid ?? ""} placeholder="Messaging Service SID (MG…)" className="input" />
                <input name="fromNumber" defaultValue={smsS?.fromNumber ?? ""} placeholder="Number (+1XXXXXXXXXX)" className="input" />
                <input name="notes" defaultValue={smsS?.notes ?? ""} placeholder="Notes (e.g. campaign approved on…)" className="input" />
                <p className="text-xs text-muted">In Twilio set the inbound webhook to /api/webhooks/twilio/inbound (status callbacks are set automatically).</p>
                <SubmitButton variant="secondary">Save text sender</SubmitButton>
              </ActionForm>
            </div>
            <div>
              <h3 className="mb-2 flex items-center gap-2 font-semibold">Email (Postmark) {senderBadge(emailS?.status)}</h3>
              <EmailSenderForm companyId={c.id} current={emailS ?? null} />
            </div>
          </div>
        </Card>

        <Card title="Package history">
          <ul className="space-y-2 text-sm">{packages.map((p) => <li key={p.id}><span className="text-muted">{formatInZone(p.createdAt, tz, { dateStyle: "medium" })}</span> — {p.fromPackage ? `${p.fromPackage.replaceAll("_", " ")} → ` : ""}{p.toPackage.replaceAll("_", " ")}{p.note ? ` (${p.note})` : ""}</li>)}</ul>
        </Card>
        <Card title="Status history">
          <ul className="space-y-2 text-sm">{lifecycle.map((l) => <li key={l.id}><span className="text-muted">{formatInZone(l.createdAt, tz, { dateStyle: "medium" })}</span> — {l.fromStatus ? `${l.fromStatus} → ` : ""}{l.toStatus}{l.reason ? ` (${l.reason})` : ""}</li>)}</ul>
        </Card>
      </div>
    </>
  );
}
