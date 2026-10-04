import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

/**
 * Stage 1 browser test against a real running server and database.
 * Uses fictional sample companies; nothing leaves the machine.
 */
const PW = "bluewater-dev-password";

function base32Decode(s: string): Buffer {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, "")) {
    value = (value << 5) | A.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpAtStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  return String((((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1e6).padStart(6, "0");
}

async function signIn(page: Page, email: string, password = PW) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Wait for the server to finish signing in and redirect (to the app, or to the code step).
  await page.waitForURL((u) => u.pathname !== "/login");
}

async function enterCode(page: Page, code: string) {
  await page.getByLabel("Verification code").fill(code);
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function latestMailLink(page: Page, to: string, path: string): Promise<string> {
  await page.goto("/dev/mailbox");
  const mail = page.getByTestId("dev-mail").filter({ hasText: to }).first();
  const body = await mail.getByTestId("dev-mail-body").innerText();
  const m = new RegExp(`http://localhost:3100(${path}[^\\s]+)`).exec(body);
  if (!m) throw new Error(`No ${path} link in mail to ${to}`);
  return m[1]!;
}

let adminSecret = "";
let lastStepUsed = 0;

/** A code the server will accept: within ±1 step of now and newer than any code already used (no replays). */
async function freshCode(): Promise<string> {
  const now = () => Math.floor(Date.now() / 30000);
  let step = Math.max(now(), lastStepUsed + 1);
  while (step > now() + 1) await new Promise((r) => setTimeout(r, 1000));
  lastStepUsed = step;
  return totpAtStep(adminSecret, step);
}

test.describe.serial("Stage 1: accounts, isolation and permissions", () => {
  test("administrator must set up two-step verification before the admin area", async ({ page }) => {
    await signIn(page, "admin@bluewater.test");
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/account\/security\?required=mfa/);
    await page.getByRole("button", { name: "Turn on two-step verification" }).click();
    await page.getByText("Can't scan? Enter this key instead").click();
    adminSecret = (await page.locator("code").innerText()).trim();
    await page.getByLabel("6-digit code").fill(await freshCode());
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Two-step verification is on")).toBeVisible();
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "All Customers" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Harbor Home Services" })).toBeVisible();
  });

  test("admin sign-in requires the code; creates a company and invites its owner", async ({ page }) => {
    await signIn(page, "admin@bluewater.test");
    await expect(page).toHaveURL(/\/login\/mfa/);
    await page.goto("/admin"); // cannot skip the code
    await expect(page).toHaveURL(/\/login\/mfa/);
    await enterCode(page, await freshCode());
    await page.goto("/admin/companies/new");
    await page.getByLabel("Business name").fill("Coastal Plumbing Co");
    await page.getByLabel("Package").selectOption("instant_response");
    await page.getByRole("button", { name: "Create company" }).click();
    await expect(page.getByText("Company created. Next: invite the owner.")).toBeVisible();
    await page.getByLabel("Invite the owner").fill("casey@coastal.test");
    await page.getByRole("button", { name: "Send owner invitation" }).click();
    await expect(page.getByText("Owner invitation sent")).toBeVisible();
  });

  test("invited owner creates an account and lands in only their workspace (Package 1 navigation)", async ({ page }) => {
    const link = await latestMailLink(page, "casey@coastal.test", "/invite/");
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Join Coastal Plumbing Co" })).toBeVisible();
    await page.getByLabel("Your name").fill("Casey Coastal");
    await page.getByLabel("Create a password").fill("casey-strong-password");
    await page.getByLabel("Confirm password").fill("casey-strong-password");
    await page.getByRole("button", { name: "Create account and join" }).click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByText("Welcome to Coastal Plumbing Co")).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main" }).first();
    await expect(nav.getByRole("link", { name: "Leads" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Appointments" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Reports" })).toHaveCount(0);
    // The link is single-use.
    await page.goto(link);
    await expect(page.getByText("This invitation can't be used")).toBeVisible();
  });

  test("package limits hold even when typing the address directly", async ({ page }) => {
    await signIn(page, "taylor@summit.test"); // Package 1
    await page.goto("/app/appointments");
    await expect(page).toHaveURL(/\/restricted\?reason=not_entitled/);
    await page.goto("/app/reports");
    await expect(page).toHaveURL(/\/restricted\?reason=not_entitled/);
  });

  test("employees cannot open owner-only areas", async ({ page }) => {
    await signIn(page, "alex@harbor.test");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Connected Accounts" })).toHaveCount(0);
    await page.goto("/app/connected-accounts");
    await expect(page).toHaveURL(/reason=forbidden/);
    await page.goto("/app/settings/activity");
    await expect(page).toHaveURL(/reason=forbidden/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/app$/);
  });

  test("forging the company cookie does not reveal another company", async ({ page, context }) => {
    // Find Summit's id as the admin, then try to use it as Harbor's owner.
    await signIn(page, "admin@bluewater.test");
    await enterCode(page, await freshCode());
    await page.goto("/admin");
    await page.getByRole("link", { name: "Summit Roofing" }).click();
    await page.waitForURL(/\/admin\/companies\/[0-9a-f-]{36}$/);
    const summitId = page.url().split("/").pop()!;
    await context.clearCookies();

    await signIn(page, "jordan@harbor.test");
    await expect(page.getByText("Harbor Home Services").first()).toBeVisible();
    await context.addCookies([{ name: "bw_company", value: summitId, url: "http://localhost:3100" }]);
    await page.goto("/app");
    await expect(page).toHaveURL(/reason=forbidden/);
    await expect(page.getByText("Summit Roofing")).toHaveCount(0);
  });

  test("password reset by email works once", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email address").fill("sam@harbor.test");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("If an account exists")).toBeVisible();
    const link = await latestMailLink(page, "sam@harbor.test", "/reset-password");
    await page.goto(link);
    await page.getByLabel("New password", { exact: true }).fill("sam-new-password-123");
    await page.getByLabel("Confirm new password").fill("sam-new-password-123");
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page.getByText("Your password was changed")).toBeVisible();
    await signIn(page, "sam@harbor.test", "sam-new-password-123");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  });

  test("owner invites, then removes, an employee — access ends immediately", async ({ page, browser }) => {
    await signIn(page, "jordan@harbor.test");
    await page.goto("/app/settings/team");
    await page.getByLabel("Email address").fill("temp@harbor.test");
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText("Invitation sent to temp@harbor.test")).toBeVisible();

    const other = await browser.newPage();
    const link = await latestMailLink(other, "temp@harbor.test", "/invite/");
    await other.goto(link);
    await other.getByLabel("Your name").fill("Temp Worker");
    await other.getByLabel("Create a password").fill("temp-strong-password");
    await other.getByLabel("Confirm password").fill("temp-strong-password");
    await other.getByRole("button", { name: "Create account and join" }).click();
    await expect(other.getByRole("heading", { name: "Overview" })).toBeVisible();

    await page.reload();
    const row = page.locator("li").filter({ hasText: "temp@harbor.test" });
    await row.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Their access ended immediately")).toBeVisible();

    await other.goto("/app/leads");
    await expect(other).toHaveURL(/restricted/);
    await other.close();
  });

  test("the client's activity log records team changes", async ({ page }) => {
    await signIn(page, "jordan@harbor.test");
    await page.goto("/app/settings/activity");
    await expect(page.getByText("Invitation sent to temp@harbor.test")).toBeVisible();
    await expect(page.getByText("Team member removed")).toBeVisible();
  });
});
