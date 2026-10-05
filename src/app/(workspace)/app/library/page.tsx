import Link from "next/link";
import { LibraryBig, Lock, Search, Star } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/authz/guard";
import { PACKAGES, type PackageTier } from "@/lib/authz/entitlements";
import { studioForCompany } from "@/server/studio/runtime";
import { listLibrary, listMyCopies, type LibraryFilters } from "@/server/library/customer";
import { INTEGRATIONS } from "@/server/library/format";

export const metadata = { title: "Sequence Library" };

const CHANNELS: Record<string, string> = { sms: "Text", email: "Email" };
const daysLabel = (d: number) => (d === 0 ? "Instant" : `${d} day${d === 1 ? "" : "s"}`);

export default async function LibraryPage({ searchParams }: { searchParams: Promise<LibraryFilters> }) {
  const ctx = await pageContext("library.view", "acknowledgment");
  const ui = await studioForCompany(ctx);
  const f = await searchParams;
  const [{ rows, industries, objectives }, mine] = await Promise.all([listLibrary(ctx, f), listMyCopies(ctx)]);
  const filtered = Object.values(f).some(Boolean);
  const sel = (name: keyof LibraryFilters, label: string, opts: [string, string][]) => (
    <div>
      <label htmlFor={`f-${name}`} className="sr-only">{label}</label>
      <select id={`f-${name}`} name={name} defaultValue={f[name] ?? ""} className="input"><option value="">{label}</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </div>
  );
  return (
    <>
      <PageHeader title={ui.t("page.library.title")} subtitle={ui.t("page.library.subtitle")} />

      {mine.length > 0 && (
        <Card title="Your copies" className="mb-6">
          <ul className="divide-y divide-line">
            {mine.map(({ c, name, latest, templateStatus, seqStatus }) => (
              <li key={c.id}>
                <Link href={`/app/library/copies/${c.id}`} className="flex flex-wrap items-center gap-2 py-3 hover:text-brand-600">
                  <span className="min-w-0 flex-1 font-medium">{name} <span className="text-xs font-normal text-muted">· version {c.templateVersion}</span></span>
                  {c.status === "active" || seqStatus === "active" ? <Badge tone="green">On</Badge> : <Badge tone="amber">Draft — not in use</Badge>}
                  {latest != null && latest > c.templateVersion && <Badge tone="blue">Update available</Badge>}
                  {templateStatus === "retired" && <Badge>Retired by Bluewater</Badge>}
                  {templateStatus === "paused" && <Badge tone="red">Paused by Bluewater</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <form className="card mb-6 grid gap-3 p-4 md:grid-cols-4" role="search">
        <div className="relative md:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={f.q} placeholder="Search by name or description" className="input pl-9" aria-label="Search the library" />
        </div>
        {sel("kind", "Any type", [["acknowledgment", "Instant reply"], ["sequence", "Follow-up sequence"]])}
        {sel("industry", "Any industry", industries.map((x) => [x, x]))}
        {sel("objective", "Any goal", objectives.map((x) => [x, x]))}
        {sel("channel", "Any channel", [["sms", "Uses text"], ["email", "Uses email"]])}
        {sel("duration", "Any length", [["short", "Up to 7 days"], ["medium", "8–14 days"], ["long", "More than 14 days"]])}
        {sel("package", "Any package", PACKAGES.map((p) => [p, ui.packageName(p as PackageTier)]))}
        {sel("integration", "Any requirement", [["none", "Needs no connections"], ...Object.entries(INTEGRATIONS)])}
        <div className="flex gap-2 md:col-span-3"><button className="btn-primary">Search</button>{filtered && <Link href="/app/library" className="btn-secondary">Clear</Link>}</div>
      </form>

      {rows.length === 0 ? (
        <EmptyState icon={LibraryBig} title={filtered ? "Nothing matches these filters" : "The library is empty"}>{filtered ? "Try fewer filters." : "Bluewater hasn't published any templates yet."}</EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((t) => (
            <li key={t.id} className="card flex flex-col p-5">
              <div className="mb-2 flex flex-wrap gap-1.5">
                <Badge tone={t.kind === "sequence" ? "purple" : "blue"}>{t.kind === "sequence" ? "Follow-up sequence" : "Instant reply"}</Badge>
                {t.recommended && <Badge tone="green"><Star className="size-3" /> Recommended</Badge>}
                {t.hasEvidence ? <Badge tone="green">Results data available</Badge> : <Badge>Unverified — no results data yet</Badge>}
              </div>
              <h2 className="font-semibold"><Link href={`/app/library/${t.id}`} className="hover:text-brand-600">{t.name}</Link></h2>
              <p className="mt-1 flex-1 text-sm text-muted">{t.description}</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted">Industry</dt><dd>{t.industry}</dd>
                <dt className="text-muted">Goal</dt><dd>{t.objective}</dd>
                <dt className="text-muted">Channels</dt><dd>{t.channels.map((c) => CHANNELS[c] ?? c).join(" + ")}</dd>
                <dt className="text-muted">Length</dt><dd>{t.kind === "sequence" ? `${t.stepCount} steps · ${daysLabel(t.durationDays)}` : "Instant"}</dd>
                <dt className="text-muted">Needs</dt><dd>{ui.packageName(t.requiredPackage)}{t.requiredIntegrations.length ? ` · ${t.requiredIntegrations.length} connection(s)` : ""}</dd>
              </dl>
              <div className="mt-4 flex items-center justify-between gap-2">
                {t.eligibility.ok ? <Link href={`/app/library/${t.id}`} className="btn-secondary">Preview</Link> : <span className="flex items-center gap-1.5 text-xs text-muted"><Lock className="size-3.5" /> {t.eligibility.reason}</span>}
                {t.copies > 0 && <span className="text-xs text-muted">You have {t.copies} cop{t.copies === 1 ? "y" : "ies"}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
