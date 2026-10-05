import { Inbox, MailCheck, MailX, MessageSquareReply, DollarSign, Trophy, UserX } from "lucide-react";
import { AppShell, type IconName } from "@/components/shell";
import { Wordmark } from "@/components/brand";
import { Badge, Card, PageHeader, StatCard } from "@/components/ui";
import { DashboardGrid, DashboardTiles } from "@/components/dashboard-grid";
import { requirePlatformAdmin } from "@/lib/authz/guard";
import { PACKAGES, hasFeature, type Feature, type PackageTier } from "@/lib/authz/entitlements";
import { previewLayers } from "@/server/studio/service";
import { previewUi } from "@/server/studio/runtime";
import { DASHBOARD_CARDS, METRIC_TILES, type MetricTile } from "@/server/studio/registry";

export const metadata = { title: "Studio preview" };
export const dynamic = "force-dynamic";

/**
 * Platform Studio preview (framed by the editor). Shows the DRAFT of one scope on top of published values,
 * as a chosen role and package would see it — with SAMPLE numbers. It reads only Studio settings: no leads,
 * messages, enrollments or billing are read or changed, and nothing can be sent from here.
 */
const SAMPLE: Record<MetricTile, string> = { new_inquiries: "42", acks_sent: "39", acks_failed: "1", needs_reply: "3", unassigned_open: "5", won_count: "8", recorded_sales: "$12,400" };
const ICON = { new_inquiries: Inbox, acks_sent: MailCheck, acks_failed: MailX, needs_reply: MessageSquareReply, unassigned_open: UserX, won_count: Trophy, recorded_sales: DollarSign } as const;

export default async function StudioPreview({ searchParams }: { searchParams: Promise<{ scope?: string; role?: string; package?: string; company?: string; page?: string }> }) {
  const ctx = await requirePlatformAdmin();
  const sp = await searchParams;
  const requested = PACKAGES.includes(sp.package as PackageTier) ? (sp.package as PackageTier) : null;
  const { layers, packageTier, companyName } = await previewLayers(ctx, sp.scope ?? "platform", { packageTier: requested, companyId: sp.company ?? null });
  const ui = previewUi(layers);
  const role = sp.role === "employee" ? "employee" : "owner";
  const style = <style dangerouslySetInnerHTML={{ __html: ui.css(":root") }} />;

  if (sp.page === "login") {
    return (
      <div className="flex min-h-dvh flex-col">
        {style}
        <p className="bg-amber-300 px-4 py-1.5 text-center text-xs font-semibold text-amber-950">Preview of the draft — sign-in page</p>
        <div className="grid flex-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <aside className="hidden bg-navy-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
            <Wordmark onDark size="lg" brand={ui.brand} />
            <div className="max-w-md"><p className="text-3xl font-bold leading-tight">{ui.t("login.headline")}</p><p className="mt-4 text-white/70">{ui.t("login.tagline")}</p></div>
            <p className="text-sm text-white/50">© {ui.brand.name}</p>
          </aside>
          <main className="flex items-center justify-center px-4 py-10">
            <div className="w-full max-w-md">
              <div className="mb-8 flex justify-center lg:hidden"><Wordmark size="lg" brand={ui.brand} /></div>
              <h1 className="text-2xl font-bold">{ui.t("login.title")}</h1>
              <p className="mt-1 text-sm text-muted">{ui.t("login.subtitle")}</p>
              <div className="mt-6 space-y-4"><div className="input text-muted">Email address</div><div className="input text-muted">Password</div><div className="btn-primary w-full">Sign in</div></div>
              <p className="mt-8 text-center text-xs text-muted">{ui.t("login.footer")}</p>
            </div>
          </main>
        </div>
      </div>
    );
  }

  const nav = ui.nav(role, packageTier).map((n) => ({ href: `#${n.id}`, label: n.label, icon: n.icon as IconName }));
  const cards = ui.cards.filter((c) => c.visible && (!("feature" in DASHBOARD_CARDS[c.id]) || hasFeature(packageTier, (DASHBOARD_CARDS[c.id] as { feature: Feature }).feature)));
  return (
    <>
      {style}
      <AppShell
        brand={ui.brand}
        nav={nav}
        banner={<p className="bg-amber-300 px-4 py-1.5 text-center text-xs font-semibold text-amber-950">Preview of the draft · {role} · {ui.packageName(packageTier)}{companyName ? ` · ${companyName}` : ""} · sample numbers, nothing here is real or saved</p>}
        sidebarTop={<p className="mx-1 truncate rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm font-medium text-white">{companyName ?? "Sample Company"}</p>}
        topbar={<Badge tone="blue">{ui.packageName(packageTier)}</Badge>}
      >
        <PageHeader title={ui.t("page.overview.title")} subtitle={ui.t("page.overview.subtitle")} />
        <DashboardTiles>{ui.tiles.map((t) => <div key={t}><StatCard icon={ICON[t]} label={METRIC_TILES[t]} value={SAMPLE[t]} note="Sample number" /></div>)}</DashboardTiles>
        <DashboardGrid items={cards.map((c) => ({
          id: c.id, size: c.size,
          node: (
            <Card title={c.id === "getting_started" ? ui.t("onboarding.title") : DASHBOARD_CARDS[c.id].label}>
              {c.id === "getting_started" && ui.t("onboarding.intro") && <p className="mb-3 whitespace-pre-line text-sm text-muted">{ui.t("onboarding.intro")}</p>}
              <div className="space-y-2" aria-hidden><div className="h-3 w-3/4 rounded bg-canvas" /><div className="h-3 w-1/2 rounded bg-canvas" /><div className="h-3 w-2/3 rounded bg-canvas" /></div>
              <p className="mt-3 text-xs text-muted">Sample content</p>
            </Card>
          ),
        }))} />
        {!hasFeature(packageTier, "ad_reporting") && <p className="mt-6 text-xs text-muted">{ui.upgrade("performance_reporting")}</p>}
      </AppShell>
    </>
  );
}
