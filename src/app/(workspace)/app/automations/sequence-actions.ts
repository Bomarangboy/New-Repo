"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actionContext, requestId } from "@/lib/authz/guard";
import { userMessage } from "@/lib/user-message";
import { UserError } from "@/lib/errors";
import type { FormState } from "@/components/forms";
import { createSequence, enrollLead, pauseEnrollment, resumeEnrollment, saveSequence, setSequenceState, stopEnrollment, type StepInput } from "@/server/sequences/manage";
import { saveReminderSettings } from "@/server/booking/settings";

async function run(fn: () => Promise<string>, paths: string[] = []): Promise<FormState> {
  try {
    const ok = await fn();
    paths.forEach((p) => revalidatePath(p));
    return { ok };
  } catch (e) {
    return { error: userMessage(e) };
  }
}
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export async function createSequenceAction(_: FormState, fd: FormData): Promise<FormState> {
  let id = "";
  const r = await run(async () => {
    const ctx = await actionContext("sequence.manage", "sequences");
    id = await createSequence(ctx, str(fd, "name"), await requestId());
    return "ok";
  });
  if (r?.error) return r;
  redirect(`/app/automations/sequences/${id}?created=1`);
}

export async function saveSequenceAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = str(fd, "sequenceId");
  return run(async () => {
    const ctx = await actionContext("sequence.manage", "sequences");
    let steps: StepInput[];
    try { steps = JSON.parse(str(fd, "steps")); } catch { throw new UserError("Please reload the page and try again."); }
    if (!Array.isArray(steps)) throw new UserError("Please reload the page and try again.");
    const r = await saveSequence(ctx, id, { name: str(fd, "name"), stopOnManualMessage: fd.get("stopOnManualMessage") === "on", handoffTask: fd.get("handoffTask") === "on", steps }, await requestId());
    return r.stepsChanged ? `Saved as version ${r.version}. People already in this sequence keep the wording they started with; new enrollments use this version.` : "Saved.";
  }, [`/app/automations/sequences/${id}`, "/app/automations"]);
}

export async function setSequenceStateAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = str(fd, "sequenceId");
  return run(async () => {
    const ctx = await actionContext("sequence.manage", "sequences");
    const on = fd.get("on") === "1";
    const r = await setSequenceState(ctx, id, { on, autoEnroll: fd.get("autoEnroll") === "on" }, await requestId());
    if (!on) return r.stopped ? `Turned off. ${r.stopped} ${r.stopped === 1 ? "person" : "people"} will not receive further messages from it.` : "Turned off.";
    return fd.get("autoEnroll") === "on" ? "On — new website leads start this sequence automatically." : "On — start it for a lead from the lead's page.";
  }, [`/app/automations/sequences/${id}`, "/app/automations"]);
}

export async function saveReminderSettingsAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("template.manage", "booking");
    const offsets = fd.getAll("offsets").map(Number).filter((n) => Number.isFinite(n) && n > 0);
    await saveReminderSettings(ctx, {
      confirmationsEnabled: fd.get("confirmationsEnabled") === "on", remindersEnabled: fd.get("remindersEnabled") === "on",
      reminderOffsetsMinutes: offsets, emailAlso: fd.get("emailAlso") === "on",
    }, await requestId());
    return "Saved. Applies to appointments booked from now on.";
  }, ["/app/automations"]);
}

/* One lead's follow-up (from the lead page). */
export async function enrollAction(_: FormState, fd: FormData): Promise<FormState> {
  const inquiryId = str(fd, "inquiryId");
  return run(async () => {
    const ctx = await actionContext("sequence.enroll_contact", "sequences");
    await enrollLead(ctx, inquiryId, str(fd, "sequenceId"), fd.get("confirmed") === "on", await requestId());
    return "Follow-up started.";
  }, [`/app/leads/${inquiryId}`]);
}

export async function enrollmentControlAction(_: FormState, fd: FormData): Promise<FormState> {
  const inquiryId = str(fd, "inquiryId");
  return run(async () => {
    const ctx = await actionContext("sequence.pause_contact", "sequences");
    const id = str(fd, "enrollmentId");
    switch (str(fd, "op")) {
      case "pause": await pauseEnrollment(ctx, id); return "Paused. Nothing more is sent until you resume.";
      case "resume": await resumeEnrollment(ctx, id); return "Resumed.";
      case "stop": await stopEnrollment(ctx, id); return "Stopped.";
      default: throw new UserError("Unknown action.");
    }
  }, [`/app/leads/${inquiryId}`, "/app"]);
}
