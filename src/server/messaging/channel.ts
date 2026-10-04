import { and, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { companySenders, contacts } from "@/lib/db/schema";
import { env, isSimulatedEnvironment } from "@/lib/env";
import type { CompanyKind } from "@/lib/authz/account-policy";
import { activeSuppression, latestConsent } from "./eligibility";
import { transportDecision } from "./transport";

type Contact = typeof contacts.$inferSelect;
export type ChannelPreference = "sms" | "email" | "sms_or_email";

/**
 * Picks how an AUTOMATIC message may reach someone: a text only with recorded text permission and no
 * opt-out; an email only if they haven't unsubscribed. Returns plain-language reasons when neither works.
 */
export async function pickChannel(tx: Tx, companyId: string, c: Contact, pref: ChannelPreference):
  Promise<{ channel: "sms" | "email"; to: string } | { channel: null; reasons: string[] }> {
  const reasons: string[] = [];
  if (pref !== "email") {
    if (!c.phoneE164) reasons.push("no phone number");
    else if (await activeSuppression(tx, companyId, "sms", c.phoneE164)) reasons.push("their number opted out of texts");
    else if ((await latestConsent(tx, companyId, c.id, "sms")) !== true) reasons.push("no text permission recorded");
    else return { channel: "sms", to: c.phoneE164 };
  }
  if (pref !== "sms") {
    if (!c.emailNormalized || !c.email) reasons.push("no email address");
    else if (await activeSuppression(tx, companyId, "email", c.emailNormalized)) reasons.push("their email is unsubscribed");
    else return { channel: "email", to: c.email };
  }
  return { channel: null, reasons };
}

/**
 * Which transport a message would use (D-23), or why it can't go: a real customer in production never
 * gets a simulated message recorded as if it reached them.
 */
export async function transportFor(tx: Tx, companyId: string, companyKind: CompanyKind, channel: "sms" | "email"):
  Promise<{ transport: string } | { blocked: string }> {
  const [sender] = await tx.select({ status: companySenders.status }).from(companySenders).where(and(eq(companySenders.companyId, companyId), eq(companySenders.channel, channel)));
  const transport = transportDecision({ simulatedEnvironment: isSimulatedEnvironment(), companyKind, senderStatus: sender?.status, channel });
  if (transport === "simulated" && companyKind === "customer" && env().APP_ENV === "production") {
    return { blocked: isSimulatedEnvironment() ? "live sending hasn't been switched on yet" : `the ${channel === "sms" ? "text" : "email"} sender isn't verified yet` };
  }
  return { transport };
}
