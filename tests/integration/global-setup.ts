import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "@neondatabase/serverless";
import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

import { attachPoolErrorHandler } from "../../src/db/pool-errors";
import { evaluateTestTarget } from "../../src/db/safety";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const devUrls = [
  process.env.DATABASE_URL,
  process.env.DATABASE_URL_DIRECT,
  process.env.NEON_BRANCH_URL_POOLED,
  process.env.NEON_BRANCH_URL_DIRECT,
]
  .map((value) => value?.trim())
  .filter((value): value is string => Boolean(value));

if (devUrls.length > 0) {
  process.env.DEV_DATABASE_URLS = devUrls.join(",");
}

export default async function globalSetup() {
  const evaluation = evaluateTestTarget(process.env);
  if (!evaluation.safe) {
    console.warn(
      `[integration] Skipping database setup: ${evaluation.reason}`,
    );
    return;
  }

  const migrationsFolder = path.join(process.cwd(), "drizzle");
  if (!existsSync(migrationsFolder)) {
    throw new Error(
      "[integration] drizzle/ migrations folder is missing. Run npm run db:generate.",
    );
  }

  const pool = new Pool({ connectionString: evaluation.connectionString });
  attachPoolErrorHandler(pool, "integration-setup");
  try {
    await migrate(drizzle(pool), { migrationsFolder });
    console.log(
      `[integration] Migrations applied to ${evaluation.target.host}/${evaluation.target.database}`,
    );
  } finally {
    await pool.end();
  }
}
