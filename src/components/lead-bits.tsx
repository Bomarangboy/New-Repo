import { Badge } from "./ui";

export const STAGE_TONES = { new: "blue", contacted: "amber", booked: "purple", won: "green", lost: "neutral" } as const;
const STAGE_LABEL = { new: "New", contacted: "Contacted", booked: "Booked", won: "Won", lost: "Lost" } as const;

export function StageBadge({ stage }: { stage: keyof typeof STAGE_TONES }) {
  return <Badge tone={STAGE_TONES[stage]}>{STAGE_LABEL[stage]}</Badge>;
}

const SOURCE = {
  website_form: "Website form", manual: "Entered manually", csv_import: "Imported", meta_lead_form: "Facebook/Instagram",
  google_lead_form: "Google lead form", other: "Other",
} as Record<string, string>;

export function sourceName(source: string, label?: string | null): string {
  if (source === "website_form" && label) return label;
  return SOURCE[source] ?? source;
}

export function money(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 === 0 ? 0 : 2 });
}

export function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "?") + (p[1]?.[0] ?? "")).toUpperCase();
}
