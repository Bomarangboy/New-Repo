import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { withPlatformDb } from "@/lib/db/context";
import type { Tx } from "@/lib/db/client";
import {
  companies, inquiryEvents, libraryCategories, libraryCopies, libraryEvidence, libraryTemplateDrafts, libraryTemplateVersions, libraryTemplates,
  messageTemplates, sequenceEnrollments, sequences,
} from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import type { PlatformContext } from "@/lib/authz/context-types";
import { cancelQueuedStepJobs } from "@/server/sequences/stop";
import { DEFAULT_TEMPLATES } from "@/server/messaging/templates";
import { checkDefinition, parseImport, type Definition } from "./format";
import { MIN_EVIDENCE } from "./customer";
import { STARTER_LIBRARY } from "./starter";

/**
 * Sequence Library administration (Bluewater administrators only, two-step verified — enforced by the admin
 * action context). Templates are curated: imported or written, validated, previewed, versioned, published,
 * retired. Published versions never change; customer copies are never edited from here, except by the
 * restricted, audited emergency pause.
 */
const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "template";

export async function listTemplatesAdmin(ctx: PlatformContext) {
  return withPlatformDb(ctx, async (tx) => {
    const rows = await tx.select({ t: libraryTemplates, category: libraryCategories.name }).from(libraryTemplates).leftJoin(libraryCategories, eq(libraryCategories.id, libraryTemplates.categoryId)).orderBy(libraryTemplates.status, libraryTemplates.name);
    const adoption = await tx.select({ templateId: libraryCopies.templateId, status: libraryCopies.status, n: count(), companies: sql<number>`count(distinct ${libraryCopies.companyId})::int` })
      .from(libraryCopies).groupBy(libraryCopies.templateId, libraryCopies.status);
    const drafts = await tx.select({ templateId: libraryTemplateDrafts.templateId, updatedAt: libraryTemplateDrafts.updatedAt }).from(libraryTemplateDrafts);
    return rows.map((r) => ({
      ...r.t, category: r.category,
      copies: adoption.filter((a) => a.templateId === r.t.id && a.status !== "archived").reduce((x, a) => x + a.n, 0),
      active: adoption.find((a) => a.templateId === r.t.id && a.status === "active")?.n ?? 0,
      hasDraft: drafts.some((d) => d.templateId === r.t.id),
    }));
  });
}

export async function getTemplateAdmin(ctx: PlatformContext, id: string) {
  if (!isId(id)) return null;
  return withPlatformDb(ctx, async (tx) => {
    const [t] = await tx.select().from(libraryTemplates).where(eq(libraryTemplates.id, id));
    if (!t) return null;
    const [draft] = await tx.select().from(libraryTemplateDrafts).where(eq(libraryTemplateDrafts.templateId, id));
    const versions = await tx.select().from(libraryTemplateVersions).where(eq(libraryTemplateVersions.templateId, id)).orderBy(desc(libraryTemplateVersions.version));
    const adoption = await tx.select({ company: companies.name, kind: companies.kind, version: libraryCopies.templateVersion, status: libraryCopies.status, createdAt: libraryCopies.createdAt })
      .from(libraryCopies).innerJoin(companies, eq(companies.id, libraryCopies.companyId)).where(eq(libraryCopies.templateId, id)).orderBy(desc(libraryCopies.createdAt));
    const evidence = await tx.select().from(libraryEvidence).where(eq(libraryEvidence.templateId, id)).orderBy(desc(libraryEvidence.computedAt)).limit(10);
    const categories = await tx.select().from(libraryCategories).orderBy(libraryCategories.sortOrder, libraryCategories.name);
    return { template: t, draft: draft ?? null, versions, adoption, evidence, categories };
  });
}

async function categoryId(tx: Tx, name: string | undefined): Promise<string | null> {
  if (!name?.trim()) return null;
  const [c] = await tx.insert(libraryCategories).values({ name: name.trim().slice(0, 60) }).onConflictDoUpdate({ target: libraryCategories.name, set: { name: name.trim().slice(0, 60) } }).returning({ id: libraryCategories.id });
  return c!.id;
}

/** Creates a new DRAFT template from a checked definition (import, starter library or the editor). Not visible to clients. */
async function createDraft(tx: Tx, ctx: PlatformContext, def: Definition, meta: NonNullable<ReturnType<typeof checkDefinition>["metadata"]>, source: string, requestId?: string) {
  let slug = slugify(def.name);
  const [{ n }] = (await tx.select({ n: count() }).from(libraryTemplates).where(sql`${libraryTemplates.slug} like ${slug + "%"}`)) as [{ n: number }];
  if (n) slug = `${slug}-${n + 1}`;
  const [t] = await tx.insert(libraryTemplates).values({
    slug, kind: def.kind, name: def.name, description: def.description, industry: def.industry, objective: def.objective, categoryId: await categoryId(tx, def.category),
    channels: meta.channels, stepCount: meta.stepCount, durationDays: meta.durationDays, requiredPackage: def.requiredPackage,
    requiredIntegrations: def.requiredIntegrations, requiredFields: meta.requiredFields, status: "draft", createdByUserId: ctx.userId,
  }).returning();
  await tx.insert(libraryTemplateDrafts).values({ templateId: t!.id, definition: def as unknown as Record<string, unknown>, revision: 1, updatedByUserId: ctx.userId });
  await audit(tx, { companyId: null, actorUserId: ctx.userId, actorType: "platform_admin", action: "library.template_created", targetType: "library_template", targetId: t!.id, details: { slug, source }, requestId });
  return t!.id;
}

/** Import: the file is validated completely first; nothing is saved unless it passes. */
export async function importTemplate(ctx: PlatformContext, raw: string, requestId?: string): Promise<{ id?: string; errors: string[]; warnings: string[] }> {
  const r = parseImport(raw);
  if (!r.ok) return { errors: r.errors, warnings: r.warnings };
  const id = await withPlatformDb(ctx, (tx) => createDraft(tx, ctx, r.definition!, r.metadata!, "import", requestId));
  return { id, errors: [], warnings: r.warnings };
}

/** Adds Bluewater's starter templates as DRAFTS (an administrator reviews and publishes each). Skips ones already present. */
export async function loadStarterLibrary(ctx: PlatformContext, requestId?: string): Promise<number> {
  return withPlatformDb(ctx, async (tx) => {
    let added = 0;
    for (const def of STARTER_LIBRARY) {
      const [exists] = await tx.select({ id: libraryTemplates.id }).from(libraryTemplates).where(eq(libraryTemplates.name, def.name));
      if (exists) continue;
      const r = checkDefinition(def);
      if (!r.ok) throw new Error(`Starter template "${def.name}" is invalid: ${r.errors.join(" ")}`);
      await createDraft(tx, ctx, r.definition!, r.metadata!, "starter", requestId);
      added++;
    }
    return added;
  });
}

export async function saveTemplateDraft(ctx: PlatformContext, id: string, definitionJson: string, baseRevision: number, requestId?: string) {
  const r = parseImport(definitionJson);
  if (!r.ok) throw new UserError(`Not saved — fix these first: ${r.errors.join(" ")}`);
  return withPlatformDb(ctx, async (tx) => {
    const [t] = await tx.select().from(libraryTemplates).where(eq(libraryTemplates.id, id)).for("update");
    if (!t) throw new UserError("Template not found.");
    if (t.kind !== r.definition!.kind) throw new UserError("A template can't change between acknowledgment and sequence. Create a new template instead.");
    const [d] = await tx.select().from(libraryTemplateDrafts).where(eq(libraryTemplateDrafts.templateId, id));
    if ((d?.revision ?? 0) !== baseRevision) throw new UserError("Someone else saved this draft after you opened it. Reload to see their changes.");
    const revision = (d?.revision ?? 0) + 1;
    await tx.insert(libraryTemplateDrafts).values({ templateId: id, definition: r.definition as unknown as Record<string, unknown>, revision, updatedByUserId: ctx.userId })
      .onConflictDoUpdate({ target: libraryTemplateDrafts.templateId, set: { definition: r.definition as unknown as Record<string, unknown>, revision, updatedByUserId: ctx.userId, updatedAt: new Date() } });
    await audit(tx, { companyId: null, actorUserId: ctx.userId, actorType: "platform_admin", action: "library.draft_saved", targetType: "library_template", targetId: id, details: { revision }, requestId });
    return { revision, warnings: r.warnings };
  });
}

/**
 * Publishes the draft as a new, permanent version. Existing customer copies and active enrollments are NOT
 * changed — each business sees "update available" with a preview and decides.
 */
export async function publishTemplate(ctx: PlatformContext, id: string, changelog: string, baseRevision: number, requestId?: string) {
  return withPlatformDb(ctx, async (tx) => {
    const [t] = await tx.select().from(libraryTemplates).where(eq(libraryTemplates.id, id)).for("update");
    if (!t) throw new UserError("Template not found.");
    if (t.status === "paused") throw new UserError("This template is paused. Lift the pause first.");
    const [d] = await tx.select().from(libraryTemplateDrafts).where(eq(libraryTemplateDrafts.templateId, id));
    if (!d) throw new UserError("There's no draft to publish.");
    if (d.revision !== baseRevision) throw new UserError("The draft changed after you reviewed it. Reload and review again.");
    const r = checkDefinition(d.definition);
    if (!r.ok) throw new UserError(`Fix these before publishing: ${r.errors.join(" ")}`);
    const def = r.definition!, meta = r.metadata!;
    const version = (t.latestVersion ?? 0) + 1;
    if (t.latestVersion) {
      const [prev] = await tx.select().from(libraryTemplateVersions).where(and(eq(libraryTemplateVersions.templateId, id), eq(libraryTemplateVersions.version, t.latestVersion)));
      if (prev && JSON.stringify(prev.definition) === JSON.stringify(def)) throw new UserError("The draft is identical to the published version.");
    }
    await tx.insert(libraryTemplateVersions).values({ templateId: id, version, definition: def as unknown as Record<string, unknown>, changelog: changelog.trim().slice(0, 500) || null, publishedByUserId: ctx.userId });
    await tx.update(libraryTemplates).set({
      name: def.name, description: def.description, industry: def.industry, objective: def.objective, categoryId: await categoryId(tx, def.category),
      channels: meta.channels, stepCount: meta.stepCount, durationDays: meta.durationDays, requiredPackage: def.requiredPackage, requiredIntegrations: def.requiredIntegrations,
      requiredFields: meta.requiredFields, latestVersion: version, status: "published", statusReason: null, updatedAt: new Date(),
    }).where(eq(libraryTemplates.id, id));
    await tx.delete(libraryTemplateDrafts).where(eq(libraryTemplateDrafts.templateId, id));
    await audit(tx, { companyId: null, actorUserId: ctx.userId, actorType: "platform_admin", action: "library.published", targetType: "library_template", targetId: id, details: { version, changelog }, requestId });
    return version;
  });
}

/** Starts a new draft from the latest published version (to prepare an update). */
export async function startDraftFromLatest(ctx: PlatformContext, id: string) {
  return withPlatformDb(ctx, async (tx) => {
    const [t] = await tx.select().from(libraryTemplates).where(eq(libraryTemplates.id, id));
    if (!t?.latestVersion) throw new UserError("Nothing published yet.");
    const [v] = await tx.select().from(libraryTemplateVersions).where(and(eq(libraryTemplateVersions.templateId, id), eq(libraryTemplateVersions.version, t.latestVersion)));
    await tx.insert(libraryTemplateDrafts).values({ templateId: id, definition: v!.definition, revision: 1, updatedByUserId: ctx.userId }).onConflictDoNothing();
  });
}

export async function setRecommended(ctx: PlatformContext, id: string, recommended: boolean, requestId?: string) {
  await withPlatformDb(ctx, async (tx) => {
    await tx.update(libraryTemplates).set({ recommended, updatedAt: new Date() }).where(eq(libraryTemplates.id, id));
    await audit(tx, { companyId: null, actorUserId: ctx.userId, actorType: "platform_admin", action: recommended ? "library.recommended" : "library.unrecommended", targetType: "library_template", targetId: id, requestId });
  });
}

/** Retiring blocks NEW copies. Existing copies keep working exactly as the businesses set them up. */
export async function setRetired(ctx: PlatformContext, id: string, retired: boolean, reason: string, requestId?: string) {
  await withPlatformDb(ctx, async (tx) => {
    const [t] = await tx.select().from(libraryTemplates).where(eq(libraryTemplates.id, id)).for("update");
    if (!t) throw new UserError("Template not found.");
    if (retired && t.status !== "published") throw new UserError("Only a published template can be retired.");
    if (!retired && t.status !== "retired") throw new UserError("This template isn't retired.");
    await tx.update(libraryTemplates).set({ status: retired ? "retired" : "published", statusReason: retired ? reason.trim().slice(0, 300) || null : null, updatedAt: new Date() }).where(eq(libraryTemplates.id, id));
    await audit(tx, { companyId: null, actorUserId: ctx.userId, actorType: "platform_admin", action: retired ? "library.retired" : "library.unretired", targetType: "library_template", targetId: id, details: { reason }, requestId });
  });
}

/* ---------------- Emergency pause (restricted, audited) ---------------- */

export async function emergencyPausePreview(ctx: PlatformContext, id: string) {
  return withPlatformDb(ctx, async (tx) => {
    const copies = await tx.select({ c: libraryCopies, company: companies.name, seqStatus: sequences.status }).from(libraryCopies)
      .innerJoin(companies, eq(companies.id, libraryCopies.companyId)).leftJoin(sequences, eq(sequences.id, libraryCopies.sequenceId))
      .where(and(eq(libraryCopies.templateId, id), inArray(libraryCopies.status, ["draft", "active"])));
    const seqIds = copies.map((x) => x.c.sequenceId).filter((x): x is string => !!x);
    const open = seqIds.length ? await tx.select({ sequenceId: sequenceEnrollments.sequenceId, n: count() }).from(sequenceEnrollments)
      .where(and(inArray(sequenceEnrollments.sequenceId, seqIds), eq(sequenceEnrollments.status, "active"))).groupBy(sequenceEnrollments.sequenceId) : [];
    const rows = copies.map((x) => ({ copyId: x.c.id, companyId: x.c.companyId, company: x.company, kind: x.c.kind, status: x.c.status, sequenceOn: x.seqStatus === "active", running: open.find((o) => o.sequenceId === x.c.sequenceId)?.n ?? 0 }));
    return { rows, companies: new Set(rows.map((r) => r.companyId)).size, running: rows.reduce((a, r) => a + r.running, 0), activeAcks: rows.filter((r) => r.kind === "acknowledgment" && r.status === "active").length };
  });
}

/**
 * For harmful or wrong content. Blocks new copies and activations; stops automatic enrollment into affected
 * sequences; PAUSES (doesn't stop) everyone currently in them, with a reason on each lead; and puts businesses
 * that activated an affected acknowledgment back on their previous wording. Owners resume when it's safe.
 * The confirmed count must match the preview, so nothing outside the reviewed scope is touched.
 */
export async function emergencyPause(ctx: PlatformContext, id: string, reason: string, confirmedCopies: number, requestId?: string) {
  const why = reason.trim().slice(0, 300);
  if (why.length < 5) throw new UserError("Give a reason (it is shown to the affected businesses).");
  const preview = await emergencyPausePreview(ctx, id);
  if (preview.rows.length !== confirmedCopies) throw new UserError("The affected list changed since you reviewed it. Review it again.");
  return withPlatformDb(ctx, async (tx) => {
    await tx.update(libraryTemplates).set({ status: "paused", statusReason: why, updatedAt: new Date() }).where(eq(libraryTemplates.id, id));
    const pauseReason = `Paused by Bluewater: the library template behind this follow-up is under review (${why})`;
    let paused = 0, reverted = 0;
    for (const r of preview.rows) {
      const [c] = await tx.select().from(libraryCopies).where(eq(libraryCopies.id, r.copyId));
      if (!c) continue;
      if (c.kind === "sequence" && c.sequenceId) {
        await tx.update(sequences).set({ autoEnroll: false, updatedAt: new Date() }).where(eq(sequences.id, c.sequenceId));
        const running = await tx.update(sequenceEnrollments).set({ status: "paused", pausedAt: new Date(), pauseReason, updatedAt: new Date() })
          .where(and(eq(sequenceEnrollments.sequenceId, c.sequenceId), eq(sequenceEnrollments.status, "active"))).returning({ id: sequenceEnrollments.id, inquiryId: sequenceEnrollments.inquiryId });
        await cancelQueuedStepJobs(tx, running.map((e) => e.id), pauseReason);
        for (const e of running) await tx.insert(inquiryEvents).values({ companyId: c.companyId, inquiryId: e.inquiryId, type: "follow_up_paused", actorType: "system", details: { reason: pauseReason } });
        paused += running.length;
      }
      if (c.kind === "acknowledgment" && c.status === "active") {
        const prev = c.previous as Record<string, { body: string; subject: string | null; version: number; isDefault: boolean }>;
        for (const key of ["ack_sms", "ack_email"] as const) {
          const p = prev[key];
          if (!p) continue;
          const [cur] = await tx.select({ v: sql<number>`coalesce(max(${messageTemplates.version}), 0)::int` }).from(messageTemplates).where(and(eq(messageTemplates.companyId, c.companyId), eq(messageTemplates.key, key)));
          const content = p.isDefault ? DEFAULT_TEMPLATES[key] : { subject: p.subject, body: p.body };
          await tx.insert(messageTemplates).values({ companyId: c.companyId, key, version: (cur?.v ?? 0) + 1, subject: content.subject, body: content.body });
        }
        await tx.update(libraryCopies).set({ status: "draft", updatedAt: new Date() }).where(eq(libraryCopies.id, c.id));
        reverted++;
      }
      await audit(tx, { companyId: c.companyId, actorUserId: ctx.userId, actorType: "platform_admin", action: "library.emergency_paused", targetType: "library_copy", targetId: c.id, details: { template: id, reason: why }, requestId });
    }
    await audit(tx, { companyId: null, actorUserId: ctx.userId, actorType: "platform_admin", action: "library.emergency_pause", targetType: "library_template", targetId: id, details: { reason: why, copies: preview.rows.length, pausedEnrollments: paused, revertedAcks: reverted }, requestId });
    return { paused, reverted, companies: preview.companies };
  });
}

/** Ends the pause for NEW adoption. Paused follow-ups stay paused until each business resumes them. */
export async function liftPause(ctx: PlatformContext, id: string, requestId?: string) {
  await withPlatformDb(ctx, async (tx) => {
    const [t] = await tx.select().from(libraryTemplates).where(eq(libraryTemplates.id, id));
    if (t?.status !== "paused") throw new UserError("This template isn't paused.");
    await tx.update(libraryTemplates).set({ status: "published", statusReason: null, updatedAt: new Date() }).where(eq(libraryTemplates.id, id));
    await audit(tx, { companyId: null, actorUserId: ctx.userId, actorType: "platform_admin", action: "library.pause_lifted", targetType: "library_template", targetId: id, requestId });
  });
}

/* ---------------- Evidence (aggregate, de-identified) ---------------- */

/**
 * Observed outcomes for people enrolled in copies of this template at REAL customers (simulated messages,
 * demo and test companies excluded) during the period. Denominators: "enrolled" for replies/bookings/opt-outs;
 * "messages sent" for delivery. These are observations, not proof the template caused them.
 */
export async function computeEvidence(ctx: PlatformContext, id: string, days = 90, requestId?: string) {
  return withPlatformDb(ctx, async (tx) => {
    const [t] = await tx.select().from(libraryTemplates).where(eq(libraryTemplates.id, id));
    if (!t) throw new UserError("Template not found.");
    if (t.kind !== "sequence") throw new UserError("Evidence is collected for follow-up sequences.");
    const since = new Date(Date.now() - days * 86_400_000);
    const [e] = await tx.execute<{ companies: number; enrolled: number; replied: number; booked: number; opted_out: number }>(sql`
      select count(distinct en.company_id)::int as companies, count(*)::int as enrolled,
        count(*) filter (where en.stop_code = 'replied')::int as replied, count(*) filter (where en.stop_code = 'booked')::int as booked,
        count(*) filter (where en.stop_code = 'opted_out')::int as opted_out
      from app.sequence_enrollments en join app.library_copies lc on lc.sequence_id = en.sequence_id join app.companies co on co.id = en.company_id
      where lc.template_id = ${id} and co.kind = 'customer' and en.enrolled_at >= ${since.toISOString()}`);
    const [m] = await tx.execute<{ sent: number; delivered: number; failed: number }>(sql`
      select count(*)::int as sent, count(*) filter (where m.status = 'delivered')::int as delivered, count(*) filter (where m.status = 'failed')::int as failed
      from app.messages m join app.library_copies lc on m.template_key like 'sequence:' || lc.sequence_id::text || ':%' join app.companies co on co.id = m.company_id
      where lc.template_id = ${id} and co.kind = 'customer' and m.transport <> 'simulated' and m.created_at >= ${since.toISOString()}`);
    const [row] = await tx.insert(libraryEvidence).values({
      templateId: id, periodStart: since.toISOString().slice(0, 10), periodEnd: new Date().toISOString().slice(0, 10), industry: t.industry, leadSource: null,
      companies: e!.companies, enrolled: e!.enrolled, messagesSent: m!.sent, delivered: m!.delivered, failed: m!.failed, replied: e!.replied, booked: e!.booked, optedOut: e!.opted_out, computedByUserId: ctx.userId,
    }).returning();
    await audit(tx, { companyId: null, actorUserId: ctx.userId, actorType: "platform_admin", action: "library.evidence_computed", targetType: "library_template", targetId: id, details: { enrolled: e!.enrolled, companies: e!.companies }, requestId });
    return row!;
  });
}

/** Shows evidence to clients — only above the minimum sample, so small numbers can't mislead or identify anyone. */
export async function publishEvidence(ctx: PlatformContext, evidenceId: string, publish: boolean, requestId?: string) {
  await withPlatformDb(ctx, async (tx) => {
    const [e] = await tx.select().from(libraryEvidence).where(eq(libraryEvidence.id, evidenceId));
    if (!e) throw new UserError("Not found.");
    if (publish && (e.enrolled < MIN_EVIDENCE.enrolled || e.companies < MIN_EVIDENCE.companies)) {
      throw new UserError(`Too small to publish: needs at least ${MIN_EVIDENCE.enrolled} people enrolled across ${MIN_EVIDENCE.companies} businesses (this has ${e.enrolled} across ${e.companies}).`);
    }
    if (publish) await tx.update(libraryEvidence).set({ published: false }).where(eq(libraryEvidence.templateId, e.templateId));
    await tx.update(libraryEvidence).set({ published: publish }).where(eq(libraryEvidence.id, evidenceId));
    await audit(tx, { companyId: null, actorUserId: ctx.userId, actorType: "platform_admin", action: publish ? "library.evidence_published" : "library.evidence_unpublished", targetType: "library_template", targetId: e.templateId, requestId });
  });
}

/** Starts a brand-new DRAFT template from Bluewater's default wording (edited before publishing). */
export async function createBlankTemplate(ctx: PlatformContext, kind: "sequence" | "acknowledgment", name: string, requestId?: string) {
  const clean = name.trim().slice(0, 80);
  if (clean.length < 3) throw new UserError("Give the template a name (at least 3 characters).");
  const { DEFAULT_SEQUENCE_STEPS } = await import("@/server/messaging/templates");
  const { FORMAT } = await import("./format");
  const base = { format: FORMAT, name: clean, description: "Describe when a business should use this and what it does.", industry: "Any business", objective: "Start a conversation", requiredIntegrations: [] };
  const def = kind === "sequence"
    ? { ...base, kind, requiredPackage: "follow_up_booking", entry: "manual_only", stopOnManualMessage: true, handoffTask: true, steps: DEFAULT_SEQUENCE_STEPS }
    : { ...base, kind, requiredPackage: "instant_response", acknowledgment: { smsBody: DEFAULT_TEMPLATES.ack_sms.body, emailSubject: DEFAULT_TEMPLATES.ack_email.subject!, emailBody: DEFAULT_TEMPLATES.ack_email.body } };
  const r = checkDefinition(def);
  if (!r.ok) throw new UserError(r.errors.join(" "));
  return withPlatformDb(ctx, (tx) => createDraft(tx, ctx, r.definition!, r.metadata!, "editor", requestId));
}
