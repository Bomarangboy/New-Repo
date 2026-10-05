import { Mail, MessageSquare } from "lucide-react";

/**
 * Shows every message and wait in a library template or copy. [[Placeholders]] that the business must
 * replace are highlighted; {{fields}} are filled in per lead.
 */
export interface StepView { delayMinutes: number; channel: string; smsBody?: string | null; emailSubject?: string | null; emailBody?: string | null }

function Highlight({ text }: { text: string }) {
  const parts = text.split(/(\[\[[^\]\n]{1,60}\]\]|\{\{[^}]+\}\})/g);
  return <>{parts.map((p, i) => p.startsWith("[[") ? <mark key={i} className="rounded bg-amber-100 px-0.5 text-amber-900">{p}</mark> : p.startsWith("{{") ? <span key={i} className="rounded bg-brand-50 px-0.5 text-brand-700">{p}</span> : p)}</>;
}

const wait = (m: number) => (m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? "" : "s"}` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? "" : "s"}` : `${m} minutes`);
const CH: Record<string, string> = { sms: "Text only", email: "Email only", sms_or_email: "Text if they gave permission, otherwise email" };

export function StepList({ steps, kind }: { steps: StepView[]; kind: "sequence" | "acknowledgment" }) {
  const totals = steps.map((_, i) => steps.slice(0, i + 1).reduce((a, x) => a + x.delayMinutes, 0));
  return (
    <ol className="space-y-4">
      {steps.map((s, i) => {
        const total = totals[i]!;
        return (
          <li key={i} className="rounded-2xl border border-line p-4">
            <p className="mb-2 text-sm font-semibold">
              {kind === "acknowledgment" ? "Sent right after a new lead arrives (within your sending hours)" : `Step ${i + 1} · ${wait(s.delayMinutes)} after ${i === 0 ? "they're added" : "the previous step"} (≈ day ${Math.ceil(total / 1440)})`}
              {kind === "sequence" && <span className="ml-2 text-xs font-normal text-muted">{CH[s.channel] ?? s.channel}</span>}
            </p>
            {s.smsBody && <div className="mb-2 flex gap-2 text-sm"><MessageSquare className="mt-0.5 size-4 shrink-0 text-muted" aria-label="Text message" /><p className="whitespace-pre-wrap"><Highlight text={s.smsBody} /></p></div>}
            {s.emailBody && (
              <div className="flex gap-2 text-sm"><Mail className="mt-0.5 size-4 shrink-0 text-muted" aria-label="Email" />
                <div><p className="font-medium"><Highlight text={s.emailSubject ?? ""} /></p><p className="whitespace-pre-wrap text-muted"><Highlight text={s.emailBody} /></p></div>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export const STANDARD_STOP_RULES = [
  "They reply (text or email)",
  "They book an appointment",
  "They opt out (STOP or unsubscribe)",
  "The lead is marked Won or Lost",
  "Your business's automatic messages are paused, or the account isn't active",
  "Optional: a team member messages them by hand",
];
