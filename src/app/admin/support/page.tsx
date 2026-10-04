import Link from "next/link";
import { Inbox } from "lucide-react";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/authz/guard";
import { CATEGORIES, listTicketsAdmin } from "@/server/support";

export const metadata = { title: "Support" };
export const dynamic = "force-dynamic";

const TONES: Record<string, "blue" | "amber" | "green" | "neutral"> = { open: "blue", waiting_on_customer: "amber", resolved: "green", closed: "neutral" };
const ADMIN_LABELS: Record<string, string> = { open: "Needs Bluewater", waiting_on_customer: "Waiting on client", resolved: "Resolved", closed: "Closed" };
const when = (d: Date) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(d) + " ET";

export default async function SupportInbox({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const ctx = await requirePlatformAdmin();
  const show = (await searchParams).show === "all" ? "all" : "active";
  const rows = await listTicketsAdmin(ctx, show);
  return (
    <>
      <PageHeader title="Support" subtitle="Client requests. Urgent open requests are listed first. Support hours: 7am–1am Eastern."
        actions={<nav className="flex rounded-xl border border-line bg-white p-1" aria-label="Filter">{(["active", "all"] as const).map((s) => (
          <Link key={s} href={`/admin/support?show=${s}`} aria-current={s === show ? "true" : undefined} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${s === show ? "bg-navy-900 text-white" : "text-muted hover:text-ink"}`}>{s === "active" ? "Active" : "All"}</Link>))}</nav>} />
      {rows.length === 0 ? <EmptyState icon={Inbox} title={show === "active" ? "No active requests" : "No requests yet"}>New client requests appear here and are emailed to every administrator.</EmptyState> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-muted"><tr><th className="px-4 py-3 font-medium">Request</th><th className="px-4 py-3 font-medium">Company</th><th className="px-4 py-3 font-medium">Type</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Last activity</th><th className="px-4 py-3 font-medium">Handled by</th></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ t, company, assignee }) => (
                <tr key={t.id}>
                  <td className="px-4 py-3"><Link href={`/admin/support/${t.id}`} className="font-medium hover:text-brand-600">{t.reference}: {t.subject}</Link></td>
                  <td className="px-4 py-3">{company}</td>
                  <td className="px-4 py-3">{t.category === "urgent" ? <Badge tone="red">Urgent</Badge> : CATEGORIES[t.category as keyof typeof CATEGORIES] ?? t.category}</td>
                  <td className="px-4 py-3"><Badge tone={TONES[t.status]}>{ADMIN_LABELS[t.status] ?? t.status}</Badge></td>
                  <td className="px-4 py-3 text-muted">{when(t.lastActivityAt)}</td>
                  <td className="px-4 py-3 text-muted">{assignee ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
