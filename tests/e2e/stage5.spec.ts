import { expect, test, type Page } from "@playwright/test";

/** Stage 5 browser tests: ad lead forms and Package 3 reporting — all SIMULATED (no Meta/Google accounts). */
const PW = "bluewater-dev-password";

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
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

test.describe.serial("Stage 5: advertising (simulated)", () => {
  test("Package 3 reports show spend, campaigns and results — clearly labeled as sample numbers", async ({ page }) => {
    await signIn(page, "morgan@bayside.test");
    await page.goto("/app/reports");
    await expect(page.getByText("Sample numbers.")).toBeVisible();
    await expect(page.getByText("Ad spend", { exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: /Spring offer — lead form \(simulated\)/ })).toBeVisible();
    await expect(page.getByText(/credited to a campaign only when the campaign id arrived/)).toBeVisible();
    await page.getByRole("link", { name: "Last 7 days" }).click();
    await expect(page).toHaveURL(/days=7/);
    await page.goto("/app");
    await expect(page.getByText(/Ad spend · last 30 days/)).toBeVisible();
    await expect(page.getByText("Sample numbers from simulated ad accounts.")).toBeVisible();
  });

  test("Package 2 receives Facebook lead-form leads but has no Reports page", async ({ page }) => {
    await signIn(page, "jordan@harbor.test");
    await page.goto("/app/connected-accounts");
    const meta = page.getByRole("region", { name: "Meta (Facebook & Instagram)" });
    await expect(meta.getByText("Connected — simulated")).toBeVisible();
    await expect(meta.getByText("Ad spend reporting is part of Bluewater Insight.", { exact: false })).toBeVisible();
    await meta.getByRole("button", { name: "Send a simulated lead" }).click();
    await expect(page.getByText(/Simulated lead sent/)).toBeVisible();
    await page.goto("/app/leads");
    await eventually(page, async () => (await page.getByText("Free estimate form (simulated)").count()) > 0);
    await page.goto("/app/reports");
    await expect(page).toHaveURL(/\/restricted\?reason=not_entitled/);
  });

  test("Package 1 connects a (simulated) Meta account and turns on a Page", async ({ page }) => {
    await signIn(page, "taylor@summit.test");
    await page.goto("/app/connected-accounts");
    const meta = page.getByRole("region", { name: "Meta (Facebook & Instagram)" });
    await meta.getByRole("button", { name: /Connect a sample Meta account \(simulated\)/ }).click();
    await expect(page.getByText("Meta connected. Choose what to use below.")).toBeVisible();
    await expect(meta.getByText("Ad accounts included in reports")).toHaveCount(0);
    await meta.getByRole("button", { name: "Receive leads" }).click();
    await expect(page.getByText(/now come into Bluewater/)).toBeVisible();
    await page.reload();
    await expect(meta.getByText("Receiving leads")).toBeVisible();
  });

  test("Google lead-form webhook: key shown once, Google's test data verifies it, a real lead is recorded", async ({ page, request }) => {
    await signIn(page, "taylor@summit.test");
    await page.goto("/app/connected-accounts");
    const g = page.getByRole("region", { name: "Google Ads" });
    await g.getByRole("button", { name: "Set up Google lead-form webhook" }).click();
    await expect(g.getByText(/won't be shown again/)).toBeVisible();
    const codes = g.locator("div").filter({ hasText: /won't be shown again/ }).last().locator("code");
    const url = (await codes.nth(0).innerText()).trim();
    const key = (await codes.nth(1).innerText()).trim();
    const lead = (id: string, extra: Record<string, unknown> = {}) => ({ lead_id: id, form_id: 1, campaign_id: 2, google_key: key, user_column_data: [{ column_id: "FULL_NAME", string_value: "Webb Hook" }, { column_id: "EMAIL", string_value: "webb.hook@example.net" }], ...extra });
    expect((await request.post(url, { data: lead("t1", { google_key: "wrong" }) })).status()).toBe(401);
    expect((await request.post(url, { data: lead("t1", { is_test: true }) })).status()).toBe(200);
    await page.reload();
    await expect(g.getByText("Test received")).toBeVisible();
    expect((await request.post(url, { data: lead("real-1") })).status()).toBe(200);
    expect((await request.post(url, { data: lead("real-1") })).status()).toBe(200); // Google retry: still one lead
    await page.goto("/app/leads?q=Webb");
    await eventually(page, async () => (await page.getByRole("link", { name: "Webb Hook" }).count()) > 0);
    await expect(page.getByRole("link", { name: "Webb Hook" })).toHaveCount(1);
  });

  test("the Meta webhook refuses unsigned messages and unknown verification tokens", async ({ request }) => {
    expect((await request.get("/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=1")).status()).toBe(403);
    expect((await request.post("/api/webhooks/meta", { data: { object: "page", entry: [] } })).status()).toBe(401);
  });
});
