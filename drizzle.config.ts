import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["app"],
  dbCredentials: { url: process.env.DATABASE_MIGRATION_URL ?? "" },
});
