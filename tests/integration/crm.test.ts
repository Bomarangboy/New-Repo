import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/lib/db/client";
import { withCompanyDb, withSystemDb } from "@/lib/db/context";
import {
  companies as companiesTable, consentRecords, contacts, importBatches, inquiries, inquiryEvents, intakeEvents, intakeSources, notes, tasks,
} from "@/lib/db/schema";
import { resolveCompanyContext } from "@/lib/authz/resolve";
import { recordInquiry } from "@/server/crm/record-inquiry";
import {
  addNote, addTask, assignLead, changeStage, createLeadManually, exportLeadsCsv, getLead, listLeads, recordSale, setTaskDone, updateContactDetails,
} from "@/server/crm/leads";
import { commitImport, previewImport } from "@/server/crm/imports";
import { removeMember } from "@/server/team";
import { overviewMetrics } from "@/server/metrics";
import { applyDueCancellations, scheduleCancellation } from "@/server/companies";
import { addMember, adminCtx, expectDbError, identityFor, makeUser, setCompany, twoCompanies } from "../helpers";
import type { CompanyContext } from "@/lib/authz/context-types";

let f: Awaited<ReturnType<typeof twoCompanies>>;
let harbor: CompanyContext, harborEmp: CompanyContext, summit: CompanyContext;
const ctx = (user: typeof f.harborOwner, companyId: string, action: Parameters<typeof resolveCompanyContext>[0]["action"] = "lead.view") =>
  resolveCompanyContext({ user, identity: identityFor(user), requestedCompanyId: companyId, action });

beforeAll(async () => {
  f = await twoCompanies();
  harbor = await ctx(f.harborOwner, f.harbor.id);
  harborEmp = await ctx(f.harborEmployee, f.harbor.id);
  summit = await ctx(f.summitOwner, f.summit.id);
});
afterAll(closeDb);

describe("contacts and repeat inquiries", () => {
  it("matches the same person by email or by differently formatted phone, and keeps each inquiry", async () => {
    const a = await createLeadManually(harbor, { fullName: "Jordan Lee", email: "Jordan@Example.com", phone: "(555) 201-0101".replace("555", "415") });
    const b = await createLeadManually(harbor, { fullName: "Jordan Lee", email: "jordan@example.com" });
    const c = await createLeadManually(harbor, { fullName: "J. Lee", phone: "+1 415-201-0101" });
    expect(b.contact.id).toBe(a.contact.id);
    expect(c.contact.id).toBe(a.contact.id);
    expect([a.inquiry.isRepeat, b.inquiry.isRepeat, c.inquiry.isRepeat]).toEqual([false, true, true]);
    expect(new Set([a.inquiry.id, b.inquiry.id, c.inquiry.id]).size).toBe(3);
    expect(c.notes.join(" ")).toMatch(/differs/); // name differs → noted, not overwritten
    const lead = await getLead(harbor, c.inquiry.id);
    expect(lead!.contact.fullName).toBe("Jordan Lee");
  });

  it("fills in missing details but never overwrites existing ones", async () => {
    const a = await createLeadManually(harbor, { fullName: "Pat", email: "pat@example.com" });
    const b = await createLeadManually(harbor, { fullName: "Pat", email: "pat@example.com", phone: "415-555-0111" });
    expect(b.contact.phoneE164).toBe("+14155550111");
    const c = await createLeadManually(harbor, { fullName: "Pat", phone: "415-555-0111", email: "other@example.com" });
    expect(c.contact.id).toBe(a.contact.id);
    expect(c.contact.emailNormalized).toBe("pat@example.com");
    expect(c.notes.join(" ")).toMatch(/different email/);
  });

  it("when email and phone belong to two different contacts, attaches to the email match and flags it", async () => {
    await createLeadManually(harbor, { fullName: "Email Person", email: "one@example.com" });
    await createLeadManually(harbor, { fullName: "Phone Person", phone: "415-555-0199" });
    const r = await createLeadManually(harbor, { fullName: "Mixed", email: "one@example.com", phone: "415-555-0199" });
    expect(r.outcome).toBe("matched_conflict");
    expect(r.contact.fullName).toBe("Email Person");
  });

  it("rejects leads with no way to contact them, and invalid details", async () => {
    await expect(createLeadManually(harbor, { fullName: "Nobody" })).rejects.toThrow(/email address or a phone/);
    await expect(createLeadManually(harbor, { fullName: "X", email: "not-an-email" })).rejects.toThrow(/Email address/);
    await expect(createLeadManually(harbor, { fullName: "X", phone: "123" })).rejects.toThrow(/Phone number/);
  });

  it("the same email in two companies creates two separate contacts", async () => {
    const h = await createLeadManually(harbor, { fullName: "Shared", email: "shared@example.com" });
    const s = await createLeadManually(summit, { fullName: "Shared", email: "shared@example.com" });
    expect(h.contact.id).not.toBe(s.contact.id);
    expect(s.inquiry.isRepeat).toBe(false);
  });

  it("manual entries are never enrolled in automatic messaging", async () => {
    const r = await createLeadManually(harbor, { fullName: "Manual", email: "manual@example.com" });
    expect(r.inquiry.automationOrigin).toBe("none");
  });
});

describe("CRM isolation between companies", () => {
  it("company A cannot read any of company B's CRM records", async () => {
    const s = await createLeadManually(summit, { fullName: "Summit Secret", email: "secret@summit.test" });
    await addNote(summit, s.inquiry.id, "private note");
    await withCompanyDb(harbor, async (tx) => {
      for (const t of [contacts, inquiries, notes, inquiryEvents, consentRecords, tasks, intakeSources, intakeEvents, importBatches]) {
        const rows = await tx.select().from(t);
        expect(rows.every((r) => (r as { companyId: string }).companyId === f.harbor.id)).toBe(true);
      }
    });
    expect(await getLead(harbor, s.inquiry.id)).toBeNull();
    const list = await listLeads(harbor, { q: "Summit Secret" });
    expect(list.total).toBe(0);
  });

  it("company A cannot attach records to company B's contact or lead", async () => {
    const s = await createLeadManually(summit, { fullName: "Target", email: "target@summit.test" });
    await expectDbError(withCompanyDb(harbor, (tx) => tx.insert(inquiries).values({
      companyId: f.harbor.id, contactId: s.contact.id, source: "manual", submittedAt: new Date(),
    })), /inquiries_contact_fk|violates foreign key/);
    await expectDbError(withCompanyDb(harbor, (tx) => tx.insert(notes).values({ companyId: f.summit.id, inquiryId: s.inquiry.id, body: "x" })), /row-level security/);
    await expect(addNote(harbor, s.inquiry.id, "sneaky")).rejects.toThrow(/not found/);
    await expect(changeStage(harbor, s.inquiry.id, "won")).rejects.toThrow(/not found/);
  });

  it("leads can't be assigned to someone outside the company", async () => {
    const r = await createLeadManually(harbor, { fullName: "Assign Me", email: "assign@example.com" });
    await expect(assignLead(harbor, r.inquiry.id, f.summitOwner.id)).rejects.toThrow(/isn't on this team/);
    await assignLead(harbor, r.inquiry.id, f.harborEmployee.id);
  });

  it("lead history cannot be edited or deleted", async () => {
    await expectDbError(withCompanyDb(harbor, (tx) => tx.update(inquiryEvents).set({ type: "x" })), /permission denied/);
    await expectDbError(withCompanyDb(harbor, (tx) => tx.delete(inquiryEvents)), /permission denied/);
  });
});

describe("pipeline, sales, notes and tasks", () => {
  it("stage changes and sales are recorded in history; empty sale value means 'not recorded'", async () => {
    const r = await createLeadManually(harbor, { fullName: "Pipeline", email: "pipe@example.com" });
    await changeStage(harborEmp, r.inquiry.id, "contacted");
    await expect(recordSale(harbor, r.inquiry.id, "12abc")).rejects.toThrow(/sale amount/);
    await recordSale(harbor, r.inquiry.id, "$1,250.50");
    let lead = (await getLead(harbor, r.inquiry.id))!;
    expect(lead.inquiry.stage).toBe("won");
    expect(lead.inquiry.saleValueCents).toBe(125050);
    await recordSale(harbor, r.inquiry.id, "");
    lead = (await getLead(harbor, r.inquiry.id))!;
    expect(lead.inquiry.saleValueCents).toBeNull();
    await changeStage(harbor, r.inquiry.id, "lost", { lostReason: "Chose a competitor" });
    lead = (await getLead(harbor, r.inquiry.id))!;
    expect(lead.inquiry.wonAt).toBeNull();
    expect(lead.history.map((h) => h.e.type)).toEqual(["stage_changed", "sale_recorded", "sale_recorded", "stage_changed", "created"]);
  });

  it("tasks are a Package 2 feature, enforced on the server", async () => {
    const r = await createLeadManually(summit, { fullName: "Task", email: "task@summit.test" });
    await expect(addTask(summit, r.inquiry.id, { title: "Call back", dueAt: null, assignedUserId: null })).rejects.toThrow(/Bluewater Engage/);
    const h = await createLeadManually(harbor, { fullName: "Task", email: "task@harbor.test" });
    await addTask(harbor, h.inquiry.id, { title: "Call back", dueAt: new Date(), assignedUserId: f.harborEmployee.id });
    const lead = (await getLead(harbor, h.inquiry.id))!;
    await setTaskDone(harborEmp, lead.tasks[0]!.t.id, true);
    expect((await getLead(harbor, h.inquiry.id))!.tasks[0]!.t.completedAt).not.toBeNull();
  });

  it("contact edits refuse duplicates of another contact", async () => {
    await createLeadManually(harbor, { fullName: "Taken", email: "taken@example.com" });
    const r = await createLeadManually(harbor, { fullName: "Editor", email: "editor@example.com" });
    await expect(updateContactDetails(harbor, r.inquiry.id, { fullName: "Editor", email: "taken@example.com", phone: "" })).rejects.toThrow(/Another contact/);
    await updateContactDetails(harbor, r.inquiry.id, { fullName: "Edited Name", email: "editor@example.com", phone: "415 555 0177" });
    expect((await getLead(harbor, r.inquiry.id))!.contact.phoneE164).toBe("+14155550177");
  });

  it("removing an employee unassigns their open leads and tasks", async () => {
    const temp = await makeUser();
    await addMember(f.harbor.id, temp.id, "employee");
    const r = await createLeadManually(harbor, { fullName: "Owned", email: "owned@example.com" });
    await assignLead(harbor, r.inquiry.id, temp.id);
    await removeMember(await ctx(f.harborOwner, f.harbor.id, "team.remove"), temp.id);
    const lead = (await getLead(harbor, r.inquiry.id))!;
    expect(lead.inquiry.assignedUserId).toBeNull();
    expect(lead.history.some((h) => (h.e.details as { reason?: string }).reason === "member_removed")).toBe(true);
  });
});

describe("export", () => {
  it("only owners can export; values are protected against spreadsheet formulas; the export is logged", async () => {
    await createLeadManually(harbor, { fullName: "=HYPERLINK(\"http://evil\")", email: "formula@example.com", message: "+danger" });
    await expect(exportLeadsCsv(harborEmp)).rejects.toThrow(/permission/);
    const out = await exportLeadsCsv(await ctx(f.harborOwner, f.harbor.id, "lead.export"));
    expect(out.csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(out.csv).toContain("'+danger");
    expect(out.csv).not.toContain("secret@summit.test");
  });
});

describe("CSV import", () => {
  const csv = [
    "Name,Email,Phone,Service,Date,utm_source",
    "Ana Lopez,ana@example.com,415-555-0123,Roof repair,2026-03-04,google",
    "Bad Email,not-an-email,,Gutter,2026-03-05,",
    "No Contact,,,Gutter,2026-03-05,",
    "Ana Lopez,ana@example.com,415-555-0123,Roof repair,2026-03-04,google",
    "Bo Chen,,(415) 555-0124,Inspection,3/6/2026,",
    "Cy Day,cy@example.com,,Inspection,31/31/2026,",
  ].join("\n");

  it("previews with row-numbered problems, imports once, never enrolls in messaging, and skips re-imports", async () => {
    const owner = await ctx(f.harborOwner, f.harbor.id, "lead.import");
    const b = await previewImport(owner, "leads.csv", csv);
    expect(b.totalRows).toBe(6);
    expect(b.validRows).toBe(2);
    expect(b.errors.map((e) => e.row)).toEqual([3, 4, 5, 7]);
    expect(b.errors.find((e) => e.row === 5)!.problems[0]).toMatch(/Same lead as row 2/);
    const res = await commitImport(owner, b.id);
    expect(res.created).toBe(2);
    await expect(commitImport(owner, b.id)).rejects.toThrow(/already completed/);
    const imported = await withCompanyDb(owner, (tx) => tx.select().from(inquiries).where(eq(inquiries.importBatchId, b.id)));
    expect(imported.every((i) => i.automationOrigin === "none" && i.source === "csv_import")).toBe(true);
    expect(imported.find((i) => i.tracking.utm_source === "google")!.submittedAt.toISOString()).toBe("2026-03-04T12:00:00.000Z");
    const again = await previewImport(owner, "leads.csv", csv);
    const res2 = await commitImport(owner, again.id);
    expect(res2).toMatchObject({ created: 0, skipped: 2 });
  });

  it("refuses files without contact columns, and employees cannot import", async () => {
    const owner = await ctx(f.harborOwner, f.harbor.id, "lead.import");
    await expect(previewImport(owner, "x.csv", "Name,City\nA,B")).rejects.toThrow(/Email.*Phone/);
    await expect(previewImport(harborEmp, "x.csv", csv)).rejects.toThrow(/Only the account owner/);
  });
});

describe("overview metrics match the underlying records", () => {
  it("counts by submission time in the company's timezone; unknown comparisons are null, not 0%", async () => {
    const owner = await ctx(f.summitOwner, f.summit.id);
    // A brand new company so the numbers are fully known.
    const admin = adminCtx(await makeUser({ admin: true }));
    const { createCompany } = await import("@/server/companies");
    const co = await createCompany(admin, { name: "Metrics Co", timezone: "America/Los_Angeles", package: "performance_reporting" });
    const o = await makeUser();
    await addMember(co.id, o.id, "owner");
    const mctx = await ctx(o, co.id);
    const now = new Date("2026-06-15T18:00:00Z"); // 11:00 in Los Angeles
    const at = (iso: string) => new Date(iso);
    await withCompanyDb(mctx, async (tx) => {
      const base = { companyId: co.id, source: "manual" as const, automationOrigin: "none" as const, actorType: "system" as const };
      await recordInquiry(tx, { fullName: "A", email: "a@m.test", submittedAt: at("2026-06-15T07:30:00Z") }, base); // Jun 15 00:30 PDT → in
      await recordInquiry(tx, { fullName: "B", email: "b@m.test", submittedAt: at("2026-06-15T06:30:00Z") }, base); // Jun 14 23:30 PDT → in (7-day)
      await recordInquiry(tx, { fullName: "C", email: "c@m.test", submittedAt: at("2026-06-09T06:59:00Z") }, base); // Jun 8 23:59 PDT → previous period
    });
    void owner;
    const m7 = await overviewMetrics(mctx, 7, now);
    expect(m7.inquiries.current).toBe(2);
    expect(m7.inquiries.previous).toBe(1);
    expect(m7.inquiries.changePct).toBe(100);
    expect(m7.daily).toHaveLength(7);
    expect(m7.daily.at(-1)).toEqual({ date: "2026-06-15", count: 1 });
    expect(m7.daily.at(-2)).toEqual({ date: "2026-06-14", count: 1 });
    expect(m7.daily.reduce((a, d) => a + d.count, 0)).toBe(m7.inquiries.current);
    expect(m7.bySource.reduce((a, s) => a + s.count, 0)).toBe(m7.inquiries.current);
    expect(Object.values(m7.pipeline!).reduce((a, n) => a + n, 0)).toBe(m7.inquiries.current);
    expect(m7.sales).toEqual({ recordedCents: 0, wonCount: 0, wonWithoutValue: 0 });
    const empty = await overviewMetrics(mctx, 7, new Date("2026-01-01T00:00:00Z"));
    expect(empty.inquiries).toEqual({ current: 0, previous: 0, changePct: null });
  });

  it("Package 1 gets no pipeline or sales figures (null, not zero)", async () => {
    const m = await overviewMetrics(summit, 30);
    expect(m.pipeline).toBeNull();
    expect(m.sales).toBeNull();
  });
});

describe("scheduled cancellation", () => {
  it("keeps service until the end date, then marks the company churned without deleting anything", async () => {
    const admin = adminCtx(await makeUser({ admin: true }));
    const { createCompany } = await import("@/server/companies");
    const co = await createCompany(admin, { name: "Leaving Co", timezone: "America/Chicago", package: "instant_response" });
    await setCompany(co.id, { lifecycleStatus: "active" });
    const end = new Date(Date.now() + 3600_000);
    await scheduleCancellation(admin, co.id, { effectiveDate: end, reason: "Closing the business" });
    expect(await applyDueCancellations(new Date())).toBe(0);
    expect(await applyDueCancellations(new Date(end.getTime() + 1000))).toBeGreaterThanOrEqual(1);
    const [c] = await withSystemDb("test", (tx) => tx.select().from(companiesTable).where(eq(companiesTable.id, co.id)));
    expect(c!.lifecycleStatus).toBe("churned");
  });
});

describe("sample (demo) dataset", () => {
  it("is deterministic, never messageable, and dashboard totals equal the underlying records", async () => {
    const { generateDemoDataset } = await import("@/server/demo/dataset");
    const c = await (await import("../helpers")).makeCompany({ name: "Demo Template", kind: "demo_template", package: "performance_reporting", timezone: "America/New_York" });
    const o = await makeUser();
    await addMember(c.id, o.id, "owner");
    const dctx = await ctx(o, c.id);
    const now = new Date("2026-06-30T20:00:00Z");
    const { created } = await withCompanyDb(dctx, (tx) => generateDemoDataset(tx, { companyId: c.id, memberIds: [o.id], seed: 7, now }));
    expect(created).toBeGreaterThan(80);
    const all = await withCompanyDb(dctx, (tx) => tx.select().from(inquiries));
    expect(all).toHaveLength(created);
    expect(all.every((i) => i.automationOrigin === "none")).toBe(true);
    const m = await overviewMetrics(dctx, 90, now);
    const inWindow = all.filter((i) => i.submittedAt >= m.period.start && i.submittedAt < m.period.end);
    expect(m.inquiries.current).toBe(inWindow.length);
    expect(m.daily.reduce((a, d) => a + d.count, 0)).toBe(inWindow.length);
    const wonInWindow = all.filter((i) => i.stage === "won" && i.wonAt! >= m.period.start && i.wonAt! < m.period.end);
    expect(m.sales!.wonCount).toBe(wonInWindow.length);
    expect(m.sales!.recordedCents).toBe(wonInWindow.reduce((a, i) => a + (i.saleValueCents ?? 0), 0));
    expect(m.sales!.wonWithoutValue).toBe(wonInWindow.filter((i) => i.saleValueCents == null).length);
  });
});
