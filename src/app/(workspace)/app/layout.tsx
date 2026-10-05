import { Building2, ChevronDown, Eye } from "lucide-react";
import { AppShell } from "@/components/shell";
import { UserMenu } from "@/components/user-menu";
import { SimulationBanner } from "@/components/simulation-banner";
import { Badge } from "@/components/ui";
import { pageContext, requireSession } from "@/lib/authz/guard";
import { listUserCompanies } from "@/lib/authz/resolve";
import { studioForCompany } from "@/server/studio/runtime";
import type { IconName } from "@/components/shell";
import { switchCompanyAction } from "./actions";
import { roleCan } from "@/lib/authz/permissions";
import { needsReplyCount } from "@/server/messaging/inbox";
import { isAutomationPaused } from "@/server/messaging/settings";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const ctx = await pageContext("workspace.view");
  const { user } = await requireSession();
  const companies = await listUserCompanies(user.id);
  const automationPaused = await isAutomationPaused(ctx);
  const waiting = roleCan(ctx.role, "conversation.view") ? await needsReplyCount(ctx) : 0;
  const ui = await studioForCompany(ctx);
  // Menu order/labels come from Platform Studio; which items exist still depends on role and package (every page re-checks on the server).
  const nav = ui.nav(ctx.role, ctx.package).map(({ href, label, icon }) => ({ href, label, icon: icon as IconName, badge: href === "/app/conversations" ? waiting : undefined }));

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
      {automationPaused && (
        <div className="bg-red-600 px-4 py-1.5 text-center text-xs font-semibold text-white">All automatic messages are stopped for this business. Turn them back on under Automations.</div>
      )}
      {ctx.policy.login === "read_only" && !ctx.supportGrantId && (
        <div className="bg-amber-100 px-4 py-1.5 text-center text-xs font-semibold text-amber-900">
          This account is read-only. You can still view and export your records. Contact Bluewater with any questions.
        </div>
      )}
    </>
  );

  return (
    <>
    {/* Package/company-level Studio colors (validated values only). */}
    <style dangerouslySetInnerHTML={{ __html: ui.css(":root") }} />
    <AppShell
      brand={ui.brand}
      nav={nav}
      banner={banner}
      sidebarTop={switcher}
      topbar={
        <>
          <span className="hidden sm:inline"><Badge tone="blue">{ui.packageName(ctx.package)}</Badge></span>
          <UserMenu name={user.fullName} email={user.email} isAdmin={user.isPlatformAdmin} />
        </>
      }
    >
      {children}
    </AppShell>
    </>
  );
}
