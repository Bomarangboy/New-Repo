import { AppShell } from "@/components/shell";
import { UserMenu } from "@/components/user-menu";
import { SimulationBanner } from "@/components/simulation-banner";
import { Badge } from "@/components/ui";
import { requirePlatformAdmin, requireSession } from "@/lib/authz/guard";

export const metadata = { title: { default: "Administrator", template: "%s · Administrator · Bluewater" } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin();
  const { user } = await requireSession();
  return (
    <AppShell
      nav={[
        { href: "/admin", label: "All Customers", icon: "building" },
        { href: "/admin/activity", label: "Activity Log", icon: "log" },
      ]}
      banner={<SimulationBanner />}
      sidebarTop={<p className="mx-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-white/80">Administrator</p>}
      topbar={<><Badge tone="purple">Platform admin</Badge><UserMenu name={user.fullName} email={user.email} isAdmin /></>}
    >
      {children}
    </AppShell>
  );
}
