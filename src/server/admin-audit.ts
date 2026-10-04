import { desc, eq } from "drizzle-orm";
import { withPlatformDb } from "@/lib/db/context";
import { auditLog, companies, users } from "@/lib/db/schema";
import type { PlatformContext } from "@/lib/authz/context-types";

export async function platformActivity(ctx: PlatformContext, limit = 200) {
  return withPlatformDb(ctx, (tx) =>
    tx.select({
      id: auditLog.id, action: auditLog.action, actorType: auditLog.actorType, actorEmail: users.email,
      companyName: companies.name, details: auditLog.details, createdAt: auditLog.createdAt, requestId: auditLog.requestId,
    }).from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .leftJoin(companies, eq(companies.id, auditLog.companyId))
      .orderBy(desc(auditLog.createdAt)).limit(limit),
  );
}
