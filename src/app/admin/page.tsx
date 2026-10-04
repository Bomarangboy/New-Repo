import Link from "next/link";
import { Building2, Plus, Search } from "lucide-react";
import { Badge, EmptyState, LIFECYCLE_TONES, PageHeader } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/authz/guard";
import { PACKAGE_LABELS } from "@/lib/authz/entitlements";
import type { LifecycleStatus } from "@/lib/authz/account-policy";
import { LIFECYCLE, listCompanies } from "@/server/companies";

export const metadata = { title: "All Customers" };

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requirePlatformAdmin();
  const sp = await searchParams;
  const status = LIFECYCLE.includes(sp.status as LifecycleStatus) ? (sp.status as LifecycleStatus) : undefined;
  const q = sp.q?.slice(0, 100);
  const rows = await listCompanies(ctx, { status, q });
  const tabs: { key?: LifecycleStatus; label: string }[] = [{ label: "All" }, ...LIFECYCLE.map((s) => ({ key: s, label: s[0]!.toUpperCase() + s.slice(1) }))];

  return (
    <>
      <PageHeader title="All Customers" subtitle="Every client company, its package and status. Demo workspaces are listed separately." actions={<Link href="/admin/companies/new" className="btn-primary"><Plus className="size-4" /> New company</Link>} />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <nav className="flex flex-wrap gap-1" aria-label="Filter by status">
          {tabs.map((t) => (
            <Link key={t.label} href={t.key ? `/admin?status=${t.key}` : "/admin"} className={`rounded-full px-3 py-1.5 text-sm font-medium ${status === t.key ? "bg-navy-900 text-white" : "bg-white text-ink hover:bg-brand-50"}`}>{t.label}</Link>
          ))}
        </nav>
        <form className="relative md:ml-auto md:w-72">
          {status && <input type="hidden" name="status" value={status} />}
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={q} placeholder="Search company or owner email" className="input pl-9" />
        </form>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Building2} title={q || status ? "No companies match" : "No client companies yet"} action={<Link href="/admin/companies/new" className="btn-primary">Create the first company</Link>}>
          {q || status ? "Try a different filter." : "Create a company, then invite its owner."}
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-canvas text-muted">
              <tr><th className="px-4 py-3 font-medium">Company</th><th className="px-4 py-3 font-medium">Owner</th><th className="px-4 py-3 font-medium">Package</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Started</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-brand-50/40">
                  <td className="px-4 py-3"><Link href={`/admin/companies/${r.id}`} className="font-semibold text-ink hover:text-brand-600">{r.name}</Link>{r.kind === "internal_test" && <span className="ml-2"><Badge>Test</Badge></span>}</td>
                  <td className="px-4 py-3 text-muted">{r.ownerEmail ?? <span className="italic">No owner yet</span>}</td>
                  <td className="px-4 py-3">{PACKAGE_LABELS[r.package].split(" — ")[1]}</td>
                  <td className="px-4 py-3"><span className="flex flex-wrap gap-1"><Badge tone={LIFECYCLE_TONES[r.lifecycleStatus]} dot>{r.lifecycleStatus}</Badge>{r.suspended && <Badge tone="red">Suspended</Badge>}{r.cancellationRequestedAt && r.lifecycleStatus !== "churned" && r.serviceEndsAt && <Badge tone="amber">{`Cancels ${r.serviceEndsAt.toLocaleDateString("en-US", { timeZone: "UTC" })}`}</Badge>}</span></td>
                  <td className="px-4 py-3 text-muted">{r.serviceStartDate ? r.serviceStartDate.toLocaleDateString("en-US") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
