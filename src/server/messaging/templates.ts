/**
 * Message templates with validated personalization fields.
 * Syntax: {{first_name}} or {{service|your project}} (text after "|" is used when the value is empty).
 */
export const TEMPLATE_FIELDS = {
  first_name: "The lead's first name",
  full_name: "The lead's full name",
  company_name: "Your business name",
  service: "The service they asked about",
} as const;
export type TemplateField = keyof typeof TEMPLATE_FIELDS;
export type TemplateKey = "ack_sms" | "ack_email";

export const DEFAULT_TEMPLATES: Record<TemplateKey, { subject: string | null; body: string }> = {
  ack_sms: {
    subject: null,
    body: "Hi {{first_name|there}}, thanks for contacting {{company_name}}! We received your request about {{service|your project}} and will be in touch shortly. Reply STOP to opt out.",
  },
  ack_email: {
    subject: "We received your request — {{company_name}}",
    body: "Hi {{first_name|there}},\n\nThanks for contacting {{company_name}}. We received your request about {{service|your project}} and a member of our team will get back to you shortly.\n\nIf you need anything in the meantime, just reply to this email.\n\n{{company_name}}",
  },
};

const TOKEN = /\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/g;

export interface TemplateCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  segments?: number;
  encoding?: "GSM-7" | "UCS-2";
}

export function validateTemplate(key: TemplateKey, body: string, subject?: string | null): TemplateCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = `${subject ?? ""}\n${body}`;
  for (const m of text.matchAll(TOKEN)) {
    if (!(m[1]! in TEMPLATE_FIELDS)) errors.push(`"{{${m[1]}}}" isn't a field Bluewater knows. Use: ${Object.keys(TEMPLATE_FIELDS).map((f) => `{{${f}}}`).join(", ")}.`);
  }
  const stray = text.replace(TOKEN, "");
  if (/\{\{|\}\}/.test(stray)) errors.push("There's an unfinished {{ }} field. Check the curly braces.");
  if (!body.trim()) errors.push("The message can't be empty.");
  if (key === "ack_email" && !subject?.trim()) errors.push("The email needs a subject line.");
  let segments: number | undefined, encoding: TemplateCheck["encoding"];
  if (key === "ack_sms") {
    if (!/\bSTOP\b/.test(body)) errors.push('Text messages must tell people how to opt out — include "Reply STOP to opt out."');
    const sample = renderTemplate(body, { first_name: "Alexandria", full_name: "Alexandria Montgomery", company_name: "Your Business Name", service: "Water heater replacement" });
    ({ segments, encoding } = smsSegments(sample));
    if (segments > 3) errors.push(`This text is too long (${segments} segments with a long name filled in). Keep it to 3 segments or fewer.`);
    else if (segments > 1) warnings.push(`With a long name or service filled in, this text can grow to ${segments} parts (${encoding}); each part is billed.`);
    if (!/\{\{\s*company_name/.test(body)) warnings.push("Carriers expect the business name in the first text. Consider including {{company_name}}.");
  }
  if (body.length > 5000) errors.push("The message is too long.");
  return { ok: errors.length === 0, errors, warnings, segments, encoding };
}

export function renderTemplate(body: string, vars: Partial<Record<TemplateField, string | null | undefined>>): string {
  return body.replace(TOKEN, (_, name: string, fallback?: string) => {
    const v = vars[name as TemplateField];
    return v && v.trim() ? v.trim() : (fallback ?? "").trim();
  });
}

export function varsFor(contact: { fullName: string }, companyName: string, service: string | null): Record<TemplateField, string> {
  const full = contact.fullName.trim();
  return { first_name: full.split(/\s+/)[0] ?? "", full_name: full, company_name: companyName, service: service ?? "" };
}

/* ---- SMS segment counting (GSM-7 vs UCS-2) ---- */
const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = "^{}\\[~]|€";

export function smsSegments(text: string): { segments: number; encoding: "GSM-7" | "UCS-2" } {
  let units = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM.includes(ch)) units += 1;
    else if (GSM_EXT.includes(ch)) units += 2;
    else { gsm = false; break; }
  }
  if (gsm) return { segments: units <= 160 ? 1 : Math.ceil(units / 153), encoding: "GSM-7" };
  const len = [...text].reduce((a, c) => a + (c.codePointAt(0)! > 0xffff ? 2 : 1), 0);
  return { segments: len <= 70 ? 1 : Math.ceil(len / 67), encoding: "UCS-2" };
}
