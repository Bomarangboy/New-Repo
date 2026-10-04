import Link from "next/link";
import { Download, KanbanSquare, Plus, Search, Upload, Users } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { StageBadge, money, sourceName } from "@/components/lead-bits";
import { pageContext } from "@/lib/authz/guard";
import { roleCan } from "@/lib/authz/permissions";
import { hasFeature } from "@/lib/authz/entitlements";
import { formatInZone } from "@/lib/timezones";
import { assignableMembers, listLeads, SOURCE_LABELS, STAGES, STAGE_LABELS, type Stage } from "@/server/crm/leads";

export const metadata = { title: "Leads" };

type SP = { q?: string; stage?: string; source?: string; assigned?: string; page?: string };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext("lead.view", "leads");
  const sp = await searchParams;
  const stage = STAGES.includes(sp.stage as Stage) ? (sp.stage as Stage) : undefined;
  const source = sp.source && sp.source in SOURCE_LABELS ? sp.source : undefined;
  const { rows, total, page, pages } = await listLeads(ctx, { q: sp.q?.trim() || undefined, stage, source, assigned: sp.assigned || undefined, page: Number(sp.page) || 1 });
  const members = await assignableMembers(ctx);
  const filtered = Boolean(sp.q || stage || source || sp.assigned);
  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/app/leads${p.size ? `?${p}` : ""}`;
  };
  const canWrite = ctx.policy.login === "full";

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Every inquiry, where it came from and what happened next."
        actions={<>
          {hasFeature(ctx.package, "pipeline_board") && <Link href="/app/leads/pipeline" className="btn-secondary"><KanbanSquare className="size-4" /> Pipeline</Link>}
          {roleCan(ctx.role, "lead.export") && (
            // A file download, not page navigation, so a plain link is correct here.
            <a href="/app/leads/export" download className="btn-secondary"><Download className="size-4" /> Export</a>
          )}
          {roleCan(ctx.role, "lead.import") && canWrite && <Link href="/app/leads/import" className="btn-secondary"><Upload className="size-4" /> Import</Link>}
          {roleCan(ctx.role, "lead.create") && canWrite && <Link href="/app/leads/new" className="btn-primary"><Plus className="size-4" /> Add lead</Link>}
        </>}
      />

      <form className="card mb-4 grid gap-3 p-4 md:grid-cols-[2fr_1fr_1fr_1fr_auto]" role="search">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={sp.q} placeholder="Search name, email, phone or service" className="input pl-9" aria-label="Search leads" />
        </div>
        <select name="stage" defaultValue={stage ?? ""} className="input" aria-label="Stage">
          <option value="">All stages</option>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
        <select name="source" defaultValue={source ?? ""} className="input" aria-label="Source">
          <option value="">All sources</option>{Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="assigned" defaultValue={sp.assigned ?? ""} className="input" aria-label="Assigned to">
          <option value="">Anyone</option><option value="me">Assigned to me</option><option value="unassigned">Unassigned</option>
          {members.map((m) => <option key={m.userId} value={m.userId}>{m.name || m.email}</option>)}
        </select>
        <div className="flex gap-2"><button className="btn-primary">Filter</button>{filtered && <Link href="/app/leads" className="btn-secondary">Clear</Link>}</div>
      </form>

      {rows.length === 0 ? (
        <EmptyState icon={Users} title={filtered ? "No leads match these filters" : "No leads yet"}
          action={!filtered && roleCan(ctx.role, "integration.manage") ? <Link href="/app/connected-accounts" className="btn-primary">Connect your website form</Link> : undefined}>
          {filtered ? "Try a different search or clear the filters." : "New inquiries from your website form appear here automatically. You can also add a lead by hand or import a spreadsheet."}
        </EmptyState>
      ) : (
        <div className="card overflow-hidden">
          {/* Phones: stacked cards. Larger screens: table. */}
          <ul className="divide-y divide-line md:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/app/leads/${r.id}`} className="block px-4 py-3 active:bg-brand-50">
                  <span className="flex items-center justify-between gap-2"><span className="truncate font-semibold">{r.contactName || r.email || r.phone || "Unnamed"}</span><StageBadge stage={r.stage} /></span>
                  <span className="mt-0.5 block truncate text-sm text-muted">{r.serviceRequested ?? "No service listed"} · {sourceName(r.source, r.sourceLabel)}</span>
                  <span className="mt-0.5 block text-xs text-muted">{formatInZone(r.submittedAt, ctx.timezone, { dateStyle: "medium", timeStyle: "short" })} · {r.assignedName || r.assignedEmail || "Unassigned"}{r.isRepeat && " · repeat"}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-canvas text-muted">
              <tr><th className="px-4 py-3 font-medium">Name</th><th className="px-4 py-3 font-medium">Service</th><th className="px-4 py-3 font-medium">Source</th><th className="px-4 py-3 font-medium">Stage</th><th className="px-4 py-3 font-medium">Assigned to</th><th className="px-4 py-3 font-medium">Received</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-brand-50/40">
                  <td className="px-4 py-3">
                    <Link href={`/app/leads/${r.id}`} className="font-semibold hover:text-brand-600">{r.contactName || r.email || r.phone || "Unnamed"}</Link>
                    <span className="block text-xs text-muted">{[r.email, r.phone].filter(Boolean).join(" · ")}{r.isRepeat && " · repeat inquiry"}</span>
                  </td>
                  <td className="px-4 py-3 text-muted">{r.serviceRequested ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{sourceName(r.source, r.sourceLabel)}</td>
                  <td className="px-4 py-3"><StageBadge stage={r.stage} />{r.stage === "won" && r.saleValueCents != null && <span className="ml-2 text-xs text-muted">{money(r.saleValueCents)}</span>}</td>
                  <td className="px-4 py-3 text-muted">{r.assignedName || r.assignedEmail || "Unassigned"}</td>
                  <td className="px-4 py-3 text-muted">{formatInZone(r.submittedAt, ctx.timezone, { dateStyle: "medium", timeStyle: "short" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-muted">
            <span>{total.toLocaleString("en-US")} {total === 1 ? "lead" : "leads"}</span>
            <span className="flex items-center gap-2">
              {page > 1 && <Link className="btn-secondary px-3 py-1.5" href={qs({ page: String(page - 1) })}>Previous</Link>}
              Page {page} of {pages}
              {page < pages && <Link className="btn-secondary px-3 py-1.5" href={qs({ page: String(page + 1) })}>Next</Link>}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
