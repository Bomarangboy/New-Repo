/**
 * Package entitlement matrix. Packages are cumulative:
 *   instant_response (1) ⊂ follow_up_booking (2) ⊂ performance_reporting (3)
 *
 * Note the deliberate split: receiving advertising lead-form leads ("ad_lead_forms")
 * is available to every package, while advertising PERFORMANCE reporting is Bluewater Insight (3).
 */
export const PACKAGES = ["instant_response", "follow_up_booking", "performance_reporting"] as const;
export type PackageTier = (typeof PACKAGES)[number];

/** Customer-facing package names (owner decision D-44). Internal codes above never change. */
export const PACKAGE_NAMES: Record<PackageTier, string> = {
  instant_response: "Bluewater Connect",
  follow_up_booking: "Bluewater Engage",
  performance_reporting: "Bluewater Insight",
};

/** What each package adds, for menus where the name alone isn't enough. */
export const PACKAGE_TAGLINES: Record<PackageTier, string> = {
  instant_response: "Instant response",
  follow_up_booking: "Follow-up & booking",
  performance_reporting: "Performance reporting",
};

export const PACKAGE_LABELS: Record<PackageTier, string> = {
  instant_response: `${PACKAGE_NAMES.instant_response} — ${PACKAGE_TAGLINES.instant_response}`,
  follow_up_booking: `${PACKAGE_NAMES.follow_up_booking} — ${PACKAGE_TAGLINES.follow_up_booking}`,
  performance_reporting: `${PACKAGE_NAMES.performance_reporting} — ${PACKAGE_TAGLINES.performance_reporting}`,
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
