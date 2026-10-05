import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb } from "@/lib/db/client";
import { withCompanyDb, withSystemDb } from "@/lib/db/context";
import { jobs, libraryCopies, libraryTemplateDrafts, libraryTemplates, libraryTemplateVersions, messages, sequenceEnrollments, sequences } from "@/lib/db/schema";
import { resolveCompanyContext } from "@/lib/authz/resolve";
import type { CompanyContext } from "@/lib/authz/context-types";
import { createIntakeSource } from "@/server/intake/sources";
import { receiveWebsiteSubmission } from "@/server/intake/website";
import { runDueJobs } from "@/server/jobs/runner";
import { handleInbound } from "@/server/messaging/inbound";
import { activeTemplate, updateAutomationSettings } from "@/server/messaging/settings";
import { saveSequence, setSequenceState } from "@/server/sequences/manage";
import { stepsFor } from "@/server/sequences/engine";
import {
  computeEvidence, emergencyPause, emergencyPausePreview, getTemplateAdmin, importTemplate, publishEvidence, publishTemplate, saveTemplateDraft, setRetired,
} from "@/server/library/admin";
import { activateCopy, applyUpdate, confirmSetup, copyTemplate, getCopy, getLibraryTemplate, listLibrary, saveAckDraft, updatePreview } from "@/server/library/customer";
import { parseImport } from "@/server/library/format";
import { STARTER_LIBRARY } from "@/server/library/starter";
import { addMember, adminCtx, expectDbError, identityFor, makeCompany, makeUser } from "../helpers";

let admin: Awaited<ReturnType<typeof makeUser>>;
const A = () => adminCtx(admin);
const ALL_CONFIRM = ["business", "window", "permission", "handoff"];
let n = 0;
const uniqueName = (base: string) => `${base} ${Date.now().toString(36)}${n++}`;

async function company(pkg: "instant_response" | "follow_up_booking" = "follow_up_booking") {
  const c = await makeCompany({ lifecycleStatus: "active", package: pkg });
  const u = await makeUser();
  await addMember(c.id, u.id, "owner");
  const ctx = await resolveCompanyContext({ user: u, identity: identityFor(u), requestedCompanyId: c.id, action: "workspace.view" });
  await updateAutomationSettings(ctx, { ackEnabled: true, windowStartMinute: 0, windowEndMinute: 1440, windowDays: [0, 1, 2, 3, 4, 5, 6], notifyUserIds: [] });
  const src = await createIntakeSource(ctx, { name: "Site", allowedOrigins: [] });
  return { c, ctx, key: src.publicKey };
}
/** Imports a template from the starter set (with a unique name) and publishes it. */
async function publishedTemplate(index: number, patch: Record<string, unknown> = {}) {
  const def = { ...STARTER_LIBRARY[index]!, name: uniqueName(STARTER_LIBRARY[index]!.name.slice(0, 50)), ...patch };
  const r = await importTemplate(A(), JSON.stringify(def));
  expect(r.errors).toEqual([]);
  const d = await getTemplateAdmin(A(), r.id!);
  await publishTemplate(A(), r.id!, "v1", d!.draft!.revision);
  return r.id!;
}
async function submit(key: string, i: number) {
  const r = await receiveWebsiteSubmission({ publicKey: key, rawBody: JSON.stringify({ name: `Lib Lead ${i}`, phone: `415-555-${String(6000 + i).padStart(4, "0")}`, email: `lib${i}.${Date.now()}@example.com`, consent_sms: "on", consent_text: "Text me" }), contentType: "application/json", origin: null, signature: null, timestamp: null, idempotencyKey: null, ip: "198.51.100.5", userAgent: "t" });
  expect(r.status).toBe(201);
  const [ev] = await withSystemDb("t", (tx) => tx.execute<{ inquiry_id: string }>(sql`select inquiry_id from app.intake_events where id = ${String(r.body.id)}`));
  return ev!.inquiry_id;
}
const enrollmentsOf = (seqId: string) => withSystemDb("t", (tx) => tx.select().from(sequenceEnrollments).where(eq(sequenceEnrollments.sequenceId, seqId)));
/** Replaces the [[offer]] placeholder in a copied home-services sequence (step 2) through the normal editor. */
async function personalize(ctx: CompanyContext, seqId: string) {
  const [s] = await withCompanyDb(ctx, (tx) => tx.select().from(sequences).where(eq(sequences.id, seqId)));
  const steps = await withCompanyDb(ctx, (tx) => stepsFor(tx, seqId, s!.currentVersion));
  const fix = (t: string | null) => (t ? t.replace(/\[\[[^\]]+\]\]/g, "Free estimates in October") : t);
  await saveSequence(ctx, seqId, { name: s!.name, stopOnManualMessage: true, handoffTask: true, steps: steps.map((x) => ({ delayMinutes: x.delayMinutes, channel: x.channel as "sms_or_email", smsBody: fix(x.smsBody), emailSubject: x.emailSubject, emailBody: fix(x.emailBody) })) });
}

beforeAll(async () => { admin = await makeUser({ admin: true }); });
afterAll(closeDb);

describe("import and validation", () => {
  it("accepts only the supported format, reports every problem, and saves nothing when invalid", () => {
    expect(parseImport("not json").errors[0]).toMatch(/isn't valid JSON/);
    const good = STARTER_LIBRARY[1]!;
    expect(parseImport(JSON.stringify({ ...good, script: "fetch('x')" })).errors.join(" ")).toMatch(/isn't supported \(script\)/);
    expect(parseImport(JSON.stringify({ ...good, format: "zapier/v2" })).errors.join(" ")).toMatch(/bluewater.library\/v1/);
    const withPhone = { ...good, steps: [{ ...good.kind === "sequence" ? good.steps[0]! : {}, smsBody: "Call Jane at 415-555-0199 today! Reply STOP to opt out." }] };
    expect(parseImport(JSON.stringify(withPhone)).errors.join(" ")).toMatch(/phone numbers/);
    const withHtml = { ...good, steps: [{ ...(good.kind === "sequence" ? good.steps[0]! : {}), emailBody: "<img src=x onerror=alert(1)>" }] };
    expect(parseImport(JSON.stringify(withHtml)).errors.join(" ")).toMatch(/plain text/);
    const noStop = { ...good, steps: [{ ...(good.kind === "sequence" ? good.steps[0]! : {}), smsBody: "Hi {{first_name}} from {{company_name}}" }] };
    expect(parseImport(JSON.stringify(noStop)).errors.join(" ")).toMatch(/opt out/);
    expect(parseImport(JSON.stringify({ ...good, requiredPackage: "instant_response" })).errors.join(" ")).toMatch(/need Bluewater Engage/);
  });

  it("drafts are invisible to clients until published", async () => {
    const { ctx } = await company();
    const r = await importTemplate(A(), JSON.stringify({ ...STARTER_LIBRARY[4]!, name: uniqueName("Hidden draft") }));
    expect((await listLibrary(ctx)).rows.some((t) => t.id === r.id)).toBe(false);
    expect(await getLibraryTemplate(ctx, r.id!)).toBeNull();
    await withCompanyDb(ctx, async (tx) => {
      expect(await tx.select().from(libraryTemplates).where(eq(libraryTemplates.id, r.id!))).toEqual([]);
      expect(await tx.select().from(libraryTemplateDrafts)).toEqual([]);
    });
    await expectDbError(withCompanyDb(ctx, (tx) => tx.update(libraryTemplates).set({ status: "published" }).where(eq(libraryTemplates.id, r.id!)).returning()).then((x) => { if (!x.length) throw new Error("row-level security: no rows"); }), /row-level security/);
  });
});

describe("package access (enforced on the server)", () => {
  it("Connect gets instant replies only; sequences are refused even if requested directly", async () => {
    const seqId = await publishedTemplate(4);
    const ackId = await publishedTemplate(0);
    const p1 = await company("instant_response");
    const list = await listLibrary(p1.ctx);
    expect(list.rows.find((t) => t.id === seqId)!.eligibility.ok).toBe(false);
    await expect(copyTemplate(p1.ctx, seqId)).rejects.toThrow(/Bluewater Engage/);
    const copy = await copyTemplate(p1.ctx, ackId);
    expect(copy.sequenceId).toBeNull();
  });
});

describe("copy → customize → validate → activate", () => {
  it("copying is private, sends nothing and enrolls nobody", async () => {
    const tplId = await publishedTemplate(1);
    const a = await company(), b = await company();
    await submit(a.key, 1); // an existing lead before the copy
    await runDueJobs();
    const before = await withSystemDb("t", (tx) => tx.select().from(messages).where(eq(messages.companyId, a.c.id)));
    const { copyId, sequenceId } = await copyTemplate(a.ctx, tplId);
    const [seq] = await withSystemDb("t", (tx) => tx.select().from(sequences).where(eq(sequences.id, sequenceId!)));
    expect(seq).toMatchObject({ status: "off", autoEnroll: false });
    expect(await enrollmentsOf(sequenceId!)).toHaveLength(0);
    expect(await withSystemDb("t", (tx) => tx.select().from(messages).where(eq(messages.companyId, a.c.id)))).toHaveLength(before.length);
    expect(await withSystemDb("t", (tx) => tx.select().from(jobs).where(and(eq(jobs.companyId, a.c.id), eq(jobs.kind, "sequence_step"))))).toHaveLength(0);

    // Editing the copy changes neither the original nor another company's copy.
    const bCopy = await copyTemplate(b.ctx, tplId);
    await personalize(a.ctx, sequenceId!);
    const [orig] = await withSystemDb("t", (tx) => tx.select().from(libraryTemplateVersions).where(eq(libraryTemplateVersions.templateId, tplId)));
    expect(JSON.stringify(orig!.definition)).toContain("[[your current offer");
    const bSteps = await withCompanyDb(b.ctx, (tx) => stepsFor(tx, bCopy.sequenceId!, 1));
    expect(bSteps[1]!.smsBody).toContain("[[your current offer");
    // Company B can't see A's copy at all.
    expect(await getCopy(b.ctx, copyId)).toBeNull();
    expect(await withCompanyDb(b.ctx, (tx) => tx.select().from(libraryCopies).where(eq(libraryCopies.id, copyId)))).toEqual([]);
  });

  it("activation is blocked until setup is complete — including through the normal on/off switch", async () => {
    const tplId = await publishedTemplate(1, { requiredIntegrations: [] }); // booking link has fallbacks, so no booking page needed here
    const a = await company();
    const { copyId, sequenceId } = await copyTemplate(a.ctx, tplId);
    let c = await getCopy(a.ctx, copyId);
    expect(c!.blockers.map((b) => b.key)).toEqual(expect.arrayContaining(["personalize", "business", "window", "permission", "handoff"]));
    await expect(activateCopy(a.ctx, copyId, { autoEnroll: true })).rejects.toThrow(/Finish the setup checklist/);
    await expect(setSequenceState(a.ctx, sequenceId!, { on: true, autoEnroll: true })).rejects.toThrow(/setup checklist/);

    await personalize(a.ctx, sequenceId!);
    await confirmSetup(a.ctx, copyId, ALL_CONFIRM);
    c = await getCopy(a.ctx, copyId);
    expect(c!.blockers).toEqual([]);
  });

  it("activation vs enrollment: turning on adds nobody; only future eligible leads start it automatically, and stop rules still apply", async () => {
    const tplId = await publishedTemplate(1, { requiredIntegrations: [] });
    const a = await company();
    const existing = await submit(a.key, 10);
    await runDueJobs();
    const { copyId, sequenceId } = await copyTemplate(a.ctx, tplId);
    await personalize(a.ctx, sequenceId!);
    await confirmSetup(a.ctx, copyId, ALL_CONFIRM);
    await activateCopy(a.ctx, copyId, { autoEnroll: false });
    expect(await enrollmentsOf(sequenceId!)).toHaveLength(0);
    await submit(a.key, 11);
    await runDueJobs();
    expect(await enrollmentsOf(sequenceId!)).toHaveLength(0); // manual-only: no automatic start

    await setSequenceState(a.ctx, sequenceId!, { on: true, autoEnroll: true });
    const fresh = await submit(a.key, 12);
    await runDueJobs();
    const enr = await enrollmentsOf(sequenceId!);
    expect(enr).toHaveLength(1);
    expect(enr[0]!.inquiryId).toBe(fresh);
    expect(enr.some((e) => e.inquiryId === existing)).toBe(false);

    // The engine's existing stop rules apply to library sequences: a reply stops it.
    await handleInbound({ companyId: a.c.id, channel: "sms", from: "+14155556012", body: "Yes please call me", transport: "simulated", providerMessageId: `lib-${Date.now()}` });
    const [after] = await enrollmentsOf(sequenceId!);
    expect(after).toMatchObject({ status: "stopped", stopCode: "replied" });
  });

  it("an acknowledgment copy becomes the company's acknowledgment only when activated", async () => {
    const tplId = await publishedTemplate(0);
    const a = await company("instant_response");
    const { copyId } = await copyTemplate(a.ctx, tplId);
    const before = await withCompanyDb(a.ctx, (tx) => activeTemplate(tx, a.c.id, "ack_sms"));
    expect(before.isDefault).toBe(true);
    await saveAckDraft(a.ctx, copyId, { smsBody: "Thanks {{first_name|there}}! {{company_name}} got your note. Reply STOP to opt out.", emailSubject: "Thanks from {{company_name}}", emailBody: "Hi {{first_name|there}}, thanks — {{company_name}}" });
    expect((await withCompanyDb(a.ctx, (tx) => activeTemplate(tx, a.c.id, "ack_sms"))).isDefault).toBe(true);
    await confirmSetup(a.ctx, copyId, ["business", "window", "permission"]);
    await activateCopy(a.ctx, copyId, { autoEnroll: false });
    expect((await withCompanyDb(a.ctx, (tx) => activeTemplate(tx, a.c.id, "ack_sms"))).body).toContain("got your note");
  });
});

describe("versions, retirement and emergency pause", () => {
  it("a new version never changes copies by itself; the update preview shows Bluewater's changes vs the business's own edits", async () => {
    const tplId = await publishedTemplate(4);
    const a = await company();
    const { copyId, sequenceId } = await copyTemplate(a.ctx, tplId);
    // The business edits step 2.
    const steps = await withCompanyDb(a.ctx, (tx) => stepsFor(tx, sequenceId!, 1));
    await saveSequence(a.ctx, sequenceId!, { name: "Mine", stopOnManualMessage: true, handoffTask: true, steps: steps.map((s, i) => ({ delayMinutes: s.delayMinutes, channel: s.channel as "sms_or_email", smsBody: i === 1 ? "Our own words from {{company_name}}. Reply STOP to opt out." : s.smsBody, emailSubject: s.emailSubject, emailBody: s.emailBody })) });
    // Bluewater publishes v2 changing step 1.
    const d = await getTemplateAdmin(A(), tplId);
    const def = d!.versions[0]!.definition as { steps: { smsBody: string }[] };
    def.steps[0]!.smsBody = "Hi {{first_name|there}}, {{company_name}} with a quick update — anything we can help with? Reply STOP to opt out.";
    await withSystemDb("t", (tx) => tx.insert(libraryTemplateDrafts).values({ templateId: tplId, definition: def, revision: 1 }));
    await publishTemplate(A(), tplId, "Friendlier first step", 1);

    const [stillMine] = await withCompanyDb(a.ctx, (tx) => stepsFor(tx, sequenceId!, 2));
    expect(stillMine!.smsBody).not.toContain("quick update"); // unchanged until the business decides
    const p = await updatePreview(a.ctx, copyId);
    expect(p.available).toBe(true);
    if (!p.available) return;
    expect(p.diffs.map((x) => x.status)).toEqual(["updated", "yours"]);
    await applyUpdate(a.ctx, copyId, "merge");
    const [s] = await withCompanyDb(a.ctx, (tx) => tx.select().from(sequences).where(eq(sequences.id, sequenceId!)));
    const merged = await withCompanyDb(a.ctx, (tx) => stepsFor(tx, sequenceId!, s!.currentVersion));
    expect(merged[0]!.smsBody).toContain("quick update");
    expect(merged[1]!.smsBody).toContain("Our own words");
    expect((await getCopy(a.ctx, copyId))!.copy.templateVersion).toBe(2);
  });

  it("retiring blocks new copies but leaves existing ones alone", async () => {
    const tplId = await publishedTemplate(3);
    const a = await company(), b = await company();
    const { sequenceId } = await copyTemplate(a.ctx, tplId);
    await setRetired(A(), tplId, true, "replaced");
    await expect(copyTemplate(b.ctx, tplId)).rejects.toThrow(/retired/);
    const [seq] = await withSystemDb("t", (tx) => tx.select().from(sequences).where(eq(sequences.id, sequenceId!)));
    expect(seq).toBeTruthy();
  });

  it("emergency pause: scope preview, confirmed count, pauses (not stops) running follow-ups and blocks new use", async () => {
    const tplId = await publishedTemplate(4);
    const a = await company();
    const { copyId, sequenceId } = await copyTemplate(a.ctx, tplId);
    await confirmSetup(a.ctx, copyId, ALL_CONFIRM);
    await activateCopy(a.ctx, copyId, { autoEnroll: true });
    await submit(a.key, 30);
    await runDueJobs();
    expect((await enrollmentsOf(sequenceId!))[0]!.status).toBe("active");

    const preview = await emergencyPausePreview(A(), tplId);
    expect(preview).toMatchObject({ companies: 1, running: 1 });
    await expect(emergencyPause(A(), tplId, "Wrong offer wording", preview.rows.length + 1)).rejects.toThrow(/changed since you reviewed/);
    await emergencyPause(A(), tplId, "Wrong offer wording", preview.rows.length);
    const [e] = await enrollmentsOf(sequenceId!);
    expect(e).toMatchObject({ status: "paused" });
    expect(e!.pauseReason).toMatch(/Paused by Bluewater/);
    const [seq] = await withSystemDb("t", (tx) => tx.select().from(sequences).where(eq(sequences.id, sequenceId!)));
    expect(seq!.autoEnroll).toBe(false);
    const other = await company();
    await expect(copyTemplate(other.ctx, tplId)).rejects.toThrow(/paused/);
    expect((await getCopy(a.ctx, copyId))!.blockers.map((b) => b.key)).toContain("template_paused");
  });
});

describe("evidence", () => {
  it("excludes simulated and test activity, and refuses to publish small samples", async () => {
    const tplId = await publishedTemplate(4);
    const ev = await computeEvidence(A(), tplId, 90);
    expect(ev.enrolled).toBe(0); // test companies and simulated sends never count
    await expect(publishEvidence(A(), ev.id, true)).rejects.toThrow(/Too small/);
    const a = await company();
    const t = await getLibraryTemplate(a.ctx, tplId);
    expect(t!.evidence).toBeNull();
  });
});

describe("drafts saved by administrators", () => {
  it("can't be saved over someone else's newer draft", async () => {
    const r = await importTemplate(A(), JSON.stringify({ ...STARTER_LIBRARY[4]!, name: uniqueName("Concurrent") }));
    const def = JSON.stringify({ ...STARTER_LIBRARY[4]!, name: uniqueName("Concurrent edit") });
    await saveTemplateDraft(A(), r.id!, def, 1);
    await expect(saveTemplateDraft(A(), r.id!, def, 1)).rejects.toThrow(/Someone else saved/);
  });
});
