import { notFound } from "next/navigation";
import { desc } from "drizzle-orm";
import { Wordmark } from "@/components/brand";
import { env } from "@/lib/env";
import { withSystemDb } from "@/lib/db/context";
import { devOutbox } from "@/lib/db/schema";

export const metadata = { title: "Development mailbox" };
export const dynamic = "force-dynamic";

/** Shows system emails captured instead of being sent. Exists ONLY in development and test. */
export default async function DevMailbox() {
  const e = env().APP_ENV;
  if (e !== "development" && e !== "test") notFound();
  const mails = await withSystemDb("dev mailbox", (tx) => tx.select().from(devOutbox).orderBy(desc(devOutbox.createdAt)).limit(50));
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Wordmark size="sm" />
      <h1 className="mt-6 text-2xl font-bold">Development mailbox</h1>
      <p className="mt-1 text-sm text-muted">Emails the app would have sent. Nothing here left this computer.</p>
      <ul className="mt-6 space-y-4">
        {mails.length === 0 && <li className="card p-6 text-sm text-muted">No emails yet.</li>}
        {mails.map((m) => (
          <li key={m.id} className="card p-5" data-testid="dev-mail">
            <p className="text-xs text-muted">{m.createdAt.toISOString()} · to <b data-testid="dev-mail-to">{m.toAddress}</b></p>
            <p className="mt-1 font-semibold">{m.subject}</p>
            <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm" data-testid="dev-mail-body">{m.textBody}</pre>
          </li>
        ))}
      </ul>
    </main>
  );
}
