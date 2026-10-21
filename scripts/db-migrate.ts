import "./load-env";

import path from "node:path";
import { existsSync } from "node:fs";

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

import { getDirectDatabaseUrl } from "../src/lib/db-url";
import {
  attachPoolErrorHandler,
  sanitizeDbError,
} from "../src/db/pool-errors";
import {
  assertDestructiveTestTarget,
  maskConnectionString,
} from "../src/db/safety";

function resolveTarget(): { url: string; label: string } {
  if (process.argv.includes("--test")) {
    return {
      url: assertDestructiveTestTarget(process.env),
      label: "TEST",
    };
  }
  return { url: getDirectDatabaseUrl(), label: "DEVELOPMENT" };
}

async function main() {
  const { url, label } = resolveTarget();
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  if (!existsSync(migrationsFolder)) {
    throw new Error(
      "No drizzle/ migrations folder found. Run npm run db:generate first.",
    );
  }

  const pool = new Pool({ connectionString: url });
  attachPoolErrorHandler(pool, "db-migrate");
  const db = drizzle(pool);

  try {
    const identity = await pool.query<{
      database: string;
      user: string;
    }>("select current_database() as database, current_user as user");

    const journal = await pool.query<{ exists: boolean }>(
      "select to_regclass('drizzle.__drizzle_migrations') is not null as exists",
    );
    const tables = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );

    console.log(`${label} migration target: ${maskConnectionString(url)}`);
    console.log(
      `Database: ${identity.rows[0]?.database}  User: ${identity.rows[0]?.user}`,
    );
    console.log(
      `Existing public tables: ${tables.rows.length === 0 ? "none" : tables.rows.map((row) => row.table_name).join(", ")}`,
    );

    if (tables.rows.length > 0 && !journal.rows[0]?.exists) {
      throw new Error(
        "The target database contains tables but no Drizzle migration journal. Refusing to modify an unmanaged database. Resolve this manually; no tables were dropped.",
      );
    }

    console.log("Applying pending Drizzle migrations (additive only)...");
    await migrate(db, { migrationsFolder });

    const after = await pool.query<{ count: string }>(
      "select count(*)::text as count from drizzle.__drizzle_migrations",
    );
    console.log(`Migrations complete. Journal entries: ${after.rows[0]?.count}`);
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(sanitizeDbError(error));
  process.exitCode = 1;
});
