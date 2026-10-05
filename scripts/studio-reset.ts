/**
 * Platform Studio recovery, OUTSIDE the editor (docs/STUDIO.md → "If the Studio makes the admin area unusable").
 *
 *   npx tsx scripts/studio-reset.ts              # list what is published
 *   npx tsx scripts/studio-reset.ts platform     # publish an empty platform configuration (= built-in Bluewater look)
 *   npx tsx scripts/studio-reset.ts all          # same for every scope (platform, packages, companies)
 *
 * It publishes a new version (so the old ones stay in history and can be restored later), writes an activity-log
 * entry, and never touches customer records, messages, billing or automation settings.
 * Faster alternative that needs no database access: set STUDIO_SAFE_MODE=true in the hosting settings and redeploy.
 */
import "./load-env";
import { eq, sql } from "drizzle-orm";
import { closeDb } from "../src/lib/db/client";
import { withSystemDb } from "../src/lib/db/context";
import { studioDrafts, studioPublished, studioVersions } from "../src/lib/db/schema";
import { audit } from "../src/lib/audit";

async function main() {
  const target = process.argv[2];
  const rows = await withSystemDb("studio reset: list", (tx) => tx.select().from(studioPublished));
  if (!target) {
    if (!rows.length) console.log("Nothing is published in the Studio — the built-in look is in use.");
    for (const r of rows) console.log(`${r.scopeKey}: version ${r.version}, ${Object.keys(r.config).length} setting(s), published ${r.publishedAt.toISOString()}`);
    console.log("\nRun with 'platform' or 'all' to reset.");
    return;
  }
  const chosen = rows.filter((r) => target === "all" || r.scopeKey === target);
  if (!chosen.length) { console.log(`Nothing published for "${target}".`); return; }
  await withSystemDb("studio reset: publish defaults", async (tx) => {
    for (const r of chosen) {
      const version = r.version + 1;
      await tx.insert(studioVersions).values({ scopeKey: r.scopeKey, version, config: {}, summary: "Reset to the built-in look by the recovery script", changes: Object.keys(r.config) });
      await tx.update(studioPublished).set({ config: {}, version, publishedAt: new Date(), publishedByUserId: null }).where(eq(studioPublished.scopeKey, r.scopeKey));
      await tx.update(studioDrafts).set({ config: {}, revision: sql`${studioDrafts.revision} + 1`, updatedAt: new Date() }).where(eq(studioDrafts.scopeKey, r.scopeKey));
      await audit(tx, { companyId: r.companyId, actorUserId: null, actorType: "system", action: "studio.reset_by_script", targetType: "studio_scope", targetId: r.scopeKey, details: { version } });
      console.log(`Reset ${r.scopeKey} → version ${version} (built-in look). Earlier versions remain in the history.`);
    }
  });
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(closeDb);
