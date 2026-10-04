/**
 * LOCAL DEVELOPMENT stand-in for the every-minute scheduler: processes jobs every 15 seconds.
 *   npm run jobs:work
 * (In staging/production, Supabase Cron calls POST /api/jobs/run instead.)
 */
import "./load-env";
import { runDueJobs, runMaintenance } from "../src/server/jobs/runner";

async function loop() {
  for (;;) {
    try {
      const m = await runMaintenance();
      const r = await runDueJobs({ timeBudgetMs: 10_000 });
      if (r.claimed || (m.ran && (m.staleJobs || m.unknownSends || m.cancellations))) console.log(new Date().toISOString(), JSON.stringify({ ...r, maintenance: m }));
    } catch (e) {
      console.error("worker error:", e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
}
loop();
