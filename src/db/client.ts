import "server-only";

import { Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";

import { getDatabaseUrl } from "@/lib/env";
import { attachPoolErrorHandler } from "./pool-errors";
import * as schema from "./schema";

export type DbClient = NeonDatabase<typeof schema>;
export type DbTransaction = Parameters<
  Parameters<DbClient["transaction"]>[0]
>[0];

type DbHandle = {
  pool: Pool;
  db: DbClient;
};

const globalForDb = globalThis as unknown as {
  __rdmmDbHandles?: Map<string, DbHandle>;
};

function handles(): Map<string, DbHandle> {
  globalForDb.__rdmmDbHandles ??= new Map();
  return globalForDb.__rdmmDbHandles;
}

export function createDbHandle(connectionString: string): DbHandle {
  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  });
  attachPoolErrorHandler(pool, "db");
  const db = drizzle(pool, { schema });
  return { pool, db };
}

export function getDb(): DbClient {
  const url = getDatabaseUrl();
  const existing = handles().get(url);
  if (existing) {
    return existing.db;
  }
  const handle = createDbHandle(url);
  handles().set(url, handle);
  return handle.db;
}

export async function closeDb(): Promise<void> {
  const entries = [...handles().values()];
  handles().clear();
  await Promise.allSettled(entries.map((entry) => entry.pool.end()));
}

export { schema };
