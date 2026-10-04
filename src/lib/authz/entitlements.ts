/**
 * Package entitlement matrix. Packages are cumulative:
 *   instant_response (1) ⊂ follow_up_booking (2) ⊂ performance_reporting (3)
 *
 * Note the deliberate split: receiving advertising lead-form leads ("ad_lead_forms")
 * is available to every package, while advertising PERFORMANCE reporting is Package 3.
 */
export const PACKAGES = ["instant_response", "follow_up_booking", "performance_reporting"] as const;
export type PackageTier = (typeof PACKAGES)[number];

export const PACKAGE_LABELS: Record<PackageTier, string> = {
  instant_response: "Package 1 — Instant Response",
  follow_up_booking: "Package 2 — Follow-Up & Booking",
  performance_reporting: "Package 3 — Performance Reporting",
};

export const FEATURES = {
  leads: 1,
  lead_sources: 1,
  ad_lead_forms: 1,
  acknowledgment: 1,
  notifications: 1,
  inbox: 1,
  crm_builtin: 1,
  crm_external: 1,
  pipeline_board: 2,
  tasks: 2,
  sequences: 2,
  booking: 2,
  appointments: 2,
  ad_reporting: 3,
  campaign_reporting: 3,
  outcome_reporting: 3,
  scheduled_summaries: 3,
} as const;

export type Feature = keyof typeof FEATURES;

export function packageLevel(p: PackageTier): number {
  return PACKAGES.indexOf(p) + 1;
}

export function hasFeature(p: PackageTier, feature: Feature): boolean {
  return packageLevel(p) >= FEATURES[feature];
}

export function minimumPackageFor(feature: Feature): PackageTier {
  return PACKAGES[FEATURES[feature] - 1]!;
}
