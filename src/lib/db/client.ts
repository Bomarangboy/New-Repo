import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

let client: ReturnType<typeof postgres> | null = null;
let db: Db | null = null;

/**
 * Raw database handle. Do NOT query with it directly from features: use
 * withCompanyDb / withPlatformDb / withSystemDb from ./context, which set the
 * Row Level Security context. Queries without context see no company data.
 */
export function getDb(): Db {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  client = postgres(url, {
    // Supabase's transaction pooler does not support prepared statements.
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
  db = drizzle(client, { schema });
  return db;
}

export async function closeDb(): Promise<void> {
  await client?.end({ timeout: 5 });
  client = null;
  db = null;
}

export async function setContext(
  tx: Tx,
  ctx: { companyId?: string | null; userId?: string | null; authUserId?: string | null; scope?: "platform" | "system" | null },
): Promise<void> {
  await tx.execute(sql`select
    set_config('app.company_id', ${ctx.companyId ?? ""}, true),
    set_config('app.user_id', ${ctx.userId ?? ""}, true),
    set_config('app.auth_user_id', ${ctx.authUserId ?? ""}, true),
    set_config('app.scope', ${ctx.scope ?? ""}, true)`);
}
