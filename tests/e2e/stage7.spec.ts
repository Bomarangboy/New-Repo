import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

/** Stage 7 browser tests: support requests, service notices, usage & billing, sales-demo workspaces, health check. */
const PW = "bluewater-dev-password";

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.pathname !== "/login");
}

test.describe.serial("Stage 7: operations", () => {
  let ticketUrl = "";

  test("an owner opens a support request and gets a reference", async ({ page }) => {
    await signIn(page, "jordan@harbor.test");
    await page.goto("/app/help");
    await expect(page.getByRole("link", { name: "Automations → Emergency pause" })).toBeVisible();
    await page.getByLabel("Subject").fill("Texts look delayed");
    await page.getByLabel("What kind of request?").selectOption("problem");
    await page.getByLabel("Details").fill("Two leads this morning got their text after 10 minutes.");
    await page.getByRole("button", { name: "Send to Bluewater" }).click();
    await page.waitForURL(/\/app\/help\/tickets\//);
    await expect(page.getByText(/Request BW-\d+ sent/)).toBeVisible();
    ticketUrl = new URL(page.url()).pathname;
  });

  test("an administrator answers it, records an internal note, and runs the operations screens", async ({ page }) => {
    test.setTimeout(150_000);
    await signIn(page, "support@bluewater.test");
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/account\/security\?required=mfa/);
    await page.getByRole("button", { name: "Turn on two-step verification" }).click();
    await page.getByText("Can't scan? Enter this key instead").click();
    const secret = (await page.locator("code").innerText()).trim();
    await page.getByLabel("6-digit code").fill(totp(secret));
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Two-step verification is on")).toBeVisible();

    // Support inbox → reply + internal note.
    await page.goto("/admin/support");
    await page.getByRole("link", { name: /Texts look delayed/ }).click();
    await page.getByLabel("Reply", { exact: true }).fill("Thanks — a provider delay this morning; it has cleared.");
    await page.getByRole("button", { name: "Send reply" }).click();
    await expect(page.getByText("Reply saved and emailed")).toBeVisible();
    await page.getByLabel("Internal note").fill("INTERNAL: check Twilio status page history");
    await page.getByLabel("Status", { exact: true }).selectOption("resolved");
    await page.getByRole("button", { name: "Save note / status" }).click();
    await expect(page.getByText("Internal notes are never shown to the client")).toBeVisible();

    // Usage & billing: unknown prices are "—", never $0.
    await page.goto("/admin/billing");
    await expect(page.getByText(/Unit prices aren.t set yet/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Harbor Home Services" })).toBeVisible();

    // Service notice: draft → review exact recipients → send.
    await page.goto("/admin/notices");
    await page.getByLabel("Subject").fill("Scheduled maintenance");
    await page.getByLabel("Message").fill("Bluewater will be briefly unavailable tonight 11:00–11:15pm ET. Leads are still captured.");
    await page.getByLabel("Only the companies ticked below").check();
    await page.getByRole("checkbox", { name: /Summit Roofing/ }).check();
    await page.getByRole("button", { name: "Save draft and review recipients" }).click();
    await expect(page.getByText(/1 recipient\(s\)/)).toBeVisible();
    await expect(page.getByText(/Summit Roofing — taylor@summit.test/)).toBeVisible();
    await page.getByRole("button", { name: "Send real email to 1 owner(s)" }).click();
    await expect(page.getByText("Sent to 1 owner(s).")).toBeVisible();

    // Sales demo: create a prospect workspace and drive it.
    await page.goto("/admin/demo");
    await page.getByLabel("Prospect's business name").fill("Coastal Roofing");
    await page.getByRole("button", { name: "Create with sample data" }).click();
    await expect(page.getByText(/Coastal Roofing \(demo\) is ready with sample data/)).toBeVisible();
    await page.reload();
    const card = page.locator(".card", { hasText: "Coastal Roofing (demo)" });
    await expect(card.getByText("Demo — Sample Data")).toBeVisible();
    await card.getByRole("button", { name: "Simulate a new lead" }).click();
    await expect(card.getByText(/New sample lead from/)).toBeVisible();
    await card.getByRole("button", { name: "End access now" }).click();
    await expect(card.getByText(/Expired · deleted after 7 days/)).toBeVisible(); // the card now shows the new state
    await expect(card.getByRole("button", { name: "Simulate a new lead" })).toHaveCount(0);

    // Data deletion is only offered for archived companies.
    await page.goto("/admin");
    await page.getByRole("link", { name: "Summit Roofing" }).click();
    await expect(page.getByText(/Only possible for/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Permanently delete data" })).toHaveCount(0);
  });

  test("the owner sees Bluewater's reply but never the internal note; billing is read-only", async ({ page }) => {
    await signIn(page, "jordan@harbor.test");
    await page.goto(ticketUrl);
    await expect(page.getByText("a provider delay this morning")).toBeVisible();
    await expect(page.getByText("Resolved", { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("INTERNAL: check Twilio");
    await page.goto("/app/settings/billing");
    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    await expect(page.getByText("Not set up yet — Bluewater will confirm your price.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Save|Record/ })).toHaveCount(0);
  });

  test("employees can't see billing", async ({ page }) => {
    await signIn(page, "alex@harbor.test");
    await page.goto("/app/settings/billing");
    await expect(page).toHaveURL(/\/restricted/);
  });

  test("the uptime-monitor endpoint reports health without client details", async ({ request }) => {
    const r = await request.get("/api/health");
    expect([200, 503]).toContain(r.status());
    const body = await r.json();
    expect(body.checks.database).toBe("ok");
    expect(JSON.stringify(body)).not.toMatch(/Harbor|Summit|Bayside|@/);
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
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
