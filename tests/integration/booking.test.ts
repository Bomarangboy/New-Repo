import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { closeDb } from "@/lib/db/client";
import { withSystemDb } from "@/lib/db/context";
import { appointments, bookingEvents, bookingSettings, inquiries, jobs, messages, notifications, sequenceEnrollments } from "@/lib/db/schema";
import { resolveCompanyContext } from "@/lib/authz/resolve";
import type { CompanyContext } from "@/lib/authz/context-types";
import { createIntakeSource } from "@/server/intake/sources";
import { receiveWebsiteSubmission } from "@/server/intake/website";
import { runDueJobs } from "@/server/jobs/runner";
import { HANDLERS } from "@/server/jobs/handlers";
import { updateAutomationSettings } from "@/server/messaging/settings";
import { createSequence, setSequenceState } from "@/server/sequences/manage";
import { getBookingSettings, saveBookingPage, saveReminderSettings, setUpBookingWebhook } from "@/server/booking/settings";
import { calcomWebhook, calSignature } from "@/server/booking/webhook";
import { refFromInquiryId } from "@/server/booking/links";
import { cancelAppointment, createManualAppointment, listAppointments, setAppointmentOutcome, simulateBooking } from "@/server/booking/appointments";
import { addMember, identityFor, makeCompany, makeUser } from "../helpers";

interface Co { id: string; owner: CompanyContext; employee: CompanyContext; key: string; hookKey: string; secret: string }

async function setup(pkg: "follow_up_booking" | "instant_response" = "follow_up_booking"): Promise<Co> {
  const c = await makeCompany({ lifecycleStatus: "active", package: pkg, name: `Book Co ${Math.random().toString(36).slice(2, 7)}` });
  const o = await makeUser(), e = await makeUser();
  await addMember(c.id, o.id, "owner");
  await addMember(c.id, e.id, "employee");
  const owner = await resolveCompanyContext({ user: o, identity: identityFor(o), requestedCompanyId: c.id, action: "workspace.view" });
  const employee = await resolveCompanyContext({ user: e, identity: identityFor(e), requestedCompanyId: c.id, action: "workspace.view" });
  await updateAutomationSettings(owner, { ackEnabled: true, windowStartMinute: 0, windowEndMinute: 1440, windowDays: [0, 1, 2, 3, 4, 5, 6], notifyUserIds: [] });
  const s = await createIntakeSource(owner, { name: "Site form", allowedOrigins: [] });
  let hookKey = "", secret = "";
  if (pkg === "follow_up_booking") {
    await saveBookingPage(owner, "https://cal.com/test-business/estimate");
    const hook = await setUpBookingWebhook(owner);
    hookKey = hook.url.split("/").pop()!;
    secret = hook.secret;
  }
  return { id: c.id, owner, employee, key: s.publicKey, hookKey, secret };
}

async function submit(co: Co, fields: Record<string, string>) {
  const r = await receiveWebsiteSubmission({ publicKey: co.key, rawBody: JSON.stringify(fields), contentType: "application/json", origin: null, signature: null, timestamp: null, idempotencyKey: null, ip: "198.51.100.11", userAgent: "test" });
  expect(r.status).toBe(201);
  const [ev] = await withSystemDb("t", (tx) => tx.execute<{ inquiry_id: string }>(sql`select inquiry_id from app.intake_events where id = ${String(r.body.id)}`));
  return ev!.inquiry_id;
}

const inDays = (d: number, h = 15) => { const t = new Date(Date.now() + d * 86_400_000); t.setUTCHours(h, 0, 0, 0); return t; };
let createdAtClock = Date.now() - 3600_000;
function calBody(trigger: string, p: Record<string, unknown>, createdAt?: string) {
  createdAtClock += 1000;
  return JSON.stringify({ triggerEvent: trigger, createdAt: createdAt ?? new Date(createdAtClock).toISOString(), payload: p });
}
async function send(co: Co, body: string, secret = co.secret) {
  return calcomWebhook(co.hookKey, body, calSignature(secret, body));
}
function booking(uid: string, start: Date, extra: Record<string, unknown> = {}) {
  return { uid, title: "Estimate", startTime: start.toISOString(), endTime: new Date(start.getTime() + 3600_000).toISOString(), attendees: [{ name: "Booker", email: "booker@example.com", timeZone: "America/New_York" }], metadata: {}, ...extra };
}
async function apptByUid(companyId: string, uid: string) {
  const [a] = await withSystemDb("t", (tx) => tx.select().from(appointments).where(and(eq(appointments.companyId, companyId), eq(appointments.externalId, uid))));
  return a ?? null;
}
async function bookingJobs(appointmentId: string) {
  return withSystemDb("t", (tx) => tx.select().from(jobs).where(and(eq(jobs.kind, "booking_message"), sql`${jobs.payload}->>'appointmentId' = ${appointmentId}`)).orderBy(asc(jobs.runAt)));
}

let n = 0;
const phone = () => `415-555-${String(4000 + n++).padStart(4, "0")}`;
let co: Co;
beforeAll(async () => { co = await setup(); });
afterAll(closeDb);

describe("Cal.com webhook security", () => {
  it("accepts only correctly signed messages to a known address", async () => {
    const body = calBody("PING", {});
    expect(await calcomWebhook(co.hookKey, body, calSignature("wrong-secret", body))).toBe(401);
    expect(await calcomWebhook(co.hookKey, body, null)).toBe(401);
    expect(await calcomWebhook("A".repeat(32), body, calSignature(co.secret, body))).toBe(404);
    const [s] = await withSystemDb("t", (tx) => tx.select().from(bookingSettings).where(eq(bookingSettings.companyId, co.id)));
    expect(s!.status).toBe("waiting_for_test");
    expect(s!.lastError).toMatch(/wrong signature/);
    expect(await send(co, body)).toBe(200);
    expect((await getBookingSettings(co.owner))!.status).toBe("connected");
    expect(JSON.stringify(await getBookingSettings(co.owner))).not.toContain(co.secret);
  });

  it("a booking link reference can't attach a booking to another company's lead", async () => {
    const other = await setup();
    const theirLead = await submit(other, { name: "Theirs", email: "theirs@example.com" });
    const uid = `x-${Date.now()}`;
    expect(await send(co, calBody("BOOKING_CREATED", booking(uid, inDays(3), { metadata: { bw: refFromInquiryId(theirLead) }, attendees: [{ name: "Intruder", email: "intruder@example.com" }] })))).toBe(200);
    const a = await apptByUid(co.id, uid);
    expect(a!.companyId).toBe(co.id);
    expect(a!.inquiryId).not.toBe(theirLead);
    const theirs = await withSystemDb("t", (tx) => tx.select().from(appointments).where(eq(appointments.inquiryId, theirLead)));
    expect(theirs).toHaveLength(0);
  });
});

describe("bookings", () => {
  it("links by booking-link reference, books the lead, stops follow-up and texts a confirmation", async () => {
    const seq = await createSequence(co.owner, "Follow up");
    await setSequenceState(co.owner, seq, { on: true, autoEnroll: true });
    const p = phone();
    const id = await submit(co, { name: "Ada Lake", phone: p, email: "ada.lake@example.com", service: "gutters", consent_sms: "on", consent_text: "Text me" });
    await runDueJobs();
    const uid = `bk-${Date.now()}`;
    expect(await send(co, calBody("BOOKING_CREATED", booking(uid, inDays(3), { metadata: { bw: refFromInquiryId(id) }, attendees: [{ name: "A. Lake", email: "different@example.com" }] })))).toBe(200);
    const a = await apptByUid(co.id, uid);
    expect(a).toMatchObject({ inquiryId: id, status: "scheduled", source: "calcom" });
    const [i] = await withSystemDb("t", (tx) => tx.select().from(inquiries).where(eq(inquiries.id, id)));
    expect(i!.stage).toBe("booked");
    const [e] = await withSystemDb("t", (tx) => tx.select().from(sequenceEnrollments).where(eq(sequenceEnrollments.inquiryId, id)));
    expect(e).toMatchObject({ status: "stopped", stopCode: "booked" });

    const js = await bookingJobs(a!.id);
    expect(js.map((j) => j.payload.type)).toEqual(["confirmation", "reminder", "reminder"]); // confirm now, 24h, 2h before
    await runDueJobs();
    const sent = await withSystemDb("t", (tx) => tx.select().from(messages).where(and(eq(messages.inquiryId, id), eq(messages.kind, "booking_confirmation"))));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: "sms", status: "delivered" });
    expect(sent[0]!.body).toMatch(/you're booked for \w{3}, \w{3} \d+ at \d+:\d\d (AM|PM) E[SD]T/);
    const alerts = await withSystemDb("t", (tx) => tx.select().from(notifications).where(and(eq(notifications.companyId, co.id), eq(notifications.kind, "booking_created"), eq(notifications.inquiryId, id))));
    expect(alerts).toHaveLength(1);
  });

  it("links by email when there's no reference, and records a new lead when nobody matches", async () => {
    const id = await submit(co, { name: "Bo", email: "bo.match@example.com" });
    const u1 = `em-${Date.now()}`;
    await send(co, calBody("BOOKING_CREATED", booking(u1, inDays(4), { attendees: [{ name: "Bo", email: "BO.Match@example.com" }] })));
    expect((await apptByUid(co.id, u1))!.inquiryId).toBe(id);
    const u2 = `new-${Date.now()}`;
    await send(co, calBody("BOOKING_CREATED", booking(u2, inDays(4), { attendees: [{ name: "Walk In", email: "walkin@example.com" }] })));
    const a = await apptByUid(co.id, u2);
    const [i] = await withSystemDb("t", (tx) => tx.select().from(inquiries).where(eq(inquiries.id, a!.inquiryId)));
    expect(i).toMatchObject({ source: "other", sourceLabel: "Cal.com booking", automationOrigin: "none", stage: "booked" });
  });

  it("ignores repeated deliveries of the same message", async () => {
    const uid = `dup-${Date.now()}`;
    const body = calBody("BOOKING_CREATED", booking(uid, inDays(5)));
    await send(co, body);
    await send(co, body);
    await send(co, body);
    const rows = await withSystemDb("t", (tx) => tx.select().from(appointments).where(eq(appointments.externalId, uid)));
    expect(rows).toHaveLength(1);
    const evs = await withSystemDb("t", (tx) => tx.select().from(bookingEvents).where(eq(bookingEvents.externalId, uid)));
    expect(evs).toHaveLength(1);
  });

  it("a reschedule keeps one appointment, moves its reminders, and late messages about the old booking are ignored", async () => {
    const id = await submit(co, { name: "Cy", phone: phone(), email: "cy@example.com", consent_sms: "on" });
    const old = `old-${Date.now()}`, next = `new-${Date.now()}`;
    const bodyCreated = calBody("BOOKING_CREATED", booking(old, inDays(3), { metadata: { bw: refFromInquiryId(id) } }));
    await send(co, bodyCreated);
    const a = await apptByUid(co.id, old);
    const before = await bookingJobs(a!.id);
    await send(co, calBody("BOOKING_RESCHEDULED", booking(next, inDays(6), { rescheduleUid: old })));
    const moved = await apptByUid(co.id, next);
    expect(moved!.id).toBe(a!.id);
    expect(moved!.startsAt.toISOString()).toBe(inDays(6).toISOString());
    expect(moved!.replacedExternalIds).toContain(old);
    const after = await bookingJobs(a!.id);
    expect(after.filter((j) => before.some((b) => b.id === j.id)).every((j) => j.status === "cancelled" || j.status === "succeeded")).toBe(true);
    expect(after.filter((j) => j.status === "queued" && j.payload.startsAt === inDays(6).toISOString()).length).toBeGreaterThanOrEqual(2);
    // Late cancellation of the OLD booking id must not cancel the moved appointment.
    await send(co, calBody("BOOKING_CANCELLED", { uid: old }));
    expect((await apptByUid(co.id, next))!.status).toBe("scheduled");
    const [late] = await withSystemDb("t", (tx) => tx.select().from(bookingEvents).where(and(eq(bookingEvents.externalId, old), eq(bookingEvents.triggerEvent, "BOOKING_CANCELLED"))));
    expect(late!.outcome).toBe("ignored_stale");
    // A reminder job for the old time cancels itself even if it was still queued.
    const stale = before.find((j) => j.payload.type === "reminder")!;
    const out = await HANDLERS.booking_message!(stale);
    expect(out).toMatchObject({ status: "cancelled" });
  });

  it("out of order: a cancellation that arrives before its booking wins; older messages never override newer ones", async () => {
    const uid = `ooo-${Date.now()}`;
    const createdBody = calBody("BOOKING_CREATED", booking(uid, inDays(3)), new Date(Date.now() - 60_000).toISOString());
    const cancelBody = calBody("BOOKING_CANCELLED", { uid }, new Date().toISOString());
    await send(co, cancelBody);
    await send(co, createdBody);
    expect(await apptByUid(co.id, uid)).toBeNull();

    const uid2 = `ooo2-${Date.now()}`;
    await send(co, calBody("BOOKING_CREATED", booking(uid2, inDays(3)), new Date(Date.now() - 10_000).toISOString()));
    await send(co, calBody("BOOKING_CANCELLED", { uid: uid2 }, new Date(Date.now() - 20_000).toISOString())); // older than the booking
    expect((await apptByUid(co.id, uid2))!.status).toBe("scheduled");
  });

  it("a cancellation moves the lead back to Contacted, cancels reminders, tells the team, and doesn't restart follow-up", async () => {
    const id = await submit(co, { name: "Dee Cancel", phone: phone(), consent_sms: "on" });
    const uid = `can-${Date.now()}`;
    await send(co, calBody("BOOKING_CREATED", booking(uid, inDays(2), { metadata: { bw: refFromInquiryId(id) } })));
    const a = await apptByUid(co.id, uid);
    await send(co, calBody("BOOKING_CANCELLED", { uid, cancellationReason: "Sick" }));
    expect((await apptByUid(co.id, uid))).toMatchObject({ status: "cancelled", cancellationReason: "Sick" });
    const [i] = await withSystemDb("t", (tx) => tx.select().from(inquiries).where(eq(inquiries.id, id)));
    expect(i!.stage).toBe("contacted");
    expect((await bookingJobs(a!.id)).filter((j) => j.status === "queued")).toHaveLength(0);
    const open = await withSystemDb("t", (tx) => tx.select().from(sequenceEnrollments).where(and(eq(sequenceEnrollments.inquiryId, id), sql`${sequenceEnrollments.status} in ('active','paused')`)));
    expect(open).toHaveLength(0);
    await runDueJobs();
    const alerts = await withSystemDb("t", (tx) => tx.select().from(notifications).where(and(eq(notifications.inquiryId, id), eq(notifications.kind, "booking_cancelled"))));
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });
});

describe("confirmations and reminders", () => {
  it("doesn't duplicate Cal.com's own emails, but emails reminders for appointments the team entered", async () => {
    const other = await setup();
    const id = await submit(other, { name: "Eve Email", email: "eve.email@example.com" }); // no phone
    await runDueJobs();
    const uid = `em-${Date.now()}`;
    await send(other, calBody("BOOKING_CREATED", booking(uid, inDays(3), { metadata: { bw: refFromInquiryId(id) } })));
    await runDueJobs();
    const a = await apptByUid(other.id, uid);
    const [confirm] = (await bookingJobs(a!.id)).filter((j) => j.payload.type === "confirmation");
    expect(confirm).toMatchObject({ status: "cancelled" });
    expect(confirm!.result).toMatch(/Cal.com emails them itself/);

    const id2 = await submit(other, { name: "Fay Phone", email: "fay.phone@example.com" });
    const d = inDays(4);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
    await createManualAppointment(other.employee, { inquiryId: id2, date, time: "10:30", durationMinutes: 60, title: "Visit" });
    await runDueJobs();
    const m = await withSystemDb("t", (tx) => tx.select().from(messages).where(and(eq(messages.inquiryId, id2), eq(messages.kind, "booking_confirmation"))));
    expect(m).toHaveLength(1);
    expect(m[0]!.channel).toBe("email");
    expect(m[0]!.body).toContain("10:30 AM");
  });

  it("skips reminders that would come too late and follows the owner's reminder settings", async () => {
    const other = await setup();
    await saveReminderSettings(other.owner, { confirmationsEnabled: false, remindersEnabled: true, reminderOffsetsMinutes: [60 * 24 * 2, 60], emailAlso: true });
    const id = await submit(other, { name: "Gus", phone: phone(), consent_sms: "on" });
    const uid = `soon-${Date.now()}`;
    await send(other, calBody("BOOKING_CREATED", booking(uid, new Date(Date.now() + 26 * 3600_000), { metadata: { bw: refFromInquiryId(id) } })));
    const a = await apptByUid(other.id, uid);
    const js = await bookingJobs(a!.id);
    expect(js.map((j) => [j.payload.type, j.payload.offsetMinutes])).toEqual([["reminder", 60]]); // 2-day reminder already passed; no confirmation
    await expect(saveReminderSettings(other.employee, { confirmationsEnabled: true, remindersEnabled: true, reminderOffsetsMinutes: [60], emailAlso: false })).rejects.toThrow(/permission/);
  });
});

describe("appointments the team manages", () => {
  it("records outcomes; Cal.com bookings must be cancelled in Cal.com", async () => {
    const id = await submit(co, { name: "Hal", email: "hal.mgmt@example.com" });
    const uid = `mg-${Date.now()}`;
    await send(co, calBody("BOOKING_CREATED", booking(uid, inDays(2), { metadata: { bw: refFromInquiryId(id) } })));
    const a = await apptByUid(co.id, uid);
    await expect(cancelAppointment(co.employee, a!.id, "x")).rejects.toThrow(/cancel it there/);
    await expect(setAppointmentOutcome(co.employee, a!.id, "completed")).rejects.toThrow(/once the appointment has started/);
    await withSystemDb("t", (tx) => tx.update(appointments).set({ startsAt: new Date(Date.now() - 3600_000) }).where(eq(appointments.id, a!.id)));
    await setAppointmentOutcome(co.employee, a!.id, "no_show");
    expect((await apptByUid(co.id, uid))!.status).toBe("no_show");
    const past = await listAppointments(co.employee, "past");
    expect(past.some((r) => r.a.id === a!.id)).toBe(true);
  });

  it("the simulator runs the same code path and is labeled simulated", async () => {
    const id = await submit(co, { name: "Ivy Sim", email: "ivy.sim@example.com" });
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(inDays(5));
    const r = await simulateBooking(co.employee, id, date, "09:00");
    expect(r.outcome).toBe("created");
    const [a] = await withSystemDb("t", (tx) => tx.select().from(appointments).where(eq(appointments.inquiryId, id)));
    expect(a).toMatchObject({ source: "simulated", status: "scheduled" });
  });
});

describe("packages and isolation", () => {
  it("Package 1 can't connect booking or add appointments", async () => {
    const p1 = await setup("instant_response");
    await expect(saveBookingPage(p1.owner, "https://cal.com/x/y")).rejects.toThrow(/Bluewater Engage/);
    await expect(setUpBookingWebhook(p1.owner)).rejects.toThrow(/Bluewater Engage/);
    const id = await submit(p1, { name: "Jay", email: "jay@example.com" });
    await expect(createManualAppointment(p1.owner, { inquiryId: id, date: "2030-01-01", time: "10:00", durationMinutes: 30 })).rejects.toThrow(/Bluewater Engage/);
    expect(await getBookingSettings(p1.owner)).toBeNull();
  });

  it("another company can't see or change these appointments", async () => {
    const other = await setup();
    const id = await submit(co, { name: "Kim Iso", email: "kim.iso@example.com" });
    const uid = `iso-${Date.now()}`;
    await send(co, calBody("BOOKING_CREATED", booking(uid, inDays(2), { metadata: { bw: refFromInquiryId(id) } })));
    const a = await apptByUid(co.id, uid);
    expect((await listAppointments(other.owner, "upcoming")).some((r) => r.a.id === a!.id)).toBe(false);
    await expect(setAppointmentOutcome(other.owner, a!.id, "completed")).rejects.toThrow(/not found/);
    await expect(createManualAppointment(other.owner, { inquiryId: id, date: "2030-01-01", time: "10:00", durationMinutes: 30 })).rejects.toThrow(/not found/);
    await expect(simulateBooking(other.owner, id, "2030-01-01", "10:00")).rejects.toThrow(/not found/);
    // A webhook signed with company B's secret can't reach company A's records either.
    const body = calBody("BOOKING_CANCELLED", { uid });
    expect(await calcomWebhook(other.hookKey, body, calSignature(other.secret, body))).toBe(200);
    expect((await apptByUid(co.id, uid))!.status).toBe("scheduled");
  });
});
