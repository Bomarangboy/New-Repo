"use server";

import { revalidatePath } from "next/cache";
import { actionContext, requestId } from "@/lib/authz/guard";
import { userMessage } from "@/lib/user-message";
import { UserError } from "@/lib/errors";
import type { FormState } from "@/components/forms";
import { cancelAppointment, createManualAppointment, setAppointmentOutcome, simulateBooking, simulateBookingChange } from "@/server/booking/appointments";

async function run(fn: () => Promise<string>, paths: string[]): Promise<FormState> {
  try {
    const ok = await fn();
    paths.forEach((p) => revalidatePath(p));
    return { ok };
  } catch (e) {
    return { error: userMessage(e) };
  }
}
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const paths = (fd: FormData) => ["/app/appointments", "/app", ...(fd.get("inquiryId") ? [`/app/leads/${str(fd, "inquiryId")}`] : [])];

export async function addAppointmentAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("appointment.manage", "appointments");
    await createManualAppointment(ctx, { inquiryId: str(fd, "inquiryId"), date: str(fd, "date"), time: str(fd, "time"), durationMinutes: Number(fd.get("duration") ?? 60), title: str(fd, "title"), location: str(fd, "location") }, await requestId());
    return "Appointment added. The lead is now Booked and any follow-up messages have stopped.";
  }, paths(fd));
}

export async function appointmentOutcomeAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("appointment.manage", "appointments");
    const op = str(fd, "op");
    if (op === "completed" || op === "no_show") { await setAppointmentOutcome(ctx, str(fd, "appointmentId"), op); return op === "completed" ? "Marked as completed." : "Marked as no-show."; }
    if (op === "cancel") { await cancelAppointment(ctx, str(fd, "appointmentId"), str(fd, "reason")); return "Appointment cancelled. Reminders won't be sent."; }
    throw new UserError("Unknown action.");
  }, paths(fd));
}

export async function simulateBookingAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("appointment.manage", "appointments");
    const r = await simulateBooking(ctx, str(fd, "inquiryId"), str(fd, "date"), str(fd, "time"));
    if (r.outcome !== "created") throw new UserError(r.detail ?? "The simulated booking wasn't recorded.");
    return "Simulated booking recorded (nothing was sent to a real calendar or phone).";
  }, paths(fd));
}

export async function simulateChangeAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("appointment.manage", "appointments");
    const op = str(fd, "op") === "cancel" ? "cancel" : "reschedule";
    const r = await simulateBookingChange(ctx, str(fd, "appointmentId"), op, str(fd, "date"), str(fd, "time"));
    if (r.outcome !== (op === "cancel" ? "cancelled" : "rescheduled")) throw new UserError(r.detail ?? "Nothing changed.");
    return op === "cancel" ? "Simulated cancellation recorded." : "Simulated reschedule recorded.";
  }, paths(fd));
}
