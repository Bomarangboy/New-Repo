import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { withCompanyDb } from "@/lib/db/context";
import type { Tx } from "@/lib/db/client";
import {
  libraryCategories, libraryCopies, libraryEvidence, libraryTemplateVersions, libraryTemplates, sequenceEnrollments, sequenceSteps, sequences,
} from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { roleCan, type Action } from "@/lib/authz/permissions";
import { PACKAGE_NAMES, hasFeature } from "@/lib/authz/entitlements";
import type { CompanyContext } from "@/lib/authz/context-types";
import { activeTemplate, saveTemplate } from "@/server/messaging/settings";
import { normalizeSteps, saveSequence, setSequenceState, type StepInput } from "@/server/sequences/manage";
import { blockers, copyContent, readiness, CONFIRMATIONS, type ConfirmKey } from "./readiness";
import { packageAllows, type AckDefinition, type Definition, type SequenceDefinition } from "./format";

/**
 * Sequence Library for client workspaces: Search → Preview → Copy → Customize → Validate → Activate.
 * Copies are private company records; the library original and other companies' copies never change.
 * Copying never sends or enrolls anyone; activation is a separate, explicit, permission-checked step that
 * goes through the existing automation engine (sequences and acknowledgment templates) and its safeguards.
 */
const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const actorType = (ctx: CompanyContext) => (ctx.supportGrantId ? "support" : "user") as "support" | "user";
export const MIN_EVIDENCE = { enrolled: 50, companies: 3 };

function need(ctx: CompanyContext, action: Action) {
  if (!roleCan(ctx.role, action)) throw new UserError("You don't have permission to do that.");
  if (!hasFeature(ctx.package, "acknowledgment")) throw new UserError("The Sequence Library isn't part of this plan.");
  if (!action.endsWith(".view") && ctx.policy.login !== "full") throw new UserError("This account is read-only right now, so changes can't be saved.");
}

/** Whether this company's package may use a template (backend rule: Connect = acknowledgments only). */
export function eligible(ctx: Pick<CompanyContext, "package">, t: { kind: string; requiredPackage: typeof libraryTemplates.$inferSelect["requiredPackage"] }): { ok: boolean; reason?: string } {
  if (t.kind === "sequence" && !hasFeature(ctx.package, "sequences")) return { ok: false, reason: `Follow-up sequences are part of ${PACKAGE_NAMES.follow_up_booking}.` };
  if (!packageAllows(ctx.package, t.requiredPackage)) return { ok: false, reason: `Requires ${PACKAGE_NAMES[t.requiredPackage]}.` };
  return { ok: true };
}

export interface LibraryFilters { q?: string; industry?: string; objective?: string; channel?: string; duration?: string; package?: string; integration?: string; kind?: string }

export async function listLibrary(ctx: CompanyContext, f: LibraryFilters = {}) {
  need(ctx, "library.view");
  return withCompanyDb(ctx, async (tx) => {
    const conds = [eq(libraryTemplates.status, "published")];
    if (f.q?.trim()) conds.push(or(ilike(libraryTemplates.name, `%${f.q.trim()}%`), ilike(libraryTemplates.description, `%${f.q.trim()}%`))!);
    if (f.industry) conds.push(eq(libraryTemplates.industry, f.industry));
    if (f.objective) conds.push(eq(libraryTemplates.objective, f.objective));
    if (f.kind === "acknowledgment" || f.kind === "sequence") conds.push(eq(libraryTemplates.kind, f.kind));
    if (f.channel === "sms" || f.channel === "email") conds.push(sql`${libraryTemplates.channels} ? ${f.channel}`);
    if (f.package === "instant_response" || f.package === "follow_up_booking" || f.package === "performance_reporting") conds.push(eq(libraryTemplates.requiredPackage, f.package));
    if (f.integration === "none") conds.push(sql`jsonb_array_length(${libraryTemplates.requiredIntegrations}) = 0`);
    else if (f.integration) conds.push(sql`${libraryTemplates.requiredIntegrations} ? ${f.integration}`);
    if (f.duration === "short") conds.push(sql`${libraryTemplates.durationDays} <= 7`);
    if (f.duration === "medium") conds.push(sql`${libraryTemplates.durationDays} between 8 and 14`);
    if (f.duration === "long") conds.push(sql`${libraryTemplates.durationDays} > 14`);
    const rows = await tx.select({ t: libraryTemplates, category: libraryCategories.name }).from(libraryTemplates).leftJoin(libraryCategories, eq(libraryCategories.id, libraryTemplates.categoryId))
      .where(and(...conds)).orderBy(desc(libraryTemplates.recommended), asc(libraryTemplates.name)).limit(100);
    const facets = await tx.select({ industry: libraryTemplates.industry, objective: libraryTemplates.objective }).from(libraryTemplates).where(eq(libraryTemplates.status, "published"));
    const mine = await tx.select({ templateId: libraryCopies.templateId, n: count() }).from(libraryCopies).where(ne(libraryCopies.status, "archived")).groupBy(libraryCopies.templateId);
    const proven = await tx.select({ templateId: libraryEvidence.templateId }).from(libraryEvidence)
      .where(and(eq(libraryEvidence.published, true), sql`${libraryEvidence.enrolled} >= ${MIN_EVIDENCE.enrolled}`, sql`${libraryEvidence.companies} >= ${MIN_EVIDENCE.companies}`));
    return {
      rows: rows.map((r) => ({ ...r.t, category: r.category, eligibility: eligible(ctx, r.t), copies: mine.find((m) => m.templateId === r.t.id)?.n ?? 0, hasEvidence: proven.some((p) => p.templateId === r.t.id) })),
      industries: [...new Set(facets.map((x) => x.industry))].sort(), objectives: [...new Set(facets.map((x) => x.objective))].sort(),
    };
  });
}

/** Everything a business needs to judge a template before copying: every message, delay, rule and requirement. */
export async function getLibraryTemplate(ctx: CompanyContext, id: string) {
  need(ctx, "library.view");
  if (!isId(id)) return null;
  return withCompanyDb(ctx, async (tx) => {
    const [t] = await tx.select().from(libraryTemplates).where(and(eq(libraryTemplates.id, id), ne(libraryTemplates.status, "draft")));
    if (!t || t.latestVersion == null) return null;
    const [v] = await tx.select().from(libraryTemplateVersions).where(and(eq(libraryTemplateVersions.templateId, id), eq(libraryTemplateVersions.version, t.latestVersion)));
    const evidence = (await tx.select().from(libraryEvidence).where(and(eq(libraryEvidence.templateId, id), eq(libraryEvidence.published, true))).orderBy(desc(libraryEvidence.computedAt)).limit(1))
      .filter((e) => e.enrolled >= MIN_EVIDENCE.enrolled && e.companies >= MIN_EVIDENCE.companies)[0] ?? null;
    const copies = await tx.select().from(libraryCopies).where(and(eq(libraryCopies.templateId, id), ne(libraryCopies.status, "archived"))).orderBy(desc(libraryCopies.createdAt));
    return { template: t, definition: v!.definition as Definition, version: v!.version, evidence, copies, eligibility: eligible(ctx, t) };
  });
}

/** Creates a PRIVATE DRAFT copy in this company. Sends nothing, enrolls no one, turns nothing on. */
export async function copyTemplate(ctx: CompanyContext, templateId: string, requestId?: string): Promise<{ copyId: string; sequenceId: string | null }> {
  need(ctx, "library.adopt");
  if (!isId(templateId)) throw new UserError("Template not found.");
  return withCompanyDb(ctx, async (tx) => {
    const [t] = await tx.select().from(libraryTemplates).where(eq(libraryTemplates.id, templateId));
    if (!t || t.status === "draft" || t.latestVersion == null) throw new UserError("Template not found.");
    if (t.status === "retired") throw new UserError("This template has been retired and can't be copied any more. Existing copies keep working.");
    if (t.status === "paused") throw new UserError("Bluewater has paused this template for review. Try again later.");
    const el = eligible(ctx, t);
    if (!el.ok) throw new UserError(`${el.reason} Contact Bluewater to upgrade.`);
    const [v] = await tx.select().from(libraryTemplateVersions).where(and(eq(libraryTemplateVersions.templateId, templateId), eq(libraryTemplateVersions.version, t.latestVersion)));
    const def = v!.definition as Definition;
    let sequenceId: string | null = null;
    if (def.kind === "sequence") {
      if (!roleCan(ctx.role, "sequence.manage")) throw new UserError("You don't have permission to do that.");
      const [{ n }] = (await tx.select({ n: count() }).from(sequences)) as [{ n: number }];
      if (n >= 10) throw new UserError("A business can have up to 10 sequences. Remove one you don't use first.");
      const [s] = await tx.insert(sequences).values({
        companyId: ctx.companyId, name: def.name.slice(0, 80), status: "off", autoEnroll: false, currentVersion: 1,
        stopOnManualMessage: def.stopOnManualMessage, handoffTask: def.handoffTask, createdByUserId: ctx.userId,
      }).returning();
      sequenceId = s!.id;
      await tx.insert(sequenceSteps).values(normalizeSteps(def.steps as StepInput[]).map((st) => ({ ...st, companyId: ctx.companyId, sequenceId: s!.id, version: 1 })));
    } else if (!roleCan(ctx.role, "template.manage")) throw new UserError("You don't have permission to do that.");
    const draft = def.kind === "acknowledgment" ? { ...(def as AckDefinition).acknowledgment } : {};
    const [c] = await tx.insert(libraryCopies).values({ companyId: ctx.companyId, templateId, templateVersion: v!.version, kind: def.kind, sequenceId, draft, createdByUserId: ctx.userId }).returning();
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: "library.copied", targetType: "library_copy", targetId: c!.id,
      details: { template: t.slug, version: v!.version, kind: def.kind, sequenceId }, requestId });
    return { copyId: c!.id, sequenceId };
  });
}

export async function listMyCopies(ctx: CompanyContext) {
  need(ctx, "library.view");
  return withCompanyDb(ctx, (tx) => tx.select({ c: libraryCopies, name: libraryTemplates.name, latest: libraryTemplates.latestVersion, templateStatus: libraryTemplates.status, seqName: sequences.name, seqStatus: sequences.status })
    .from(libraryCopies).innerJoin(libraryTemplates, eq(libraryTemplates.id, libraryCopies.templateId)).leftJoin(sequences, eq(sequences.id, libraryCopies.sequenceId))
    .where(ne(libraryCopies.status, "archived")).orderBy(desc(libraryCopies.createdAt)));
}

async function loadCopy(tx: Tx, copyId: string) {
  if (!isId(copyId)) throw new UserError("Copy not found.");
  const [c] = await tx.select().from(libraryCopies).where(eq(libraryCopies.id, copyId)).for("update");
  if (!c) throw new UserError("Copy not found.");
  return c;
}

export async function getCopy(ctx: CompanyContext, copyId: string) {
  need(ctx, "library.view");
  if (!isId(copyId)) return null;
  return withCompanyDb(ctx, async (tx) => {
    const [c] = await tx.select().from(libraryCopies).where(eq(libraryCopies.id, copyId));
    if (!c) return null;
    const [t] = await tx.select().from(libraryTemplates).where(eq(libraryTemplates.id, c.templateId));
    const content = await copyContent(tx, c);
    const items = await readiness(tx, ctx.companyId, c);
    const [{ open }] = c.sequenceId ? (await tx.select({ open: count() }).from(sequenceEnrollments).where(and(eq(sequenceEnrollments.sequenceId, c.sequenceId), inArray(sequenceEnrollments.status, ["active", "paused"])))) as [{ open: number }] : [{ open: 0 }];
    return { copy: c, template: t!, content, items, blockers: blockers(items), openEnrollments: open, updateAvailable: t!.latestVersion != null && t!.latestVersion > c.templateVersion };
  });
}

/** Records the owner's checklist confirmations (never activates anything by itself). */
export async function confirmSetup(ctx: CompanyContext, copyId: string, keys: string[], requestId?: string) {
  need(ctx, "library.adopt");
  return withCompanyDb(ctx, async (tx) => {
    const c = await loadCopy(tx, copyId);
    const setup = { ...(c.setup as Record<string, unknown>) };
    for (const k of Object.keys(CONFIRMATIONS) as ConfirmKey[]) setup[k] = keys.includes(k);
    await tx.update(libraryCopies).set({ setup, updatedAt: new Date() }).where(eq(libraryCopies.id, c.id));
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: "library.setup_confirmed", targetType: "library_copy", targetId: c.id, details: { confirmed: keys }, requestId });
  });
}

/** Saves the wording of an acknowledgment copy (sequence copies are edited in the normal sequence editor). */
export async function saveAckDraft(ctx: CompanyContext, copyId: string, input: { smsBody: string; emailSubject: string; emailBody: string }, requestId?: string) {
  need(ctx, "library.adopt");
  if (!roleCan(ctx.role, "template.manage")) throw new UserError("You don't have permission to do that.");
  const draft = { smsBody: input.smsBody.replace(/\r\n?/g, "\n").trim().slice(0, 1600), emailSubject: input.emailSubject.trim().slice(0, 200), emailBody: input.emailBody.replace(/\r\n?/g, "\n").trim().slice(0, 5000) };
  return withCompanyDb(ctx, async (tx) => {
    const c = await loadCopy(tx, copyId);
    if (c.kind !== "acknowledgment") throw new UserError("Edit sequences in the sequence editor.");
    await tx.update(libraryCopies).set({ draft, updatedAt: new Date() }).where(eq(libraryCopies.id, c.id));
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: "library.copy_edited", targetType: "library_copy", targetId: c.id, requestId });
  });
}

/**
 * Activation (explicit, owner-level). Sequence: turns the company's sequence ON through the normal switch
 * (which re-checks the checklist); `autoEnroll` decides whether FUTURE eligible new leads start it automatically.
 * Nobody already in the system is enrolled. Acknowledgment: becomes the company's active acknowledgment wording
 * (a new template version; the previous version is remembered).
 */
export async function activateCopy(ctx: CompanyContext, copyId: string, opts: { autoEnroll: boolean }, requestId?: string) {
  need(ctx, "library.adopt");
  const info = await withCompanyDb(ctx, async (tx) => {
    const c = await loadCopy(tx, copyId);
    const b = blockers(await readiness(tx, ctx.companyId, c));
    if (b.length) throw new UserError(`Finish the setup checklist first: ${b.map((x) => x.label).join(", ")}.`);
    return c;
  });
  if (info.kind === "sequence") {
    await setSequenceState(ctx, info.sequenceId!, { on: true, autoEnroll: opts.autoEnroll }, requestId);
  } else {
    const d = info.draft as { smsBody?: string; emailSubject?: string; emailBody?: string };
    const previous = await withCompanyDb(ctx, async (tx) => ({
      ack_sms: await activeTemplate(tx, ctx.companyId, "ack_sms"), ack_email: await activeTemplate(tx, ctx.companyId, "ack_email"),
    }));
    if (d.smsBody) await saveTemplate(ctx, "ack_sms", { body: d.smsBody }, requestId);
    if (d.emailBody) await saveTemplate(ctx, "ack_email", { subject: d.emailSubject ?? "", body: d.emailBody }, requestId);
    await withCompanyDb(ctx, (tx) => tx.update(libraryCopies).set({ previous }).where(eq(libraryCopies.id, info.id)));
  }
  await withCompanyDb(ctx, async (tx) => {
    await tx.update(libraryCopies).set({ status: "active", activatedAt: new Date(), activatedByUserId: ctx.userId, updatedAt: new Date() }).where(eq(libraryCopies.id, info.id));
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: "library.activated", targetType: "library_copy", targetId: info.id,
      details: { kind: info.kind, autoEnroll: info.kind === "sequence" ? opts.autoEnroll : null }, requestId });
  });
}

export async function archiveCopy(ctx: CompanyContext, copyId: string, requestId?: string) {
  need(ctx, "library.adopt");
  const c = await withCompanyDb(ctx, (tx) => loadCopy(tx, copyId));
  if (c.kind === "sequence" && c.sequenceId) {
    const [s] = await withCompanyDb(ctx, (tx) => tx.select().from(sequences).where(eq(sequences.id, c.sequenceId!)));
    if (s?.status === "active") throw new UserError("Turn the sequence off first (Automations → the sequence). People already in it are handled by the normal stop rules.");
  }
  await withCompanyDb(ctx, async (tx) => {
    await tx.update(libraryCopies).set({ status: "archived", updatedAt: new Date() }).where(eq(libraryCopies.id, c.id));
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: "library.copy_archived", targetType: "library_copy", targetId: c.id, requestId });
  });
}

/* ---------------- Template updates ---------------- */

type StepLike = { delayMinutes: number; channel: string; smsBody: string | null; emailSubject: string | null; emailBody: string | null };
const stepKey = (s: StepLike | undefined) => (s ? JSON.stringify([s.delayMinutes, s.channel, s.smsBody ?? null, s.emailSubject ?? null, s.emailBody ?? null]) : "");

export interface StepDiff { position: number; status: "same" | "updated" | "conflict" | "yours" | "added" | "removed"; yours?: StepLike; base?: StepLike; next?: StepLike }

/**
 * What a newer published version would change in this copy. "updated" = Bluewater changed a step you didn't
 * touch; "conflict" = both of you changed it; "yours" = only you changed it (kept either way in a merge).
 */
export async function updatePreview(ctx: CompanyContext, copyId: string) {
  need(ctx, "library.view");
  return withCompanyDb(ctx, async (tx) => {
    const [c] = await tx.select().from(libraryCopies).where(eq(libraryCopies.id, copyId));
    if (!c) throw new UserError("Copy not found.");
    const [t] = await tx.select().from(libraryTemplates).where(eq(libraryTemplates.id, c.templateId));
    if (!t?.latestVersion || t.latestVersion <= c.templateVersion) return { available: false as const };
    const vers = await tx.select().from(libraryTemplateVersions).where(and(eq(libraryTemplateVersions.templateId, c.templateId), inArray(libraryTemplateVersions.version, [c.templateVersion, t.latestVersion])));
    const base = vers.find((v) => v.version === c.templateVersion)!.definition as Definition;
    const next = vers.find((v) => v.version === t.latestVersion)!;
    const content = await copyContent(tx, c);
    const norm = (d: Definition): StepLike[] => d.kind === "sequence" ? normalizeSteps(d.steps as StepInput[]) : [{ delayMinutes: 0, channel: "ack", smsBody: d.acknowledgment.smsBody ?? null, emailSubject: d.acknowledgment.emailSubject ?? null, emailBody: d.acknowledgment.emailBody ?? null }];
    const yoursList: StepLike[] = c.kind === "sequence" ? content.steps : [{ delayMinutes: 0, channel: "ack", smsBody: (c.draft as { smsBody?: string }).smsBody ?? null, emailSubject: (c.draft as { emailSubject?: string }).emailSubject ?? null, emailBody: (c.draft as { emailBody?: string }).emailBody ?? null }];
    const baseList = norm(base), nextList = norm(next.definition as Definition);
    const diffs: StepDiff[] = [];
    for (let i = 0; i < Math.max(baseList.length, nextList.length, yoursList.length); i++) {
      const y = yoursList[i], b = baseList[i], n = nextList[i];
      const youChanged = stepKey(y) !== stepKey(b), theyChanged = stepKey(n) !== stepKey(b);
      const status: StepDiff["status"] = !n && b ? "removed" : n && !b ? "added" : youChanged && theyChanged ? (stepKey(y) === stepKey(n) ? "same" : "conflict") : theyChanged ? "updated" : youChanged ? "yours" : "same";
      diffs.push({ position: i, status, yours: y, base: b, next: n });
    }
    const [{ open }] = c.sequenceId ? (await tx.select({ open: count() }).from(sequenceEnrollments).where(and(eq(sequenceEnrollments.sequenceId, c.sequenceId), inArray(sequenceEnrollments.status, ["active", "paused"])))) as [{ open: number }] : [{ open: 0 }];
    return { available: true as const, from: c.templateVersion, to: next.version, changelog: next.changelog, diffs, sameLength: baseList.length === nextList.length && yoursList.length === baseList.length, openEnrollments: open, nextDefinition: next.definition as Definition };
  });
}

/**
 * Applies an update to this company's copy only. "merge": take Bluewater's changes for steps you didn't edit and
 * keep yours where you did. "replace": use the new version as-is. "dismiss": keep everything, stop showing this
 * update. For sequences a NEW sequence version is saved — people already enrolled finish the version they started.
 */
export async function applyUpdate(ctx: CompanyContext, copyId: string, mode: "merge" | "replace" | "dismiss", requestId?: string) {
  need(ctx, "library.adopt");
  const p = await updatePreview(ctx, copyId);
  if (!p.available) throw new UserError("There's no newer version to apply.");
  if (mode === "merge" && !p.sameLength) throw new UserError("The number of steps changed, so a step-by-step merge isn't possible. Choose replace or keep yours.");
  const pick = (d: StepDiff): StepLike => (mode === "replace" ? d.next! : d.status === "updated" ? d.next! : d.yours!);
  const c = await withCompanyDb(ctx, (tx) => loadCopy(tx, copyId));
  if (mode !== "dismiss") {
    if (c.kind === "sequence") {
      const def = p.nextDefinition as SequenceDefinition;
      const steps = (mode === "replace" ? normalizeSteps(def.steps as StepInput[]) : p.diffs.map(pick)) as StepInput[];
      const [s] = await withCompanyDb(ctx, (tx) => tx.select().from(sequences).where(eq(sequences.id, c.sequenceId!)));
      await saveSequence(ctx, c.sequenceId!, { name: s!.name, stopOnManualMessage: s!.stopOnManualMessage, handoffTask: s!.handoffTask, steps: steps.map((x) => ({ delayMinutes: x.delayMinutes, channel: x.channel, smsBody: x.smsBody, emailSubject: x.emailSubject, emailBody: x.emailBody })) }, requestId);
    } else {
      const chosen = pick(p.diffs[0]!);
      await withCompanyDb(ctx, (tx) => tx.update(libraryCopies).set({ draft: { smsBody: chosen.smsBody ?? "", emailSubject: chosen.emailSubject ?? "", emailBody: chosen.emailBody ?? "" }, status: c.status === "active" ? "draft" : c.status }).where(eq(libraryCopies.id, c.id)));
    }
  }
  await withCompanyDb(ctx, async (tx) => {
    await tx.update(libraryCopies).set({ templateVersion: p.to, updatedAt: new Date() }).where(eq(libraryCopies.id, c.id));
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: "library.update_applied", targetType: "library_copy", targetId: c.id, details: { from: p.from, to: p.to, mode }, requestId });
  });
}

/** The library copy behind a company sequence, if any (for a link back to its setup checklist). */
export async function copyForSequence(ctx: CompanyContext, sequenceId: string) {
  if (!roleCan(ctx.role, "library.view") || !isId(sequenceId)) return null;
  return withCompanyDb(ctx, async (tx) => (await tx.select({ id: libraryCopies.id, name: libraryTemplates.name, version: libraryCopies.templateVersion })
    .from(libraryCopies).innerJoin(libraryTemplates, eq(libraryTemplates.id, libraryCopies.templateId)).where(eq(libraryCopies.sequenceId, sequenceId)))[0] ?? null);
}
