import type { ReactNode } from "react";
import type { CardSize } from "@/server/studio/registry";

/**
 * Responsive grid for the Overview (Platform Studio layout). Phones: one column. Tablets: two. Wide screens:
 * six tracks, so cards can be a third, half, two-thirds or full width.
 */
export const SIZE_CLASS: Record<CardSize, string> = {
  sm: "xl:col-span-2",
  md: "xl:col-span-3",
  lg: "md:col-span-2 xl:col-span-4",
  full: "md:col-span-2 xl:col-span-6",
};

export function DashboardGrid({ items }: { items: { id: string; size: CardSize; node: ReactNode }[] }) {
  return (
    <div className="mt-6 grid grid-flow-row-dense gap-6 md:grid-cols-2 xl:grid-cols-6">
      {items.map((i) => <section key={i.id} aria-label={i.id.replaceAll("_", " ")} data-card={i.id} className={`min-w-0 ${SIZE_CLASS[i.size]}`}>{i.node}</section>)}
    </div>
  );
}

export function DashboardTiles({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 [&>div]:min-w-0">{children}</div>;
}
