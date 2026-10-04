import type { Tx } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";

export type ActorType = "user" | "platform_admin" | "support" | "system";

/** Keys that must never be written to the activity log, even by mistake. */
const FORBIDDEN_KEYS = /pass(word)?|token|secret|key|authorization|cookie|code/i;

export function redactDetails(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    out[k] = FORBIDDEN_KEYS.test(k) ? "[redacted]" : v;
  }
  return out;
}

/** Writes one activity-log entry inside the caller's transaction (so it commits with the change). */
export async function audit(
  tx: Tx,
  entry: {
    companyId: string | null;
    actorUserId: string | null;
    actorType: ActorType;
    action: string;
    targetType?: string;
    targetId?: string;
    details?: Record<string, unknown>;
    requestId?: string;
  },
): Promise<void> {
  await tx.insert(auditLog).values({
    companyId: entry.companyId,
    actorUserId: entry.actorUserId,
    actorType: entry.actorType,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    details: redactDetails(entry.details ?? {}),
    requestId: entry.requestId ?? null,
  });
}
