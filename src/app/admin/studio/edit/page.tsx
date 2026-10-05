import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp, Lock } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/authz/guard";
import { PACKAGES, PACKAGE_NAMES } from "@/lib/authz/entitlements";
import { listAssets, loadScope, publishImpact } from "@/server/studio/service";
import { CARD_SIZES, DASHBOARD_CARDS, FONTS, LANDING_CHOICES, METRIC_TILES, NAV_ITEMS, SETTINGS, contrast, validateOverrides, type CardLayout } from "@/server/studio/registry";
import { IMAGE_RULES, type ImageKind } from "@/server/studio/images";
import { discardAction, publishAction, restoreAction, saveSectionAction, uploadImageAction } from "../actions";

export const metadata = { title: "Platform Studio" };
export const dynamic = "force-dynamic";

const TABS = [["brand", "Brand"], ["content", "Wording"], ["packages", "Packages"], ["navigation", "Menu"], ["dashboard", "Overview layout"], ["publish", "Preview & publish"], ["history", "History"]] as const;
const when = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(d) + " ET" : "—");

type Data = Awaited<ReturnType<typeof loadScope>>;

function Hidden({ data, section }: { data: Data; section: string }) {
  // The first submit button is what Enter triggers: make it a plain "save", never a Reset or Move button.
  return <><button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" /><input type="hidden" name="scope" value={data.key} /><input type="hidden" name="revision" value={data.revision} /><input type="hidden" name="section" value={section} /></>;
}

/** Shows where the value comes from, and a Reset button when this scope overrides it. */
function Source({ data, k }: { data: Data; k: string }) {
  const own = k in data.draft;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      {own ? <Badge tone="blue">Set here</Badge> : <span className="text-muted">Inherited from {data.inherited.source[k] ?? "Built-in default"}</span>}
      {own && <button name="resetKey" value={k} className="font-medium text-brand-600 hover:underline">Reset to inherited</button>}
    </span>
  );
}

function TextRow({ data, k }: { data: Data; k: string }) {
  const def = SETTINGS[k]!;
  const value = String(data.effective.values[k] ?? "");
  const id = `f-${k.replaceAll(".", "-")}`;
  return (
    <div>
      <label htmlFor={id} className="label">{def.label}</label>
      {def.text?.multiline
        ? <textarea id={id} name={k} defaultValue={value} rows={3} maxLength={def.text.max} className="input" />
        : <input id={id} name={k} defaultValue={value} maxLength={def.text?.max} className="input" />}
      <Source data={data} k={k} />
    </div>
  );
}

export default async function StudioEditor({ searchParams }: { searchParams: Promise<{ scope?: string; tab?: string; role?: string; package?: string; company?: string; width?: string }> }) {
  const ctx = await requirePlatformAdmin();
  const sp = await searchParams;
  const scope = sp.scope ?? "platform";
  const tab = TABS.some(([t]) => t === sp.tab) ? sp.tab! : "brand";
  let data: Data;
  try { data = await loadScope(ctx, scope); } catch { notFound(); }
  const kind = data.scope.kind;
  const allowed = (k: string) => SETTINGS[k]!.scopes.includes(kind);
  const href = (t: string) => `/admin/studio/edit?scope=${encodeURIComponent(scope)}&tab=${t}`;

  return (
    <>
      <PageHeader title="Platform Studio" subtitle={`Editing: ${data.label}. Changes go into a draft; nothing is live until you publish.`}
        actions={<Link href="/admin/studio" className="btn-secondary">Change scope</Link>} />
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-sm">
        <span>Live version: <b>{data.publishedVersion || "none (built-in look)"}</b>{data.publishedAt ? ` · published ${when(data.publishedAt)}` : ""}</span>
        {data.unpublished.length ? <Badge tone="amber">{data.unpublished.length} unpublished change{data.unpublished.length === 1 ? "" : "s"}</Badge> : <Badge tone="green">Draft matches live</Badge>}
        <span className="text-muted">Draft revision {data.revision}</span>
      </div>
      <nav className="mb-6 flex flex-wrap gap-1 rounded-xl border border-line bg-white p-1" aria-label="Studio sections">
        {TABS.filter(([t]) => t !== "packages" || kind === "platform").map(([t, l]) => (
          <Link key={t} href={href(t)} aria-current={t === tab ? "page" : undefined} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${t === tab ? "bg-navy-900 text-white" : "text-muted hover:text-ink"}`}>{l}</Link>
        ))}
      </nav>

      {tab === "brand" && <BrandTab data={data} allowed={allowed} assets={await listAssets(ctx)} />}
      {tab === "content" && <ContentTab data={data} allowed={allowed} />}
      {tab === "packages" && kind === "platform" && <PackagesTab data={data} />}
      {tab === "navigation" && <NavigationTab data={data} />}
      {tab === "dashboard" && <DashboardTab data={data} />}
      {tab === "publish" && <PublishTab data={data} sp={sp} impact={await publishImpact(ctx, scope, data.unpublished)} />}
      {tab === "history" && <HistoryTab data={data} />}

      <Card title="Related settings (edited in their own screens)" className="mt-6">
        <p className="mb-3 text-sm text-muted">The Studio changes appearance and wording only. These are set elsewhere so there&apos;s one place for each — the Studio never duplicates them:</p>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          <li>Acknowledgment wording, follow-up sequences, sending hours, notifications — <b>each client&apos;s Automations page</b> (or <Link className="text-brand-600 hover:underline" href="/admin/library">Sequence Library</Link> for shared templates)</li>
          <li>Booking (Cal.com) — client&apos;s Connected Accounts</li>
          <li>Package, status, prices and limits per company — <Link className="text-brand-600 hover:underline" href="/admin">company pages</Link> and <Link className="text-brand-600 hover:underline" href="/admin/billing">Usage & Billing</Link></li>
          <li>Who can do what — fixed permission rules (docs/PERMISSIONS.md); team members — client&apos;s Settings → Team</li>
          <li>Reports and their definitions — fixed (docs/METRICS.md)</li>
          <li>Pipelines, custom fields, assignment rules — not available yet (would need development)</li>
        </ul>
      </Card>
    </>
  );
}

function BrandTab({ data, allowed, assets }: { data: Data; allowed: (k: string) => boolean; assets: Awaited<ReturnType<typeof listAssets>> }) {
  const v = data.effective.values;
  const imageKeys = ["brand.logoLight", "brand.logoDark", "brand.favicon"].filter(allowed);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Name, wordmark, colors and font">
        <ActionForm action={saveSectionAction} className="space-y-4">
          <Hidden data={data} section="brand" />
          {["brand.name", "brand.wordmarkFirst", "brand.wordmarkSecond", "brand.wordmarkTagline"].filter(allowed).map((k) => <TextRow key={k} data={data} k={k} />)}
          {(["brand.colorPrimary", "brand.colorNavy"] as const).map((k) => (
            <div key={k}>
              <label htmlFor={`f-${k}`} className="label">{SETTINGS[k]!.label}</label>
              <div className="flex items-center gap-3">
                <input id={`f-${k}`} name={k} type="color" defaultValue={String(v[k]).toLowerCase()} className="h-10 w-16 cursor-pointer rounded-lg border border-line" />
                <span className="text-xs text-muted">White text contrast: {contrast(String(v[k]), "#FFFFFF").toFixed(1)}:1 {k === "brand.colorNavy" ? "(needs 7:1)" : "(needs 3:1; links are darkened automatically)"}</span>
              </div>
              <Source data={data} k={k} />
            </div>
          ))}
          <div>
            <label htmlFor="f-font" className="label">{SETTINGS["brand.font"]!.label}</label>
            <select id="f-font" name="brand.font" defaultValue={String(v["brand.font"])} className="input">
              {Object.entries(FONTS).map(([key, f]) => <option key={key} value={key}>{f.label}</option>)}
            </select>
            <Source data={data} k="brand.font" />
          </div>
          {imageKeys.map((k) => (
            <div key={k}>
              <label htmlFor={`f-${k}`} className="label">{SETTINGS[k]!.label}</label>
              <select id={`f-${k}`} name={k} defaultValue={String(v[k] ?? "")} className="input">
                <option value="">{k === "brand.favicon" ? "Browser default" : "Use the wordmark (no image)"}</option>
                {assets.filter((a) => a.kind === SETTINGS[k]!.assetKind).map((a) => <option key={a.id} value={a.id}>{`${a.width}×${a.height} ${a.mime.replace("image/", "")} · uploaded ${a.createdAt.toISOString().slice(0, 10)}`}</option>)}
              </select>
              <Source data={data} k={k} />
            </div>
          ))}
          <SubmitButton>Save brand draft</SubmitButton>
        </ActionForm>
      </Card>
      <div className="space-y-6">
        <Card title="Upload an image">
          <p className="mb-3 text-sm text-muted">Files are checked by their actual contents. SVG, HTML and anything that could contain scripts are refused.</p>
          {imageKeys.map((k) => (
            <ActionForm key={k} action={uploadImageAction} className="mb-4 space-y-2 border-b border-line pb-4 last:border-0">
              <input type="hidden" name="scope" value={data.key} /><input type="hidden" name="revision" value={data.revision} /><input type="hidden" name="key" value={k} />
              <label htmlFor={`u-${k}`} className="label">{SETTINGS[k]!.label}</label>
              <input id={`u-${k}`} name="file" type="file" accept={k === "brand.favicon" ? "image/png,image/x-icon" : "image/png,image/jpeg,image/webp"} className="block text-sm" />
              <p className="text-xs text-muted">{IMAGE_RULES[SETTINGS[k]!.assetKind as ImageKind].hint}</p>
              <SubmitButton variant="secondary">Upload and use in draft</SubmitButton>
            </ActionForm>
          ))}
        </Card>
        <Card title="How it looks (draft)">
          <div className="space-y-3">
            <div className="rounded-xl p-4" style={{ background: String(v["brand.colorNavy"]) }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- validated logo served by the app */}
              {v["brand.logoDark"] ? <img src={`/brand-asset/${v["brand.logoDark"]}`} alt="Logo on dark" className="h-9" /> : <p className="text-2xl font-extrabold text-white">{String(v["brand.wordmarkFirst"])}<span style={{ color: String(v["brand.colorPrimary"]) }}>{String(v["brand.wordmarkSecond"])}</span></p>}
            </div>
            <div className="rounded-xl border border-line bg-white p-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- validated logo served by the app */}
              {v["brand.logoLight"] ? <img src={`/brand-asset/${v["brand.logoLight"]}`} alt="Logo on light" className="h-9" /> : <p className="text-2xl font-extrabold" style={{ color: String(v["brand.colorNavy"]) }}>{String(v["brand.wordmarkFirst"])}<span style={{ color: String(v["brand.colorPrimary"]) }}>{String(v["brand.wordmarkSecond"])}</span></p>}
              <span className="mt-3 inline-block rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ background: String(v["brand.colorPrimary"]) }}>Sample button</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ContentTab({ data, allowed }: { data: Data; allowed: (k: string) => boolean }) {
  const keys = Object.keys(SETTINGS).filter((k) => k.startsWith("text.") && allowed(k));
  const groups = [...new Set(keys.map((k) => SETTINGS[k]!.group))];
  return (
    <ActionForm action={saveSectionAction} className="space-y-6">
      <Hidden data={data} section="content" />
      <p className="text-sm text-muted">Plain text only — no HTML, links or scripts. Leave a field as it is to keep following the inherited wording.</p>
      {groups.map((g) => (
        <Card key={g} title={g}>
          <div className="grid gap-4 md:grid-cols-2">{keys.filter((k) => SETTINGS[k]!.group === g).map((k) => <TextRow key={k} data={data} k={k} />)}</div>
        </Card>
      ))}
      <div className="sticky bottom-4"><SubmitButton>Save wording draft</SubmitButton></div>
    </ActionForm>
  );
}

function PackagesTab({ data }: { data: Data }) {
  return (
    <ActionForm action={saveSectionAction} className="space-y-6">
      <Hidden data={data} section="packages" />
      <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">These are <b>display</b> names and texts. The package each client is on, what it includes and what they pay are unchanged — they live on the company pages and in Usage & Billing, under stable internal codes ({PACKAGES.join(", ")}).</p>
      <div className="grid gap-6 lg:grid-cols-3">
        {PACKAGES.map((p) => (
          <Card key={p} title={`${PACKAGE_NAMES[p]} (${p})`}>
            <div className="space-y-4">{["name", "description", "upgrade", "displayPrice"].map((f) => <TextRow key={f} data={data} k={`package.${p}.${f}`} />)}</div>
          </Card>
        ))}
      </div>
      <SubmitButton>Save package texts draft</SubmitButton>
    </ActionForm>
  );
}

function NavigationTab({ data }: { data: Data }) {
  const v = data.effective.values;
  const order = v["nav.order"] as string[];
  const hidden = new Set(v["nav.hidden"] as string[]);
  return (
    <ActionForm action={saveSectionAction} className="space-y-6">
      <Hidden data={data} section="navigation" />
      <Card title="Client menu">
        <p className="mb-3 text-sm text-muted">Rename, reorder or hide items. Each client still only sees the items their package and role allow, and hiding an item never blocks the page itself. Locked items are essential (Overview, Settings, Help & Support) and can&apos;t be hidden.</p>
        <ol className="divide-y divide-line rounded-xl border border-line">
          {order.map((id, i) => {
            const n = NAV_ITEMS.find((x) => x.id === id)!;
            const k = `nav.label.${id}`;
            return (
              <li key={id} className="grid items-center gap-3 px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
                <span className="flex gap-1">
                  <button name="move" value={`nav:${id}:up`} disabled={i === 0} className="btn-secondary px-2 py-1" aria-label={`Move ${n.label} up`}><ArrowUp className="size-4" /></button>
                  <button name="move" value={`nav:${id}:down`} disabled={i === order.length - 1} className="btn-secondary px-2 py-1" aria-label={`Move ${n.label} down`}><ArrowDown className="size-4" /></button>
                </span>
                <div>
                  <label htmlFor={`f-${k}`} className="sr-only">Label for {n.label}</label>
                  <input id={`f-${k}`} name={k} defaultValue={String(v[k])} maxLength={30} className="input" />
                  <Source data={data} k={k} />
                </div>
                <span className="text-xs text-muted">{n.feature ? `Needs: ${n.feature.replaceAll("_", " ")}` : "All packages"}</span>
                {n.locked ? <span className="flex items-center gap-1 text-xs text-muted"><Lock className="size-3.5" /> Always shown</span>
                  : <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={`hide.${id}`} defaultChecked={hidden.has(id)} /> Hide</label>}
              </li>
            );
          })}
        </ol>
        <div className="mt-2"><Source data={data} k="nav.order" /></div>
      </Card>
      <Card title="Page after sign-in">
        <label htmlFor="f-landing" className="label">{SETTINGS["nav.landing"]!.label}</label>
        <select id="f-landing" name="nav.landing" defaultValue={String(v["nav.landing"])} className="input max-w-sm">
          {LANDING_CHOICES.map((c) => <option key={c} value={c}>{NAV_ITEMS.find((n) => n.id === c)!.label}</option>)}
        </select>
        <Source data={data} k="nav.landing" />
        <p className="mt-2 text-xs text-muted">Set different pages per package by editing a package scope. If someone can&apos;t open the chosen page (package or role), they land on Overview.</p>
      </Card>
      <SubmitButton>Save menu draft</SubmitButton>
    </ActionForm>
  );
}

function DashboardTab({ data }: { data: Data }) {
  const v = data.effective.values;
  const tiles = v["dashboard.tiles"] as string[];
  const cards = v["dashboard.cards"] as CardLayout[];
  return (
    <ActionForm action={saveSectionAction} className="space-y-6">
      <Hidden data={data} section="dashboard" />
      <Card title="Number tiles (top of Overview)">
        <p className="mb-3 text-sm text-muted">Pick up to four existing measurements. Their calculations don&apos;t change (docs/METRICS.md).</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <label htmlFor={`tile-${i}`} className="label">Tile {i + 1}</label>
              <select id={`tile-${i}`} name={`tile.${i}`} defaultValue={tiles[i] ?? ""} className="input">
                <option value="">— none —</option>
                {Object.entries(METRIC_TILES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
          ))}
        </div>
        <Source data={data} k="dashboard.tiles" />
      </Card>
      <Card title="Cards">
        <p className="mb-3 text-sm text-muted">Order, width and visibility. A card still only appears when the client&apos;s package and the person&apos;s role include it.</p>
        <ol className="divide-y divide-line rounded-xl border border-line">
          {cards.map((c, i) => (
            <li key={c.id} className="grid items-center gap-3 px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
              <span className="flex gap-1">
                <button name="move" value={`card:${c.id}:up`} disabled={i === 0} className="btn-secondary px-2 py-1" aria-label={`Move ${DASHBOARD_CARDS[c.id].label} up`}><ArrowUp className="size-4" /></button>
                <button name="move" value={`card:${c.id}:down`} disabled={i === cards.length - 1} className="btn-secondary px-2 py-1" aria-label={`Move ${DASHBOARD_CARDS[c.id].label} down`}><ArrowDown className="size-4" /></button>
              </span>
              <span className="font-medium">{DASHBOARD_CARDS[c.id].label}{"feature" in DASHBOARD_CARDS[c.id] ? <span className="ml-2 text-xs font-normal text-muted">(only where included)</span> : null}</span>
              <span>
                <label htmlFor={`size-${c.id}`} className="sr-only">Width of {DASHBOARD_CARDS[c.id].label}</label>
                <select id={`size-${c.id}`} name={`card.size.${c.id}`} defaultValue={c.size} className="input py-1.5">{Object.entries(CARD_SIZES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </span>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={`card.visible.${c.id}`} defaultChecked={c.visible} /> Show</label>
            </li>
          ))}
        </ol>
        <Source data={data} k="dashboard.cards" />
      </Card>
      <SubmitButton>Save layout draft</SubmitButton>
    </ActionForm>
  );
}

function PublishTab({ data, sp, impact }: { data: Data; sp: { role?: string; package?: string; company?: string; width?: string }; impact: Awaited<ReturnType<typeof publishImpact>> }) {
  const check = validateOverrides(data.scope.kind, data.draft, data.scope.packageTier);
  const role = sp.role === "employee" ? "employee" : "owner";
  const pkg = data.scope.kind === "package" ? data.scope.packageTier! : data.companyPackage ?? (PACKAGES.includes(sp.package as never) ? sp.package! : "follow_up_booking");
  const width = sp.width === "mobile" ? "mobile" : "desktop";
  const qs = (o: Record<string, string>) => new URLSearchParams({ scope: data.key, tab: "publish", role, package: pkg, width, ...o }).toString();
  const src = `/studio-preview?${new URLSearchParams({ scope: data.key, role, package: pkg, ...(sp.company ? { company: sp.company } : {}) }).toString()}`;
  return (
    <div className="space-y-6">
      <Card title="1 · Preview the draft">
        <div className="mb-3 flex flex-wrap gap-2 text-sm">
          {(["desktop", "mobile"] as const).map((w) => <Link key={w} href={`?${qs({ width: w })}`} aria-current={w === width ? "true" : undefined} className={`rounded-lg border px-3 py-1.5 ${w === width ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-white"}`}>{w === "desktop" ? "Desktop" : "Phone"}</Link>)}
          {(["owner", "employee"] as const).map((r) => <Link key={r} href={`?${qs({ role: r })}`} aria-current={r === role ? "true" : undefined} className={`rounded-lg border px-3 py-1.5 ${r === role ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-white"}`}>As {r}</Link>)}
          {data.scope.kind === "platform" && PACKAGES.map((p) => <Link key={p} href={`?${qs({ package: p })}`} aria-current={p === pkg ? "true" : undefined} className={`rounded-lg border px-3 py-1.5 ${p === pkg ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-white"}`}>{PACKAGE_NAMES[p]}</Link>)}
        </div>
        <p className="mb-3 text-xs text-muted">The preview uses sample numbers and this draft. It never reads or changes leads, messages, billing or automations. {data.scope.kind !== "company" && "To preview a specific company&apos;s own overrides on top, open that company&apos;s scope."}</p>
        <div className="overflow-x-auto rounded-2xl border border-line bg-canvas p-3">
          <iframe title="Draft preview" src={src} className="mx-auto block rounded-xl border border-line bg-white" style={{ width: width === "mobile" ? 390 : 1280, height: 760 }} />
        </div>
        <p className="mt-2 text-xs"><a href={src} target="_blank" className="text-brand-600 hover:underline">Open the preview in a new tab</a> · also check <a href={`${src}&page=login`} target="_blank" className="text-brand-600 hover:underline">the sign-in page</a></p>
      </Card>

      <Card title="2 · Check what changes and who it reaches">
        {data.unpublished.length === 0 ? <p className="text-sm text-muted">The draft matches what is live. Nothing to publish.</p> : (
          <ul className="mb-4 space-y-1 text-sm">
            {data.unpublished.map((k) => <li key={k}><b>{SETTINGS[k]?.label ?? k}</b>{SETTINGS[k]?.group ? <span className="text-muted"> · {SETTINGS[k]!.group}</span> : null}{k in data.draft ? "" : <span className="text-muted"> — reset to inherited</span>}</li>)}
          </ul>
        )}
        <p className="text-sm">Scope: <b>{data.label}</b> · reaches <b>{impact.companies}</b> workspace(s) ({impact.customers} customer{impact.customers === 1 ? "" : "s"}).</p>
        {impact.keeping.length > 0 && (
          <div className="mt-3 rounded-xl bg-canvas p-3 text-sm">
            <p className="font-medium">These keep their own values for the changed settings (their explicit choices are never overwritten):</p>
            <ul className="mt-1 list-disc pl-5 text-muted">{impact.keeping.map((k) => <li key={k.scope}>{k.scope}: {k.keys.map((x) => SETTINGS[x]?.label ?? x).join(", ")}</li>)}</ul>
          </div>
        )}
        {check.errors.length > 0 && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">Can&apos;t publish yet: {check.errors.join(" ")}</p>}
        {check.warnings.length > 0 && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{check.warnings.join(" ")}</p>}
      </Card>

      <Card title="3 · Publish">
        <ActionForm action={publishAction} className="space-y-3">
          <input type="hidden" name="scope" value={data.key} /><input type="hidden" name="revision" value={data.revision} />
          <label htmlFor="summary" className="label">Summary for the version history</label>
          <input id="summary" name="summary" required minLength={3} maxLength={300} className="input" placeholder="e.g. New logo and Engage upgrade wording" />
          <p className="text-xs text-muted">Publishing is recorded in the activity log. If someone saved the draft after you opened this page, publishing is refused and you&apos;ll be asked to reload.</p>
          <SubmitButton>Publish to {impact.companies} workspace(s)</SubmitButton>
        </ActionForm>
        <ActionForm action={discardAction} className="mt-4 border-t border-line pt-4">
          <input type="hidden" name="scope" value={data.key} /><input type="hidden" name="revision" value={data.revision} />
          <SubmitButton variant="secondary">Discard draft changes</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}

function HistoryTab({ data }: { data: Data }) {
  return (
    <Card title="Published versions">
      {data.history.length === 0 ? <p className="text-sm text-muted">Nothing has been published for this scope yet — the inherited look is in use.</p> : (
        <ul className="divide-y divide-line">
          {data.history.map((h) => (
            <li key={h.version} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <span className="min-w-0 flex-1"><b>Version {h.version}</b>{h.version === data.publishedVersion && <span className="ml-2"><Badge tone="green">Live</Badge></span>}<span className="block text-muted">{when(h.publishedAt)} · {h.summary} · {h.changes.length} setting(s)</span></span>
              <ActionForm action={restoreAction} className="flex items-center gap-2">
                <input type="hidden" name="scope" value={data.key} /><input type="hidden" name="revision" value={data.revision} /><input type="hidden" name="version" value={h.version} />
                <SubmitButton variant="secondary">Copy into draft</SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">Restoring copies an old version&apos;s appearance and wording into the draft; you still preview and publish it. It never restores customer data, billing or automation settings — the Studio doesn&apos;t store those.</p>
    </Card>
  );
}
