import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "@neondatabase/serverless";
import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

import { attachPoolErrorHandler } from "../../src/db/pool-errors";
import {
  assertSafeTestTarget,
  collectDevUrls,
} from "../../src/db/safety";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const devUrls = collectDevUrls(process.env);
if (devUrls.length > 0) {
  process.env.DEV_DATABASE_URLS = devUrls.join(",");
}

export default async function globalSetup() {
  const evaluation = assertSafeTestTarget(process.env);

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
