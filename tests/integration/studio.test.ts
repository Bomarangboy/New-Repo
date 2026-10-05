import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb } from "@/lib/db/client";
import { withCompanyDb, withSystemDb } from "@/lib/db/context";
import { auditLog, studioAssets, studioDrafts, studioPublished, studioVersions } from "@/lib/db/schema";
import { resolveCompanyContext } from "@/lib/authz/resolve";
import { discardDraft, loadScope, previewLayers, publishImpact, publishScope, restoreVersion, saveDraft, uploadAsset } from "@/server/studio/service";
import { previewUi, studioForCompany } from "@/server/studio/runtime";
import { DEFAULTS } from "@/server/studio/registry";
import { addMember, adminCtx, expectDbError, identityFor, makeCompany, makeUser } from "../helpers";

let admin: Awaited<ReturnType<typeof makeUser>>;
const A = () => adminCtx(admin);
async function owner(pkg: "instant_response" | "follow_up_booking" | "performance_reporting" = "follow_up_booking", role: "owner" | "employee" = "owner") {
  const c = await makeCompany({ lifecycleStatus: "active", package: pkg });
  const u = await makeUser();
  await addMember(c.id, u.id, role);
  return { c, ctx: await resolveCompanyContext({ user: u, identity: identityFor(u), requestedCompanyId: c.id, action: "workspace.view" }) };
}
/** Saves into a scope's draft and publishes it (the normal two-step flow). */
async function publish(scope: string, set: Record<string, unknown>, unset: string[] = []) {
  const s = await loadScope(A(), scope);
  const r = await saveDraft(A(), scope, { set, unset }, s.revision);
  return publishScope(A(), scope, r.revision, "test change");
}

beforeAll(async () => { admin = await makeUser({ admin: true }); });
afterAll(closeDb);

describe("Platform Studio: who can see and change what", () => {
  it("client workspaces can't read drafts, history or images, and can't publish anything", async () => {
    const { c, ctx } = await owner();
    const s = await loadScope(A(), `company:${c.id}`);
    await saveDraft(A(), `company:${c.id}`, { set: { "text.page.leads.title": "Secret draft title" }, unset: [] }, s.revision);
    await withCompanyDb(ctx, async (tx) => {
      expect(await tx.select().from(studioDrafts)).toEqual([]);
      expect(await tx.select().from(studioVersions)).toEqual([]);
      expect(await tx.select().from(studioAssets)).toEqual([]);
    });
    await expectDbError(withCompanyDb(ctx, (tx) => tx.insert(studioPublished).values({ scopeKey: `company:${c.id}`, scopeKind: "company", companyId: c.id, config: { "text.page.leads.title": "x" }, version: 99 })), /row-level security/);
    // The draft isn't live.
    expect((await studioForCompany(ctx)).t("page.leads.title")).toBe("Leads");
  });

  it("a company's published override is visible only to that company", async () => {
    const a = await owner(), b = await owner();
    await publish(`company:${a.c.id}`, { "text.page.leads.title": "Our enquiries" });
    expect((await studioForCompany(a.ctx)).t("page.leads.title")).toBe("Our enquiries");
    expect((await studioForCompany(b.ctx)).t("page.leads.title")).toBe("Leads");
    const visible = await withCompanyDb(b.ctx, (tx) => tx.select().from(studioPublished).where(eq(studioPublished.scopeKey, `company:${a.c.id}`)));
    expect(visible).toEqual([]);
  });
});

describe("Platform Studio: inheritance", () => {
  it("platform → package → company, and a platform change never overwrites a company's own value", async () => {
    const key = "text.page.conversations.subtitle";
    const p2 = await owner("follow_up_booking"), p1 = await owner("instant_response"), custom = await owner("follow_up_booking");
    await publish("platform", { [key]: "Platform wording" });
    await publish("package:follow_up_booking", { [key]: "Engage wording" });
    await publish(`company:${custom.c.id}`, { [key]: "Our own wording" });
    expect((await studioForCompany(p1.ctx)).t("page.conversations.subtitle")).toBe("Platform wording");
    expect((await studioForCompany(p2.ctx)).t("page.conversations.subtitle")).toBe("Engage wording");
    expect((await studioForCompany(custom.ctx)).t("page.conversations.subtitle")).toBe("Our own wording");

    const impact = await publishImpact(A(), "platform", [key]);
    expect(impact.keeping.map((k) => k.scope)).toEqual(expect.arrayContaining(["Bluewater Engage default"]));
    await publish("platform", { [key]: "Platform wording v2" });
    expect((await studioForCompany(custom.ctx)).t("page.conversations.subtitle")).toBe("Our own wording");
    expect((await studioForCompany(p1.ctx)).t("page.conversations.subtitle")).toBe("Platform wording v2");

    // Reset to inherited removes the company's override.
    await publish(`company:${custom.c.id}`, {}, [key]);
    expect((await studioForCompany(custom.ctx)).t("page.conversations.subtitle")).toBe("Engage wording");
    const s = await loadScope(A(), `company:${custom.c.id}`);
    expect(s.inherited.source[key]).toBe("Bluewater Engage default");
    // Tidy the shared scopes for other tests.
    await publish("platform", {}, [key]);
    await publish("package:follow_up_booking", {}, [key]);
  });

  it("menu changes are visual: role and package still decide what exists, and essential items can't be hidden", async () => {
    const emp = await owner("instant_response", "employee");
    await publish(`company:${emp.c.id}`, { "nav.hidden": ["leads"], "nav.label.help": "Get help", "nav.landing": "conversations" });
    const ui = await studioForCompany(emp.ctx);
    const ids = ui.nav(emp.ctx.role, emp.ctx.package).map((n) => n.id);
    expect(ids).not.toContain("leads");
    expect(ids).not.toContain("appointments"); // not in Connect, whatever the Studio says
    expect(ids).not.toContain("connected"); // employees can't view integrations
    expect(ui.nav(emp.ctx.role, emp.ctx.package).find((n) => n.id === "help")!.label).toBe("Get help");
    expect(ui.landing(emp.ctx.role, emp.ctx.package)).toBe("/app/conversations");
    const s = await loadScope(A(), `company:${emp.c.id}`);
    await expect(saveDraft(A(), `company:${emp.c.id}`, { set: { "nav.hidden": ["settings"] }, unset: [] }, s.revision)).rejects.toThrow(/essential/);
    await expect(saveDraft(A(), "package:instant_response", { set: { "nav.landing": "reports" }, unset: [] }, (await loadScope(A(), "package:instant_response")).revision)).rejects.toThrow(/doesn't include/);
  });
});

describe("Platform Studio: validation, conflicts, publishing and restore", () => {
  it("rejects markup, unsafe colors, unknown settings and settings at the wrong level", async () => {
    const { c } = await owner();
    const key = `company:${c.id}`;
    const rev = (await loadScope(A(), key)).revision;
    await expect(saveDraft(A(), key, { set: { "text.page.leads.title": "<script>alert(1)</script>" }, unset: [] }, rev)).rejects.toThrow(/plain text/);
    await expect(saveDraft(A(), key, { set: { "text.help.extra": "Click <a href=x onclick=y>" }, unset: [] }, rev)).rejects.toThrow(/plain text/);
    await expect(saveDraft(A(), key, { set: { "brand.colorPrimary": "#FFEE00" }, unset: [] }, rev)).rejects.toThrow(/too hard to read/);
    await expect(saveDraft(A(), key, { set: { "brand.colorNavy": "#4A90E2" }, unset: [] }, rev)).rejects.toThrow(/too hard to read/);
    await expect(saveDraft(A(), key, { set: { "auth.disableMfa": true }, unset: [] }, rev)).rejects.toThrow(/isn't a setting/);
    await expect(saveDraft(A(), key, { set: { "text.login.headline": "Hi" }, unset: [] }, rev)).rejects.toThrow(/platform level/);
    await expect(saveDraft(A(), key, { set: { "dashboard.cards": [] }, unset: [] }, rev)).rejects.toThrow(/every card/);
  });

  it("two administrators can't overwrite each other's draft", async () => {
    const { c } = await owner();
    const key = `company:${c.id}`;
    const opened = (await loadScope(A(), key)).revision; // both open the editor at the same revision
    await saveDraft(A(), key, { set: { "text.page.leads.title": "First admin" }, unset: [] }, opened);
    await expect(saveDraft(A(), key, { set: { "text.page.leads.title": "Second admin" }, unset: [] }, opened)).rejects.toThrow(/Someone else saved/);
    expect((await loadScope(A(), key)).draft["text.page.leads.title"]).toBe("First admin");
    // Publishing with a stale revision is refused too.
    await expect(publishScope(A(), key, opened, "stale")).rejects.toThrow(/changed this draft/);
  });

  it("publishing is versioned and audited; restore copies a version into the draft and drops what's no longer valid", async () => {
    const { c, ctx } = await owner();
    const key = `company:${c.id}`;
    const v1 = await publish(key, { "text.page.overview.title": "Dashboard", "brand.colorPrimary": "#1D4ED8" });
    await publish(key, { "text.page.overview.title": "Home" });
    expect((await studioForCompany(ctx)).t("page.overview.title")).toBe("Home");
    // An old version containing a setting that no longer exists:
    await withSystemDb("t", (tx) => tx.insert(studioVersions).values({ scopeKey: key, version: 50, config: { "text.page.overview.title": "Old", "removed.setting": 1 }, summary: "legacy" }));
    const r = await restoreVersion(A(), key, 50, (await loadScope(A(), key)).revision);
    expect(r.dropped).toEqual(["removed.setting"]);
    expect((await studioForCompany(ctx)).t("page.overview.title")).toBe("Home"); // restore is a draft until published
    await restoreVersion(A(), key, v1.version, r.revision);
    const pub = await publishScope(A(), key, (await loadScope(A(), key)).revision, "Back to v1");
    expect(pub.version).toBe(3);
    expect((await studioForCompany(ctx)).t("page.overview.title")).toBe("Dashboard");
    const logs = await withSystemDb("t", (tx) => tx.select().from(auditLog).where(and(eq(auditLog.targetId, key), eq(auditLog.action, "studio.published"))));
    expect(logs.length).toBe(3);
    // Discard returns the draft to what's live.
    const s = await loadScope(A(), key);
    const d = await saveDraft(A(), key, { set: { "text.page.overview.title": "Unwanted" }, unset: [] }, s.revision);
    await discardDraft(A(), key, d.revision);
    expect((await loadScope(A(), key)).unpublished).toEqual([]);
  });

  it("a preview uses the draft without publishing it", async () => {
    const { c, ctx } = await owner();
    const key = `company:${c.id}`;
    await saveDraft(A(), key, { set: { "text.page.overview.title": "Preview only" }, unset: [] }, (await loadScope(A(), key)).revision);
    const p = await previewLayers(A(), key, {});
    expect(previewUi(p.layers).t("page.overview.title")).toBe("Preview only");
    expect((await studioForCompany(ctx)).t("page.overview.title")).toBe("Overview");
  });

  it("safe mode ignores every Studio setting", async () => {
    const { c, ctx } = await owner();
    await publish(`company:${c.id}`, { "text.page.leads.title": "Customized" });
    process.env.STUDIO_SAFE_MODE = "true";
    try {
      const ui = await studioForCompany(ctx);
      expect(ui.safeMode).toBe(true);
      expect(ui.t("page.leads.title")).toBe(DEFAULTS["text.page.leads.title"]);
    } finally {
      delete process.env.STUDIO_SAFE_MODE;
    }
  });
});

describe("Platform Studio: images", () => {
  const png = (w: number, h: number) => {
    const b = Buffer.alloc(64);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8); b.write("IHDR", 12, "ascii"); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
    return b;
  };
  it("accepts a real PNG and refuses SVG, HTML, wrong sizes and disguised files", async () => {
    const id = await uploadAsset(A(), "logo_light", png(400, 100));
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(uploadAsset(A(), "logo_light", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).rejects.toThrow(/SVG/);
    await expect(uploadAsset(A(), "logo_light", Buffer.from("<html><body>hi</body></html>"))).rejects.toThrow(/SVG and HTML/);
    await expect(uploadAsset(A(), "logo_light", Buffer.from("just text pretending to be a png"))).rejects.toThrow(/isn't a supported image/);
    await expect(uploadAsset(A(), "favicon", png(64, 32))).rejects.toThrow(/square/);
    await expect(uploadAsset(A(), "logo_light", png(5000, 100))).rejects.toThrow(/80–2000/);
    // An image uploaded for one purpose can't be used for another.
    const { c } = await owner();
    const key = `company:${c.id}`;
    await expect(saveDraft(A(), key, { set: { "brand.logoDark": id }, unset: [] }, (await loadScope(A(), key)).revision)).rejects.toThrow(/different purpose/);
    await saveDraft(A(), key, { set: { "brand.logoLight": id }, unset: [] }, (await loadScope(A(), key)).revision);
  });
});
