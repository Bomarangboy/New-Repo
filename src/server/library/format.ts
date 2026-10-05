import { z } from "zod";
import { PACKAGES, type PackageTier } from "@/lib/authz/entitlements";
import { validateTemplate } from "@/server/messaging/templates";
import { MAX_STEPS, checkSteps, stepSchema } from "@/server/sequences/manage";

/**
 * Sequence Library definition format "bluewater.library/v1" (docs/LIBRARY.md; example in
 * docs/examples/library-sequence-example.json). It is DATA only: messages, delays, channels, the entry
 * condition, the two configurable stop/hand-off options and required setup. Nothing in a file is executed.
 * Third-party sequence files (other CRMs/tools) are NOT compatible as-is — they must be rewritten in this format.
 */
export const FORMAT = "bluewater.library/v1";
export const INTEGRATIONS = { website_form: "Website form connected", booking: "Booking page (Cal.com) connected", meta_lead_forms: "Facebook/Instagram lead forms connected", google_lead_forms: "Google lead forms connected" } as const;
export type Integration = keyof typeof INTEGRATIONS;
export const ENTRY = { new_website_leads: "New leads from live forms (website, ad lead forms) — only if you also choose to start it automatically", manual_only: "Only people a team member adds by hand" } as const;

/** Fill-in markers like [[your special offer]] that the business must replace before activating. */
export const MARKER = /\[\[([^\]\n]{1,60})\]\]/g;

const text = (max: number) => z.string().max(max);
const meta = {
  format: z.literal(FORMAT, { error: `The file must say "format": "${FORMAT}".` }),
  name: text(80).min(3),
  description: text(500).min(10),
  industry: text(60).min(2),
  objective: text(80).min(2),
  category: text(60).optional(),
  requiredPackage: z.enum(PACKAGES),
  requiredIntegrations: z.array(z.enum(Object.keys(INTEGRATIONS) as [Integration, ...Integration[]])).max(4).default([]),
};

export const sequenceDefinition = z.strictObject({
  ...meta,
  kind: z.literal("sequence"),
  entry: z.enum(["new_website_leads", "manual_only"]).default("manual_only"),
  stopOnManualMessage: z.boolean().default(true),
  handoffTask: z.boolean().default(true),
  steps: z.array(stepSchema.strict()).min(1).max(MAX_STEPS),
});
export const acknowledgmentDefinition = z.strictObject({
  ...meta,
  kind: z.literal("acknowledgment"),
  acknowledgment: z.strictObject({ smsBody: text(1600).optional(), emailSubject: text(200).optional(), emailBody: text(5000).optional() }),
});
export const definitionSchema = z.discriminatedUnion("kind", [sequenceDefinition, acknowledgmentDefinition]);
export type Definition = z.infer<typeof definitionSchema>;
export type SequenceDefinition = z.infer<typeof sequenceDefinition>;
export type AckDefinition = z.infer<typeof acknowledgmentDefinition>;

const RANK: Record<PackageTier, number> = { instant_response: 1, follow_up_booking: 2, performance_reporting: 3 };
export const packageAllows = (have: PackageTier, need: PackageTier) => RANK[have] >= RANK[need];

/** Every message text in a definition (for scanning and marker detection). */
export function allTexts(d: Definition): string[] {
  if (d.kind === "sequence") return d.steps.flatMap((s) => [s.smsBody ?? "", s.emailSubject ?? "", s.emailBody ?? ""]);
  return [d.acknowledgment.smsBody ?? "", d.acknowledgment.emailSubject ?? "", d.acknowledgment.emailBody ?? ""];
}
export function markersIn(texts: string[]): string[] {
  return [...new Set(texts.flatMap((t) => [...t.matchAll(MARKER)].map((m) => m[1]!.trim())))];
}

/** Content rules for shared templates: plain text, no personal data, no secrets, no links except {{booking_link}}. */
function scanShared(texts: string[]): string[] {
  const problems: string[] = [];
  const all = texts.join("\n");
  if (/<\s*\/?\s*[a-zA-Z!?]|javascript:|\bon[a-z]+\s*=/i.test(all)) problems.push("Messages must be plain text — remove HTML tags or code.");
  if (/https?:\/\/|www\./i.test(all)) problems.push("Don't put web links in shared templates; use {{booking_link}} (each business's own booking page).");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(all)) problems.push("Remove email addresses — shared templates must not contain personal or business contact details.");
  if (/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(all)) problems.push("Remove phone numbers — shared templates must not contain personal or business contact details.");
  if (/\b(sk_live|api[_-]?key|password|secret|token)\b/i.test(all)) problems.push("Remove anything that looks like a password, key or token.");
  return problems;
}

export interface Checked { ok: boolean; definition?: Definition; errors: string[]; warnings: string[]; metadata?: { channels: string[]; stepCount: number; durationDays: number; requiredFields: string[] } }

/** Validates a definition (from the editor or an imported file). Reports every problem before anything is saved. */
export function checkDefinition(input: unknown): Checked {
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 12).map((i) => `${i.path.join(".") || "file"}: ${i.code === "unrecognized_keys" ? `isn't supported (${(i as { keys?: string[] }).keys?.join(", ")})` : i.message}`), warnings: [] };
  }
  const d = parsed.data;
  const errors: string[] = [], warnings: string[] = [];
  const texts = allTexts(d);
  errors.push(...scanShared(texts));
  // Wording rules are the same ones the automation editor uses (opt-out text, known fields, length).
  const withMarkersFilled = (t: string | null | undefined) => (t ?? "").replace(MARKER, (_, m: string) => m);
  if (d.kind === "sequence") {
    if (d.requiredPackage === "instant_response") errors.push("Follow-up sequences need Bluewater Engage or Insight: set requiredPackage to follow_up_booking or performance_reporting.");
    errors.push(...checkSteps(d.steps.map((s) => ({ ...s, smsBody: withMarkersFilled(s.smsBody), emailSubject: withMarkersFilled(s.emailSubject), emailBody: withMarkersFilled(s.emailBody) }))));
  } else {
    const a = d.acknowledgment;
    if (!a.smsBody && !a.emailBody) errors.push("An acknowledgment needs a text message, an email, or both.");
    if (a.smsBody) { const c = validateTemplate("ack_sms", withMarkersFilled(a.smsBody)); errors.push(...c.errors.map((e) => `Text: ${e}`)); warnings.push(...c.warnings.map((w) => `Text: ${w}`)); }
    if (a.emailBody) { const c = validateTemplate("ack_email", withMarkersFilled(a.emailBody), withMarkersFilled(a.emailSubject)); errors.push(...c.errors.map((e) => `Email: ${e}`)); warnings.push(...c.warnings.map((w) => `Email: ${w}`)); }
  }
  const usesBooking = texts.some((t) => /\{\{\s*booking_link/.test(t));
  if (usesBooking && !d.requiredIntegrations.includes("booking")) warnings.push("Uses {{booking_link}} but doesn't list the booking integration as required; businesses without a booking page will get the fallback text.");
  const channels = d.kind === "sequence"
    ? [...new Set(d.steps.flatMap((s) => (s.channel === "sms_or_email" ? ["sms", "email"] : [s.channel])))]
    : [...(d.acknowledgment.smsBody ? ["sms"] : []), ...(d.acknowledgment.emailBody ? ["email"] : [])];
  const minutes = d.kind === "sequence" ? d.steps.reduce((a, s) => a + s.delayMinutes, 0) : 0;
  return {
    ok: errors.length === 0, definition: d, errors: [...new Set(errors)], warnings: [...new Set(warnings)],
    metadata: { channels, stepCount: d.kind === "sequence" ? d.steps.length : 1, durationDays: Math.ceil(minutes / 1440), requiredFields: markersIn(texts) },
  };
}

/** Parses an uploaded file: JSON only, size-limited; never evaluated as code. */
export function parseImport(raw: string): Checked {
  if (raw.length > 100_000) return { ok: false, errors: ["The file is too large (limit 100 KB)."], warnings: [] };
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return { ok: false, errors: [`That isn't valid JSON. Only "${FORMAT}" files exported from Bluewater or written from the example are supported.`], warnings: [] }; }
  return checkDefinition(data);
}
