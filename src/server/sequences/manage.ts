import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db/client";
import { withCompanyDb } from "@/lib/db/context";
import { contacts, inquiries, inquiryEvents, messages, sequenceEnrollments, sequenceSteps, sequences } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { roleCan, type Action } from "@/lib/authz/permissions";
import { hasFeature } from "@/lib/authz/entitlements";
import type { CompanyContext } from "@/lib/authz/context-types";
import { cleanText } from "@/lib/contact-normalize";
import { DEFAULT_SEQUENCE_STEPS, validateTemplate } from "@/server/messaging/templates";
import { enqueueStep, startEnrollment, stepsFor } from "./engine";
import { cancelQueuedStepJobs, stopEnrollments, STOP_LABELS, type StopCode } from "./stop";

/** Server-side checks for every sequence action (the page guards are only a convenience). */
function need(ctx: CompanyContext, action: Action) {
  if (!roleCan(ctx.role, action)) throw new UserError("You don't have permission to do that.");
  if (!hasFeature(ctx.package, "sequences")) throw new UserError("Follow-up sequences are part of Package 2. Contact Bluewater to upgrade.");
  if (!action.endsWith(".view") && ctx.policy.login !== "full") throw new UserError("This account is read-only right now, so changes can't be saved.");
}
const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const actorType = (ctx: CompanyContext) => (ctx.supportGrantId ? "support" : "user") as "support" | "user";
const actor = (ctx: CompanyContext) => ({ userId: ctx.userId, type: actorType(ctx) });

export const MAX_STEPS = 8;
export const stepSchema = z.object({
  delayMinutes: z.number().int().min(60, "Wait at least 1 hour between steps.").max(30 * 24 * 60, "Steps can be at most 30 days apart."),
  channel: z.enum(["sms", "email", "sms_or_email"]),
  smsBody: z.string().max(1600).nullable().optional(),
  emailSubject: z.string().max(200).nullable().optional(),
  emailBody: z.string().max(5000).nullable().optional(),
});
export type StepInput = z.infer<typeof stepSchema>;

/** Validates every step's wording with the same rules as other templates. Returns plain-language problems. */
export function checkSteps(steps: StepInput[]): string[] {
  const problems: string[] = [];
  if (!steps.length) problems.push("Add at least one step.");
  if (steps.length > MAX_STEPS) problems.push(`A sequence can have at most ${MAX_STEPS} steps.`);
  steps.forEach((s, n) => {
    const label = `Step ${n + 1}`;
    if (s.channel !== "email") {
      const c = validateTemplate("followup_sms", (s.smsBody ?? "").trim());
      problems.push(...c.errors.map((e) => `${label} text: ${e}`));
    }
    if (s.channel !== "sms") {
      const c = validateTemplate("followup_email", (s.emailBody ?? "").trim(), (s.emailSubject ?? "").trim());
      problems.push(...c.errors.map((e) => `${label} email: ${e}`));
    }
  });
  return problems;
}

function normalizeSteps(steps: StepInput[]) {
  return steps.map((s, position) => ({
    position, delayMinutes: s.delayMinutes, channel: s.channel,
    smsBody: s.channel === "email" ? null : (s.smsBody ?? "").replace(/\r\n?/g, "\n").trim(),
    emailSubject: s.channel === "sms" ? null : (s.emailSubject ?? "").trim(),
    emailBody: s.channel === "sms" ? null : (s.emailBody ?? "").replace(/\r\n?/g, "\n").trim(),
  }));
}

/* ---------------- Reading ---------------- */

export async function listSequences(ctx: CompanyContext) {
  need(ctx, "sequence.view");
  return withCompanyDb(ctx, async (tx) => {
    const rows = await tx.select().from(sequences).orderBy(asc(sequences.createdAt));
    const counts = await tx.select({ sequenceId: sequenceEnrollments.sequenceId, status: sequenceEnrollments.status, n: count() })
      .from(sequenceEnrollments).groupBy(sequenceEnrollments.sequenceId, sequenceEnrollments.status);
    const stepCounts = await tx.select({ sequenceId: sequenceSteps.sequenceId, version: sequenceSteps.version, n: count() })
      .from(sequenceSteps).groupBy(sequenceSteps.sequenceId, sequenceSteps.version);
    return rows.map((s) => ({
      ...s,
      steps: stepCounts.find((c) => c.sequenceId === s.id && c.version === s.currentVersion)?.n ?? 0,
      active: counts.filter((c) => c.sequenceId === s.id && (c.status === "active" || c.status === "paused")).reduce((a, c) => a + c.n, 0),
      completed: counts.find((c) => c.sequenceId === s.id && c.status === "completed")?.n ?? 0,
      stopped: counts.find((c) => c.sequenceId === s.id && c.status === "stopped")?.n ?? 0,
    }));
  });
}

export async function getSequence(ctx: CompanyContext, id: string) {
  need(ctx, "sequence.view");
  if (!isId(id)) return null;
  return withCompanyDb(ctx, async (tx) => {
    const [s] = await tx.select().from(sequences).where(eq(sequences.id, id));
    if (!s) return null;
    const steps = await stepsFor(tx, s.id, s.currentVersion);
    const [{ open }] = (await tx.select({ open: count() }).from(sequenceEnrollments)
      .where(and(eq(sequenceEnrollments.sequenceId, id), inArray(sequenceEnrollments.status, ["active", "paused"])))) as [{ open: number }];
    const onOlder = await tx.select({ n: count() }).from(sequenceEnrollments)
      .where(and(eq(sequenceEnrollments.sequenceId, id), inArray(sequenceEnrollments.status, ["active", "paused"]), sql`${sequenceEnrollments.version} <> ${s.currentVersion}`));
    return { sequence: s, steps, openEnrollments: open, onOlderVersion: onOlder[0]?.n ?? 0 };
  });
}

/* ---------------- Owner changes ---------------- */

export async function createSequence(ctx: CompanyContext, name: string, requestId?: string): Promise<string> {
  need(ctx, "sequence.manage");
  const clean = cleanText(name, 80);
  if (!clean) throw new UserError("Give the sequence a name.");
  return withCompanyDb(ctx, async (tx) => {
    const [{ n }] = (await tx.select({ n: count() }).from(sequences)) as [{ n: number }];
    if (n >= 10) throw new UserError("A business can have up to 10 sequences.");
    const [s] = await tx.insert(sequences).values({ companyId: ctx.companyId, name: clean, status: "off", autoEnroll: false, currentVersion: 1, createdByUserId: ctx.userId }).returning();
    await tx.insert(sequenceSteps).values(normalizeSteps(DEFAULT_SEQUENCE_STEPS).map((st) => ({ ...st, companyId: ctx.companyId, sequenceId: s!.id, version: 1 })));
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: "sequence.created", targetType: "sequence", targetId: s!.id, details: { name: clean }, requestId });
    return s!.id;
  });
}

/**
 * Saves name/rules and, if the steps changed, a NEW VERSION of the steps. People already in the sequence
 * finish the version they started on (D-26); new enrollments use the new version.
 */
export async function saveSequence(ctx: CompanyContext, id: string, input: { name: string; stopOnManualMessage: boolean; handoffTask: boolean; steps: StepInput[] }, requestId?: string) {
  need(ctx, "sequence.manage");
  if (!isId(id)) throw new UserError("Sequence not found.");
  const name = cleanText(input.name, 80);
  if (!name) throw new UserError("Give the sequence a name.");
  const parsed = z.array(stepSchema).safeParse(input.steps);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]?.message ?? "Check the steps.");
  const problems = checkSteps(parsed.data);
  if (problems.length) throw new UserError(problems.join(" "));
  const steps = normalizeSteps(parsed.data);
  return withCompanyDb(ctx, async (tx) => {
    const [s] = await tx.select().from(sequences).where(eq(sequences.id, id)).for("update");
    if (!s) throw new UserError("Sequence not found.");
    const current = await stepsFor(tx, id, s.currentVersion);
    const same = current.length === steps.length && current.every((c, n) => {
      const x = steps[n]!;
      return c.delayMinutes === x.delayMinutes && c.channel === x.channel && c.smsBody === x.smsBody && c.emailSubject === x.emailSubject && c.emailBody === x.emailBody;
    });
    const version = same ? s.currentVersion : s.currentVersion + 1;
    if (!same) await tx.insert(sequenceSteps).values(steps.map((st) => ({ ...st, companyId: ctx.companyId, sequenceId: id, version })));
    await tx.update(sequences).set({ name, stopOnManualMessage: input.stopOnManualMessage, handoffTask: input.handoffTask, currentVersion: version, updatedAt: new Date() }).where(eq(sequences.id, id));
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: "sequence.saved", targetType: "sequence", targetId: id,
      details: { name, version, stepsChanged: !same, steps: steps.length, stopOnManualMessage: input.stopOnManualMessage, handoffTask: input.handoffTask }, requestId });
    return { version, stepsChanged: !same };
  });
}

/** Turning a sequence off stops everyone currently in it (their pending steps are cancelled). */
export async function setSequenceState(ctx: CompanyContext, id: string, input: { on: boolean; autoEnroll: boolean }, requestId?: string) {
  need(ctx, "sequence.manage");
  if (!isId(id)) throw new UserError("Sequence not found.");
  return withCompanyDb(ctx, async (tx) => {
    const [s] = await tx.select().from(sequences).where(eq(sequences.id, id)).for("update");
    if (!s) throw new UserError("Sequence not found.");
    const autoEnroll = input.on && input.autoEnroll;
    if (autoEnroll) {
      const [other] = await tx.select({ name: sequences.name }).from(sequences)
        .where(and(eq(sequences.autoEnroll, true), eq(sequences.status, "active"), sql`${sequences.id} <> ${id}`));
      if (other) throw new UserError(`"${other.name}" already starts automatically for new leads. Turn that off first — only one sequence can start automatically.`);
    }
    await tx.update(sequences).set({ status: input.on ? "active" : "off", autoEnroll, updatedAt: new Date() }).where(eq(sequences.id, id));
    const stopped = input.on ? 0 : await stopEnrollments(tx, ctx.companyId, { sequenceId: id }, "sequence_off", "The sequence was turned off", actor(ctx));
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: input.on ? "sequence.turned_on" : "sequence.turned_off",
      targetType: "sequence", targetId: id, details: { autoEnroll, stoppedEnrollments: stopped }, requestId });
    return { stopped };
  });
}

/* ---------------- One lead ---------------- */

export async function enrollmentForInquiry(ctx: CompanyContext, inquiryId: string) {
  if (!roleCan(ctx.role, "sequence.view") || !hasFeature(ctx.package, "sequences")) return null;
  return withCompanyDb(ctx, async (tx) => {
    const [i] = await tx.select({ contactId: inquiries.contactId }).from(inquiries).where(eq(inquiries.id, inquiryId));
    if (!i) return null;
    // The person's open follow-up (it may belong to an earlier inquiry), else this inquiry's latest.
    const [open] = await tx.select({ e: sequenceEnrollments, name: sequences.name }).from(sequenceEnrollments).innerJoin(sequences, eq(sequences.id, sequenceEnrollments.sequenceId))
      .where(and(eq(sequenceEnrollments.contactId, i.contactId), inArray(sequenceEnrollments.status, ["active", "paused"])));
    const [latest] = open ? [open] : await tx.select({ e: sequenceEnrollments, name: sequences.name }).from(sequenceEnrollments).innerJoin(sequences, eq(sequences.id, sequenceEnrollments.sequenceId))
      .where(eq(sequenceEnrollments.inquiryId, inquiryId)).orderBy(desc(sequenceEnrollments.enrolledAt)).limit(1);
    const available = await tx.select({ id: sequences.id, name: sequences.name }).from(sequences).where(eq(sequences.status, "active")).orderBy(asc(sequences.name));
    if (!latest) return { enrollment: null, available };
    const steps = await stepsFor(tx, latest.e.sequenceId, latest.e.version);
    return { enrollment: { ...latest.e, sequenceName: latest.name, totalSteps: steps.length, otherInquiry: latest.e.inquiryId !== inquiryId }, available };
  });
}

/**
 * A team member starts a follow-up for one lead. Leads that didn't arrive live through a form (imports,
 * manual entries) need the team member to confirm the person asked to be contacted (D-20).
 */
export async function enrollLead(ctx: CompanyContext, inquiryId: string, sequenceId: string, confirmedRequest: boolean, requestId?: string) {
  need(ctx, "sequence.enroll_contact");
  if (!isId(inquiryId) || !isId(sequenceId)) throw new UserError("Lead not found.");
  if (!ctx.policy.automatedSending) throw new UserError("Automatic messages aren't active for this account yet, so a follow-up can't start.");
  return withCompanyDb(ctx, async (tx) => {
    const [i] = await tx.select().from(inquiries).where(eq(inquiries.id, inquiryId)).for("update");
    if (!i) throw new UserError("Lead not found.");
    if (i.stage === "booked" || i.stage === "won" || i.stage === "lost") throw new UserError("This lead is already booked or closed, so a follow-up wouldn't make sense.");
    if (i.automationOrigin !== "eligible" && !confirmedRequest) {
      throw new UserError("This lead wasn't received through a connected form. Confirm the person asked to hear from you before starting a follow-up.");
    }
    const [s] = await tx.select().from(sequences).where(and(eq(sequences.id, sequenceId), eq(sequences.status, "active")));
    if (!s) throw new UserError("That sequence isn't turned on.");
    const id = await startEnrollment(tx, {
      companyId: ctx.companyId, sequenceId: s.id, version: s.currentVersion, inquiryId, contactId: i.contactId, origin: "manual",
      userId: ctx.userId, actorType: actorType(ctx), details: i.automationOrigin !== "eligible" ? { confirmedPersonAsked: true } : {},
    });
    if (!id) throw new UserError("This person is already in a follow-up. Stop that one first.");
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: "sequence.enrolled", targetType: "inquiry", targetId: inquiryId, details: { sequenceId, confirmedRequest }, requestId });
    return id;
  });
}

async function loadOpen(tx: Tx, enrollmentId: string) {
  if (!isId(enrollmentId)) throw new UserError("Follow-up not found.");
  const [e] = await tx.select().from(sequenceEnrollments).where(eq(sequenceEnrollments.id, enrollmentId)).for("update");
  if (!e) throw new UserError("Follow-up not found.");
  return e;
}

export async function pauseEnrollment(ctx: CompanyContext, enrollmentId: string) {
  need(ctx, "sequence.pause_contact");
  return withCompanyDb(ctx, async (tx) => {
    const e = await loadOpen(tx, enrollmentId);
    if (e.status !== "active") throw new UserError("Only a running follow-up can be paused.");
    await tx.update(sequenceEnrollments).set({ status: "paused", pausedAt: new Date(), updatedAt: new Date() }).where(eq(sequenceEnrollments.id, e.id));
    await cancelQueuedStepJobs(tx, [e.id], "Paused by a team member");
    await tx.insert(inquiryEvents).values({ companyId: ctx.companyId, inquiryId: e.inquiryId, type: "follow_up_paused", actorUserId: ctx.userId, actorType: actorType(ctx), details: { sequenceId: e.sequenceId } });
  });
}

/** Resuming continues with the next unsent step — at its original time, or in a minute if that has passed. */
export async function resumeEnrollment(ctx: CompanyContext, enrollmentId: string) {
  need(ctx, "sequence.pause_contact");
  if (!ctx.policy.automatedSending) throw new UserError("Automatic messages aren't active for this account right now.");
  return withCompanyDb(ctx, async (tx) => {
    const e = await loadOpen(tx, enrollmentId);
    if (e.status !== "paused") throw new UserError("This follow-up isn't paused.");
    const now = new Date();
    const runAt = e.nextRunAt && e.nextRunAt > now ? e.nextRunAt : new Date(now.getTime() + 60_000);
    await tx.update(sequenceEnrollments).set({ status: "active", pausedAt: null, nextRunAt: runAt, updatedAt: now }).where(eq(sequenceEnrollments.id, e.id));
    // A fresh job key (the paused one was cancelled); the MESSAGE key stays per step, so nothing can send twice.
    await enqueueStep(tx, ctx.companyId, e.id, e.nextStep, runAt, `:resume:${now.getTime()}`);
    await tx.insert(inquiryEvents).values({ companyId: ctx.companyId, inquiryId: e.inquiryId, type: "follow_up_resumed", actorUserId: ctx.userId, actorType: actorType(ctx), details: { nextStepAt: runAt.toISOString() } });
  });
}

export async function stopEnrollment(ctx: CompanyContext, enrollmentId: string) {
  need(ctx, "sequence.pause_contact");
  return withCompanyDb(ctx, async (tx) => {
    const e = await loadOpen(tx, enrollmentId);
    if (e.status !== "active" && e.status !== "paused") throw new UserError("This follow-up has already ended.");
    await stopEnrollments(tx, ctx.companyId, { enrollmentId: e.id }, "stopped_by_user", "Stopped by a team member", actor(ctx));
  });
}

/* ---------------- Overview ---------------- */

export async function activeFollowUps(ctx: CompanyContext, limit = 8) {
  if (!roleCan(ctx.role, "sequence.view") || !hasFeature(ctx.package, "sequences")) return null;
  return withCompanyDb(ctx, async (tx) => {
    const [{ active }] = (await tx.select({ active: count() }).from(sequenceEnrollments).where(eq(sequenceEnrollments.status, "active"))) as [{ active: number }];
    const [{ paused }] = (await tx.select({ paused: count() }).from(sequenceEnrollments).where(eq(sequenceEnrollments.status, "paused"))) as [{ paused: number }];
    const next = await tx.select({ id: sequenceEnrollments.id, inquiryId: sequenceEnrollments.inquiryId, nextRunAt: sequenceEnrollments.nextRunAt, nextStep: sequenceEnrollments.nextStep, status: sequenceEnrollments.status, name: contacts.fullName, sequence: sequences.name })
      .from(sequenceEnrollments).innerJoin(contacts, eq(contacts.id, sequenceEnrollments.contactId)).innerJoin(sequences, eq(sequences.id, sequenceEnrollments.sequenceId))
      .where(inArray(sequenceEnrollments.status, ["active", "paused"])).orderBy(sql`${sequenceEnrollments.nextRunAt} asc nulls last`).limit(limit);
    return { active, paused, next };
  });
}

/** Why follow-ups stopped in a period (for the Overview). */
export async function stopActivity(ctx: CompanyContext, since: Date) {
  if (!roleCan(ctx.role, "sequence.view") || !hasFeature(ctx.package, "sequences")) return null;
  return withCompanyDb(ctx, async (tx) => {
    const rows = await tx.select({ code: sequenceEnrollments.stopCode, n: count() }).from(sequenceEnrollments)
      .where(and(eq(sequenceEnrollments.status, "stopped"), sql`${sequenceEnrollments.endedAt} >= ${since.toISOString()}`)).groupBy(sequenceEnrollments.stopCode);
    const [{ completed }] = (await tx.select({ completed: count() }).from(sequenceEnrollments)
      .where(and(eq(sequenceEnrollments.status, "completed"), sql`${sequenceEnrollments.endedAt} >= ${since.toISOString()}`))) as [{ completed: number }];
    const [{ sent }] = (await tx.select({ sent: count() }).from(messages)
      .where(and(eq(messages.kind, "follow_up"), inArray(messages.status, ["submitted", "delivered"]), sql`${messages.createdAt} >= ${since.toISOString()}`))) as [{ sent: number }];
    return { sent, completed, stopped: rows.map((r) => ({ code: r.code as StopCode, label: STOP_LABELS[r.code as StopCode] ?? r.code ?? "Other", n: r.n })).sort((a, b) => b.n - a.n) };
  });
}
