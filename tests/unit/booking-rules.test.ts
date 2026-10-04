import { describe, expect, it } from "vitest";
import { bookingLinkFor, formatAppointmentTime, inquiryIdFromRef, refFromInquiryId, validBookingUrl } from "@/server/booking/links";
import { calSignature, parseCalcomBody, verifyCalSignature } from "@/server/booking/webhook";
import { DEFAULT_SEQUENCE_STEPS, DEFAULT_TEMPLATES, STORED_TEMPLATE_KEYS, validateTemplate } from "@/server/messaging/templates";
import { checkSteps } from "@/server/sequences/manage";

const ID = "3f2b8c1e-9a4d-4e7b-8c21-5d6e7f809a1b";

describe("booking link references", () => {
  it("round-trip an inquiry id through a short reference", () => {
    const ref = refFromInquiryId(ID);
    expect(ref).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(inquiryIdFromRef(ref)).toBe(ID);
  });
  it("reject anything that isn't a reference", () => {
    for (const bad of [null, undefined, 42, "", "short", "x".repeat(23), "../../etc/passwd!!!!!!", "AAAAAAAAAAAAAAAAAAAAA="]) expect(inquiryIdFromRef(bad)).toBeNull();
  });
  it("builds personal links; prefill only when asked (emails), nothing without a booking page", () => {
    const sms = bookingLinkFor("https://cal.com/acme/estimate", ID)!;
    expect(sms).toBe(`https://cal.com/acme/estimate?metadata[bw]=${refFromInquiryId(ID)}`);
    const email = bookingLinkFor("https://cal.com/acme/estimate?duration=30", ID, { name: "Ann Lee", email: "ann@example.com" })!;
    expect(email).toContain("duration=30&name=Ann+Lee&email=ann%40example.com&metadata[bw]=");
    expect(bookingLinkFor(null, ID)).toBeNull();
  });
  it("accepts only plain https booking pages", () => {
    expect(validBookingUrl(" https://cal.com/acme/estimate#x ")).toBe("https://cal.com/acme/estimate");
    for (const bad of ["http://cal.com/acme", "javascript:alert(1)", "https://user:pw@cal.com/a", "cal.com/acme", "https://localhost/a"]) expect(validBookingUrl(bad)).toBeNull();
  });
  it("formats appointment times in the business's timezone, across DST", () => {
    expect(formatAppointmentTime(new Date("2026-10-06T18:00:00Z"), "America/New_York")).toBe("Tue, Oct 6 at 2:00 PM EDT");
    expect(formatAppointmentTime(new Date("2026-11-02T19:00:00Z"), "America/New_York")).toBe("Mon, Nov 2 at 2:00 PM EST");
    expect(formatAppointmentTime(new Date("2026-11-02T19:00:00Z"), "America/Phoenix")).toBe("Mon, Nov 2 at 12:00 PM MST");
  });
});

describe("Cal.com signatures and payloads", () => {
  const body = JSON.stringify({ triggerEvent: "BOOKING_CREATED", createdAt: "2026-10-04T12:00:00.000Z", payload: {
    uid: "abc", startTime: "2026-10-08T15:00:00.000Z", endTime: "2026-10-08T16:00:00.000Z", title: "Estimate",
    attendees: [{ name: "Ann Lee", email: "ann@example.com", timeZone: "America/Chicago" }],
    responses: { name: { label: "Name", value: "Ann" }, attendeePhoneNumber: { value: "+14155550100" } }, metadata: { bw: refFromInquiryId(ID) },
  } });
  it("verifies the HMAC-SHA256 of the exact body", () => {
    const sig = calSignature("s3cret", body);
    expect(verifyCalSignature("s3cret", body, sig)).toBe(true);
    expect(verifyCalSignature("s3cret", body, `sha256=${sig}`)).toBe(true);
    expect(verifyCalSignature("s3cret", body + " ", sig)).toBe(false);
    expect(verifyCalSignature("other", body, sig)).toBe(false);
    expect(verifyCalSignature("s3cret", body, null)).toBe(false);
    expect(verifyCalSignature("s3cret", body, "zz")).toBe(false);
  });
  it("extracts what Bluewater needs, tolerating Cal.com's response shapes", () => {
    const e = parseCalcomBody(body)!;
    expect(e).toMatchObject({ trigger: "BOOKING_CREATED", uid: "abc", startTime: "2026-10-08T15:00:00.000Z", ref: refFromInquiryId(ID),
      attendee: { name: "Ann Lee", email: "ann@example.com", phone: "+14155550100", timeZone: "America/Chicago" } });
    expect(e.eventCreatedAt!.toISOString()).toBe("2026-10-04T12:00:00.000Z");
    expect(e.bodyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(parseCalcomBody("not json")).toBeNull();
    expect(parseCalcomBody(JSON.stringify({ payload: {} }))).toBeNull();
  });
});

describe("message wording rules", () => {
  it("every default template and default follow-up step is valid and fits in 3 text segments", () => {
    for (const k of STORED_TEMPLATE_KEYS) expect(validateTemplate(k, DEFAULT_TEMPLATES[k].body, DEFAULT_TEMPLATES[k].subject).errors, k).toEqual([]);
    expect(checkSteps(DEFAULT_SEQUENCE_STEPS)).toEqual([]);
  });
  it("appointment time only works in booking messages; a booking link without fallback gets a warning", () => {
    expect(validateTemplate("followup_sms", "{{company_name}} see you {{appointment_time}}. Reply STOP to opt out.").errors.join()).toMatch(/only works in appointment/);
    expect(validateTemplate("booking_reminder_sms", "{{company_name}} see you {{appointment_time}}. Reply STOP to opt out.").ok).toBe(true);
    expect(validateTemplate("followup_sms", "{{company_name}}: book {{booking_link}}. Reply STOP to opt out.").warnings.join()).toMatch(/fallback/);
  });
  it("step checks name the step and channel", () => {
    const s = DEFAULT_SEQUENCE_STEPS[0]!;
    expect(checkSteps([s, { ...s, smsBody: "hello" }]).join(" ")).toMatch(/Step 2 text: .*STOP/);
    expect(checkSteps([{ ...s, channel: "email", emailSubject: "" }]).join(" ")).toMatch(/Step 1 email: .*subject/);
    expect(checkSteps([])).toContain("Add at least one step.");
  });
});
