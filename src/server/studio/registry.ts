import { PACKAGES, PACKAGE_NAMES, PACKAGE_TAGLINES, hasFeature, type Feature, type PackageTier } from "@/lib/authz/entitlements";

/**
 * Platform Studio settings registry (docs/STUDIO.md). EVERY editable setting is listed here with its default
 * (today's built-in look and wording), the levels it may be set at, and how it is validated. Anything not in
 * this list cannot be changed from the Studio — that is how authentication, permissions, package enforcement,
 * opt-out safeguards, critical notices and audit logging stay out of reach.
 *
 * Configuration is stored as a flat map { settingKey: value } per scope. The effective value for a company is
 * its own override, else its package's, else the platform's, else the default below.
 */
export type ScopeKind = "platform" | "package" | "company";
export const SCHEMA_VERSION = 1;

/* ---------------- Text content ---------------- */

interface TextDef { label: string; group: string; default: string; max: number; multiline?: boolean; required?: boolean; email?: boolean }

export const TEXT: Record<string, TextDef> = {
  "login.headline": { group: "Login page", label: "Headline beside the sign-in form", default: "Answer every lead. Follow up on time. Know what your advertising produces.", max: 140, required: true },
  "login.tagline": { group: "Login page", label: "Text under the headline", default: "Your leads, follow-up and results — in one secure place for your business.", max: 200 },
  "login.title": { group: "Login page", label: "Form heading", default: "Sign in", max: 40, required: true },
  "login.subtitle": { group: "Login page", label: "Form description", default: "Welcome back. Sign in to your company workspace.", max: 140 },
  "login.footer": { group: "Login page", label: "Note under the form", default: "Accounts are created by invitation. Ask your account owner for an invite.", max: 200 },

  "page.overview.title": { group: "Page headings", label: "Overview — heading", default: "Overview", max: 60, required: true },
  "page.overview.subtitle": { group: "Page headings", label: "Overview — description", default: "Your leads, follow-up and advertising in one place.", max: 200 },
  "page.leads.title": { group: "Page headings", label: "Leads — heading", default: "Leads", max: 60, required: true },
  "page.leads.subtitle": { group: "Page headings", label: "Leads — description", default: "Every inquiry, where it came from and what happened next.", max: 200 },
  "page.conversations.title": { group: "Page headings", label: "Conversations — heading", default: "Conversations", max: 60, required: true },
  "page.conversations.subtitle": { group: "Page headings", label: "Conversations — description", default: "Texts and emails with your leads, in one inbox.", max: 200 },
  "page.automations.title": { group: "Page headings", label: "Automations — heading", default: "Automations", max: 60, required: true },
  "page.automations.subtitle": { group: "Page headings", label: "Automations — description", default: "The messages Bluewater sends for you, and when.", max: 200 },
  "page.library.title": { group: "Page headings", label: "Sequence Library — heading", default: "Sequence Library", max: 60, required: true },
  "page.library.subtitle": { group: "Page headings", label: "Sequence Library — description", default: "Ready-made automatic replies and follow-ups from Bluewater. Copy one, make it yours, then turn it on.", max: 200 },
  "page.appointments.title": { group: "Page headings", label: "Appointments — heading", default: "Appointments", max: 60, required: true },
  "page.reports.title": { group: "Page headings", label: "Reports — heading", default: "Reports", max: 60, required: true },
  "page.reports.subtitle": { group: "Page headings", label: "Reports — description", default: "What your advertising cost, and what it produced in Bluewater.", max: 200 },
  "page.connected.title": { group: "Page headings", label: "Connected Accounts — heading", default: "Connected Accounts", max: 60, required: true },
  "page.connected.subtitle": { group: "Page headings", label: "Connected Accounts — description", default: "Where your leads come from, and the tools linked to Bluewater. Bluewater never asks for your account passwords.", max: 200 },
  "page.settings.title": { group: "Page headings", label: "Settings — heading", default: "Settings", max: 60, required: true },
  "page.settings.subtitle": { group: "Page headings", label: "Settings — description", default: "Company details, your plan and where customer records live.", max: 200 },
  "page.help.title": { group: "Page headings", label: "Help & Support — heading", default: "Help & Support", max: 60, required: true },

  "button.add_lead": { group: "Button labels", label: "Add a lead", default: "Add lead", max: 30, required: true },
  "button.import_leads": { group: "Button labels", label: "Import leads", default: "Import", max: 30, required: true },
  "button.export_leads": { group: "Button labels", label: "Export leads", default: "Export", max: 30, required: true },
  "button.connect_form": { group: "Button labels", label: "Connect website form (empty leads list)", default: "Connect your website form", max: 40, required: true },
  "button.send_support": { group: "Button labels", label: "Send a support request", default: "Send to Bluewater", max: 30, required: true },

  "empty.leads.title": { group: "Empty states", label: "No leads yet — title", default: "No leads yet", max: 60, required: true },
  "empty.leads.body": { group: "Empty states", label: "No leads yet — text", default: "New inquiries from your website form appear here automatically. You can also add a lead by hand or import a spreadsheet.", max: 300, multiline: true },
  "empty.conversations.title": { group: "Empty states", label: "No conversations — title", default: "No conversations yet", max: 60, required: true },
  "empty.conversations.body": { group: "Empty states", label: "No conversations — text", default: "Automatic acknowledgments and replies from your leads will appear here. You can also message a lead from their lead page.", max: 300, multiline: true },
  "empty.appointments.title": { group: "Empty states", label: "No appointments — title", default: "No upcoming appointments", max: 60, required: true },
  "empty.appointments.body": { group: "Empty states", label: "No appointments — text", default: "Add one from a lead's page, or share your booking link.", max: 300, multiline: true },

  "help.intro": { group: "Help & support", label: "Help page description", default: "Ask Bluewater a question or report a problem.", max: 200 },
  "help.hours": { group: "Help & support", label: "Support hours", default: "7am–1am Eastern, every day", max: 80, required: true },
  "help.email": { group: "Help & support", label: "Support email shown to clients (optional)", default: "", max: 120, email: true },
  "help.phone": { group: "Help & support", label: "Support phone shown to clients (optional)", default: "", max: 40 },
  "help.extra": { group: "Help & support", label: "Extra help text (optional)", default: "", max: 1000, multiline: true },

  "onboarding.title": { group: "Onboarding", label: "Checklist heading", default: "Getting started", max: 60, required: true },
  "onboarding.intro": { group: "Onboarding", label: "Instructions above the checklist (optional)", default: "", max: 600, multiline: true },
};

/* ---------------- Brand ---------------- */

export const FONTS = {
  figtree: { label: "Figtree (Bluewater default)", stack: '"Figtree Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif' },
  system: { label: "System font (each device's own)", stack: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  serif: { label: "Classic serif", stack: 'Georgia, Cambria, "Times New Roman", serif' },
} as const;
export type FontKey = keyof typeof FONTS;

export const BRAND_DEFAULTS = {
  "brand.name": "Bluewater Collective",
  "brand.wordmarkFirst": "Blue",
  "brand.wordmarkSecond": "water",
  "brand.wordmarkTagline": "COLLECTIVE",
  "brand.colorPrimary": "#0575FE",
  "brand.colorNavy": "#0F243D",
  "brand.font": "figtree" as FontKey,
  "brand.logoLight": "" as string, // asset id; empty = use the wordmark
  "brand.logoDark": "" as string,
  "brand.favicon": "" as string,
};

/* ---------------- Navigation ---------------- */

export interface NavDef { id: string; href: string; label: string; icon: string; action: string; feature?: Feature; locked?: boolean }

/** The workspace menu items the Studio may reorder/rename/hide. Locked items can be renamed and moved, never hidden. */
export const NAV_ITEMS: NavDef[] = [
  { id: "overview", href: "/app", label: "Overview", icon: "home", action: "workspace.view", locked: true },
  { id: "leads", href: "/app/leads", label: "Leads", icon: "users", action: "lead.view", feature: "leads" },
  { id: "conversations", href: "/app/conversations", label: "Conversations", icon: "message", action: "conversation.view", feature: "inbox" },
  { id: "automations", href: "/app/automations", label: "Automations", icon: "zap", action: "template.view", feature: "acknowledgment" },
  { id: "library", href: "/app/library", label: "Sequence Library", icon: "library", action: "library.view", feature: "acknowledgment" },
  { id: "appointments", href: "/app/appointments", label: "Appointments", icon: "calendar", action: "appointment.view", feature: "appointments" },
  { id: "reports", href: "/app/reports", label: "Reports", icon: "chart", action: "report.view", feature: "outcome_reporting" },
  { id: "connected", href: "/app/connected-accounts", label: "Connected Accounts", icon: "link", action: "integration.view", feature: "lead_sources" },
  { id: "settings", href: "/app/settings", label: "Settings", icon: "settings", action: "settings.view", locked: true },
  { id: "help", href: "/app/help", label: "Help & Support", icon: "help", action: "support.request", locked: true },
];
const NAV_IDS = NAV_ITEMS.map((n) => n.id);
/** Pages a package may land on after sign-in (only ones that package includes). */
export const LANDING_CHOICES = ["overview", "leads", "conversations", "appointments", "reports", "library"] as const;

/* ---------------- Dashboard ---------------- */

/** Overview number tiles: existing calculations only (docs/METRICS.md) — the Studio picks, never computes. */
export const METRIC_TILES = {
  new_inquiries: "New inquiries",
  acks_sent: "Acknowledgments sent",
  acks_failed: "Failed acknowledgments",
  needs_reply: "Waiting for your reply",
  unassigned_open: "Open leads with no one assigned",
  won_count: "Leads won",
  recorded_sales: "Recorded sales",
} as const;
export type MetricTile = keyof typeof METRIC_TILES;

export type CardSize = "sm" | "md" | "lg" | "full";
export const CARD_SIZES: Record<CardSize, string> = { sm: "Third", md: "Half", lg: "Two-thirds", full: "Full width" };

/** Overview cards. Each still only appears when the company's package and the person's role allow it. */
export const DASHBOARD_CARDS = {
  active_followups: { label: "Active follow-ups", feature: "sequences" as Feature, size: "sm" as CardSize },
  followup_results: { label: "Follow-up results", feature: "sequences" as Feature, size: "sm" as CardSize },
  upcoming_appointments: { label: "Upcoming appointments", feature: "appointments" as Feature, size: "sm" as CardSize },
  lead_activity: { label: "Lead activity chart", size: "lg" as CardSize },
  lead_sources: { label: "Lead sources", size: "sm" as CardSize },
  recent_leads: { label: "Recent leads", size: "lg" as CardSize },
  team_alerts: { label: "Team alerts", size: "sm" as CardSize },
  unassigned: { label: "Unassigned leads reminder", size: "sm" as CardSize },
  pipeline: { label: "Pipeline", feature: "pipeline_board" as Feature, size: "sm" as CardSize },
  ad_spend: { label: "Ad spend", feature: "ad_reporting" as Feature, size: "sm" as CardSize },
  recorded_sales: { label: "Recorded sales", size: "sm" as CardSize },
  getting_started: { label: "Getting started checklist", size: "full" as CardSize },
} as const;
export type CardId = keyof typeof DASHBOARD_CARDS;
export interface CardLayout { id: CardId; visible: boolean; size: CardSize }

export const DEFAULT_CARDS: CardLayout[] = (Object.keys(DASHBOARD_CARDS) as CardId[]).map((id) => ({ id, visible: true, size: DASHBOARD_CARDS[id].size }));

/* ---------------- Packages (display only) ---------------- */

const UPGRADE_DEFAULTS: Record<PackageTier, string> = {
  instant_response: "",
  follow_up_booking: `Multi-day follow-up, booking and appointments are part of ${PACKAGE_NAMES.follow_up_booking}. Contact Bluewater to upgrade.`,
  performance_reporting: `Advertising reports and the weekly summary are part of ${PACKAGE_NAMES.performance_reporting}. Contact Bluewater to upgrade.`,
};

/* ---------------- The full list of settings ---------------- */

export type SettingType = "text" | "color" | "font" | "asset" | "nav_order" | "nav_hidden" | "landing" | "tiles" | "cards";
export interface SettingDef { type: SettingType; label: string; group: string; scopes: ScopeKind[]; default: unknown; text?: TextDef; assetKind?: string }

const ALL: ScopeKind[] = ["platform", "package", "company"];

function build(): Record<string, SettingDef> {
  const r: Record<string, SettingDef> = {};
  r["brand.name"] = { type: "text", label: "Platform name", group: "Brand", scopes: ["platform"], default: BRAND_DEFAULTS["brand.name"], text: { group: "Brand", label: "Platform name", default: BRAND_DEFAULTS["brand.name"], max: 60, required: true } };
  r["brand.wordmarkFirst"] = { type: "text", label: "Wordmark — first part (navy/white)", group: "Brand", scopes: ALL, default: "Blue", text: { group: "Brand", label: "", default: "Blue", max: 20 } };
  r["brand.wordmarkSecond"] = { type: "text", label: "Wordmark — second part (brand color)", group: "Brand", scopes: ALL, default: "water", text: { group: "Brand", label: "", default: "water", max: 20 } };
  r["brand.wordmarkTagline"] = { type: "text", label: "Wordmark — small line underneath", group: "Brand", scopes: ALL, default: "COLLECTIVE", text: { group: "Brand", label: "", default: "COLLECTIVE", max: 24 } };
  r["brand.colorPrimary"] = { type: "color", label: "Brand color (buttons, links, highlights)", group: "Brand", scopes: ALL, default: BRAND_DEFAULTS["brand.colorPrimary"] };
  r["brand.colorNavy"] = { type: "color", label: "Sidebar color", group: "Brand", scopes: ALL, default: BRAND_DEFAULTS["brand.colorNavy"] };
  r["brand.font"] = { type: "font", label: "Font", group: "Brand", scopes: ALL, default: "figtree" };
  r["brand.logoLight"] = { type: "asset", label: "Logo for light backgrounds", group: "Brand", scopes: ALL, default: "", assetKind: "logo_light" };
  r["brand.logoDark"] = { type: "asset", label: "Logo for dark backgrounds (sidebar, login)", group: "Brand", scopes: ALL, default: "", assetKind: "logo_dark" };
  r["brand.favicon"] = { type: "asset", label: "Browser tab icon (favicon)", group: "Brand", scopes: ["platform"], default: "", assetKind: "favicon" };
  for (const [k, d] of Object.entries(TEXT)) {
    // Login-page wording is platform-wide (people aren't in a company yet when they see it).
    r[`text.${k}`] = { type: "text", label: d.label, group: d.group, scopes: k.startsWith("login.") ? ["platform"] : ALL, default: d.default, text: d };
  }
  for (const p of PACKAGES) {
    r[`package.${p}.name`] = { type: "text", label: "Display name", group: `Package: ${PACKAGE_NAMES[p]}`, scopes: ["platform"], default: PACKAGE_NAMES[p], text: { group: "", label: "", default: PACKAGE_NAMES[p], max: 40, required: true } };
    r[`package.${p}.description`] = { type: "text", label: "Short description", group: `Package: ${PACKAGE_NAMES[p]}`, scopes: ["platform"], default: PACKAGE_TAGLINES[p], text: { group: "", label: "", default: PACKAGE_TAGLINES[p], max: 160 } };
    r[`package.${p}.upgrade`] = { type: "text", label: "Upgrade message (shown where a feature needs this package)", group: `Package: ${PACKAGE_NAMES[p]}`, scopes: ["platform"], default: UPGRADE_DEFAULTS[p], text: { group: "", label: "", default: UPGRADE_DEFAULTS[p], max: 240, multiline: true } };
    r[`package.${p}.displayPrice`] = { type: "text", label: "Display price (text only — never changes what anyone pays)", group: `Package: ${PACKAGE_NAMES[p]}`, scopes: ["platform"], default: "", text: { group: "", label: "", default: "", max: 40 } };
  }
  r["nav.order"] = { type: "nav_order", label: "Menu order", group: "Navigation", scopes: ALL, default: NAV_IDS };
  r["nav.hidden"] = { type: "nav_hidden", label: "Hidden menu items", group: "Navigation", scopes: ALL, default: [] };
  for (const n of NAV_ITEMS) r[`nav.label.${n.id}`] = { type: "text", label: `Menu label: ${n.label}`, group: "Navigation", scopes: ALL, default: n.label, text: { group: "", label: "", default: n.label, max: 30, required: true } };
  r["nav.landing"] = { type: "landing", label: "Page shown after sign-in", group: "Navigation", scopes: ["platform", "package", "company"], default: "overview" };
  r["dashboard.tiles"] = { type: "tiles", label: "Number tiles at the top of Overview", group: "Overview layout", scopes: ALL, default: ["new_inquiries", "acks_sent", "acks_failed", "needs_reply"] };
  r["dashboard.cards"] = { type: "cards", label: "Overview cards (order, size, shown/hidden)", group: "Overview layout", scopes: ALL, default: DEFAULT_CARDS };
  return r;
}

export const SETTINGS: Record<string, SettingDef> = build();
export type Flat = Record<string, unknown>;

export const DEFAULTS: Flat = Object.fromEntries(Object.entries(SETTINGS).map(([k, d]) => [k, d.default]));

/* ---------------- Validation & sanitizing ---------------- */

const HEX = /^#[0-9a-fA-F]{6}$/;
const MARKUP = /<\s*\/?\s*[a-zA-Z!?]|javascript:|data:text\/html|\bon[a-z]+\s*=/i;

/** Relative luminance / contrast (WCAG 2.x). */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
/** Mixes a color toward black (amount 0–1). */
export function darken(hex: string, amount: number): string {
  return "#" + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount)).toString(16).padStart(2, "0")).join("");
}
export function lighten(hex: string, amount: number): string {
  return "#" + [1, 3, 5].map((i) => { const v = parseInt(hex.slice(i, i + 2), 16); return Math.round(v + (255 - v) * amount).toString(16).padStart(2, "0"); }).join("");
}

/** Cleans text: plain text only, no control characters; null when it contains markup/script-like content. */
export function cleanStudioText(v: unknown, def: TextDef): { value?: string; error?: string } {
  if (typeof v !== "string") return { error: "must be text" };
  const s = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(def.multiline ? /$^/ : /\n+/g, " ").trim();
  if (MARKUP.test(s)) return { error: "can't contain HTML, scripts or code — plain text only" };
  if (s.length > def.max) return { error: `is too long (${s.length} of ${def.max} characters)` };
  if (def.required && !s) return { error: "can't be empty" };
  if (def.email && s && !/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(s)) return { error: "isn't a valid email address" };
  return { value: s };
}

export interface Validation { clean: Flat; errors: string[]; warnings: string[] }

/** Validates one scope's overrides. Unknown keys, wrong levels and unsafe values are rejected with plain-language reasons. */
export function validateOverrides(scope: ScopeKind, input: Flat, packageTier?: PackageTier | null): Validation {
  const clean: Flat = {}, errors: string[] = [], warnings: string[] = [];
  for (const [key, raw] of Object.entries(input)) {
    const def = SETTINGS[key];
    if (!def) { errors.push(`"${key}" isn't a setting the Studio can change.`); continue; }
    const name = def.label || key;
    if (!def.scopes.includes(scope)) { errors.push(`${name} can only be set at the ${def.scopes.join(" or ")} level.`); continue; }
    switch (def.type) {
      case "text": {
        const r = cleanStudioText(raw, def.text!);
        if (r.error) errors.push(`${name} ${r.error}.`); else clean[key] = r.value;
        break;
      }
      case "color": {
        if (typeof raw !== "string" || !HEX.test(raw)) { errors.push(`${name} must be a color like #0575FE.`); break; }
        const c = raw.toUpperCase();
        if (key === "brand.colorPrimary") {
          // Buttons use white text on this color; links use a darker shade of it on white.
          const onWhite = contrast(c, "#FFFFFF");
          if (onWhite < 3) { errors.push(`${name}: white button text on ${c} is too hard to read (contrast ${onWhite.toFixed(1)}:1, needs at least 3:1). Pick a darker color.`); break; }
          if (onWhite < 4.5) warnings.push(`${name}: white text on ${c} has contrast ${onWhite.toFixed(1)}:1 — fine for bold buttons, links use a darker shade automatically.`);
        }
        if (key === "brand.colorNavy") {
          const w = contrast(c, "#FFFFFF");
          if (w < 7) { errors.push(`${name}: the white menu text on ${c} is too hard to read (contrast ${w.toFixed(1)}:1, needs at least 7:1). Pick a darker color.`); break; }
        }
        clean[key] = c;
        break;
      }
      case "font":
        if (typeof raw !== "string" || !(raw in FONTS)) errors.push(`${name} must be one of: ${Object.values(FONTS).map((f) => f.label).join(", ")}.`); else clean[key] = raw;
        break;
      case "asset":
        if (raw === "" || (typeof raw === "string" && /^[0-9a-f-]{36}$/i.test(raw))) clean[key] = raw; else errors.push(`${name} must be an uploaded image.`);
        break;
      case "nav_order": {
        if (!Array.isArray(raw) || raw.length !== NAV_IDS.length || NAV_IDS.some((id) => !raw.includes(id))) { errors.push("The menu order must include every menu item exactly once."); break; }
        clean[key] = raw.map(String);
        break;
      }
      case "nav_hidden": {
        if (!Array.isArray(raw) || raw.some((id) => !NAV_IDS.includes(String(id)))) { errors.push("Hidden menu items must be known menu items."); break; }
        const locked = raw.filter((id) => NAV_ITEMS.find((n) => n.id === id)?.locked);
        if (locked.length) { errors.push(`These menu items are essential and can't be hidden: ${locked.map((id) => NAV_ITEMS.find((n) => n.id === id)!.label).join(", ")}.`); break; }
        clean[key] = [...new Set(raw.map(String))];
        break;
      }
      case "landing": {
        if (typeof raw !== "string" || !(LANDING_CHOICES as readonly string[]).includes(raw)) { errors.push(`${name} must be one of: ${LANDING_CHOICES.join(", ")}.`); break; }
        if (scope === "package" && packageTier) {
          const n = NAV_ITEMS.find((x) => x.id === raw)!;
          if (n.feature && !hasFeature(packageTier, n.feature)) { errors.push(`${name}: ${PACKAGE_NAMES[packageTier]} doesn't include that page.`); break; }
        }
        clean[key] = raw;
        break;
      }
      case "tiles": {
        if (!Array.isArray(raw) || raw.length < 1 || raw.length > 4 || raw.some((m) => !(String(m) in METRIC_TILES))) { errors.push("Choose 1 to 4 number tiles from the supported list."); break; }
        clean[key] = [...new Set(raw.map(String))];
        break;
      }
      case "cards": {
        const ids = Object.keys(DASHBOARD_CARDS);
        if (!Array.isArray(raw) || raw.length !== ids.length) { errors.push("The Overview layout must list every card exactly once."); break; }
        const out: CardLayout[] = [];
        for (const c of raw as Record<string, unknown>[]) {
          if (!c || !ids.includes(String(c.id)) || out.some((o) => o.id === c.id) || !(String(c.size) in CARD_SIZES)) { errors.push("The Overview layout has an unknown or repeated card."); break; }
          out.push({ id: String(c.id) as CardId, visible: c.visible !== false, size: String(c.size) as CardSize });
        }
        if (out.length === ids.length) {
          if (!out.some((c) => c.visible)) errors.push("Keep at least one Overview card visible.");
          else clean[key] = out;
        }
        break;
      }
    }
  }
  return { clean, errors, warnings };
}

/* ---------------- Inheritance ---------------- */

export interface Layer { scope: ScopeKind; label: string; values: Flat }

/** Effective configuration: default ← platform ← package ← company, per setting. Also says where each value came from. */
export function resolve(layers: Layer[]): { values: Flat; source: Record<string, string> } {
  const values: Flat = { ...DEFAULTS };
  const source: Record<string, string> = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, "Built-in default"]));
  for (const l of layers) {
    for (const [k, v] of Object.entries(l.values)) {
      if (!(k in SETTINGS) || !SETTINGS[k]!.scopes.includes(l.scope)) continue; // ignore stale/foreign keys safely
      values[k] = v;
      source[k] = l.label;
    }
  }
  return { values, source };
}

export function scopeKeyFor(kind: ScopeKind, id?: string | null): string {
  return kind === "platform" ? "platform" : `${kind}:${id}`;
}
export function parseScopeKey(key: string): { kind: ScopeKind; packageTier: PackageTier | null; companyId: string | null } | null {
  if (key === "platform") return { kind: "platform", packageTier: null, companyId: null };
  const [kind, id] = key.split(":");
  if (kind === "package" && (PACKAGES as readonly string[]).includes(id ?? "")) return { kind: "package", packageTier: id as PackageTier, companyId: null };
  if (kind === "company" && id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { kind: "company", packageTier: null, companyId: id };
  return null;
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
