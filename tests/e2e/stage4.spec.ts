import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

/** Stage 4 browser tests: follow-up sequences, appointments, Cal.com connection. Simulated delivery only. */
const PW = "bluewater-dev-password";

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.pathname !== "/login");
}

const dateIn = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + days * 86_400_000));

test.describe.serial("Stage 4: follow-up and booking", () => {
  let leadUrl = "";
  let leadId = "";

  test("owner edits the follow-up wording; it's checked and saved as a new version", async ({ page }) => {
    await signIn(page, "jordan@harbor.test");
    await page.goto("/app/automations");
    await page.getByRole("link", { name: /New lead follow-up/ }).click();
    await page.waitForURL(/\/app\/automations\/sequences\//);
    const step1 = page.getByLabel("Text message").first();
    await step1.fill("Hi {{first_name|there}}, {{company_name}} again about your {{service|request}}.");
    await expect(page.getByText(/include "Reply STOP to opt out."/).first()).toBeVisible();
    await step1.fill("Hi {{first_name|there}}, {{company_name}} checking in on your {{service|request}}. Reply STOP to opt out.");
    await expect(page.getByText("Hi Jordan, Harbor Home Services checking in on your roof repair. Reply STOP to opt out.")).toBeVisible();
    await page.getByRole("button", { name: "Save sequence" }).click();
    await expect(page.getByText(/Saved as version 2/)).toBeVisible();
  });

  test("a new website lead starts the follow-up; an employee pauses and resumes it", async ({ page, request }) => {
    await signIn(page, "jordan@harbor.test");
    await page.goto("/app/connected-accounts");
    await page.getByText("+ Connect a website form").click();
    await page.getByLabel("Name", { exact: true }).last().fill("Stage 4 form");
    await page.getByRole("button", { name: "Create form connection" }).click();
    await expect(page.getByText("Form connection created")).toBeVisible();
    const url = (await page.locator("details[open] code").filter({ hasText: "/api/intake/" }).first().innerText()).trim();
    const res = await request.post(url, { data: { name: "Morgan Follow", phone: "415-555-0933", email: "morgan.follow@example.net", service: "deck repair", consent_sms: "on" } });
    expect(res.status()).toBe(201);

    await signIn(page, "alex@harbor.test");
    await page.goto("/app/leads?q=Morgan+Follow");
    await page.getByRole("link", { name: "Morgan Follow" }).first().click();
    await page.waitForURL(/\/app\/leads\/[0-9a-f-]{36}/);
    leadUrl = page.url();
    leadId = leadUrl.split("/").pop()!;
    await expect(page.getByText("Running")).toBeVisible();
    await expect(page.getByText(/Step 1 of 3 · next message/)).toBeVisible();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(page.getByText(/Paused\. Nothing more is sent/)).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByText("Resumed.")).toBeVisible();
  });

  test("a (simulated) booking books the lead, stops the follow-up and shows on Appointments", async ({ page }) => {
    await signIn(page, "alex@harbor.test");
    await page.goto(leadUrl);
    await page.getByText("Simulate a booking (demo/testing only)").click();
    await page.getByLabel("Booked date").fill(dateIn(3));
    await page.getByLabel("Booked time").fill("14:00");
    await page.getByRole("button", { name: "Simulate booking" }).click();
    await expect(page.getByText(/Simulated booking recorded/)).toBeVisible();
    await page.reload();
    await expect(page.locator("h1 + span, h1 ~ *").filter({ hasText: "Booked" }).first()).toBeVisible();
    await expect(page.getByText(/Stopped .*They booked/)).toBeVisible();
    await page.goto("/app/appointments");
    const row = page.locator("li").filter({ hasText: "Morgan Follow" });
    await expect(row.getByText("Simulated")).toBeVisible();
    await expect(row.getByText("Scheduled")).toBeVisible();
  });

  test("an appointment booked by phone can be added by hand", async ({ page }) => {
    await signIn(page, "alex@harbor.test");
    await page.goto("/app/leads/new");
    await page.getByLabel("Name").fill("Phone Booker");
    await page.getByLabel("Email").fill("phone.booker@example.net");
    await page.getByRole("button", { name: /Add lead|Save lead|Create lead/ }).click();
    await page.waitForURL(/created=1/);
    await page.getByText("Add an appointment booked another way").click();
    await page.getByLabel("Date", { exact: true }).fill(dateIn(4));
    await page.getByLabel("Time", { exact: true }).fill("10:30");
    await page.getByRole("button", { name: "Add appointment" }).click();
    await expect(page.getByText(/Appointment added/)).toBeVisible();
    await page.goto("/app/appointments");
    await expect(page.locator("li").filter({ hasText: "Phone Booker" }).getByText("Entered by your team")).toBeVisible();
  });

  test("owner connects Cal.com: the secret is shown once, a signed test connects it, a signed booking attaches to the lead", async ({ page, request }) => {
    await signIn(page, "jordan@harbor.test");
    await page.goto("/app/connected-accounts");
    await page.getByLabel("Booking page address").fill("https://cal.com/harbor-sample/estimate");
    await page.getByRole("button", { name: "Save booking page" }).click();
    await expect(page.getByText(/Saved\. New messages will include personal booking links/)).toBeVisible();
    await page.getByRole("button", { name: "Set up automatic booking updates" }).click();
    await expect(page.getByText(/won't be shown again/)).toBeVisible();
    const codes = page.locator("div").filter({ hasText: /won't be shown again/ }).last().locator("code");
    const hookUrl = (await codes.filter({ hasText: "/api/webhooks/calcom/" }).innerText()).trim();
    const secret = (await codes.nth(1).innerText()).trim();

    const sign = (b: string) => createHmac("sha256", secret).update(b).digest("hex");
    const ping = JSON.stringify({ triggerEvent: "PING", createdAt: new Date().toISOString(), payload: {} });
    expect((await request.post(hookUrl, { data: ping, headers: { "content-type": "application/json", "x-cal-signature-256": "0".repeat(64) } })).status()).toBe(401);
    expect((await request.post(hookUrl, { data: ping, headers: { "content-type": "application/json", "x-cal-signature-256": sign(ping) } })).status()).toBe(200);
    await page.reload();
    await expect(page.locator(".badge", { hasText: /^Connected$/ })).toBeVisible(); // the Cal.com card's status
    await expect(page.locator("body")).not.toContainText(secret);

    // A booking made through the lead's personal link (reference = the lead).
    await page.goto(leadUrl);
    const link = (await page.locator("code").filter({ hasText: "metadata[bw]=" }).innerText()).trim();
    const ref = link.split("metadata[bw]=")[1]!;
    const start = new Date(Date.now() + 6 * 86_400_000); start.setUTCHours(15, 0, 0, 0);
    const body = JSON.stringify({ triggerEvent: "BOOKING_CREATED", createdAt: new Date().toISOString(), payload: {
      uid: `e2e-${Date.now()}`, title: "Estimate", startTime: start.toISOString(), endTime: new Date(start.getTime() + 3600_000).toISOString(),
      attendees: [{ name: "Morgan Follow", email: "someone.else@example.net", timeZone: "America/New_York" }], metadata: { bw: ref },
    } });
    expect((await request.post(hookUrl, { data: body, headers: { "content-type": "application/json", "x-cal-signature-256": sign(body) } })).status()).toBe(200);
    await page.reload();
    await expect(page.locator("li").getByText("Cal.com", { exact: true })).toBeVisible();
    expect(leadId).toBeTruthy();
  });

  test("Package 1 has no appointments or sequences, even by direct address", async ({ page }) => {
    await signIn(page, "taylor@summit.test");
    await page.goto("/app/appointments");
    await expect(page).toHaveURL(/\/restricted\?reason=not_entitled/);
    await page.goto("/app/automations");
    await expect(page.getByText("Multi-day follow-up by text and email is part of Package 2.")).toBeVisible();
    await page.goto("/app/automations/sequences/00000000-0000-0000-0000-000000000000");
    await expect(page).toHaveURL(/\/restricted\?reason=not_entitled/);
  });
});
