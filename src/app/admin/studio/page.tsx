import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/authz/guard";
import { PACKAGES, PACKAGE_NAMES } from "@/lib/authz/entitlements";
import { studioScopes } from "@/server/studio/service";
import { studioSafeMode } from "@/server/studio/runtime";

export const metadata = { title: "Platform Studio" };
export const dynamic = "force-dynamic";

export default async function StudioHome() {
  const ctx = await requirePlatformAdmin();
  const { scopes, companies } = await studioScopes(ctx);
  const info = (key: string) => scopes.find((s) => s.key === key);
  const row = (key: string, label: string, sub: string) => {
    const s = info(key);
    return (
      <li key={key} className="flex flex-wrap items-center gap-3 py-3">
        <span className="min-w-0 flex-1"><Link href={`/admin/studio/edit?scope=${encodeURIComponent(key)}`} className="font-medium hover:text-brand-600">{label}</Link><span className="block text-xs text-muted">{sub}</span></span>
        {s?.version ? <Badge tone="green">Live v{s.version} · {s.overrides} setting{s.overrides === 1 ? "" : "s"}</Badge> : <Badge>Nothing published</Badge>}
        {s?.unpublished ? <Badge tone="amber">{s.unpublished} unpublished</Badge> : null}
        <Link href={`/admin/studio/edit?scope=${encodeURIComponent(key)}`} className="btn-secondary">Edit</Link>
      </li>
    );
  };
  const companyScopes = scopes.filter((s) => s.kind === "company");
  return (
    <>
      <PageHeader title="Platform Studio" subtitle="Change the look, wording, menu and Overview layout without code. Every change is a draft until you preview and publish it." />
      {studioSafeMode() && <p className="mb-6 flex items-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800"><ShieldAlert className="size-5" /> Safe mode is ON (STUDIO_SAFE_MODE): everyone sees the built-in look and published Studio settings are ignored. You can still edit and publish; turn safe mode off in the hosting settings to apply them.</p>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title="Choose what to edit">
          <p className="mb-2 text-sm text-muted">Settings are inherited: <b>platform default</b> → <b>package default</b> → <b>one company</b>. A lower level only stores what it changes, so later default changes still reach everything that wasn&apos;t customized.</p>
          <ul className="divide-y divide-line">
            {row("platform", "Platform default", "Everyone: sign-in page, admin area and every client workspace")}
            {PACKAGES.map((p) => row(`package:${p}`, `Package default: ${PACKAGE_NAMES[p]}`, `Only clients on ${PACKAGE_NAMES[p]}`))}
            {companyScopes.map((s) => row(s.key, s.label, "Only this company"))}
          </ul>
          <form action="/admin/studio/edit" className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4">
            <div className="min-w-0 flex-1">
              <label htmlFor="company-scope" className="label">Customize one company</label>
              <select id="company-scope" name="scope" className="input">{companies.map((c) => <option key={c.id} value={`company:${c.id}`}>{c.name}{c.kind !== "customer" ? ` (${c.kind.replace("_", " ")})` : ""}</option>)}</select>
            </div>
            <button className="btn-primary">Open</button>
          </form>
        </Card>
        <div className="space-y-6">
          <Card title="What the Studio can't change">
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              <li>Sign-in, two-step verification and company separation</li>
              <li>Who can do what, and what each package includes</li>
              <li>Opt-out (STOP) protections and sending rules</li>
              <li>Critical notices (emergency stop, read-only, support session, demo/simulation banners)</li>
              <li>The activity log</li>
              <li>Prices people pay and calculations behind numbers</li>
            </ul>
            <p className="mt-3 text-xs text-muted">Hiding a menu item or card is visual only — access is always checked on the server.</p>
          </Card>
          <Card title="If something goes wrong">
            <p className="text-sm text-muted">Open History and copy an earlier version into the draft, then publish. If the admin area itself becomes hard to use, see “Recovery” in docs/STUDIO.md (safe-mode switch, or the reset script).</p>
          </Card>
        </div>
      </div>
    </>
  );
}
