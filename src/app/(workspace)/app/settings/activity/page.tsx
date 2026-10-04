import { ScrollText } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/authz/guard";
import { formatInZone } from "@/lib/timezones";
import { companyActivity } from "@/server/team";
import { describeActivity } from "@/lib/activity-labels";

export const metadata = { title: "Activity log" };

export default async function ActivityPage() {
  const ctx = await pageContext("audit.view");
  const rows = await companyActivity(ctx);
  return (
    <>
      <PageHeader title="Activity log" subtitle="Important changes in this workspace, including any Bluewater support access." />
      {rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="No activity yet" />
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-4">
                <span className="w-44 shrink-0 text-xs text-muted">{formatInZone(r.createdAt, ctx.timezone)}</span>
                <span className="flex-1 text-sm">{describeActivity(r.action, r.details)}</span>
                <span className="text-xs text-muted">
                  {r.actorType === "support" ? <Badge tone="purple">Bluewater support</Badge> : r.actorType === "platform_admin" ? <Badge tone="blue">Bluewater</Badge> : r.actorEmail ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
