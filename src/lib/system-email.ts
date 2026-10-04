import { env } from "@/lib/env";
import { withSystemDb } from "@/lib/db/context";
import { devOutbox } from "@/lib/db/schema";

/**
 * Bluewater's OWN service emails (invitations, password resets, service notices).
 * These are deliberately separate from messages sent on behalf of client
 * businesses, which go through the messaging layer with per-company senders.
 *
 * dev-outbox – stored in the database and shown at /dev/mailbox. Nothing leaves the server.
 * postmark   – Postmark transactional stream. Only configured on staging/production after
 *              the owner approves the account and verifies the sending domain.
 */
export interface SystemEmail {
  to: string;
  subject: string;
  text: string;
}

export async function sendSystemEmail(msg: SystemEmail): Promise<void> {
  const e = env();
  if (e.SYSTEM_EMAIL_TRANSPORT === "dev-outbox" || e.APP_ENV === "demo") {
    await withSystemDb("system email: dev outbox", (tx) =>
      tx.insert(devOutbox).values({ toAddress: msg.to, subject: msg.subject, textBody: msg.text }),
    );
    return;
  }
  if (!e.POSTMARK_SERVER_TOKEN) throw new Error("POSTMARK_SERVER_TOKEN is not configured");
  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": e.POSTMARK_SERVER_TOKEN,
    },
    body: JSON.stringify({
      From: e.SYSTEM_EMAIL_FROM,
      To: msg.to,
      Subject: msg.subject,
      TextBody: msg.text,
      MessageStream: "outbound",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // Never include the token or full message in logs.
    throw new Error(`System email provider rejected the message (HTTP ${res.status})`);
  }
}
