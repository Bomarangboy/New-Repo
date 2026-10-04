import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, Card } from "@/components/ui";
import { SourceBadge } from "@/components/appointment-bits";
import { roleCan } from "@/lib/authz/permissions";
import type { CompanyContext } from "@/lib/authz/context-types";
import { formatInZone } from "@/lib/timezones";
import { enrollmentForInquiry } from "@/server/sequences/manage";
import { STOP_LABELS, type StopCode } from "@/server/sequences/stop";
import { appointmentsForInquiry, localDateInDays, simulationAllowed } from "@/server/booking/appointments";
import { getBookingSettings } from "@/server/booking/settings";
import { bookingLinkFor } from "@/server/booking/links";
import { enrollAction, enrollmentControlAction } from "../../automations/sequence-actions";
import { addAppointmentAction, simulateBookingAction } from "../../appointments/actions";

type Lead = { id: string; stage: string; automationOrigin: string };
type Contact = { fullName: string; email: string | null };

const STATUS_BADGE: Record<string, { label: string; tone: "green" | "amber" | "neutral" | "blue" }> = {
  active: { label: "Running", tone: "green" }, paused: { label: "Paused", tone: "amber" }, completed: { label: "Finished", tone: "blue" }, stopped: { label: "Stopped", tone: "neutral" },
};

export async function FollowUpCard({ ctx, lead }: { ctx: CompanyContext; lead: Lead }) {
  const data = await enrollmentForInquiry(ctx, lead.id);
  if (!data) return null;
  const e = data.enrollment;
  const tz = ctx.timezone;
  const writable = ctx.policy.login === "full";
  const canControl = roleCan(ctx.role, "sequence.pause_contact") && writable;
  const canEnroll = roleCan(ctx.role, "sequence.enroll_contact") && writable && ctx.policy.automatedSending;
  const open = e && (e.status === "active" || e.status === "paused");
  const closed = lead.stage === "booked" || lead.stage === "won" || lead.stage === "lost";

  return (
    <Card title="Automatic follow-up" actions={e ? <Badge tone={STATUS_BADGE[e.status]?.tone ?? "neutral"} dot>{STATUS_BADGE[e.status]?.label ?? e.status}</Badge> : undefined}>
      {e ? (
        <div className="space-y-2 text-sm">
          <p><span className="font-medium">{e.sequenceName}</span>{e.otherInquiry ? " (started from an earlier inquiry by this person)" : ""}</p>
          {e.status === "active" && <p className="text-muted">Step {Math.min(e.nextStep + 1, e.totalSteps)} of {e.totalSteps}{e.nextRunAt ? ` · next message ${formatInZone(e.nextRunAt, tz)}` : ""} (checked again just before sending)</p>}
          {e.status === "paused" && <p className="text-muted">Paused {e.pausedAt ? formatInZone(e.pausedAt, tz) : ""}. Step {e.nextStep + 1} of {e.totalSteps} is next when resumed.{e.pauseReason ? ` ${e.pauseReason}.` : ""}</p>}
          {e.status === "completed" && <p className="text-muted">All {e.totalSteps} steps were handled {e.endedAt ? formatInZone(e.endedAt, tz) : ""}.</p>}
          {e.status === "stopped" && <p className="text-muted">Stopped {e.endedAt ? formatInZone(e.endedAt, tz) : ""}: {STOP_LABELS[e.stopCode as StopCode] ?? e.stopReason}.</p>}
          {open && canControl && (
            <div className="flex flex-wrap gap-2 pt-1">
              <ActionForm action={enrollmentControlAction} className=""><input type="hidden" name="inquiryId" value={lead.id} /><input type="hidden" name="enrollmentId" value={e.id} /><input type="hidden" name="op" value={e.status === "active" ? "pause" : "resume"} /><SubmitButton variant="secondary" className="px-3 py-1.5 text-sm">{e.status === "active" ? "Pause" : "Resume"}</SubmitButton></ActionForm>
              <ActionForm action={enrollmentControlAction} className=""><input type="hidden" name="inquiryId" value={lead.id} /><input type="hidden" name="enrollmentId" value={e.id} /><input type="hidden" name="op" value="stop" /><SubmitButton variant="secondary" className="px-3 py-1.5 text-sm">Stop</SubmitButton></ActionForm>
            </div>
          )}
        </div>
      ) : <p className="text-sm text-muted">This lead isn&apos;t in a follow-up sequence.</p>}

      {!open && canEnroll && !closed && data.available.length > 0 && (
        <ActionForm action={enrollAction} className="mt-4 space-y-3 border-t border-line pt-4">
          <input type="hidden" name="inquiryId" value={lead.id} />
          <div><label className="label" htmlFor="sequenceId">Start a follow-up</label>
            <select id="sequenceId" name="sequenceId" className="input">{data.available.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          {lead.automationOrigin !== "eligible" && (
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmed" className="mt-0.5 size-4 accent-brand-500" />
              <span>This person asked us to contact them about this inquiry. <span className="text-muted">(Needed because the lead was added by hand or imported.)</span></span></label>
          )}
          <SubmitButton variant="secondary">Start follow-up</SubmitButton>
        </ActionForm>
      )}
      {!open && canEnroll && !closed && data.available.length === 0 && <p className="mt-3 text-xs text-muted">No sequence is turned on. Set one up under Automations.</p>}
    </Card>
  );
}

export async function AppointmentsCard({ ctx, lead, contact }: { ctx: CompanyContext; lead: Lead; contact: Contact }) {
  const [appts, booking] = await Promise.all([appointmentsForInquiry(ctx, lead.id), getBookingSettings(ctx)]);
  if (!appts) return null;
  const tz = ctx.timezone;
  const canManage = roleCan(ctx.role, "appointment.manage") && ctx.policy.login === "full";
  const sim = simulationAllowed(ctx);
  const link = bookingLinkFor(booking?.bookingUrl, lead.id, { name: contact.fullName || null, email: contact.email });
  const dateDefault = localDateInDays(tz, 2);

  return (
    <Card title="Appointments">
      {appts.length === 0 ? <p className="mb-3 text-sm text-muted">No appointments.</p> : (
        <ul className="mb-4 space-y-2 text-sm">
          {appts.map((a) => (
            <li key={a.id} className="rounded-xl border border-line p-3">
              <p className="flex flex-wrap items-center gap-2 font-medium">{formatInZone(a.startsAt, tz)}<SourceBadge source={a.source} /><Badge tone={a.status === "scheduled" ? "blue" : a.status === "completed" ? "green" : a.status === "no_show" ? "amber" : "neutral"}>{a.status.replace("_", "-")}</Badge></p>
              {(a.title || a.location) && <p className="text-xs text-muted">{[a.title, a.location].filter(Boolean).join(" · ")}</p>}
            </li>
          ))}
        </ul>
      )}
      {link && (
        <div className="mb-4">
          <p className="label">Personal booking link</p>
          <code className="block break-all rounded-lg bg-canvas p-2 text-xs">{link}</code>
          <p className="mt-1 text-xs text-muted">Bookings made with this link attach to this lead automatically.</p>
        </div>
      )}
      {canManage && (
        <details className="group">
          <summary className="cursor-pointer text-sm font-medium text-brand-600">Add an appointment booked another way (phone, in person)</summary>
          <ActionForm action={addAppointmentAction} className="mt-3 space-y-3">
            <input type="hidden" name="inquiryId" value={lead.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Date" name="date" type="date" defaultValue={dateDefault} required />
              <Field label="Time" name="time" type="time" defaultValue="10:00" required step={300} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Length (minutes)" name="duration" type="number" defaultValue="60" min={5} max={720} />
              <Field label="What (optional)" name="title" placeholder="e.g. Estimate visit" />
            </div>
            <Field label="Where (optional)" name="location" />
            <SubmitButton variant="secondary">Add appointment</SubmitButton>
          </ActionForm>
        </details>
      )}
      {canManage && sim && (
        <details className="mt-3 rounded-xl bg-amber-50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-amber-900">Simulate a booking (demo/testing only)</summary>
          <ActionForm action={simulateBookingAction} className="mt-3 space-y-3">
            <input type="hidden" name="inquiryId" value={lead.id} />
            <p className="text-xs text-amber-900">Pretends this person booked on your Cal.com page. It runs exactly what a real booking would, and is labeled simulated everywhere.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Booked date" name="date" type="date" defaultValue={dateDefault} required />
              <Field label="Booked time" name="time" type="time" defaultValue="14:00" required step={300} />
            </div>
            <SubmitButton variant="secondary">Simulate booking</SubmitButton>
          </ActionForm>
        </details>
      )}
    </Card>
  );
}
