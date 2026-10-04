import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db/client";
import { withCompanyDb } from "@/lib/db/context";
import { bookingSettings } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { encrypt, newToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { UserError } from "@/lib/errors";
import { roleCan, type Action } from "@/lib/authz/permissions";
import { hasFeature } from "@/lib/authz/entitlements";
import type { CompanyContext } from "@/lib/authz/context-types";
import { webhookKeyHash } from "@/server/messaging/webhooks";
import { validBookingUrl } from "./links";

export type BookingSettingsRow = typeof bookingSettings.$inferSelect;

export async function loadBookingSettings(tx: Tx, companyId: string): Promise<BookingSettingsRow> {
  const [s] = await tx.select().from(bookingSettings).where(eq(bookingSettings.companyId, companyId));
  if (s) return s;
  await tx.insert(bookingSettings).values({ companyId }).onConflictDoNothing();
  const [created] = await tx.select().from(bookingSettings).where(eq(bookingSettings.companyId, companyId));
  return created!;
}

function need(ctx: CompanyContext, action: Action) {
  if (!roleCan(ctx.role, action)) throw new UserError("You don't have permission to do that.");
  if (!hasFeature(ctx.package, "booking")) throw new UserError("Booking is part of Bluewater Engage. Contact Bluewater to upgrade.");
  if (!action.endsWith(".view") && ctx.policy.login !== "full") throw new UserError("This account is read-only right now, so changes can't be saved.");
}
const actorType = (ctx: CompanyContext) => (ctx.supportGrantId ? "support" : "user") as "support" | "user";

/** Everything the screens need — never the webhook secret. */
export async function getBookingSettings(ctx: CompanyContext) {
  if (!hasFeature(ctx.package, "booking") || !roleCan(ctx.role, "appointment.view")) return null;
  return withCompanyDb(ctx, async (tx) => {
    const { webhookSecretEnc, webhookKeyHash: wk, ...rest } = await loadBookingSettings(tx, ctx.companyId);
    return { ...rest, webhookConfigured: Boolean(webhookSecretEnc && wk) };
  });
}

export async function saveBookingPage(ctx: CompanyContext, rawUrl: string, requestId?: string) {
  need(ctx, "integration.manage");
  const trimmed = rawUrl.trim();
  const url = trimmed ? validBookingUrl(trimmed) : null;
  if (trimmed && !url) throw new UserError("Enter the full booking page address, starting with https:// (for example https://cal.com/your-business/estimate).");
  return withCompanyDb(ctx, async (tx) => {
    const before = await loadBookingSettings(tx, ctx.companyId);
    await tx.update(bookingSettings).set({ bookingUrl: url, updatedAt: new Date() }).where(eq(bookingSettings.companyId, ctx.companyId));
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: "booking.page_saved", targetType: "booking", details: { from: before.bookingUrl, to: url }, requestId });
    return url;
  });
}

/**
 * Creates (or replaces) the address and signing secret the client pastes into Cal.com → Settings →
 * Developer → Webhooks. Both are shown ONCE; Bluewater stores only the encrypted secret and the
 * address's hash. Status becomes "connected" only after Cal.com sends a correctly signed message.
 */
export async function setUpBookingWebhook(ctx: CompanyContext, requestId?: string): Promise<{ url: string; secret: string }> {
  need(ctx, "integration.manage");
  const key = newToken(24);
  const secret = newToken(32);
  return withCompanyDb(ctx, async (tx) => {
    const before = await loadBookingSettings(tx, ctx.companyId);
    await tx.update(bookingSettings).set({
      webhookSecretEnc: encrypt(secret), webhookKeyHash: webhookKeyHash(key), status: "waiting_for_test", lastError: null, lastErrorAt: null, updatedAt: new Date(),
    }).where(eq(bookingSettings.companyId, ctx.companyId));
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: before.webhookKeyHash ? "booking.webhook_replaced" : "booking.webhook_created", targetType: "booking", requestId });
    return { url: `${env().APP_BASE_URL}/api/webhooks/calcom/${key}`, secret };
  });
}

export async function disconnectBooking(ctx: CompanyContext, requestId?: string) {
  need(ctx, "integration.manage");
  return withCompanyDb(ctx, async (tx) => {
    await loadBookingSettings(tx, ctx.companyId);
    await tx.update(bookingSettings).set({ webhookSecretEnc: null, webhookKeyHash: null, status: "not_connected", updatedAt: new Date() }).where(eq(bookingSettings.companyId, ctx.companyId));
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: "booking.disconnected", targetType: "booking", requestId });
  });
}

export const reminderSchema = z.object({
  confirmationsEnabled: z.boolean(),
  remindersEnabled: z.boolean(),
  reminderOffsetsMinutes: z.array(z.number().int().min(30, "Reminders must be at least 30 minutes before.").max(7 * 24 * 60, "Reminders can be at most 7 days before.")).max(3, "Choose up to 3 reminders."),
  emailAlso: z.boolean(),
});

/** Changes apply to appointments booked from now on (already-scheduled reminders keep their times). */
export async function saveReminderSettings(ctx: CompanyContext, input: z.input<typeof reminderSchema>, requestId?: string) {
  need(ctx, "template.manage");
  const parsed = reminderSchema.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]?.message ?? "Check the reminder settings.");
  const v = { ...parsed.data, reminderOffsetsMinutes: [...new Set(parsed.data.reminderOffsetsMinutes)].sort((a, b) => b - a) };
  return withCompanyDb(ctx, async (tx) => {
    await loadBookingSettings(tx, ctx.companyId);
    await tx.update(bookingSettings).set({ ...v, updatedAt: new Date() }).where(eq(bookingSettings.companyId, ctx.companyId));
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: "booking.reminders_updated", targetType: "booking", details: v, requestId });
  });
}
