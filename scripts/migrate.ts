/**
 * Applies database migrations (drizzle/*.sql) using the OWNER connection
 * (DATABASE_MIGRATION_URL). Optionally sets the application role's password from
 * APP_DB_ROLE_PASSWORD so it never has to appear in a migration file.
 *
 *   npm run db:migrate
 */
import "./load-env";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export async function runMigrations(url: string, appRolePassword?: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "drizzle", migrationsSchema: "app_migrations" });
    if (appRolePassword) {
      await sql.unsafe(`alter role bluewater_app with login password '${appRolePassword.replace(/'/g, "''")}'`);
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) {
    console.error("DATABASE_MIGRATION_URL is not set");
    process.exit(1);
  }
  runMigrations(url, process.env.APP_DB_ROLE_PASSWORD)
    .then(() => console.log("Migrations applied."))
    .catch((e) => {
      console.error("Migration failed:", e.message);
      process.exit(1);
    });
}
