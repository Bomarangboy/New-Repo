import type { LucideIcon } from "lucide-react";
import { Badge, EmptyState, PageHeader } from "./ui";

/** Honest placeholder for areas that are not built yet. Never shows sample numbers. */
export function ComingSoon({ title, subtitle, icon, what }: { title: string; subtitle: string; icon: LucideIcon; what: string }) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <EmptyState icon={icon} title={`${title} is being set up`} action={<Badge tone="blue">Coming soon</Badge>}>
        {what}
      </EmptyState>
    </>
  );
}
