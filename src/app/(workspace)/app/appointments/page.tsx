import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { SourceBadge } from "@/components/appointment-bits";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/authz/guard";
import { roleCan } from "@/lib/authz/permissions";
import { formatInZone, timezoneLabel } from "@/lib/timezones";
import { listAppointments, simulationAllowed } from "@/server/booking/appointments";
import { getBookingSettings } from "@/server/booking/settings";
import { appointmentOutcomeAction, simulateChangeAction } from "./actions";
import { studioForCompany } from "@/server/studio/runtime";

export const metadata = { title: "Appointments" };

const STATUS: Record<string, { label: string; tone: "green" | "blue" | "red" | "amber" | "neutral" }> = {
  scheduled: { label: "Scheduled", tone: "blue" }, completed: { label: "Completed", tone: "green" }, no_show: { label: "No-show", tone: "amber" }, cancelled: { label: "Cancelled", tone: "neutral" },
};

type Row = Awaited<ReturnType<typeof listAppointments>>[number];

function AppointmentRow({ r, tz, canManage, sim, past }: { r: Row; tz: string; canManage: boolean; sim: boolean; past: boolean }) {
  const a = r.a;
  const started = r.started;
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start">
      <div className="w-full shrink-0 sm:w-48">
        <p className="font-semibold">{formatInZone(a.startsAt, tz, { weekday: "short", month: "short", day: "numeric" })}</p>
        <p className="text-sm text-muted">{formatInZone(a.startsAt, tz, { timeStyle: "short" })}{a.endsAt ? ` – ${formatInZone(a.endsAt, tz, { timeStyle: "short" })}` : ""}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <Link href={`/app/leads/${a.inquiryId}`} className="font-medium hover:text-brand-600">{r.name || r.email || r.phone || "Unnamed lead"}</Link>
          <Badge tone={STATUS[a.status]?.tone ?? "neutral"}>{STATUS[a.status]?.label ?? a.status}</Badge>
          <SourceBadge source={a.source} />
        </p>
        <p className="text-sm text-muted">{[a.title ?? r.service, a.location].filter(Boolean).join(" · ") || "—"}</p>
        {a.status === "cancelled" && a.cancellationReason && <p className="text-xs text-muted">Reason: {a.cancellationReason}</p>}
      </div>
      {canManage && (
        <div className="flex flex-wrap gap-2">
          {a.status === "scheduled" && started && (
            <>
              <ActionForm action={appointmentOutcomeAction} className=""><input type="hidden" name="appointmentId" value={a.id} /><input type="hidden" name="op" value="completed" /><SubmitButton variant="secondary" className="px-3 py-1.5 text-sm">Completed</SubmitButton></ActionForm>
              <ActionForm action={appointmentOutcomeAction} className=""><input type="hidden" name="appointmentId" value={a.id} /><input type="hidden" name="op" value="no_show" /><SubmitButton variant="secondary" className="px-3 py-1.5 text-sm">No-show</SubmitButton></ActionForm>
            </>
          )}
          {!past && a.status === "scheduled" && a.source === "manual" && (
            <ActionForm action={appointmentOutcomeAction} className=""><input type="hidden" name="appointmentId" value={a.id} /><input type="hidden" name="op" value="cancel" /><SubmitButton variant="secondary" className="px-3 py-1.5 text-sm">Cancel</SubmitButton></ActionForm>
          )}
          {!past && a.status === "scheduled" && a.source === "simulated" && sim && (
            <ActionForm action={simulateChangeAction} className=""><input type="hidden" name="appointmentId" value={a.id} /><input type="hidden" name="op" value="cancel" /><SubmitButton variant="secondary" className="px-3 py-1.5 text-sm">Simulate cancellation</SubmitButton></ActionForm>
          )}
          {!past && a.status === "scheduled" && a.source === "calcom" && <p className="max-w-48 text-xs text-muted">Change or cancel in Cal.com; Bluewater updates automatically.</p>}
        </div>
      )}
    </li>
  );
}

export default async function AppointmentsPage() {
  const ctx = await pageContext("appointment.view", "appointments");
  const ui = await studioForCompany(ctx);
  const [upcoming, past, booking] = await Promise.all([listAppointments(ctx, "upcoming"), listAppointments(ctx, "past", 50), getBookingSettings(ctx)]);
  const canManage = roleCan(ctx.role, "appointment.manage") && ctx.policy.login === "full";
  const sim = simulationAllowed(ctx);
  const tz = ctx.timezone;

  return (
    <>
      <PageHeader title={ui.t("page.appointments.title")} subtitle={`Bookings from Cal.com and appointments your team entered. Times in ${timezoneLabel(tz)} time.`} />
      {booking && booking.status !== "connected" && (
        <p className="mb-6 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Cal.com isn&apos;t connected yet, so online bookings won&apos;t appear here automatically.{" "}
          {roleCan(ctx.role, "integration.view") && <Link href="/app/connected-accounts" className="font-medium underline">Connect it on Connected Accounts</Link>}
          {sim && " You can try the flow with “Simulate a booking” on any lead."}
        </p>
      )}
      <Card title={`Upcoming (${upcoming.length})`} className="mb-6">
        {upcoming.length === 0 ? (
          <EmptyState icon={CalendarDays} title={ui.t("empty.appointments.title")}>{ui.t("empty.appointments.body")}</EmptyState>
        ) : <ul className="-my-4 divide-y divide-line">{upcoming.map((r) => <AppointmentRow key={r.a.id} r={r} tz={tz} canManage={canManage} sim={sim} past={false} />)}</ul>}
      </Card>
      <Card title="Past and cancelled">
        {past.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p>
          : <ul className="-my-4 divide-y divide-line">{past.map((r) => <AppointmentRow key={r.a.id} r={r} tz={tz} canManage={canManage} sim={sim} past />)}</ul>}
      </Card>
    </>
  );
}
