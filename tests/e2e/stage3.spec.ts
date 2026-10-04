import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

/** Stage 3 browser tests: acknowledgments, inbox, opt-outs, automations, admin health. Simulated delivery only. */
const PW = "bluewater-dev-password";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.pathname !== "/login");
}

async function eventually(page: Page, check: () => Promise<boolean>, timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await page.waitForTimeout(700);
    await page.reload();
  }
  throw new Error("condition not met in time");
}

test.describe.serial("Stage 3: automatic acknowledgment, inbox and controls", () => {
  let conversationUrl = "";

  test("a new website lead is acknowledged automatically (simulated) and the owner is alerted", async ({ page, request }) => {
    await signIn(page, "jordan@harbor.test");
    await page.goto("/app/connected-accounts");
    await page.getByText("+ Connect a website form").click();
    await page.getByLabel("Name", { exact: true }).last().fill("Stage 3 form");
    await page.getByRole("button", { name: "Create form connection" }).click();
    await expect(page.getByText("Form connection created")).toBeVisible();
    const url = (await page.locator("details[open] code").filter({ hasText: "/api/intake/" }).first().innerText()).trim();

    const res = await request.post(url, { data: { name: "Robin Example", phone: "415-555-0912", email: "robin.e3@example.net", service: "gutter cleaning", consent_sms: "on", consent_text: "Text me about my request." }, headers: { "Content-Type": "application/json" } });
    expect(res.status()).toBe(201);

    await page.goto("/app/conversations");
    await eventually(page, async () => (await page.getByRole("link", { name: /Robin Example/ }).count()) > 0);
    await page.getByRole("link", { name: /Robin Example/ }).click();
    await page.waitForURL(/conversations\/[0-9a-f-]{36}/);
    conversationUrl = page.url();
    await expect(page.getByText("Automatic acknowledgment")).toBeVisible();
    await expect(page.getByText("Simulated").first()).toBeVisible();
    await expect(page.getByText("Hi Robin, thanks for contacting Harbor Home Services")).toBeVisible();
    await expect(page.getByText("Delivered")).toBeVisible();

    await page.goto("/dev/mailbox");
    await expect(page.getByText(/New lead for Harbor Home Services: Robin Example/).first()).toBeVisible();
  });

  test("a reply needs attention; an employee answers by text; STOP blocks further texts", async ({ page }) => {
    await signIn(page, "alex@harbor.test");
    await page.goto(conversationUrl);
    await page.getByLabel("Simulate a reply from this person").fill("Can you come Saturday?");
    await page.getByRole("button", { name: "Simulate" }).click();
    await expect(page.getByText("Can you come Saturday?")).toBeVisible();
    await expect(page.getByText("Needs reply").first()).toBeVisible();

    await page.getByPlaceholder("Write a text…").fill("Saturday at 10 works. See you then!");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Saturday at 10 works. See you then!")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Mark as handled" })).toHaveCount(0);

    await page.getByLabel("Simulate a reply from this person").fill("STOP");
    await page.getByRole("button", { name: "Simulate" }).click();
    await expect(page.getByText("Opted out of texts")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Text" })).toBeDisabled();
  });

  test("template edits are checked before saving and saved as a new version", async ({ page }) => {
    await signIn(page, "jordan@harbor.test");
    await page.goto("/app/automations");
    const sms = page.getByLabel("Message").first();
    await sms.fill("Hi {{firstname}}, thanks!");
    await expect(page.getByText(/isn't a field Bluewater knows/)).toBeVisible();
    await expect(page.getByText(/include "Reply STOP to opt out."/)).toBeVisible();
    await sms.fill("Hi {{first_name|there}}, {{company_name}} got your request. Reply STOP to opt out.");
    await expect(page.getByText("Hi Jordan, Harbor Home Services got your request. Reply STOP to opt out.")).toBeVisible();
    await page.getByRole("button", { name: "Save new version" }).first().click();
    await expect(page.getByText(/Saved as version 1/)).toBeVisible();
  });

  test("the emergency stop halts automatic messages and can be lifted", async ({ page }) => {
    await signIn(page, "jordan@harbor.test");
    await page.goto("/app/automations");
    await page.getByLabel("Why? (for your records)").fill("Checking wording");
    await page.getByRole("button", { name: "Stop all automatic messages" }).click();
    await expect(page.getByText("All automatic messages are stopped").first()).toBeVisible();
    await page.goto("/app");
    await expect(page.getByText("All automatic messages are stopped for this business")).toBeVisible();
    await page.goto("/app/automations");
    await page.getByRole("button", { name: "Turn automatic messages back on" }).click();
    await expect(page.getByText("Automatic messages are back on")).toBeVisible();
  });

  test("employees can't change automations", async ({ page }) => {
    await signIn(page, "alex@harbor.test");
    await page.goto("/app/automations");
    await expect(page.getByRole("button", { name: "Save new version" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Stop all automatic messages" })).toHaveCount(0);
  });

  test("administrator health page and sender setup", async ({ page }) => {
    await signIn(page, "ops@bluewater.test"); // second admin, so this file doesn't depend on others
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/account\/security\?required=mfa/);
    await page.getByRole("button", { name: "Turn on two-step verification" }).click();
    await page.getByText("Can't scan? Enter this key instead").click();
    const secret = (await page.locator("code").innerText()).trim();
    await page.getByLabel("6-digit code").fill(totp(secret));
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Two-step verification is on")).toBeVisible();
    await page.goto("/admin/health");
    await expect(page.getByText(/Simulated — no real texts or emails can be sent/)).toBeVisible();
    await page.goto("/admin");
    await page.getByRole("link", { name: "Summit Roofing" }).click();
    await page.waitForURL(/\/admin\/companies\//);
    await page.locator("select[aria-label='Text sender status']").selectOption("pending_verification");
    await page.getByPlaceholder("Subaccount SID (AC…)").fill("AC" + "2".repeat(32));
    await page.getByPlaceholder("Subaccount auth token").fill("secret-token-not-shown-again");
    await page.getByRole("button", { name: "Save text sender" }).click();
    await expect(page.getByText("Text sender saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByPlaceholder("Auth token saved — leave blank to keep")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("secret-token-not-shown-again");
  });
});

function totp(secret: string): string {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of secret) { value = (value << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", Buffer.from(out)).update(c).digest();
  const o = h[h.length - 1]! & 15;
  return String((((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1e6).padStart(6, "0");
}
