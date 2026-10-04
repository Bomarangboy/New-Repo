import { OctagonX, PlayCircle, Repeat } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/authz/guard";
import { roleCan } from "@/lib/authz/permissions";
import { hasFeature } from "@/lib/authz/entitlements";
import { formatInZone, timezoneLabel } from "@/lib/timezones";
import { getAutomationSettings } from "@/server/messaging/settings";
import { assignableMembers } from "@/server/crm/leads";
import { pauseAction, saveSettingsAction } from "./actions";
import { TemplateEditor } from "./template-editor";

export const metadata = { title: "Automations" };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hhmm = (m: number) => (m >= 1440 ? "24:00" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);

export default async function AutomationsPage() {
  const ctx = await pageContext("template.view", "acknowledgment");
  const { settings: s, sms, email, history } = await getAutomationSettings(ctx);
  const members = await assignableMembers(ctx);
  const canEdit = roleCan(ctx.role, "template.manage") && ctx.policy.login === "full";
  const canPause = roleCan(ctx.role, "automation.emergency_pause") && ctx.policy.login === "full";

  return (
    <>
      <PageHeader title="Automations" subtitle="The messages Bluewater sends for you, and when." />

      {s.automationPaused && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800">
          <OctagonX className="mt-0.5 size-5 shrink-0" />
          <span><b>All automatic messages are stopped</b> since {formatInZone(s.automationPausedAt, ctx.timezone)}: {s.automationPausedReason}. Leads are still captured and your team is still notified.</span>
        </div>
      )}
      {!ctx.policy.automatedSending && (
        <p className="mb-6 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Automatic messages start once Bluewater activates your account. You can prepare everything here now.</p>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <Card title="Automatic acknowledgment" actions={s.ackEnabled ? <Badge tone="green" dot>On</Badge> : <Badge dot>Off</Badge>}>
            <p className="-mt-2 mb-4 text-sm text-muted">
              Every new website lead gets a quick “we got your request” message — by text if they gave permission to text, otherwise by email.
              It is skipped if the lead already wrote to you or someone on your team already contacted them, and never sent to anyone who opted out.
            </p>
            <h3 className="mb-2 font-semibold">Text message</h3>
            <TemplateEditor templateKey="ack_sms" body={sms.body} subject={null} companyName={ctx.companyName} canEdit={canEdit} />
            <p className="mb-5 mt-1 text-xs text-muted">{sms.isDefault ? "Using Bluewater's standard wording." : `Version ${sms.version}.`}</p>
            <h3 className="mb-2 font-semibold">Email</h3>
            <TemplateEditor templateKey="ack_email" body={email.body} subject={email.subject} companyName={ctx.companyName} canEdit={canEdit} />
            <p className="mt-1 text-xs text-muted">{email.isDefault ? "Using Bluewater's standard wording." : `Version ${email.version}.`}</p>
          </Card>

          <Card title="Follow-up sequences">
            <div className="flex items-start gap-3 text-sm text-muted">
              <Repeat className="mt-0.5 size-5 text-brand-500" />
              {hasFeature(ctx.package, "sequences") ? <p>Multi-day follow-up messages are being added next. They will stop automatically when a lead replies, books, opts out or is closed.</p>
                : <p>Multi-day follow-up is part of Package 2.</p>}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="When and who">
            <ActionForm action={saveSettingsAction}>
              <fieldset disabled={!canEdit} className="space-y-4">
                <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="ackEnabled" defaultChecked={s.ackEnabled} className="size-4 accent-brand-500" /> Send automatic acknowledgments</label>
                <div>
                  <p className="label">Sending window ({timezoneLabel(ctx.timezone)})</p>
                  <div className="flex items-center gap-2">
                    <input type="time" name="windowStart" defaultValue={hhmm(s.windowStartMinute)} className="input" aria-label="Start" step={900} />
                    <span className="text-muted">to</span>
                    <input type="time" name="windowEnd" defaultValue={hhmm(Math.min(s.windowEndMinute, 1439))} className="input" aria-label="End" step={900} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {DAYS.map((d, i) => (
                      <label key={d} className="flex cursor-pointer items-center gap-1 rounded-lg border border-line px-2 py-1 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
                        <input type="checkbox" name="days" value={i} defaultChecked={s.windowDays.includes(i)} className="accent-brand-500" />{d}
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-muted">Leads that arrive outside these hours are acknowledged when the window opens — or skipped if that&apos;s more than 24 hours later. Your team is alerted right away either way.</p>
                </div>
                <div>
                  <p className="label">Alert these people about new leads and replies</p>
                  <div className="space-y-1">
                    {members.map((m) => (
                      <label key={m.userId} className="flex items-center gap-2 text-sm"><input type="checkbox" name="notify" value={m.userId} defaultChecked={s.notifyUserIds.includes(m.userId)} className="accent-brand-500" />{m.name || m.email}</label>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-muted">If nobody is ticked: the person the lead is assigned to, otherwise the account owner.</p>
                </div>
                {canEdit && <SubmitButton>Save</SubmitButton>}
              </fieldset>
            </ActionForm>
          </Card>

          {canPause && (
            <Card title="Emergency stop">
              <ActionForm action={pauseAction}>
                <input type="hidden" name="paused" value={s.automationPaused ? "0" : "1"} />
                {s.automationPaused ? (
                  <><p className="text-sm text-muted">Turning messages back on only affects new leads; anything cancelled while stopped stays cancelled.</p><SubmitButton><PlayCircle className="size-4" /> Turn automatic messages back on</SubmitButton></>
                ) : (
                  <><p className="text-sm text-muted">Immediately stops every automatic message for your business. Leads are still captured.</p>
                    <Field label="Why? (for your records)" name="reason" required minLength={3} />
                    <SubmitButton variant="danger"><OctagonX className="size-4" /> Stop all automatic messages</SubmitButton></>
                )}
              </ActionForm>
            </Card>
          )}

          {history.length > 0 && (
            <Card title="Wording history">
              <ul className="space-y-1 text-sm">
                {history.map((h) => <li key={`${h.key}${h.version}`} className="flex justify-between"><span>{h.key === "ack_sms" ? "Text" : "Email"} v{h.version}</span><span className="text-muted">{formatInZone(h.createdAt, ctx.timezone, { dateStyle: "medium" })}</span></li>)}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
