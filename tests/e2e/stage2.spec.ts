import { expect, test, type Page } from "@playwright/test";

/** Stage 2 browser tests: real server, real database, fictional sample data only. */
const PW = "bluewater-dev-password";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.pathname !== "/login");
}

test.describe.serial("Stage 2: leads, website forms, import", () => {
  let intakeUrl = "";

  test("owner connects a website form and gets setup instructions", async ({ page }) => {
    await signIn(page, "taylor@summit.test"); // Package 1, onboarding, no sample data
    await page.goto("/app/connected-accounts");
    await expect(page.getByRole("region", { name: "Meta (Facebook & Instagram)" })).toBeVisible(); // ad platforms listed (simulated in tests)
    await page.getByLabel("Name", { exact: true }).fill("Quote form");
    await page.getByLabel("Allowed websites (recommended)").fill("https://summit.example");
    await page.getByRole("button", { name: "Create form connection" }).click();
    await expect(page.getByText("Form connection created")).toBeVisible();
    await expect(page.getByText("Submission address (POST):")).toBeVisible(); // opened automatically
    intakeUrl = (await page.locator("code").filter({ hasText: "/api/intake/" }).first().innerText()).trim();
    expect(intakeUrl).toMatch(/\/api\/intake\/[A-Za-z0-9_-]+$/);
  });

  test("a website submission over HTTP becomes a lead; a retry does not duplicate it", async ({ page, request }) => {
    const body = { name: "Web Visitor", email: "visitor@example.com", phone: "415-555-0177", service: "Roof inspection", utm_source: "google", utm_campaign: "fall", consent_sms: "on", consent_text: "Text me about my request." };
    const headers = { "Content-Type": "application/json", Origin: "https://summit.example", "Idempotency-Key": "e2e-sub-1" };
    const first = await request.post(intakeUrl, { data: body, headers });
    expect(first.status()).toBe(201);
    const retry = await request.post(intakeUrl, { data: body, headers });
    expect(retry.status()).toBe(200);
    expect((await retry.json()).status).toBe("duplicate");
    const wrongSite = await request.post(intakeUrl, { data: body, headers: { ...headers, Origin: "https://evil.example", "Idempotency-Key": "e2e-sub-2" } });
    expect(wrongSite.status()).toBe(403);

    await signIn(page, "taylor@summit.test");
    await page.goto("/app/leads?q=visitor");
    await expect(page.getByText("1 lead")).toBeVisible();
    await page.getByRole("link", { name: "Web Visitor" }).filter({ visible: true }).first().click();
    await expect(page.getByText("Quote form").first()).toBeVisible();
    await expect(page.getByText("fall")).toBeVisible(); // campaign preserved
    await expect(page.getByText("Text messages:")).toBeVisible(); // consent evidence
    await expect(page.getByText("Arrived while automatic messages were off")).toBeVisible(); // onboarding → held
    await page.goto("/app");
    await expect(page.getByText("Receiving leads").or(page.getByText("Last lead")).first()).toBeVisible();
  });

  test("Package 1 has no pipeline board, even by direct address", async ({ page }) => {
    await signIn(page, "taylor@summit.test");
    await page.goto("/app/leads/pipeline");
    await expect(page).toHaveURL(/reason=not_entitled/);
  });

  test("manual lead: add, move through the pipeline, record a sale, add a note", async ({ page }) => {
    await signIn(page, "jordan@harbor.test"); // Package 2
    await page.goto("/app/leads/new");
    await page.getByLabel("Name").fill("Phone Caller");
    await page.getByLabel("Email").fill("phone.caller@example.net"); // unique: sample data already uses 555-01xx phones
    await page.getByLabel("Service requested").fill("Water heater install");
    await page.getByRole("button", { name: "Add lead" }).click();
    await expect(page.getByText("Lead added.")).toBeVisible();
    await page.getByLabel("Stage", { exact: true }).selectOption("booked");
    await page.getByRole("button", { name: "Update stage" }).click();
    await expect(page.getByText("Stage updated.")).toBeVisible();
    await page.getByLabel("Sale amount (USD)").fill("2,450");
    await page.getByRole("button", { name: "Save sale" }).click();
    await expect(page.getByText("Sale recorded and lead marked Won.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("$2,450").first()).toBeVisible();
    await page.getByPlaceholder("Add a note for your team…").fill("Customer wants a weekday install.");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("Customer wants a weekday install.")).toBeVisible();
    await expect(page.getByText("Sale recorded: $2,450 — stage changed from Booked to Won")).toBeVisible();
  });

  test("CSV import shows problems by row, imports the valid rows once", async ({ page }) => {
    await signIn(page, "jordan@harbor.test");
    await page.goto("/app/leads/import");
    const csv = "Name,Email,Phone,Service,Date\nCsv One,csv.one@example.com,,Gutters,2026-02-01\nBroken,not-an-email,,Gutters,2026-02-01\nCsv Two,,415-555-0166,Roof,2/2/2026\n";
    await page.setInputFiles("#file", { name: "old-leads.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "Check file" }).click();
    await expect(page.getByText("2 ready to import")).toBeVisible();
    await expect(page.getByText(/Row 3:/)).toBeVisible();
    await page.getByRole("button", { name: "Import 2 leads" }).click();
    await expect(page.getByText("Import complete: 2 added")).toBeVisible();
    await page.goto("/app/leads?q=csv.one");
    await expect(page.getByText("1 lead")).toBeVisible();
  });

  test("employees can work leads but not import or export", async ({ page, request, context }) => {
    await signIn(page, "alex@harbor.test");
    await page.goto("/app/leads");
    await expect(page.getByRole("link", { name: "Add lead" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Import" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Export" })).toHaveCount(0);
    await page.goto("/app/leads/import");
    await expect(page).toHaveURL(/reason=forbidden/);
    const cookies = await context.cookies();
    const res = await request.get("/app/leads/export", { headers: { Cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") } });
    expect(res.status()).toBe(403);
  });

  test("owners can export; another company's lead address shows 'not found'", async ({ page }) => {
    await signIn(page, "jordan@harbor.test");
    await page.goto("/app/leads?q=Phone+Caller");
    await page.getByRole("link", { name: "Phone Caller" }).filter({ visible: true }).first().click();
    await page.waitForURL(/\/app\/leads\/[0-9a-f-]{36}/);
    const harborLeadUrl = page.url();
    const download = page.waitForEvent("download");
    await page.goto("/app/leads");
    await page.getByRole("link", { name: "Export" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^leads-\d{4}-\d{2}-\d{2}\.csv$/);

    await page.context().clearCookies();
    await signIn(page, "taylor@summit.test");
    const res = await page.goto(harborLeadUrl);
    expect(res?.status()).toBe(404);
    await expect(page.getByText("Phone Caller")).toHaveCount(0);
  });

  test("overview totals agree with each other", async ({ page }) => {
    await signIn(page, "morgan@bayside.test"); // Package 3 with sample data
    await page.goto("/app?days=90");
    const total = Number((await page.locator("p.text-3xl").first().innerText()).replace(/,/g, ""));
    expect(total).toBeGreaterThan(0);
    await page.getByText("View as table").click();
    const cells = await page.locator("figure table tbody td:nth-child(2)").allInnerTexts();
    expect(cells.reduce((a, c) => a + Number(c), 0)).toBe(total);
    await expect(page.getByRole("heading", { name: "Recorded sales" })).toBeVisible();
  });
});
