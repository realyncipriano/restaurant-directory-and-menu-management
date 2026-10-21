import "./load-env";

import { Pool } from "@neondatabase/serverless";

import { getDirectDatabaseUrl } from "../src/lib/db-url";
import {
  attachPoolErrorHandler,
  sanitizeDbError,
} from "../src/db/pool-errors";
import { maskConnectionString } from "../src/db/safety";

async function main() {
  const url = getDirectDatabaseUrl();
  const pool = new Pool({ connectionString: url });
  attachPoolErrorHandler(pool, "preflight");

  try {
    const identity = await pool.query<{
      database: string;
      user: string;
      version: string;
    }>(
      "select current_database() as database, current_user as user, version() as version",
    );

    const tables = await pool.query<{
      table_schema: string;
      table_name: string;
    }>(
      `select table_schema, table_name
         from information_schema.tables
        where table_schema in ('public', 'drizzle')
        order by table_schema, table_name`,
    );

    const journal = await pool.query<{ exists: boolean }>(
      "select to_regclass('drizzle.__drizzle_migrations') is not null as exists",
    );

    const row = identity.rows[0];
    console.log("DATABASE PREFLIGHT (read-only)");
    console.log(`Target: ${maskConnectionString(url)}`);
    console.log(`Database: ${row?.database}  User: ${row?.user}`);
    console.log(`Version: ${row?.version?.split(",")[0] ?? "unknown"}`);
    console.log(
      `Existing tables (public/drizzle): ${tables.rows.length === 0 ? "none" : tables.rows.map((table) => `${table.table_schema}.${table.table_name}`).join(", ")}`,
    );
    console.log(
      `Drizzle migration journal: ${journal.rows[0]?.exists ? "present" : "absent"}`,
    );
    console.log("No changes were made.");
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(sanitizeDbError(error));
  process.exitCode = 1;
});
