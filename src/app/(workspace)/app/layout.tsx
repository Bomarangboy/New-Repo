import { Building2, ChevronDown, Eye } from "lucide-react";
import { AppShell } from "@/components/shell";
import { UserMenu } from "@/components/user-menu";
import { SimulationBanner } from "@/components/simulation-banner";
import { Badge } from "@/components/ui";
import { pageContext, requireSession } from "@/lib/authz/guard";
import { listUserCompanies } from "@/lib/authz/resolve";
import { PACKAGE_LABELS } from "@/lib/authz/entitlements";
import { visibleNav } from "@/lib/nav";
import { switchCompanyAction } from "./actions";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const ctx = await pageContext("workspace.view");
  const { user } = await requireSession();
  const companies = await listUserCompanies(user.id);
  const nav = visibleNav(ctx.role, ctx.package).map(({ href, label, icon }) => ({ href, label, icon }));

  const switcher = (
    <details className="group relative mx-1">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm font-medium text-white hover:bg-white/10 [&::-webkit-details-marker]:hidden">
        <Building2 className="size-5 shrink-0" />
        <span className="truncate">{ctx.companyName}</span>
        {companies.length > 1 && <ChevronDown className="ml-auto size-4 shrink-0 transition group-open:rotate-180" />}
      </summary>
      {companies.length > 1 && (
        <div className="absolute inset-x-0 z-50 mt-2 rounded-xl border border-line bg-white p-1 shadow-xl">
          {companies.map((c) => (
            <form key={c.id} action={switchCompanyAction}>
              <input type="hidden" name="companyId" value={c.id} />
              <button className={`w-full truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-canvas ${c.id === ctx.companyId ? "font-semibold text-brand-600" : "text-ink"}`}>{c.name}</button>
            </form>
          ))}
        </div>
      )}
    </details>
  );

  const banner = (
    <>
      <SimulationBanner />
      {ctx.supportGrantId && (
        <div className="flex items-center justify-center gap-2 bg-violet-700 px-4 py-1.5 text-xs font-semibold text-white">
          <Eye className="size-3.5" /> Bluewater support session ({ctx.role === "support_read" ? "view only" : "can edit"}) — recorded in this company&apos;s activity log.
        </div>
      )}
      {ctx.policy.login === "read_only" && !ctx.supportGrantId && (
        <div className="bg-amber-100 px-4 py-1.5 text-center text-xs font-semibold text-amber-900">
          This account is read-only. You can still view and export your records. Contact Bluewater with any questions.
        </div>
      )}
    </>
  );

  return (
    <AppShell
      nav={nav}
      banner={banner}
      sidebarTop={switcher}
      topbar={
        <>
          <span className="hidden sm:inline"><Badge tone="blue">{PACKAGE_LABELS[ctx.package].split(" — ")[1]}</Badge></span>
          <UserMenu name={user.fullName} email={user.email} isAdmin={user.isPlatformAdmin} />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
