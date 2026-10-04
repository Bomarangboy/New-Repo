/**
 * Message templates with validated personalization fields.
 * Syntax: {{first_name}} or {{service|your project}} (text after "|" is used when the value is empty).
 */
export const TEMPLATE_FIELDS = {
  first_name: "The lead's first name",
  full_name: "The lead's full name",
  company_name: "Your business name",
  service: "The service they asked about",
  booking_link: "A link to your booking page, personalized for this lead (blank if no booking page is set up)",
  appointment_time: "The appointment's day and time, in your business's timezone",
} as const;
export type TemplateField = keyof typeof TEMPLATE_FIELDS;

/** Stored, versioned templates (message_templates) — one per key per company. */
export type TemplateKey =
  | "ack_sms" | "ack_email"
  | "booking_confirm_sms" | "booking_confirm_email"
  | "booking_reminder_sms" | "booking_reminder_email";
/** Anything that can be validated: stored templates plus follow-up step texts (stored on the step). */
export type ValidationKey = TemplateKey | "followup_sms" | "followup_email";

export const STORED_TEMPLATE_KEYS: TemplateKey[] = ["ack_sms", "ack_email", "booking_confirm_sms", "booking_confirm_email", "booking_reminder_sms", "booking_reminder_email"];

export const isSmsKey = (k: ValidationKey) => k.endsWith("_sms");
const isBookingKey = (k: ValidationKey) => k.startsWith("booking_");

/** Which fields each kind of message may use (an appointment time only exists for booking messages). */
export function fieldsFor(k: ValidationKey): TemplateField[] {
  const base: TemplateField[] = ["first_name", "full_name", "company_name", "service", "booking_link"];
  return isBookingKey(k) ? [...base, "appointment_time"] : base;
}

export const DEFAULT_TEMPLATES: Record<TemplateKey, { subject: string | null; body: string }> = {
  ack_sms: {
    subject: null,
    body: "Hi {{first_name|there}}, thanks for contacting {{company_name}}! We received your request about {{service|your project}} and will be in touch shortly. Reply STOP to opt out.",
  },
  ack_email: {
    subject: "We received your request — {{company_name}}",
    body: "Hi {{first_name|there}},\n\nThanks for contacting {{company_name}}. We received your request about {{service|your project}} and a member of our team will get back to you shortly.\n\nIf you need anything in the meantime, just reply to this email.\n\n{{company_name}}",
  },
  booking_confirm_sms: {
    subject: null,
    body: "{{company_name}}: you're booked for {{appointment_time}}. Need to change it? Reply here. Reply STOP to opt out.",
  },
  booking_confirm_email: {
    subject: "Your appointment with {{company_name}} — {{appointment_time}}",
    body: "Hi {{first_name|there}},\n\nYou're booked with {{company_name}} for {{appointment_time}}.\n\nIf you need to change it, just reply to this email.\n\n{{company_name}}",
  },
  booking_reminder_sms: {
    subject: null,
    body: "Reminder from {{company_name}}: your appointment is {{appointment_time}}. Reply here if you need to change it. Reply STOP to opt out.",
  },
  booking_reminder_email: {
    subject: "Reminder: your appointment with {{company_name}}",
    body: "Hi {{first_name|there}},\n\nA reminder that your appointment with {{company_name}} is {{appointment_time}}.\n\nIf you need to change it, just reply to this email.\n\n{{company_name}}",
  },
};

/** Starting point for a new follow-up sequence (owners edit before turning it on). */
export const DEFAULT_SEQUENCE_STEPS = [
  {
    delayMinutes: 24 * 60, channel: "sms_or_email" as const,
    smsBody: "Hi {{first_name|there}}, it's {{company_name}} following up on your {{service|request}}. Want to pick a time? {{booking_link|Just reply here.}} Reply STOP to opt out.",
    emailSubject: "Following up on your {{service|request}}",
    emailBody: "Hi {{first_name|there}},\n\nJust following up on your request about {{service|your project}}. You can pick a time that suits you here: {{booking_link|reply to this email and we'll find a time}}\n\n{{company_name}}",
  },
  {
    delayMinutes: 2 * 24 * 60, channel: "sms_or_email" as const,
    smsBody: "Hi {{first_name|there}}, {{company_name}} here. Still interested in help with {{service|your project}}? {{booking_link|Reply and we'll set a time.}} Reply STOP to opt out.",
    emailSubject: "Still interested? — {{company_name}}",
    emailBody: "Hi {{first_name|there}},\n\nWe'd still love to help with {{service|your project}}. Book a time here: {{booking_link|just reply to this email}}\n\n{{company_name}}",
  },
  {
    delayMinutes: 4 * 24 * 60, channel: "sms_or_email" as const,
    smsBody: "Hi {{first_name|there}}, last note from {{company_name}} — if you'd still like help with {{service|your project}}, just reply and we'll take it from there. Reply STOP to opt out.",
    emailSubject: "Last note from {{company_name}}",
    emailBody: "Hi {{first_name|there}},\n\nThis is our last follow-up about {{service|your project}}. If you'd still like help, reply to this email or book a time: {{booking_link|just reply and we'll find a time}}\n\n{{company_name}}",
  },
];

const TOKEN = /\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/g;

export interface TemplateCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  segments?: number;
  encoding?: "GSM-7" | "UCS-2";
}

/** Long-but-realistic values, so length checks reflect the worst common case. */
export const SAMPLE_VARS: Record<TemplateField, string> = {
  first_name: "Alexandria", full_name: "Alexandria Montgomery", company_name: "Your Business Name", service: "Water heater replacement",
  booking_link: "https://cal.com/your-business/estimate?metadata[bw]=AbCdEfGhIjKlMnOpQrStUv", appointment_time: "Wed, Sep 30 at 12:30 PM EDT",
};

export function validateTemplate(key: ValidationKey, body: string, subject?: string | null): TemplateCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const allowed = fieldsFor(key);
  const text = `${subject ?? ""}\n${body}`;
  for (const m of text.matchAll(TOKEN)) {
    const f = m[1]!;
    if (!(f in TEMPLATE_FIELDS)) errors.push(`"{{${f}}}" isn't a field Bluewater knows. Use: ${allowed.map((x) => `{{${x}}}`).join(", ")}.`);
    else if (!allowed.includes(f as TemplateField)) errors.push(`"{{${f}}}" only works in appointment confirmations and reminders.`);
    else if (f === "booking_link" && m[2] === undefined) warnings.push("If no booking page is connected, {{booking_link}} will be blank. Add a fallback, e.g. {{booking_link|just reply to this message}}.");
  }
  const stray = text.replace(TOKEN, "");
  if (/\{\{|\}\}/.test(stray)) errors.push("There's an unfinished {{ }} field. Check the curly braces.");
  if (!body.trim()) errors.push("The message can't be empty.");
  if (!isSmsKey(key) && !subject?.trim()) errors.push("The email needs a subject line.");
  let segments: number | undefined, encoding: TemplateCheck["encoding"];
  if (isSmsKey(key)) {
    if (!/\bSTOP\b/.test(body)) errors.push('Text messages must tell people how to opt out — include "Reply STOP to opt out."');
    ({ segments, encoding } = smsSegments(renderTemplate(body, SAMPLE_VARS)));
    if (segments > 3) errors.push(`This text is too long (${segments} segments with a long name filled in). Keep it to 3 segments or fewer.`);
    else if (segments > 1) warnings.push(`With a long name or service filled in, this text can grow to ${segments} parts (${encoding}); each part is billed.`);
    if (!/\{\{\s*company_name/.test(body)) warnings.push("Carriers expect the business name in every automated text. Consider including {{company_name}}.");
  }
  if (body.length > 5000) errors.push("The message is too long.");
  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)], segments, encoding };
}

export function renderTemplate(body: string, vars: Partial<Record<TemplateField, string | null | undefined>>): string {
  return body.replace(TOKEN, (_, name: string, fallback?: string) => {
    const v = vars[name as TemplateField];
    return v && v.trim() ? v.trim() : (fallback ?? "").trim();
  });
}

export function varsFor(
  contact: { fullName: string }, companyName: string, service: string | null,
  extra: { bookingLink?: string | null; appointmentTime?: string | null } = {},
): Record<TemplateField, string> {
  const full = contact.fullName.trim();
  return {
    first_name: full.split(/\s+/)[0] ?? "", full_name: full, company_name: companyName, service: service ?? "",
    booking_link: extra.bookingLink ?? "", appointment_time: extra.appointmentTime ?? "",
  };
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
