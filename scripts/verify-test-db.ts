import "./load-env";

import { Pool } from "@neondatabase/serverless";

import {
  attachPoolErrorHandler,
  sanitizeDbError,
} from "../src/db/pool-errors";
import {
  evaluateTestTarget,
  maskConnectionString,
} from "../src/db/safety";

async function main() {
  const evaluation = evaluateTestTarget(process.env);
  if (!evaluation.safe) {
    console.error(`BLOCKED: ${evaluation.reason}`);
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString: evaluation.connectionString });
  attachPoolErrorHandler(pool, "verify-test-db");
  try {
    const result = await pool.query<{
      database: string;
      user: string;
      version: string;
    }>(
      "select current_database() as database, current_user as user, version() as version",
    );
    const row = result.rows[0];
    console.log(
      `Test database verified: ${maskConnectionString(evaluation.connectionString)} (db=${row?.database}, user=${row?.user})`,
    );
    console.log(`PostgreSQL: ${row?.version?.split(",")[0] ?? "unknown"}`);
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(sanitizeDbError(error));
  process.exitCode = 1;
});
