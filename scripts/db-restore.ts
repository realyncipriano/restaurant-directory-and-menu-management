import "./load-env";

import { existsSync } from "node:fs";
import path from "node:path";

import { sql } from "drizzle-orm";
import { Pool } from "@neondatabase/serverless";
import {
  drizzle,
  type NeonDatabase,
} from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

import {
  assertRestoreTargetEmpty,
  restoreBackup,
  type BackupDb,
} from "../src/db/backup";
import {
  attachPoolErrorHandler,
  sanitizeDbError,
} from "../src/db/pool-errors";
import * as schema from "../src/db/schema";
import { maskConnectionString } from "../src/db/safety";
import {
  assertBackupKey,
  decryptBackup,
} from "../src/lib/backups/crypto";
import {
  argument,
  flag,
  readBackupFile,
} from "./lib/backup-files";
import { resolveRestoreTarget } from "./lib/restore-target";

async function revokeEphemeralAuthState(
  db: NeonDatabase<typeof schema>,
): Promise<{ sessions: number; tokens: number; challenges: number }> {
  const result = await db.execute(sql`
    with deleted_sessions as (delete from sessions returning 1),
         deleted_tokens as (delete from auth_tokens returning 1),
         deleted_challenges as (delete from mfa_challenges returning 1)
    select (select count(*)::int from deleted_sessions) as "sessions",
           (select count(*)::int from deleted_tokens) as "tokens",
           (select count(*)::int from deleted_challenges) as "challenges"
  `);
  const rows =
    (result as { rows?: Record<string, unknown>[] }).rows ?? [];
  const row = rows[0] ?? {};
  return {
    sessions: Number(row.sessions ?? 0),
    tokens: Number(row.tokens ?? 0),
    challenges: Number(row.challenges ?? 0),
  };
}

async function main() {
  const file = argument("file");
  if (!file) {
    throw new Error(
      "Usage: npm run db:restore -- --file <backup.rdmm.enc> [--migrate] [--keep-sessions]",
    );
  }

  const key = assertBackupKey(process.env.BACKUP_ENCRYPTION_KEY);
  const payload = decryptBackup(readBackupFile(file), key);
  const targetUrl = resolveRestoreTarget(process.env);
  const pool = new Pool({ connectionString: targetUrl, max: 2 });
  attachPoolErrorHandler(pool, "db-restore");
  const db = drizzle(pool, { schema });

  try {
    if (flag("migrate")) {
      const migrationsFolder = path.join(process.cwd(), "drizzle");
      if (!existsSync(migrationsFolder)) {
        throw new Error(
          "No drizzle/ migrations folder found. Check out the backup's commit first.",
        );
      }
      console.log("Checking the restore target is empty before migrating...");
      await assertRestoreTargetEmpty(db as unknown as BackupDb, {
        allowMissingTables: true,
      });
      console.log("Applying Drizzle migrations to the restore target...");
      await migrate(db, { migrationsFolder });
    }

    console.log(`Restore target: ${maskConnectionString(targetUrl)}`);
    console.log(`Backup created: ${payload.createdAt}`);
    console.log(`Backup commit: ${payload.commit ?? "unknown"}`);

    const report = await restoreBackup(db as unknown as BackupDb, payload);
    console.log(
      `Restore complete: ${report.totalRows} rows across ${report.tables.length} tables.`,
    );
    console.log(
      `Schema migrations: ${report.schemaMigrations}. Post-restore checksums: verified.`,
    );

    if (flag("keep-sessions")) {
      console.warn(
        "WARNING: --keep-sessions preserved restored sessions and auth tokens. Revoke them manually before exposing the database.",
      );
    } else {
      const revoked = await revokeEphemeralAuthState(db);
      console.log(
        `Authentication state revoked: ${revoked.sessions} session(s), ${revoked.tokens} auth token(s), ${revoked.challenges} MFA challenge(s).`,
      );
    }

    console.log("");
    console.log("Next steps:");
    console.log(
      "  1. Keep the current MFA_ENCRYPTION_KEY. Rotating it makes restored TOTP secrets unreadable.",
    );
    if (!process.env.MFA_ENCRYPTION_KEY?.trim()) {
      console.log(
        "     MFA_ENCRYPTION_KEY is not set in this shell; confirm the application still has the original key.",
      );
    }
    console.log(
      "  2. Point the application's DATABASE_URL at the restored database, then redeploy or restart.",
    );
    console.log(
      "  3. Run the public smoke checks against the recovered deployment.",
    );
    console.log(
      "  4. Reconcile object storage (R2) references, then review the recovery in the incident record.",
    );
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(sanitizeDbError(error));
  process.exitCode = 1;
});
