import { describe, expect, it } from "vitest";
import { transportDecision } from "@/server/messaging/transport";
import { renderTemplate, smsSegments, validateTemplate, DEFAULT_TEMPLATES } from "@/server/messaging/templates";
import { isWithinWindow, nextWindowStart } from "@/server/messaging/settings";
import { classifyInbound } from "@/server/messaging/inbound";

describe("real sending requires every condition (D-23)", () => {
  const ok = { simulatedEnvironment: false, companyKind: "customer" as const, senderStatus: "verified", channel: "sms" as const };
  it("sends for real only when all conditions hold", () => {
    expect(transportDecision(ok)).toBe("twilio");
    expect(transportDecision({ ...ok, channel: "email" })).toBe("postmark");
  });
  it.each([
    ["simulated environment", { simulatedEnvironment: true }],
    ["demo company", { companyKind: "demo_prospect" as const }],
    ["internal test company", { companyKind: "internal_test" as const }],
    ["sender pending", { senderStatus: "pending_verification" }],
    ["no sender", { senderStatus: null }],
  ])("simulates when: %s", (_, patch) => {
    expect(transportDecision({ ...ok, ...patch })).toBe("simulated");
  });
});

describe("templates", () => {
  it("default templates are valid", () => {
    expect(validateTemplate("ack_sms", DEFAULT_TEMPLATES.ack_sms.body).ok).toBe(true);
    expect(validateTemplate("ack_email", DEFAULT_TEMPLATES.ack_email.body, DEFAULT_TEMPLATES.ack_email.subject).ok).toBe(true);
  });
  it("rejects unknown fields, broken braces, missing STOP and missing subject", () => {
    expect(validateTemplate("ack_sms", "Hi {{firstname}} Reply STOP").errors[0]).toMatch(/isn't a field/);
    expect(validateTemplate("ack_sms", "Hi {{first_name} Reply STOP").errors.join()).toMatch(/unfinished/);
    expect(validateTemplate("ack_sms", "Hi {{first_name}}").errors.join()).toMatch(/STOP/);
    expect(validateTemplate("ack_email", "Hello", "").errors.join()).toMatch(/subject/);
    expect(validateTemplate("ack_sms", "x".repeat(600) + " STOP").errors.join()).toMatch(/too long/);
  });
  it("fills fields and uses fallbacks for empty values", () => {
    expect(renderTemplate("Hi {{first_name|there}} re {{service}}.", { first_name: "", service: "roof" })).toBe("Hi there re roof.");
    expect(renderTemplate("{{ company_name }}!", { company_name: "Acme" })).toBe("Acme!");
  });
  it("counts SMS segments the way carriers bill them", () => {
    expect(smsSegments("a".repeat(160))).toEqual({ segments: 1, encoding: "GSM-7" });
    expect(smsSegments("a".repeat(161))).toEqual({ segments: 2, encoding: "GSM-7" });
    expect(smsSegments("€".repeat(80))).toEqual({ segments: 1, encoding: "GSM-7" }); // 2 units each
    expect(smsSegments("Hi 😀")).toEqual({ segments: 1, encoding: "UCS-2" });
    expect(smsSegments("é".repeat(10) + "ł".repeat(61))).toEqual({ segments: 2, encoding: "UCS-2" });
  });
});

describe("sending window", () => {
  const w = { windowStartMinute: 9 * 60, windowEndMinute: 17 * 60, windowDays: [1, 2, 3, 4, 5] };
  it("knows when the window is open in the company's timezone", () => {
    expect(isWithinWindow(new Date("2026-10-06T14:30:00Z"), "America/Chicago", w)).toBe(true); // Tue 9:30
    expect(isWithinWindow(new Date("2026-10-06T13:59:00Z"), "America/Chicago", w)).toBe(false); // Tue 8:59
    expect(isWithinWindow(new Date("2026-10-04T15:00:00Z"), "America/Chicago", w)).toBe(false); // Sunday
  });
  it("finds the next opening, across weekends and DST", () => {
    expect(nextWindowStart(new Date("2026-10-09T23:00:00Z"), "America/Chicago", w)!.toISOString()).toBe("2026-10-12T14:00:00.000Z"); // Fri 6pm → Mon 9am CDT
    expect(nextWindowStart(new Date("2026-10-31T23:00:00Z"), "America/New_York", { ...w, windowDays: [0, 1, 2, 3, 4, 5, 6] })!.toISOString()).toBe("2026-11-01T14:00:00.000Z"); // DST ends Nov 1: 9am EST = 14:00Z
    expect(nextWindowStart(new Date(), "UTC", { ...w, windowDays: [] })).toBeNull();
  });
});

describe("incoming message classification", () => {
  it.each([
    ["STOP", "opt_out"], ["stop.", "opt_out"], ["Unsubscribe", "opt_out"], ["STOP ALL", "opt_out"], ["please stop texting me", "opt_out"],
    ["Don't text me again", "opt_out"], ["START", "opt_in"], ["unstop", "opt_in"], ["HELP", "help"],
    ["Can you stop by Tuesday?", "message"], ["Yes Tuesday works", "message"], ["What does stopping the leak cost?", "message"],
  ])("%s → %s", (text, expected) => {
    expect(classifyInbound(text)).toBe(expected);
  });
});
