import { cache } from "react";
import { inArray } from "drizzle-orm";
import { withCompanyDb, withPlatformDb, withSystemDb } from "@/lib/db/context";
import { studioPublished } from "@/lib/db/schema";
import { PACKAGE_NAMES, hasFeature, type PackageTier } from "@/lib/authz/entitlements";
import { roleCan, type Action, type WorkspaceRole } from "@/lib/authz/permissions";
import type { CompanyContext, PlatformContext } from "@/lib/authz/context-types";
import {
  DASHBOARD_CARDS, FONTS, METRIC_TILES, NAV_ITEMS, TEXT, contrast, darken, lighten, resolve,
  type CardLayout, type Flat, type FontKey, type Layer, type MetricTile,
} from "./registry";

/**
 * What pages read: the effective, PUBLISHED Studio values for a company (or the platform). Drafts are never
 * read here. Each request reads fresh values (one small query), so a publication shows on everyone's next
 * page load. STUDIO_SAFE_MODE=true ignores every Studio value (recovery switch, docs/STUDIO.md).
 */
export function studioSafeMode(): boolean {
  const v = process.env.STUDIO_SAFE_MODE;
  return v === "true" || v === "1";
}

export class StudioUi {
  constructor(readonly values: Flat, readonly safeMode = false) {}

  t(key: keyof typeof TEXT | string): string {
    const v = this.values[`text.${key}`];
    return typeof v === "string" ? v : (TEXT[key]?.default ?? key);
  }
  get brand() {
    const v = this.values;
    const asset = (k: string) => (typeof v[k] === "string" && v[k] ? `/brand-asset/${v[k]}` : null);
    return {
      name: String(v["brand.name"]), first: String(v["brand.wordmarkFirst"]), second: String(v["brand.wordmarkSecond"]), tagline: String(v["brand.wordmarkTagline"]),
      logoLight: asset("brand.logoLight"), logoDark: asset("brand.logoDark"), favicon: asset("brand.favicon"),
    };
  }
  packageName(p: PackageTier): string { return String(this.values[`package.${p}.name`] ?? PACKAGE_NAMES[p]); }
  packageDescription(p: PackageTier): string { return String(this.values[`package.${p}.description`] ?? ""); }
  packagePrice(p: PackageTier): string { return String(this.values[`package.${p}.displayPrice`] ?? ""); }
  upgrade(p: PackageTier): string { return String(this.values[`package.${p}.upgrade`] ?? `This is part of ${this.packageName(p)}. Contact Bluewater to upgrade.`); }

  /** Menu items in the chosen order and wording — still filtered by role and package (hiding is never the protection). */
  nav(role: WorkspaceRole, pkg: PackageTier) {
    const order = (this.values["nav.order"] as string[]) ?? NAV_ITEMS.map((n) => n.id);
    const hidden = new Set((this.values["nav.hidden"] as string[]) ?? []);
    return order
      .map((id) => NAV_ITEMS.find((n) => n.id === id)!)
      .filter((n) => n && roleCan(role, n.action as Action) && (!n.feature || hasFeature(pkg, n.feature)) && (n.locked || !hidden.has(n.id)))
      .map((n) => ({ id: n.id, href: n.href, icon: n.icon, label: String(this.values[`nav.label.${n.id}`] ?? n.label) }));
  }
  /** Where to go after sign-in: the configured page if this person can open it, else Overview. */
  landing(role: WorkspaceRole, pkg: PackageTier): string {
    const id = String(this.values["nav.landing"] ?? "overview");
    const n = NAV_ITEMS.find((x) => x.id === id);
    if (!n || !roleCan(role, n.action as Action) || (n.feature && !hasFeature(pkg, n.feature))) return "/app";
    return n.href;
  }
  get tiles(): MetricTile[] { return ((this.values["dashboard.tiles"] as string[]) ?? []).filter((t): t is MetricTile => t in METRIC_TILES); }
  get cards(): CardLayout[] { return ((this.values["dashboard.cards"] as CardLayout[]) ?? []).filter((c) => c.id in DASHBOARD_CARDS); }

  /** CSS custom properties for the brand colors and font (overrides the built-in theme tokens). */
  css(selector = ":root"): string {
    const p = String(this.values["brand.colorPrimary"]);
    const n = String(this.values["brand.colorNavy"]);
    let p600 = darken(p, 0.14);
    for (let i = 0; i < 10 && contrast(p600, "#FFFFFF") < 4.5; i++) p600 = darken(p600, 0.1); // readable text links
    const font = FONTS[(this.values["brand.font"] as FontKey) ?? "figtree"] ?? FONTS.figtree;
    const vars: Record<string, string> = {
      "--color-brand-50": lighten(p, 0.92), "--color-brand-100": lighten(p, 0.84), "--color-brand-200": lighten(p, 0.67),
      "--color-brand-500": p, "--color-brand-600": p600, "--color-brand-700": darken(p600, 0.18),
      "--color-navy-950": darken(n, 0.3), "--color-navy-900": n, "--color-navy-800": lighten(n, 0.07), "--color-navy-700": lighten(n, 0.14), "--color-navy-600": lighten(n, 0.24),
      "--font-sans": font.stack,
    };
    // Values come only from validated settings (hex colors, a fixed font list), so this text is safe to inline.
    return `${selector}{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}}`;
  }
}

function layersFrom(rows: { scopeKey: string; scopeKind: string; config: unknown }[], pkg: PackageTier | null, companyId: string | null): Layer[] {
  const get = (k: string) => (rows.find((r) => r.scopeKey === k)?.config ?? {}) as Flat;
  const layers: Layer[] = [{ scope: "platform", label: "Platform default", values: get("platform") }];
  if (pkg) layers.push({ scope: "package", label: `${PACKAGE_NAMES[pkg]} default`, values: get(`package:${pkg}`) });
  if (companyId) layers.push({ scope: "company", label: "This company", values: get(`company:${companyId}`) });
  return layers;
}

/** Effective look for a client workspace (platform → package → company). */
export const studioForCompany = cache(async (ctx: CompanyContext): Promise<StudioUi> => {
  if (studioSafeMode()) return new StudioUi(resolve([]).values, true);
  const keys = ["platform", `package:${ctx.package}`, `company:${ctx.companyId}`];
  const rows = await withCompanyDb(ctx, (tx) => tx.select({ scopeKey: studioPublished.scopeKey, scopeKind: studioPublished.scopeKind, config: studioPublished.config }).from(studioPublished).where(inArray(studioPublished.scopeKey, keys)));
  return new StudioUi(resolve(layersFrom(rows, ctx.package, ctx.companyId)).values);
});

/** Platform-level look for pages outside a workspace (sign-in pages, favicon). Reads platform settings only. */
export const studioPlatform = cache(async (): Promise<StudioUi> => {
  if (studioSafeMode()) return new StudioUi(resolve([]).values, true);
  try {
    const rows = await withSystemDb("studio: public branding", (tx) => tx.select({ scopeKey: studioPublished.scopeKey, scopeKind: studioPublished.scopeKind, config: studioPublished.config }).from(studioPublished).where(inArray(studioPublished.scopeKey, ["platform"])));
    return new StudioUi(resolve(layersFrom(rows, null, null)).values);
  } catch {
    return new StudioUi(resolve([]).values, true); // never let branding take the sign-in page down
  }
});

/** Platform-level look for the administrator area. */
export const studioForAdmin = cache(async (ctx: PlatformContext): Promise<StudioUi> => {
  if (studioSafeMode()) return new StudioUi(resolve([]).values, true);
  const rows = await withPlatformDb(ctx, (tx) => tx.select({ scopeKey: studioPublished.scopeKey, scopeKind: studioPublished.scopeKind, config: studioPublished.config }).from(studioPublished).where(inArray(studioPublished.scopeKey, ["platform"])));
  return new StudioUi(resolve(layersFrom(rows, null, null)).values);
});

/** Preview: the layers above the edited scope use published values; the edited scope uses its DRAFT. */
export function previewUi(layers: Layer[]): StudioUi {
  return new StudioUi(resolve(layers).values);
}
