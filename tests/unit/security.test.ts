import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { base32Encode, decrypt, encrypt, hashPassword, passwordProblems, totpAt, verifyPassword, verifyTotp } from "@/lib/crypto";
import { assertSafeCombination, type Env } from "@/lib/env";
import { redactDetails } from "@/lib/audit";
import { FEATURES, hasFeature, minimumPackageFor, PACKAGES } from "@/lib/authz/entitlements";
import { ACTIONS, ROLE_PERMISSIONS } from "@/lib/authz/permissions";
import { accountPolicy } from "@/lib/authz/account-policy";

describe("TOTP matches RFC 6238 test vectors", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it.each([
    [59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"],
  ])("t=%i → %s", (t, code) => {
    expect(totpAt(secret, Math.floor(t / 30), 8)).toBe(code);
  });
  it("accepts ±1 step drift and rejects replays", () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30000);
    expect(verifyTotp(secret, totpAt(secret, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step - 2), now)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, step), now, step)).toBeNull();
    expect(verifyTotp(secret, "12ab56", now)).toBeNull();
  });
});

describe("passwords and encryption", () => {
  it("hashes and verifies passwords", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h).not.toContain("correct");
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
  it("enforces a minimum length", () => {
    expect(passwordProblems("short")).toMatch(/12/);
    expect(passwordProblems("a reasonable passphrase")).toBeNull();
  });
  it("encrypts with authentication (tampering is detected)", () => {
    const c = encrypt("secret-value");
    expect(c).not.toContain("secret");
    expect(decrypt(c)).toBe("secret-value");
    const parts = c.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("activity log details never keep secrets", () => {
    expect(redactDetails({ email: "a@b.c", password: "x", accessToken: "y", apiKey: "z" }))
      .toEqual({ email: "a@b.c", password: "[redacted]", accessToken: "[redacted]", apiKey: "[redacted]" });
  });
});

describe("configuration safety", () => {
  const base: Env = {
    APP_ENV: "development", APP_BASE_URL: "http://localhost:3000", DATABASE_URL: "x", AUTH_PROVIDER: "local",
    ENCRYPTION_KEY: "k".repeat(44), SYSTEM_EMAIL_TRANSPORT: "dev-outbox", SYSTEM_EMAIL_FROM: "x", LIVE_SENDING_ENABLED: false,
  };
  const supa = { NEXT_PUBLIC_SUPABASE_URL: "u", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "p", SUPABASE_SECRET_KEY: "s" };
  it("local login is refused outside development/test and on any hosted deployment", () => {
    expect(() => assertSafeCombination(base, {})).not.toThrow();
    expect(() => assertSafeCombination({ ...base, APP_ENV: "production" }, {})).toThrow(/local development login/);
    expect(() => assertSafeCombination({ ...base, APP_ENV: "demo" }, {})).toThrow(/local development login/);
    expect(() => assertSafeCombination(base, { VERCEL: "1" })).toThrow();
  });
  it("demo can never enable live sending; dev cannot either", () => {
    expect(() => assertSafeCombination({ ...base, ...supa, AUTH_PROVIDER: "supabase", APP_ENV: "demo", LIVE_SENDING_ENABLED: true }, {})).toThrow(/demo/);
    expect(() => assertSafeCombination({ ...base, LIVE_SENDING_ENABLED: true }, {})).toThrow(/development or test/);
  });
  it("production requires a real system email transport and Supabase keys", () => {
    expect(() => assertSafeCombination({ ...base, AUTH_PROVIDER: "supabase", APP_ENV: "production" }, {})).toThrow(/Supabase/);
    expect(() => assertSafeCombination({ ...base, ...supa, AUTH_PROVIDER: "supabase", APP_ENV: "production" }, {})).toThrow(/system email/);
    expect(() => assertSafeCombination({ ...base, ...supa, AUTH_PROVIDER: "supabase", APP_ENV: "production", SYSTEM_EMAIL_TRANSPORT: "postmark" }, {})).not.toThrow();
  });
});

describe("entitlements and permissions", () => {
  it("packages are cumulative", () => {
    for (const f of Object.keys(FEATURES) as (keyof typeof FEATURES)[]) {
      const min = PACKAGES.indexOf(minimumPackageFor(f));
      PACKAGES.forEach((p, i) => expect(hasFeature(p, f), `${p}/${f}`).toBe(i >= min));
    }
  });
  it("lead capture from ad forms is separate from ad reporting", () => {
    expect(hasFeature("instant_response", "ad_lead_forms")).toBe(true);
    expect(hasFeature("follow_up_booking", "ad_reporting")).toBe(false);
  });
  it("support roles never include exports, invitations, ownership transfer, deletion or messaging", () => {
    for (const r of ["support_read", "support_edit"] as const) {
      for (const a of ["lead.export", "data.export_all", "team.invite", "ownership.transfer", "lead.delete", "message.send_manual"] as const) {
        expect(ROLE_PERMISSIONS[r].has(a), `${r}/${a}`).toBe(false);
      }
    }
    expect(ROLE_PERMISSIONS.owner.size).toBe(ACTIONS.length);
  });
  it("account policy: onboarding stores leads without automation; suspension stops all sending", () => {
    expect(accountPolicy({ lifecycleStatus: "onboarding", suspended: false, kind: "customer" })).toMatchObject({ intake: "store_only", automatedSending: false });
    expect(accountPolicy({ lifecycleStatus: "active", suspended: true, kind: "customer" })).toMatchObject({ login: "read_only", intake: "store_only", automatedSending: false, manualSending: false });
    expect(accountPolicy({ lifecycleStatus: "active", suspended: false, kind: "demo_prospect" }).liveDeliveryAllowed).toBe(false);
  });
});

describe("code guardrails", () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
    });
  }
  it("client workspace pages never use unrestricted database access", () => {
    const dir = path.resolve(__dirname, "../../src/app/(workspace)");
    for (const f of files(dir)) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/withSystemDb|withSystemCompanyDb|withPlatformDb|getDb\(/);
    }
  });
  it("no secrets are exposed through NEXT_PUBLIC_ variables", () => {
    for (const f of files(path.resolve(__dirname, "../../src"))) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE_ROLE|TOKEN|PASSWORD)/);
    }
  });
});

import { safeNext } from "@/lib/safe-next";
describe("redirect safety", () => {
  it("only allows same-site relative paths", () => {
    expect(safeNext("/app/leads")).toBe("/app/leads");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "", undefined, "/a\r\nSet-Cookie: x"]) {
      expect(safeNext(bad)).toBe("/app");
    }
  });
});

import { readFileSync as readDoc } from "node:fs";
import { renderPermissionsDoc } from "../../scripts/gen-permissions-doc";
describe("documentation matches enforcement", () => {
  it("docs/PERMISSIONS.md is up to date (run: npx tsx scripts/gen-permissions-doc.ts)", () => {
    expect(readDoc(path.resolve(__dirname, "../../docs/PERMISSIONS.md"), "utf8")).toBe(renderPermissionsDoc());
  });
});

describe("scheduled cancellation in account policy", () => {
  it("takes effect at the end date even before the scheduler runs", () => {
    const base = { lifecycleStatus: "active" as const, suspended: false, kind: "customer" as const, cancellationRequestedAt: new Date("2026-01-01") };
    expect(accountPolicy({ ...base, serviceEndsAt: new Date("2026-02-01") }, new Date("2026-01-15")).intake).toBe("process");
    expect(accountPolicy({ ...base, serviceEndsAt: new Date("2026-02-01") }, new Date("2026-02-02"))).toMatchObject({ login: "read_only", intake: "reject", automatedSending: false });
  });
});
