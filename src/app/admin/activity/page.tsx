import { Badge, Card, PageHeader } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/authz/guard";
import { formatInZone } from "@/lib/timezones";
import { describeActivity } from "@/lib/activity-labels";
import { platformActivity } from "@/server/admin-audit";

export const metadata = { title: "Activity Log" };

export default async function AdminActivityPage() {
  const ctx = await requirePlatformAdmin();
  const rows = await platformActivity(ctx);
  return (
    <>
      <PageHeader title="Activity Log" subtitle="Sensitive changes across all companies (most recent 200). Times in Eastern." />
      <Card>
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="grid gap-1 py-3 text-sm md:grid-cols-[11rem_12rem_1fr_auto] md:items-center md:gap-4">
              <span className="text-xs text-muted">{formatInZone(r.createdAt, "America/New_York")}</span>
              <span className="truncate font-medium">{r.companyName ?? "Platform"}</span>
              <span>{describeActivity(r.action, r.details)}</span>
              <span className="flex items-center gap-2 text-xs text-muted">{r.actorType !== "user" && <Badge tone="purple">{r.actorType.replace("_", " ")}</Badge>}{r.actorEmail ?? "system"}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
