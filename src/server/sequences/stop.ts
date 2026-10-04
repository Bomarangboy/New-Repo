import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { inquiryEvents, jobs, sequenceEnrollments } from "@/lib/db/schema";

/**
 * Stop rules for follow-up sequences (docs/MESSAGING.md). Called the moment something happens
 * (reply, opt-out, booking, lead closed, manual message, account change) so the screens are right
 * immediately — and the step job re-checks everything again just before sending, so a missed hook
 * can never cause a send.
 */
export type StopCode =
  | "replied" | "booked" | "opted_out" | "closed" | "manual_message" | "stopped_by_user"
  | "account" | "paused_all" | "package" | "sequence_off" | "sending_off";

export const STOP_LABELS: Record<StopCode, string> = {
  replied: "They replied",
  booked: "They booked",
  opted_out: "They opted out",
  closed: "Lead closed (won/lost)",
  manual_message: "A team member messaged them",
  stopped_by_user: "Stopped by a team member",
  account: "Account not active for automatic messages",
  paused_all: "Emergency stop",
  package: "Package doesn't include follow-ups",
  sequence_off: "Sequence turned off",
  sending_off: "Sending not switched on for this business",
};

export interface StopTarget { contactId?: string; inquiryId?: string; sequenceId?: string; enrollmentId?: string; allInCompany?: true }

export async function stopEnrollments(
  tx: Tx, companyId: string, target: StopTarget, code: StopCode, reason: string,
  actor: { userId?: string | null; type: "user" | "support" | "system" } = { type: "system" },
): Promise<number> {
  const conds = [eq(sequenceEnrollments.companyId, companyId), inArray(sequenceEnrollments.status, ["active", "paused"])];
  if (target.contactId) conds.push(eq(sequenceEnrollments.contactId, target.contactId));
  if (target.inquiryId) conds.push(eq(sequenceEnrollments.inquiryId, target.inquiryId));
  if (target.sequenceId) conds.push(eq(sequenceEnrollments.sequenceId, target.sequenceId));
  if (target.enrollmentId) conds.push(eq(sequenceEnrollments.id, target.enrollmentId));
  if (!target.contactId && !target.inquiryId && !target.sequenceId && !target.enrollmentId && !target.allInCompany) throw new Error("stopEnrollments needs a target");

  const now = new Date();
  const stopped = await tx.update(sequenceEnrollments)
    .set({ status: "stopped", stopCode: code, stopReason: reason.slice(0, 300), endedAt: now, nextRunAt: null, updatedAt: now })
    .where(and(...conds)).returning({ id: sequenceEnrollments.id, inquiryId: sequenceEnrollments.inquiryId, sequenceId: sequenceEnrollments.sequenceId });
  if (!stopped.length) return 0;

  await tx.insert(inquiryEvents).values(stopped.map((s) => ({
    companyId, inquiryId: s.inquiryId, type: "follow_up_stopped", actorUserId: actor.userId ?? null, actorType: actor.type,
    details: { code, reason, sequenceId: s.sequenceId },
  })));
  await cancelQueuedStepJobs(tx, stopped.map((s) => s.id), reason);
  return stopped.length;
}

/** Waiting step jobs for these enrollments are cancelled (they would cancel themselves anyway). */
export async function cancelQueuedStepJobs(tx: Tx, enrollmentIds: string[], reason: string) {
  if (!enrollmentIds.length) return;
  await tx.update(jobs).set({ status: "cancelled", result: reason.slice(0, 300), finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(jobs.kind, "sequence_step"), eq(jobs.status, "queued"), inArray(sql`${jobs.payload}->>'enrollmentId'`, enrollmentIds)));
}
