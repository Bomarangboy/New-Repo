import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader } from "@/components/ui";
import { StepList, STANDARD_STOP_RULES } from "@/components/library-steps";
import { pageContext } from "@/lib/authz/guard";
import { roleCan } from "@/lib/authz/permissions";
import { studioForCompany } from "@/server/studio/runtime";
import { getLibraryTemplate } from "@/server/library/customer";
import { ENTRY, INTEGRATIONS, type Integration } from "@/server/library/format";
import { copyTemplateAction } from "../actions";

export const metadata = { title: "Library template" };

export default async function TemplatePreview({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext("library.view", "acknowledgment");
  const ui = await studioForCompany(ctx);
  const r = await getLibraryTemplate(ctx, (await params).id);
  if (!r) notFound();
  const { template: t, definition: d, evidence } = r;
  const steps = d.kind === "sequence" ? d.steps : [{ delayMinutes: 0, channel: "ack", ...d.acknowledgment }];
  const canCopy = roleCan(ctx.role, "library.adopt") && ctx.policy.login === "full" && r.eligibility.ok && t.status === "published";
  const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");
  return (
    <>
      <Link href="/app/library" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> {ui.t("page.library.title")}</Link>
      <PageHeader title={t.name} subtitle={t.description} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card title={d.kind === "sequence" ? `Every message (${t.stepCount} steps over about ${t.durationDays} days)` : "The message"}>
            <StepList steps={steps} kind={d.kind} />
            <p className="mt-3 text-xs text-muted"><mark className="rounded bg-amber-100 px-0.5 text-amber-900">[[Highlighted]]</mark> parts must be replaced with your own words before you can turn it on. <span className="rounded bg-brand-50 px-0.5 text-brand-700">{"{{Blue}}"}</span> parts are filled in for each lead automatically.</p>
          </Card>
          {d.kind === "sequence" && (
            <Card title="Who starts it, and when it stops">
              <p className="text-sm"><b>Who can start it:</b> {ENTRY[d.entry]}.</p>
              <p className="mt-2 text-sm"><b>Existing, imported or older leads</b> are never added automatically — a team member can add one from the lead&apos;s page after confirming they asked to be contacted.</p>
              <p className="mt-3 text-sm font-semibold">Stops automatically when:</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-muted">{STANDARD_STOP_RULES.map((s) => <li key={s}>{s}{s.startsWith("Optional") ? (d.stopOnManualMessage ? " — on in this template" : " — off in this template") : ""}</li>)}</ul>
              <p className="mt-3 text-sm"><b>When it finishes without a reply:</b> {d.handoffTask ? "a call-back task is created for the person assigned to the lead." : "nothing else happens."}</p>
              <p className="mt-2 text-sm"><b>Sending hours:</b> your business&apos;s own hours and timezone ({ctx.timezone}), set under Automations.</p>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card title="Requirements">
            <ul className="space-y-2 text-sm">
              <li><b>Package:</b> {ui.packageName(t.requiredPackage)} {r.eligibility.ok ? <Badge tone="green">Included</Badge> : <Badge>Not in your plan</Badge>}</li>
              <li><b>Connections:</b> {t.requiredIntegrations.length ? (t.requiredIntegrations as Integration[]).map((i) => INTEGRATIONS[i]).join(", ") : "None"}</li>
              <li><b>You fill in:</b> {t.requiredFields.length ? t.requiredFields.map((x) => `[[${x}]]`).join(", ") : "Nothing extra"}</li>
              <li><b>Channels:</b> {t.channels.join(" + ")}</li>
              <li><b>Version:</b> {r.version}</li>
            </ul>
          </Card>
          <Card title="Results">
            {evidence ? (
              <div className="text-sm">
                <p>Observed across <b>{evidence.companies}</b> businesses ({evidence.industry ?? "all industries"}), {evidence.periodStart} to {evidence.periodEnd}, <b>{evidence.enrolled}</b> people enrolled:</p>
                <ul className="mt-2 space-y-1">
                  <li>Replied: {pct(evidence.replied, evidence.enrolled)} · Booked: {pct(evidence.booked, evidence.enrolled)} · Opted out: {pct(evidence.optedOut, evidence.enrolled)} <span className="text-muted">(of people enrolled)</span></li>
                  <li>Delivered: {pct(evidence.delivered, evidence.messagesSent)} <span className="text-muted">(of {evidence.messagesSent} messages sent)</span></li>
                </ul>
                <p className="mt-2 text-xs text-muted">These are observed outcomes, not proof that this sequence caused them. Results depend on your leads, offer and follow-through.</p>
              </div>
            ) : <p className="text-sm text-muted"><b>Unverified.</b> Bluewater doesn&apos;t have enough real results for this template yet. It&apos;s a well-written starting point, not a proven one.</p>}
          </Card>
          <Card title="Use it">
            {!r.eligibility.ok ? <p className="flex items-start gap-2 text-sm text-muted"><Lock className="mt-0.5 size-4" /> {r.eligibility.reason} {ui.upgrade(t.requiredPackage)}</p>
              : t.status !== "published" ? <p className="text-sm text-muted">This template isn&apos;t available for new copies right now.</p>
              : canCopy ? (
                <ActionForm action={copyTemplateAction} className="space-y-3">
                  <input type="hidden" name="templateId" value={t.id} />
                  <p className="text-sm text-muted">Copying makes a <b>private draft</b> in your workspace. Nothing is sent, nobody is added, and the original isn&apos;t changed. You&apos;ll customize it and check the setup before turning it on.</p>
                  <SubmitButton>Copy to my workspace</SubmitButton>
                </ActionForm>
              ) : <p className="text-sm text-muted">Ask your account owner to copy this template.</p>}
            {r.copies.length > 0 && <p className="mt-3 text-xs text-muted">You already have {r.copies.length} cop{r.copies.length === 1 ? "y" : "ies"}: {r.copies.map((c) => <Link key={c.id} href={`/app/library/copies/${c.id}`} className="mr-2 text-brand-600 hover:underline">open</Link>)}</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
