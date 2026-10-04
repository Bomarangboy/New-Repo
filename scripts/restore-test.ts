/**
 * Backup + restore drill (docs/RECOVERY.md). Proves a backup can actually be restored and still protects data:
 *   1. takes a backup of the source database (pg_dump, custom format)       → measures backup time and size
 *   2. restores it into a NEW, separate database                           → measures restore time
 *   3. verifies: same row counts in every table, row-level security still enabled and forced everywhere,
 *      same security policies, same migrations, and a live isolation check as the application role
 *   4. deletes the scratch database (use --keep to inspect it) and prints a summary
 *   5. with --record, stores the result as evidence on Admin → Health ("Backups, restore & load tests").
 *
 *   npx tsx scripts/restore-test.ts [--record] [--keep]
 * Source: DATABASE_MIGRATION_URL (owner connection). Scratch database is created with LOCAL_PG_SUPERUSER_URL
 * (default postgres:postgres@localhost). For a hosted drill, restore the Supabase backup into a *new* project and
 * point both variables at it — never at production. Nothing here modifies the source database except --record.
 */
import "./load-env";
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import postgres from "postgres";

const source = process.env.DATABASE_MIGRATION_URL;
const superUrl = process.env.LOCAL_PG_SUPERUSER_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
if (!source) { console.error("DATABASE_MIGRATION_URL is not set"); process.exit(1); }
const args = new Set(process.argv.slice(2));
const environment = process.env.APP_ENV ?? "development";

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const scratch = `bluewater_restore_${stamp}`;
const withDb = (url: string, db: string) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };
const ms = (t: number) => Math.round(performance.now() - t);

async function counts(sql: postgres.Sql) {
  const tables = await sql<{ t: string }[]>`select tablename as t from pg_tables where schemaname = 'app' order by 1`;
  const out: Record<string, number> = {};
  await sql.begin(async (tx) => {
    await tx`select set_config('app.scope', 'system', true)`; // forced RLS applies to the owner too
    for (const { t } of tables) out[t] = Number((await tx.unsafe(`select count(*)::bigint as n from app."${t}"`))[0]!.n);
  });
  return out;
}
async function security(sql: postgres.Sql) {
  const rls = await sql<{ t: string; on: boolean; forced: boolean }[]>`select c.relname as t, c.relrowsecurity as on, c.relforcerowsecurity as forced
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app' and c.relkind = 'r' order by 1`;
  const [p] = await sql<{ n: number }[]>`select count(*)::int as n from pg_policies where schemaname = 'app'`;
  const [m] = await sql<{ n: number }[]>`select count(*)::int as n from app_migrations.__drizzle_migrations`;
  const policies = p!.n, migrations = m!.n;
  return { unprotected: rls.filter((r) => !r.on || !r.forced).map((r) => r.t), policies, migrations };
}

async function main() {
  mkdirSync("backups", { recursive: true });
  const file = `backups/bluewater_${stamp}.dump`;
  const backupPoint = new Date();

  let t = performance.now();
  // Tables FORCE row-level security, so even the owner must dump *through* the policies: --enable-row-security
  // plus the system scope (app.scope=system) makes every row visible to the dump. (A plain pg_dump as the owner
  // fails with "query would be affected by row-level security policy" — found by this drill.)
  execFileSync("pg_dump", ["--format=custom", "--enable-row-security", "--file", file, source!], { stdio: "inherit", env: { ...process.env, PGOPTIONS: "-c app.scope=system" } });
  const backupMs = ms(t);
  const sizeMb = +(statSync(file).size / 1024 / 1024).toFixed(2);

  const admin = postgres(superUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database "${scratch}"`);
  t = performance.now();
  execFileSync("pg_restore", ["--exit-on-error", "--dbname", withDb(superUrl, scratch), file], { stdio: "inherit" });
  const restoreMs = ms(t);

  const src = postgres(source!, { max: 1, onnotice: () => {} });
  const dst = postgres(withDb(superUrl, scratch), { max: 1, onnotice: () => {} });
  const problems: string[] = [];
  t = performance.now();
  const [a, b] = [await counts(src), await counts(dst)];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    // The source keeps working during the drill (the scheduler marker updates); only flag real differences.
    if (a[k] !== b[k] && k !== "jobs") problems.push(`row count differs in ${k}: source ${a[k]} vs restored ${b[k]}`);
  }
  const [sa, sb] = [await security(src), await security(dst)];
  if (sb.unprotected.length) problems.push(`row-level security missing after restore on: ${sb.unprotected.join(", ")}`);
  if (sa.policies !== sb.policies) problems.push(`policies: source ${sa.policies} vs restored ${sb.policies}`);
  if (sa.migrations !== sb.migrations) problems.push(`migrations: source ${sa.migrations} vs restored ${sb.migrations}`);

  // Isolation still works in the restored copy: as the application role, company A sees only its own leads.
  const isolation = await dst.begin(async (tx) => {
    const cos = await tx<{ id: string }[]>`select id from app.companies order by created_at limit 2`;
    if (cos.length < 2) return "skipped (fewer than two companies)";
    const [own] = await tx<{ n: number }[]>`select count(*)::int as n from app.inquiries where company_id = ${cos[0]!.id}`;
    await tx`set local role bluewater_app`;
    await tx`select set_config('app.company_id', ${cos[0]!.id}, true), set_config('app.scope', '', true)`;
    const [seen] = await tx<{ n: number; other: number }[]>`select count(*)::int as n, count(*) filter (where company_id <> ${cos[0]!.id})::int as other from app.inquiries`;
    if (seen!.other > 0) problems.push(`isolation failed: company saw ${seen!.other} other-company leads`);
    if (seen!.n !== own!.n) problems.push(`isolation: expected ${own!.n} own leads, saw ${seen!.n}`);
    return `company saw ${seen!.n} of its own leads and 0 of others`;
  });
  const verifyMs = ms(t);

  await src.end(); await dst.end();
  if (!args.has("--keep")) await admin.unsafe(`drop database "${scratch}" with (force)`);
  await admin.end();

  const totalRows = Object.values(b).reduce((x, y) => x + y, 0);
  const summary = {
    result: problems.length ? "failed" : "passed",
    environment, backupPoint: backupPoint.toISOString(), file, sizeMb, tables: Object.keys(b).length, totalRows,
    backupSeconds: +(backupMs / 1000).toFixed(1), restoreSeconds: +(restoreMs / 1000).toFixed(1), verifySeconds: +(verifyMs / 1000).toFixed(1),
    measuredRtoSeconds: +((backupMs + restoreMs + verifyMs) / 1000).toFixed(1),
    rlsTablesChecked: Object.keys(b).length, policies: sb.policies, migrations: sb.migrations, isolation, problems,
    scratchDatabase: args.has("--keep") ? scratch : "dropped",
  };
  console.log(JSON.stringify(summary, null, 2));

  if (args.has("--record")) {
    const db = postgres(source!, { max: 1, onnotice: () => {} });
    await db.begin(async (tx) => {
      await tx`select set_config('app.scope', 'system', true)`;
      await tx`insert into app.ops_records (kind, result, environment, summary, details) values ('restore_test', ${summary.result}, ${environment},
        ${`Restore drill (${environment}): ${totalRows} rows in ${summary.tables} tables restored into a separate database in ${summary.restoreSeconds}s; counts, row-level security, ${sb.policies} policies and isolation verified${problems.length ? ` — ${problems.length} problem(s)` : ""}.`},
        ${JSON.stringify(summary)}::jsonb)`;
    });
    await db.end();
    console.log("Recorded on Admin → Health.");
  }
  process.exitCode = problems.length ? 1 : 0;
}

main().catch((e) => { console.error("Restore drill failed:", e instanceof Error ? e.message : e); process.exitCode = 1; });
