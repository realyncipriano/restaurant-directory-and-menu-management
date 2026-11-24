import "./load-env";

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "../src/db/schema";
import {
  attachPoolErrorHandler,
  sanitizeDbError,
} from "../src/db/pool-errors";
import { maskConnectionString } from "../src/db/safety";
import { getDirectDatabaseUrl } from "../src/lib/db-url";
import { createAdminRecoveryLink } from "../src/server/services/auth/recovery";
import { readAdminRecoveryConfig } from "./recover-admin-config";
import { recoveryOutputLines } from "./recover-admin-output";

async function main() {
  const config = readAdminRecoveryConfig(process.env);
  const databaseUrl = getDirectDatabaseUrl(process.env);
  const target = maskConnectionString(databaseUrl);

  console.log(`Admin recovery target: ${target}`);

  const pool = new Pool({ connectionString: databaseUrl });
  attachPoolErrorHandler(pool, "recover-admin");
  const db = drizzle(pool, { schema });

  try {
    const link = await createAdminRecoveryLink(db, config);
    const output = recoveryOutputLines({
      email: link.user.email,
      url: link.url,
      mfaReset: config.disableMfa,
    });

    console.warn(output.warning);
    for (const line of output.lines) {
      console.log(line);
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(sanitizeDbError(error));
  process.exitCode = 1;
});
