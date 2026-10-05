import { and, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { adLeadSources, bookingSettings, companies, companySenders, intakeSources, libraryCopies, libraryTemplates, messagingSettings, sequenceSteps, sequences } from "@/lib/db/schema";
import { isSimulatedEnvironment } from "@/lib/env";
import { checkSteps } from "@/server/sequences/manage";
import { validateTemplate } from "@/server/messaging/templates";
import { INTEGRATIONS, MARKER, markersIn, type Integration } from "./format";

/**
 * The setup checklist for a library copy (docs/LIBRARY.md). Activation is refused — in this module, which the
 * normal sequence on/off switch also calls — until every blocking item is done. Nothing here sends or enrolls.
 */
export interface ReadyItem { key: string; label: string; status: "ok" | "todo" | "warn"; detail: string; blocking: boolean; confirm?: boolean }
export const CONFIRMATIONS = {
  business: "Our business name and the service wording in these messages are correct.",
  window: "I checked our timezone and sending hours (Automations → When and who).",
  permission: "I understand texts only go to people who gave permission, and that existing, imported or older leads are never added automatically.",
  handoff: "I understand when the follow-up stops, and who takes over afterwards.",
} as const;
export type ConfirmKey = keyof typeof CONFIRMATIONS;

const minutesLabel = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export async function copyContent(tx: Tx, copy: typeof libraryCopies.$inferSelect) {
  if (copy.kind === "sequence" && copy.sequenceId) {
    const [seq] = await tx.select().from(sequences).where(eq(sequences.id, copy.sequenceId));
    const steps = seq ? await tx.select().from(sequenceSteps).where(and(eq(sequenceSteps.sequenceId, seq.id), eq(sequenceSteps.version, seq.currentVersion))).orderBy(sequenceSteps.position) : [];
    return { seq: seq ?? null, steps, texts: steps.flatMap((s) => [s.smsBody ?? "", s.emailSubject ?? "", s.emailBody ?? ""]), channels: [...new Set(steps.flatMap((s) => (s.channel === "sms_or_email" ? ["sms", "email"] : [s.channel])))] };
  }
  const d = copy.draft as { smsBody?: string; emailSubject?: string; emailBody?: string };
  return { seq: null, steps: [], texts: [d.smsBody ?? "", d.emailSubject ?? "", d.emailBody ?? ""], channels: [...(d.smsBody ? ["sms"] : []), ...(d.emailBody ? ["email"] : [])] };
}

export async function readiness(tx: Tx, companyId: string, copy: typeof libraryCopies.$inferSelect): Promise<ReadyItem[]> {
  const items: ReadyItem[] = [];
  const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
  const [tpl] = await tx.select().from(libraryTemplates).where(eq(libraryTemplates.id, copy.templateId));
  const content = await copyContent(tx, copy);
  const setup = copy.setup as Partial<Record<ConfirmKey, boolean>>;

  if (tpl?.status === "paused") items.push({ key: "template_paused", label: "Template paused by Bluewater", status: "todo", blocking: true, detail: `Bluewater paused this template for review${tpl.statusReason ? `: ${tpl.statusReason}` : ""}. It can't be turned on until the review is finished.` });

  const left = markersIn(content.texts);
  items.push({ key: "personalize", label: "Fill in the personalized parts", status: left.length ? "todo" : "ok", blocking: true,
    detail: left.length ? `Replace these placeholders with your own words: ${left.map((m) => `[[${m}]]`).join(", ")}.` : "No placeholders left." });

  let wording: string[] = [];
  if (copy.kind === "sequence") wording = checkSteps(content.steps.map((s) => ({ delayMinutes: s.delayMinutes, channel: s.channel as "sms" | "email" | "sms_or_email", smsBody: s.smsBody, emailSubject: s.emailSubject, emailBody: s.emailBody })).map((s) => ({ ...s, smsBody: s.smsBody?.replace(MARKER, "x"), emailBody: s.emailBody?.replace(MARKER, "x"), emailSubject: s.emailSubject?.replace(MARKER, "x") })));
  else {
    const d = copy.draft as { smsBody?: string; emailSubject?: string; emailBody?: string };
    if (!d.smsBody && !d.emailBody) wording.push("Add a text message or an email.");
    if (d.smsBody) wording.push(...validateTemplate("ack_sms", d.smsBody).errors);
    if (d.emailBody) wording.push(...validateTemplate("ack_email", d.emailBody, d.emailSubject).errors);
  }
  items.push({ key: "wording", label: "Messages pass the wording checks", status: wording.length ? "todo" : "ok", blocking: true, detail: wording.length ? wording.join(" ") : "Opt-out wording, fields and length are fine." });

  items.push({ key: "business", label: "Business name and service", status: setup.business ? "ok" : "todo", blocking: true, confirm: true,
    detail: `Messages use your business name “${company?.name ?? ""}” ({{company_name}}) and the service each lead asked about ({{service}}). ${CONFIRMATIONS.business}` });

  // Sender identity: who the messages come from.
  const senders = await tx.select().from(companySenders).where(eq(companySenders.companyId, companyId));
  const live = !isSimulatedEnvironment() && company?.kind === "customer";
  for (const ch of content.channels) {
    const s = senders.find((x) => x.channel === ch);
    const name = ch === "sms" ? "Texting number" : "Email sender";
    if (!live) items.push({ key: `sender_${ch}`, label: `${name}`, status: "ok", blocking: false, detail: "Simulated in this environment — nothing is actually sent." });
    else items.push({ key: `sender_${ch}`, label: `${name}`, status: s?.status === "verified" ? "ok" : "todo", blocking: true, detail: s?.status === "verified" ? "Verified by Bluewater." : "Bluewater must set up and verify this sender before real messages can go out. Contact Bluewater." });
  }

  // Booking link and other required connections.
  const usesLink = content.texts.some((t) => /\{\{\s*booking_link/.test(t));
  const linkNoFallback = content.texts.some((t) => /\{\{\s*booking_link\s*\}\}/.test(t));
  const required = new Set<Integration>([...((tpl?.requiredIntegrations ?? []) as Integration[]), ...(linkNoFallback ? ["booking" as Integration] : [])]);
  const [booking] = await tx.select().from(bookingSettings).where(eq(bookingSettings.companyId, companyId));
  const hasBooking = Boolean(booking?.bookingUrl);
  if (usesLink && !required.has("booking")) items.push({ key: "booking", label: "Booking link", status: hasBooking ? "ok" : "warn", blocking: false, detail: hasBooking ? "Your booking page is set." : "No booking page set — the messages will use their fallback wording instead of a link." });
  for (const need of required) {
    let ok = false;
    if (need === "booking") ok = hasBooking;
    if (need === "website_form") ok = (await tx.select({ id: intakeSources.id }).from(intakeSources).where(and(eq(intakeSources.companyId, companyId), eq(intakeSources.active, true)))).length > 0;
    if (need === "meta_lead_forms" || need === "google_lead_forms") {
      const kind = need === "meta_lead_forms" ? "meta_page" : "google_webhook";
      ok = (await tx.select({ id: adLeadSources.id }).from(adLeadSources).where(and(eq(adLeadSources.companyId, companyId), eq(adLeadSources.kind, kind), eq(adLeadSources.active, true)))).length > 0;
    }
    items.push({ key: `integration_${need}`, label: INTEGRATIONS[need], status: ok ? "ok" : "todo", blocking: true, detail: ok ? "Connected." : "Set this up under Connected Accounts first." });
  }

  const [ms] = await tx.select().from(messagingSettings).where(eq(messagingSettings.companyId, companyId));
  const win = ms ? `${minutesLabel(ms.windowStartMinute)}–${minutesLabel(ms.windowEndMinute)} on ${(ms.windowDays as number[]).map((d) => DAYS[d]).join(", ")}` : "the default hours (8:00–21:00, every day)";
  items.push({ key: "window", label: "Timezone and sending hours", status: setup.window ? "ok" : "todo", blocking: true, confirm: true, detail: `Messages go out ${win}, ${company?.timezone ?? ""} time. ${CONFIRMATIONS.window}` });
  items.push({ key: "permission", label: "Contact permission", status: setup.permission ? "ok" : "todo", blocking: true, confirm: true, detail: CONFIRMATIONS.permission });
  if (copy.kind === "sequence") {
    const seq = content.seq;
    items.push({ key: "handoff", label: "Stop rules and hand-off", status: setup.handoff ? "ok" : "todo", blocking: true, confirm: true,
      detail: `Stops automatically when the person replies, books, opts out, the lead is closed${seq?.stopOnManualMessage ? ", or a team member messages them" : ""}. ${seq?.handoffTask ? "When it finishes without a reply, a call-back task goes to the assigned person." : "No call-back task is created when it finishes."} ${CONFIRMATIONS.handoff}` });
  }
  return items;
}

export const blockers = (items: ReadyItem[]) => items.filter((i) => i.blocking && i.status !== "ok");

/** Called by the normal sequence on/off switch: a sequence copied from the library can't be turned on with setup incomplete. */
export async function libraryActivationGate(tx: Tx, companyId: string, sequenceId: string): Promise<string | null> {
  const [copy] = await tx.select().from(libraryCopies).where(and(eq(libraryCopies.companyId, companyId), eq(libraryCopies.sequenceId, sequenceId)));
  if (!copy) return null;
  const b = blockers(await readiness(tx, companyId, copy));
  return b.length ? `Finish the setup checklist first (Sequence Library → your copy): ${b.map((x) => x.label).join(", ")}.` : null;
}
