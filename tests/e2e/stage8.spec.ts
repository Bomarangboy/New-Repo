import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

/** Stage 8 browser tests: Platform Studio (edit → preview → publish) and the Sequence Library (search → copy → set up → activate). */
const PW = "bluewater-dev-password";

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.pathname !== "/login");
}

test.describe.serial("Stage 8: Platform Studio and Sequence Library", () => {
  test("an administrator customizes one company, previews and publishes; the client sees it", async ({ page }) => {
    test.setTimeout(150_000);
    await signIn(page, "design@bluewater.test");
    await page.goto("/admin");
    await page.getByRole("button", { name: "Turn on two-step verification" }).click();
    await page.getByText("Can't scan? Enter this key instead").click();
    const secret = (await page.locator("code").innerText()).trim();
    await page.getByLabel("6-digit code").fill(totp(secret));
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Two-step verification is on")).toBeVisible();

    await page.goto("/admin/studio");
    await page.getByLabel("Customize one company").selectOption({ label: "Harbor Home Services (internal test)" });
    await page.getByRole("button", { name: "Open" }).click();
    await expect(page.getByText("Editing: Company: Harbor Home Services")).toBeVisible();

    // Wording (draft only).
    await page.getByRole("link", { name: "Wording" }).click();
    await page.getByLabel("Leads — heading").fill("Enquiries");
    await page.getByRole("button", { name: "Save wording draft" }).click();
    await expect(page.getByText(/Draft saved \(1 change\)/)).toBeVisible();

    // Menu: the accessible move buttons (no dragging needed).
    await page.getByRole("link", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Move Conversations up" }).click();
    await expect(page.getByText(/Draft saved/)).toBeVisible();

    // Preview, check scope, publish.
    await page.getByRole("link", { name: "Preview & publish" }).click();
    await expect(page.getByText("reaches 1 workspace(s)")).toBeVisible();
    const frame = page.frameLocator('iframe[title="Draft preview"]');
    await expect(frame.getByText(/Preview of the draft/)).toBeVisible();
    await page.getByLabel("Summary for the version history").fill("Harbor wording and menu");
    await page.getByRole("button", { name: /Publish to 1 workspace/ }).click();
    await expect(page.getByText(/Published as version 1/)).toBeVisible();
    await page.getByRole("link", { name: "History" }).click();
    await expect(page.getByText("Harbor wording and menu")).toBeVisible();

    // The client sees it; another company doesn't.
    await signIn(page, "jordan@harbor.test");
    await page.goto("/app/leads");
    await expect(page.getByRole("heading", { name: "Enquiries" })).toBeVisible();
    const menu = page.getByRole("navigation", { name: "Main" });
    const labels = await menu.getByRole("link").allInnerTexts();
    expect(labels.findIndex((l) => l.includes("Conversations"))).toBeLessThan(labels.findIndex((l) => l.includes("Leads")));
    await signIn(page, "morgan@bayside.test");
    await page.goto("/app/leads");
    await expect(page.getByRole("heading", { name: "Leads", exact: true })).toBeVisible();
  });

  test("an owner copies a library sequence, can't turn it on until setup is done, then activates it", async ({ page }) => {
    await signIn(page, "jordan@harbor.test");
    await page.goto("/app/library");
    await page.getByLabel("Search the library").fill("check-in");
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("link", { name: "Quick 2-step check-in" }).click();
    await expect(page.getByText("Unverified.")).toBeVisible();
    await expect(page.getByText("They opt out (STOP or unsubscribe)")).toBeVisible();
    await page.getByRole("button", { name: "Copy to my workspace" }).click();
    await page.waitForURL(/\/app\/library\/copies\//);
    await expect(page.getByText(/Copied\. Nothing has been sent and nobody has been added/)).toBeVisible();

    await page.getByRole("button", { name: "Turn on" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Finish the setup checklist first" })).toBeVisible();

    for (const box of await page.getByRole("checkbox", { name: /I (understand|checked)|Our business name/ }).all()) await box.check();
    await page.getByRole("button", { name: "Save confirmations" }).click();
    await expect(page.getByText("Checklist saved.")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Turn on" }).click();
    await expect(page.getByText(/Turned on\. It runs only for people you add from their lead page\. Nobody already in Bluewater was added\./)).toBeVisible();
    await page.reload();
    await expect(page.getByText("This is on.")).toBeVisible();
  });

  test("Connect owners see sequences as unavailable; employees can browse but not copy", async ({ page }) => {
    await signIn(page, "taylor@summit.test");
    await page.goto("/app/library");
    await expect(page.getByText("Follow-up sequences are part of Bluewater Engage.").first()).toBeVisible();
    await signIn(page, "alex@harbor.test");
    await page.goto("/app/library");
    await page.getByRole("link", { name: "Friendly instant thank-you" }).click();
    await expect(page.getByText("Ask your account owner to copy this template.")).toBeVisible();
  });

  test("the Overview fits a phone screen without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, "jordan@harbor.test");
    await page.goto("/app");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
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
