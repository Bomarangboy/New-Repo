import Link from "next/link";
import { AlertTriangle, CheckCircle2, Circle, Inbox, MailCheck, MailX, MessageSquareReply, MinusCircle } from "lucide-react";
import { Badge, Card, PageHeader, StatCard } from "@/components/ui";
import { pageContext } from "@/lib/authz/guard";
import { onboardingChecklist, type StepStatus } from "@/server/onboarding";

export const metadata = { title: "Overview" };

const STATUS: Record<StepStatus, { label: string; tone: "green" | "neutral" | "amber" | "blue"; icon: typeof Circle }> = {
  ready: { label: "Ready", tone: "green", icon: CheckCircle2 },
  pending: { label: "Pending", tone: "blue", icon: Circle },
  attention: { label: "Needs attention", tone: "amber", icon: AlertTriangle },
  na: { label: "Not applicable", tone: "neutral", icon: MinusCircle },
};

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const ctx = await pageContext("workspace.view");
  const { welcome } = await searchParams;
  const steps = await onboardingChecklist(ctx);
  const done = steps.filter((s) => s.status === "ready" || s.status === "na").length;
  const note = "Appears once lead capture is connected";

  return (
    <>
      <PageHeader title="Overview" subtitle="Your leads, follow-up and advertising in one place." />
      {welcome && <p className="mb-6 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Welcome to {ctx.companyName}! You&apos;re all set up.</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Inbox} label="New inquiries" value={null} note={note} />
        <StatCard icon={MailCheck} label="Acknowledgments sent" value={null} note={note} tone="green" />
        <StatCard icon={MailX} label="Failed acknowledgments" value={null} note={note} tone="amber" />
        <StatCard icon={MessageSquareReply} label="Unread replies" value={null} note={note} tone="purple" />
      </div>

      <Card className="mt-6" title="Getting started" actions={<Badge tone="blue">{done} of {steps.length} complete</Badge>}>
        <div className="mb-4 h-2 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuenow={done} aria-valuemax={steps.length} aria-label="Setup progress">
          <div className="h-full rounded-full bg-brand-500" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        <ul className="divide-y divide-line">
          {steps.map((s) => {
            const st = STATUS[s.status];
            const Icon = st.icon;
            return (
              <li key={s.key} className="flex items-start gap-3 py-3">
                <Icon className={`mt-0.5 size-5 shrink-0 ${s.status === "ready" ? "text-emerald-600" : s.status === "attention" ? "text-amber-600" : "text-slate-400"}`} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{s.title}</p>
                  <p className="text-sm text-muted">{s.detail}{s.owner === "bluewater" && s.status === "pending" ? " · Bluewater handles this step" : ""}</p>
                </div>
                <Badge tone={st.tone}>{st.label}</Badge>
              </li>
            );
          })}
        </ul>
        {steps.find((s) => s.key === "crm")?.status === "attention" && ctx.role === "owner" && (
          <p className="mt-4"><Link href="/app/settings#crm" className="btn-primary">Choose your CRM</Link></p>
        )}
      </Card>
    </>
  );
}
