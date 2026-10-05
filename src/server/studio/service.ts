import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { withPlatformDb } from "@/lib/db/context";
import type { Tx } from "@/lib/db/client";
import { companies, studioAssets, studioDrafts, studioPublished, studioVersions } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { PACKAGE_NAMES, type PackageTier } from "@/lib/authz/entitlements";
import type { PlatformContext } from "@/lib/authz/context-types";
import { inspectImage, type ImageKind } from "./images";
import {
  DEFAULTS, SCHEMA_VERSION, SETTINGS, parseScopeKey, resolve, sameValue, validateOverrides, type Flat, type Layer, type ScopeKind,
} from "./registry";

/**
 * Platform Studio administration (docs/STUDIO.md): Draft → Preview → Publish per scope, with optimistic locking
 * (two administrators can't silently overwrite each other), permanent version history, restore-into-draft and
 * an audit entry for every save, publish, restore and upload. Nothing here touches customer records, messages,
 * billing or automation settings — the Studio only stores appearance and wording.
 */
type ScopeInfo = NonNullable<ReturnType<typeof parseScopeKey>>;

function scopeOrThrow(key: string): ScopeInfo {
  const s = parseScopeKey(key);
  if (!s) throw new UserError("Unknown Studio scope.");
  return s;
}

export function scopeLabel(s: ScopeInfo, companyName?: string | null): string {
  if (s.kind === "platform") return "Platform default (everyone)";
  if (s.kind === "package") return `Package default: ${PACKAGE_NAMES[s.packageTier!]}`;
  return `Company: ${companyName ?? "unknown company"}`;
}

async function loadRows(tx: Tx, key: string) {
  const [draft] = await tx.select().from(studioDrafts).where(eq(studioDrafts.scopeKey, key));
  const [pub] = await tx.select().from(studioPublished).where(eq(studioPublished.scopeKey, key));
  return { draft, pub };
}

/** The layers ABOVE a scope (what it inherits from), using published values. */
async function parentLayers(tx: Tx, s: ScopeInfo): Promise<Layer[]> {
  const layers: Layer[] = [];
  if (s.kind === "platform") return layers;
  const [plat] = await tx.select().from(studioPublished).where(eq(studioPublished.scopeKey, "platform"));
  layers.push({ scope: "platform", label: "Platform default", values: (plat?.config ?? {}) as Flat });
  if (s.kind === "company") {
    const [c] = await tx.select({ package: companies.package }).from(companies).where(eq(companies.id, s.companyId!));
    if (c) {
      const [pk] = await tx.select().from(studioPublished).where(eq(studioPublished.scopeKey, `package:${c.package}`));
      layers.push({ scope: "package", label: `${PACKAGE_NAMES[c.package]} default`, values: (pk?.config ?? {}) as Flat });
    }
  }
  return layers;
}

/** Everything the editor needs for one scope. */
export async function loadScope(ctx: PlatformContext, key: string) {
  const s = scopeOrThrow(key);
  return withPlatformDb(ctx, async (tx) => {
    let companyName: string | null = null, companyPackage: PackageTier | null = null;
    if (s.kind === "company") {
      const [c] = await tx.select({ name: companies.name, package: companies.package }).from(companies).where(eq(companies.id, s.companyId!));
      if (!c) throw new UserError("Company not found.");
      companyName = c.name; companyPackage = c.package;
    }
    const { draft, pub } = await loadRows(tx, key);
    const published = (pub?.config ?? {}) as Flat;
    const draftValues = (draft?.config ?? published) as Flat;
    const parents = await parentLayers(tx, s);
    const inherited = resolve(parents);
    const history = await tx.select({ version: studioVersions.version, summary: studioVersions.summary, changes: studioVersions.changes, publishedAt: studioVersions.publishedAt, schemaVersion: studioVersions.schemaVersion })
      .from(studioVersions).where(eq(studioVersions.scopeKey, key)).orderBy(desc(studioVersions.version)).limit(30);
    return {
      key, scope: s, label: scopeLabel(s, companyName), companyName, companyPackage,
      draft: draftValues, revision: draft?.revision ?? 0, published, publishedVersion: pub?.version ?? 0, publishedAt: pub?.publishedAt ?? null,
      unpublished: changedKeys(published, draftValues), inherited, history,
      effective: resolve([...parents, { scope: s.kind, label: scopeLabel(s, companyName), values: draftValues }]),
    };
  });
}

export function changedKeys(a: Flat, b: Flat): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !sameValue(a[k], b[k])).sort();
}

async function assertAssets(tx: Tx, values: Flat) {
  const ids = Object.entries(values).filter(([k, v]) => SETTINGS[k]?.type === "asset" && v).map(([, v]) => String(v));
  if (!ids.length) return;
  const found = await tx.select({ id: studioAssets.id, kind: studioAssets.kind }).from(studioAssets).where(inArray(studioAssets.id, ids));
  for (const [k, v] of Object.entries(values)) {
    if (SETTINGS[k]?.type !== "asset" || !v) continue;
    const a = found.find((f) => f.id === v);
    if (!a) throw new UserError(`${SETTINGS[k]!.label}: that image no longer exists. Upload it again.`);
    if (a.kind !== SETTINGS[k]!.assetKind) throw new UserError(`${SETTINGS[k]!.label}: that image was uploaded for a different purpose.`);
  }
}

/**
 * Saves changes into the scope's DRAFT. `baseRevision` must be the revision the editor loaded; if someone else
 * saved in between, nothing is saved and the person is asked to reload (no silent overwrite).
 */
export async function saveDraft(ctx: PlatformContext, key: string, input: { set: Flat; unset: string[] }, baseRevision: number, requestId?: string) {
  const s = scopeOrThrow(key);
  const v = validateOverrides(s.kind, input.set, s.packageTier);
  if (v.errors.length) throw new UserError(v.errors.join(" "));
  const unset = input.unset.filter((k) => k in SETTINGS);
  return withPlatformDb(ctx, async (tx) => {
    if (s.kind === "company") {
      const [c] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, s.companyId!));
      if (!c) throw new UserError("Company not found.");
    }
    const { draft, pub } = await loadRows(tx, key);
    const current = draft?.revision ?? 0;
    if (current !== baseRevision) throw new UserError("Someone else saved changes to this draft after you opened it. Reload the page to see them, then make your change again.");
    const next: Flat = { ...((draft?.config ?? pub?.config ?? {}) as Flat), ...v.clean };
    for (const k of unset) delete next[k];
    await assertAssets(tx, next);
    const revision = current + 1;
    if (draft) {
      const updated = await tx.update(studioDrafts).set({ config: next, revision, updatedByUserId: ctx.userId, updatedAt: new Date() })
        .where(and(eq(studioDrafts.scopeKey, key), eq(studioDrafts.revision, current))).returning({ r: studioDrafts.revision });
      if (!updated.length) throw new UserError("Someone else saved changes to this draft at the same moment. Reload and try again.");
    } else {
      const inserted = await tx.insert(studioDrafts).values({ scopeKey: key, scopeKind: s.kind, packageTier: s.packageTier, companyId: s.companyId, config: next, revision, updatedByUserId: ctx.userId })
        .onConflictDoNothing().returning({ r: studioDrafts.revision });
      if (!inserted.length) throw new UserError("Someone else started a draft for this scope at the same moment. Reload and try again.");
    }
    await audit(tx, { companyId: s.companyId, actorUserId: ctx.userId, actorType: "platform_admin", action: "studio.draft_saved", targetType: "studio_scope", targetId: key,
      details: { set: Object.keys(v.clean), reset: unset, revision }, requestId });
    return { revision, warnings: v.warnings };
  });
}

/** Throws away unpublished changes (the draft goes back to what is live). */
export async function discardDraft(ctx: PlatformContext, key: string, baseRevision: number, requestId?: string) {
  const s = scopeOrThrow(key);
  return withPlatformDb(ctx, async (tx) => {
    const { draft, pub } = await loadRows(tx, key);
    if (!draft) return 0;
    if (draft.revision !== baseRevision) throw new UserError("Someone else changed this draft after you opened it. Reload first.");
    await tx.update(studioDrafts).set({ config: (pub?.config ?? {}) as Flat, revision: draft.revision + 1, updatedByUserId: ctx.userId, updatedAt: new Date() }).where(eq(studioDrafts.scopeKey, key));
    await audit(tx, { companyId: s.companyId, actorUserId: ctx.userId, actorType: "platform_admin", action: "studio.draft_discarded", targetType: "studio_scope", targetId: key, requestId });
    return draft.revision + 1;
  });
}

/** Who a publication reaches, and who keeps their own value (explicit overrides are never overwritten). */
export async function publishImpact(ctx: PlatformContext, key: string, keys: string[]) {
  const s = scopeOrThrow(key);
  return withPlatformDb(ctx, async (tx) => {
    const all = await tx.select({ id: companies.id, name: companies.name, package: companies.package, kind: companies.kind, status: companies.lifecycleStatus }).from(companies);
    const reached = s.kind === "platform" ? all : s.kind === "package" ? all.filter((c) => c.package === s.packageTier) : all.filter((c) => c.id === s.companyId);
    const lower = s.kind === "company" ? [] : await tx.select().from(studioPublished).where(isNotNull(studioPublished.scopeKind));
    const keeping: { scope: string; keys: string[] }[] = [];
    for (const row of lower) {
      if (s.kind === "platform" && row.scopeKind === "platform") continue;
      if (s.kind === "package" && (row.scopeKind !== "company" || reached.every((c) => c.id !== row.companyId))) continue;
      const own = keys.filter((k) => k in (row.config as Flat));
      if (!own.length) continue;
      const label = row.scopeKind === "package" ? `${PACKAGE_NAMES[row.packageTier!]} default` : all.find((c) => c.id === row.companyId)?.name ?? "A company";
      keeping.push({ scope: label, keys: own });
    }
    return { companies: reached.length, customers: reached.filter((c) => c.kind === "customer").length, keeping };
  });
}

/** Publishes the draft: validated, versioned, audited. Pages read the published values on their next request. */
export async function publishScope(ctx: PlatformContext, key: string, baseRevision: number, summary: string, requestId?: string) {
  const s = scopeOrThrow(key);
  const note = summary.trim().slice(0, 300);
  if (note.length < 3) throw new UserError("Write a short summary of what changed (it goes into the version history).");
  return withPlatformDb(ctx, async (tx) => {
    const { draft, pub } = await loadRows(tx, key);
    if (!draft) throw new UserError("There's no draft to publish.");
    if (draft.revision !== baseRevision) throw new UserError("Someone else changed this draft after you previewed it. Reload, review again, then publish.");
    const values = draft.config as Flat;
    const v = validateOverrides(s.kind, values, s.packageTier);
    if (v.errors.length) throw new UserError(`Fix these before publishing: ${v.errors.join(" ")}`);
    await assertAssets(tx, v.clean);
    const changes = changedKeys((pub?.config ?? {}) as Flat, v.clean);
    if (!changes.length) throw new UserError("Nothing to publish — the draft matches what is live.");
    const version = (pub?.version ?? 0) + 1;
    await tx.insert(studioVersions).values({ scopeKey: key, version, config: v.clean, summary: note, changes, schemaVersion: SCHEMA_VERSION, publishedByUserId: ctx.userId });
    const row = { scopeKind: s.kind, packageTier: s.packageTier, companyId: s.companyId, config: v.clean, version, publishedByUserId: ctx.userId, publishedAt: new Date() };
    await tx.insert(studioPublished).values({ scopeKey: key, ...row }).onConflictDoUpdate({ target: studioPublished.scopeKey, set: row });
    await tx.update(studioDrafts).set({ config: v.clean, revision: draft.revision + 1, updatedAt: new Date() }).where(eq(studioDrafts.scopeKey, key));
    await audit(tx, { companyId: s.companyId, actorUserId: ctx.userId, actorType: "platform_admin", action: "studio.published", targetType: "studio_scope", targetId: key,
      details: { version, changes, summary: note }, requestId });
    return { version, changes, revision: draft.revision + 1 };
  });
}

/**
 * Copies a previous version into the DRAFT (it still has to be previewed and published). Settings that no
 * longer exist or no longer pass validation are dropped and listed. Only appearance is restored — never
 * customer data, billing or automation settings, because the Studio never stored those.
 */
export async function restoreVersion(ctx: PlatformContext, key: string, version: number, baseRevision: number, requestId?: string) {
  const s = scopeOrThrow(key);
  return withPlatformDb(ctx, async (tx) => {
    const [ver] = await tx.select().from(studioVersions).where(and(eq(studioVersions.scopeKey, key), eq(studioVersions.version, version)));
    if (!ver) throw new UserError("That version doesn't exist.");
    const old = ver.config as Flat;
    const keep: Flat = {}, dropped: string[] = [];
    for (const [k, val] of Object.entries(old)) {
      const one = validateOverrides(s.kind, { [k]: val }, s.packageTier);
      if (one.errors.length) { dropped.push(SETTINGS[k]?.label ?? k); continue; }
      Object.assign(keep, one.clean);
    }
    const ids = Object.entries(keep).filter(([k, v]) => SETTINGS[k]?.type === "asset" && v).map(([, v]) => String(v));
    if (ids.length) {
      const found = await tx.select({ id: studioAssets.id }).from(studioAssets).where(inArray(studioAssets.id, ids));
      for (const [k, v] of Object.entries(keep)) if (SETTINGS[k]?.type === "asset" && v && !found.some((f) => f.id === v)) { delete keep[k]; dropped.push(SETTINGS[k]!.label); }
    }
    const { draft } = await loadRows(tx, key);
    if ((draft?.revision ?? 0) !== baseRevision) throw new UserError("Someone else changed this draft after you opened it. Reload first.");
    const revision = (draft?.revision ?? 0) + 1;
    await tx.insert(studioDrafts).values({ scopeKey: key, scopeKind: s.kind, packageTier: s.packageTier, companyId: s.companyId, config: keep, revision, updatedByUserId: ctx.userId })
      .onConflictDoUpdate({ target: studioDrafts.scopeKey, set: { config: keep, revision, updatedByUserId: ctx.userId, updatedAt: new Date() } });
    await audit(tx, { companyId: s.companyId, actorUserId: ctx.userId, actorType: "platform_admin", action: "studio.version_restored_to_draft", targetType: "studio_scope", targetId: key,
      details: { version, dropped }, requestId });
    return { revision, dropped };
  });
}

/** Scopes that have anything set (for the Studio home page). */
export async function studioScopes(ctx: PlatformContext) {
  return withPlatformDb(ctx, async (tx) => {
    const pubs = await tx.select({ key: studioPublished.scopeKey, kind: studioPublished.scopeKind, version: studioPublished.version, publishedAt: studioPublished.publishedAt, config: studioPublished.config }).from(studioPublished);
    const drafts = await tx.select({ key: studioDrafts.scopeKey, kind: studioDrafts.scopeKind, config: studioDrafts.config, updatedAt: studioDrafts.updatedAt }).from(studioDrafts);
    const cos = await tx.select({ id: companies.id, name: companies.name, kind: companies.kind }).from(companies).orderBy(companies.name);
    const keys = [...new Set([...pubs.map((p) => p.key), ...drafts.map((d) => d.key)])];
    return {
      companies: cos,
      scopes: keys.map((k) => {
        const p = pubs.find((x) => x.key === k), d = drafts.find((x) => x.key === k);
        const s = parseScopeKey(k);
        return { key: k, label: s ? scopeLabel(s, cos.find((c) => c.id === s.companyId)?.name) : k, kind: s?.kind, version: p?.version ?? 0, publishedAt: p?.publishedAt ?? null,
          overrides: Object.keys((p?.config ?? {}) as Flat).length, unpublished: d ? changedKeys((p?.config ?? {}) as Flat, d.config as Flat).length : 0 };
      }),
    };
  });
}

/* ---------------- Images ---------------- */

export async function uploadAsset(ctx: PlatformContext, kind: ImageKind, bytes: Buffer, requestId?: string): Promise<string> {
  if (!["logo_light", "logo_dark", "favicon"].includes(kind)) throw new UserError("Unknown image purpose.");
  const r = inspectImage(kind, bytes);
  if (!r.ok) throw new UserError(r.error);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return withPlatformDb(ctx, async (tx) => {
    const [row] = await tx.insert(studioAssets).values({ kind, mime: r.info.mime, bytes, sha256, sizeBytes: bytes.length, width: r.info.width, height: r.info.height, uploadedByUserId: ctx.userId }).returning({ id: studioAssets.id });
    await audit(tx, { companyId: null, actorUserId: ctx.userId, actorType: "platform_admin", action: "studio.image_uploaded", targetType: "studio_asset", targetId: row!.id,
      details: { kind, mime: r.info.mime, width: r.info.width, height: r.info.height, bytes: bytes.length }, requestId });
    return row!.id;
  });
}

export async function listAssets(ctx: PlatformContext) {
  return withPlatformDb(ctx, (tx) => tx.select({ id: studioAssets.id, kind: studioAssets.kind, mime: studioAssets.mime, width: studioAssets.width, height: studioAssets.height, sizeBytes: studioAssets.sizeBytes, createdAt: studioAssets.createdAt })
    .from(studioAssets).orderBy(desc(studioAssets.createdAt)).limit(50));
}

/** For tests and the recovery script: the built-in defaults. */
export const BUILT_IN_DEFAULTS = DEFAULTS;
export type { ScopeKind };

/**
 * Layers for a preview: the scope being edited uses its DRAFT; everything else uses published values.
 * Reads Studio tables only — previews never touch leads, messages, enrollments or billing.
 */
export async function previewLayers(ctx: PlatformContext, key: string, opts: { packageTier?: PackageTier | null; companyId?: string | null }) {
  const s = scopeOrThrow(key);
  return withPlatformDb(ctx, async (tx) => {
    const pubs = await tx.select().from(studioPublished);
    const { draft } = await loadRows(tx, key);
    const pub = (k: string) => (pubs.find((p) => p.scopeKey === k)?.config ?? {}) as Flat;
    let pkg = opts.packageTier ?? "follow_up_booking";
    let companyId = opts.companyId ?? null;
    let companyName: string | null = null;
    if (s.kind === "package") pkg = s.packageTier!;
    if (s.kind === "company") companyId = s.companyId;
    if (companyId) {
      const [c] = await tx.select({ name: companies.name, package: companies.package }).from(companies).where(eq(companies.id, companyId));
      if (c) { companyName = c.name; if (s.kind === "company" || !opts.packageTier) pkg = c.package; }
      if (c && s.kind === "package" && c.package !== s.packageTier) { companyId = null; companyName = null; } // a company on another package isn't affected
    }
    const val = (k: string) => (k === key ? ((draft?.config ?? pub(k)) as Flat) : pub(k));
    const layers: Layer[] = [{ scope: "platform", label: "Platform default", values: val("platform") }, { scope: "package", label: `${PACKAGE_NAMES[pkg]} default`, values: val(`package:${pkg}`) }];
    if (companyId) layers.push({ scope: "company", label: companyName ?? "Company", values: val(`company:${companyId}`) });
    return { layers, packageTier: pkg, companyName };
  });
}
