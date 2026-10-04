import { resetLocalDatabase } from "../scripts/reset-local-db";

/** Every test run starts from a freshly migrated, isolated database. */
export default async function setup() {
  const { appUrl, ownerUrl } = await resetLocalDatabase(
    "bluewater_test",
    process.env.LOCAL_PG_SUPERUSER_URL ?? "postgres://postgres:postgres@localhost:5432/postgres",
  );
  process.env.DATABASE_URL = appUrl;
  process.env.DATABASE_MIGRATION_URL = ownerUrl;
}
