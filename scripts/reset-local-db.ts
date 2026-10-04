/**
 * LOCAL MACHINE ONLY. Drops and recreates a local database with the two roles the
 * app expects (owner for migrations, bluewater_app for the running app), then migrates.
 *
 *   LOCAL_PG_SUPERUSER_URL=postgres://postgres:postgres@localhost:5432/postgres npm run db:reset-local
 *   (pass a database name as the first argument; default bluewater_dev)
 */
import postgres from "postgres";
import { runMigrations } from "./migrate";

export const LOCAL_APP_PASSWORD = "bluewater_app_local";
export const LOCAL_OWNER_PASSWORD = "bluewater_owner_local";

export async function resetLocalDatabase(dbName: string, superuserUrl: string): Promise<{ appUrl: string; ownerUrl: string }> {
  if (!/^bluewater_[a-z0-9_]+$/.test(dbName)) throw new Error("Refusing: local database names must start with bluewater_");
  const host = new URL(superuserUrl);
  if (!["localhost", "127.0.0.1", "::1"].includes(host.hostname)) throw new Error("Refusing to reset a non-local database server.");
  const su = postgres(superuserUrl, { max: 1, onnotice: () => {} });
  try {
    await su.unsafe(`do $$ begin
      if not exists (select from pg_roles where rolname = 'bluewater_owner') then
        create role bluewater_owner login createrole password '${LOCAL_OWNER_PASSWORD}';
      end if;
      if not exists (select from pg_roles where rolname = 'bluewater_app') then
        create role bluewater_app login nobypassrls password '${LOCAL_APP_PASSWORD}';
      end if;
    end $$;`);
    await su.unsafe(`alter role bluewater_app login nobypassrls password '${LOCAL_APP_PASSWORD}'`);
    await su.unsafe(`select pg_terminate_backend(pid) from pg_stat_activity where datname = '${dbName}' and pid <> pg_backend_pid()`);
    await su.unsafe(`drop database if exists ${dbName}`);
    await su.unsafe(`create database ${dbName} owner bluewater_owner`);
  } finally {
    await su.end();
  }
  const base = `${host.protocol}//`;
  const hp = `${host.hostname}:${host.port || 5432}`;
  const ownerUrl = `${base}bluewater_owner:${LOCAL_OWNER_PASSWORD}@${hp}/${dbName}`;
  const appUrl = `${base}bluewater_app:${LOCAL_APP_PASSWORD}@${hp}/${dbName}`;
  await runMigrations(ownerUrl);
  return { appUrl, ownerUrl };
}

if (process.argv[1]?.endsWith("reset-local-db.ts")) {
  const name = process.argv[2] ?? "bluewater_dev";
  resetLocalDatabase(name, process.env.LOCAL_PG_SUPERUSER_URL ?? "postgres://postgres:postgres@localhost:5432/postgres")
    .then(({ appUrl, ownerUrl }) => {
      console.log(`Database ${name} recreated and migrated.`);
      console.log(`DATABASE_URL=${appUrl}`);
      console.log(`DATABASE_MIGRATION_URL=${ownerUrl}`);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
