import Papa from "papaparse";
import { and, desc, eq, sql } from "drizzle-orm";
import { withCompanyDb } from "@/lib/db/context";
import { importBatches } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { roleCan } from "@/lib/authz/permissions";
import type { CompanyContext } from "@/lib/authz/context-types";
import { cleanText, normalizeEmail, normalizePhone, pickTracking } from "@/lib/contact-normalize";
import { recordInquiry, validateInquiry } from "./record-inquiry";

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;

/** Accepted column names (case/spacing-insensitive). */
const ALIASES: Record<string, string[]> = {
  name: ["name", "full name", "fullname", "contact name", "customer name"],
  first_name: ["first name", "firstname", "first"],
  last_name: ["last name", "lastname", "last"],
  email: ["email", "email address", "e-mail"],
  phone: ["phone", "phone number", "mobile", "cell", "telephone"],
  service: ["service", "service requested", "service_requested", "interest"],
  message: ["message", "notes", "inquiry", "comments", "details"],
  date: ["date", "submitted", "submitted at", "submitted_at", "created", "created at", "lead date"],
};

export interface ImportRow {
  row: number;
  fullName: string;
  email: string | null;
  phone: string | null;
  serviceRequested: string | null;
  message: string | null;
  submittedAt: string | null;
  tracking: Record<string, string>;
}

function headerKey(h: string): string | null {
  const n = h.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  for (const [k, list] of Object.entries(ALIASES)) if (list.includes(n)) return k;
  if (/^utm (source|medium|campaign|term|content)$/.test(n)) return n.replace(" ", "_");
  if (["gclid", "fbclid"].includes(n)) return n;
  return null;
}

/** Accepts ISO dates and US-style M/D/YYYY (optionally with time). */
export function parseImportDate(raw: string | undefined): Date | null | "invalid" {
  const s = cleanText(raw, 40);
  if (!s) return null;
  let d: Date;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(s);
  if (us) {
    const y = us[3]!.length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    d = new Date(Date.UTC(y, Number(us[1]) - 1, Number(us[2]), Number(us[4] ?? 12), Number(us[5] ?? 0)));
    if (d.getUTCMonth() !== Number(us[1]) - 1) return "invalid";
  } else if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    d = new Date(s.length === 10 ? `${s}T12:00:00Z` : s);
  } else return "invalid";
  if (Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 86400_000 || d.getUTCFullYear() < 2000) return "invalid";
  return d;
}

function need(ctx: CompanyContext) {
  if (!roleCan(ctx.role, "lead.import")) throw new UserError("Only the account owner can import leads.");
  if (ctx.policy.login !== "full") throw new UserError("This account is read-only right now, so imports are paused.");
}

/** Step 1: validate the file and store a preview. Nothing is added to the CRM yet. */
export async function previewImport(ctx: CompanyContext, fileName: string, text: string) {
  need(ctx);
  if (Buffer.byteLength(text) > MAX_IMPORT_BYTES) throw new UserError("The file is larger than 2 MB. Split it into smaller files.");
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy" });
  const headers = parsed.meta.fields ?? [];
  const map = new Map<string, string>();
  for (const h of headers) { const k = headerKey(h); if (k && !map.has(k)) map.set(k, h); }
  if (!map.has("email") && !map.has("phone")) {
    throw new UserError(`The file needs an "Email" or "Phone" column. Columns found: ${headers.slice(0, 12).join(", ") || "none"}.`);
  }
  if (parsed.data.length > MAX_IMPORT_ROWS) throw new UserError(`The file has ${parsed.data.length} rows; the limit is ${MAX_IMPORT_ROWS}.`);

  const get = (r: Record<string, string>, k: string) => (map.has(k) ? r[map.get(k)!] : undefined);
  const rows: ImportRow[] = [];
  const errors: { row: number; problems: string[] }[] = [];
  const seen = new Map<string, number>();

  parsed.data.forEach((r, i) => {
    const rowNo = i + 2; // row 1 is the header in a spreadsheet
    const name = get(r, "name") ?? [get(r, "first_name"), get(r, "last_name")].filter(Boolean).join(" ");
    const v = validateInquiry({ fullName: name, email: get(r, "email"), phone: get(r, "phone"), serviceRequested: get(r, "service"), message: get(r, "message") });
    const date = parseImportDate(get(r, "date"));
    const problems = v.ok ? [] : [...v.problems];
    if (date === "invalid") problems.push(`Date "${get(r, "date")}" isn't recognised (use 2026-03-31 or 3/31/2026).`);
    if (v.ok) {
      const key = `${v.value.email?.normalized ?? ""}|${v.value.phone?.e164 ?? ""}|${date instanceof Date ? date.toISOString() : ""}|${(v.value.serviceRequested ?? "").toLowerCase()}`;
      if (seen.has(key)) problems.push(`Same lead as row ${seen.get(key)}.`);
      else seen.set(key, rowNo);
    }
    if (problems.length || !v.ok) { errors.push({ row: rowNo, problems }); return; }
    const tracking = pickTracking(Object.fromEntries(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"].map((k) => [k, get(r, k)])));
    rows.push({
      row: rowNo, fullName: v.value.fullName, email: v.value.email?.display ?? null, phone: v.value.phone?.display ?? null,
      serviceRequested: v.value.serviceRequested, message: v.value.message, submittedAt: date instanceof Date ? date.toISOString() : null, tracking,
    });
  });

  return withCompanyDb(ctx, async (tx) => {
    const [b] = await tx.insert(importBatches).values({
      companyId: ctx.companyId, fileName: cleanText(fileName, 200) ?? "import.csv", rows, errors,
      totalRows: parsed.data.length, validRows: rows.length, createdByUserId: ctx.userId,
    }).returning();
    return b!;
  });
}

export async function getImport(ctx: CompanyContext, id: string) {
  need(ctx);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withCompanyDb(ctx, async (tx) => (await tx.select().from(importBatches).where(eq(importBatches.id, id)))[0] ?? null);
}

export async function recentImports(ctx: CompanyContext) {
  need(ctx);
  return withCompanyDb(ctx, (tx) => tx.select({
    id: importBatches.id, fileName: importBatches.fileName, status: importBatches.status, totalRows: importBatches.totalRows,
    validRows: importBatches.validRows, createdCount: importBatches.createdCount, matchedCount: importBatches.matchedCount, createdAt: importBatches.createdAt,
  }).from(importBatches).orderBy(desc(importBatches.createdAt)).limit(10));
}

/**
 * Step 2: add the previewed rows. Runs once (status changes atomically). Imported inquiries are
 * NEVER enrolled in automatic messaging. Rows already imported before (same contact + same date
 * from an earlier import) are skipped, so re-uploading a file doesn't duplicate leads.
 */
export async function commitImport(ctx: CompanyContext, id: string, requestId?: string) {
  need(ctx);
  return withCompanyDb(ctx, async (tx) => {
    const [b] = await tx.update(importBatches).set({ status: "committed", committedAt: new Date() })
      .where(and(eq(importBatches.id, id), eq(importBatches.status, "previewed"))).returning();
    if (!b) throw new UserError("This import was already completed or cancelled.");
    let created = 0, skipped = 0, matched = 0;
    for (const r of b.rows as ImportRow[]) {
      const submittedAt = r.submittedAt ? new Date(r.submittedAt) : undefined;
      if (submittedAt) {
        const existing = await tx.execute<{ n: number }>(
          // Same contact (by email or phone) already has an imported inquiry at the same time → skip.
          // Parameterized; values come from the validated preview.
          sqlAlreadyImported(ctx.companyId, r, submittedAt),
        );
        if (Number(existing[0]?.n ?? 0) > 0) { skipped++; continue; }
      }
      const res = await recordInquiry(tx, { fullName: r.fullName, email: r.email, phone: r.phone, serviceRequested: r.serviceRequested, message: r.message, submittedAt, tracking: r.tracking }, {
        companyId: ctx.companyId, source: "csv_import", sourceLabel: `Import: ${b.fileName}`, automationOrigin: "none",
        actorUserId: ctx.userId, actorType: ctx.supportGrantId ? "support" : "user", importBatchId: b.id,
      });
      created++;
      if (res.outcome !== "new_contact") matched++;
    }
    await tx.update(importBatches).set({ createdCount: created, matchedCount: matched }).where(eq(importBatches.id, id));
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: ctx.supportGrantId ? "support" : "user", action: "data.leads_imported", targetType: "import_batch", targetId: id, details: { fileName: b.fileName, created, skipped, matched, errors: b.errors.length }, requestId });
    return { created, skipped, matched, errors: b.errors.length };
  });
}

export async function cancelImport(ctx: CompanyContext, id: string) {
  need(ctx);
  await withCompanyDb(ctx, (tx) => tx.update(importBatches).set({ status: "cancelled", rows: [] }).where(and(eq(importBatches.id, id), eq(importBatches.status, "previewed"))));
}

function sqlAlreadyImported(companyId: string, r: ImportRow, at: Date) {
  const e = normalizeEmail(r.email), p = normalizePhone(r.phone);
  const email = e && e !== "invalid" ? e.normalized : null;
  const phone = p && p !== "invalid" ? p.e164 : null;
  return sql`select count(*)::int as n from app.inquiries i join app.contacts c on c.id = i.contact_id
    where i.company_id = ${companyId} and i.source = 'csv_import' and i.submitted_at = ${at.toISOString()}
      and ((${email}::text is not null and c.email_normalized = ${email}) or (${phone}::text is not null and c.phone_e164 = ${phone}))`;
}
