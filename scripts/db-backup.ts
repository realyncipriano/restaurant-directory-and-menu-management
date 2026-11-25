import "./load-env";

import { execFileSync } from "node:child_process";

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

import { exportBackup, type BackupDb } from "../src/db/backup";
import {
  attachPoolErrorHandler,
  sanitizeDbError,
} from "../src/db/pool-errors";
import * as schema from "../src/db/schema";
import {
  assertDestructiveTestTarget,
  canonicalDatabaseIdentity,
  maskConnectionString,
} from "../src/db/safety";
import {
  assertBackupKey,
  encryptBackup,
  selectExpiredBackups,
} from "../src/lib/backups/crypto";
import { getDirectDatabaseUrl } from "../src/lib/db-url";
import {
  argument,
  backupOutputDirectory,
  flag,
  formatBytes,
  integerEnv,
  listBackupFiles,
  removeBackupFile,
  writeBackupFile,
} from "./lib/backup-files";

function currentCommit(): string | null {
  try {
    return (
      execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || null
    );
  } catch {
    return null;
  }
}

async function main() {
  const key = assertBackupKey(process.env.BACKUP_ENCRYPTION_KEY);
  const url = flag("test")
    ? assertDestructiveTestTarget(process.env)
    : getDirectDatabaseUrl();

  const identity = canonicalDatabaseIdentity(url);
  if (identity.hostIdentity.kind === "neon" && identity.hostIdentity.pooled) {
    console.warn(
      "Warning: the backup connection uses a pooled Neon endpoint. Set DATABASE_URL_DIRECT for consistent snapshots.",
    );
  }

  const outputDirectory = backupOutputDirectory(argument("out"));
  const now = new Date();
  const commit = currentCommit();

  const pool = new Pool({ connectionString: url, max: 2 });
  attachPoolErrorHandler(pool, "db-backup");
  const db = drizzle(pool, { schema });

  try {
    console.log(`Backup source: ${maskConnectionString(url)}`);
    const payload = await exportBackup(db as unknown as BackupDb, {
      now,
      commit,
    });
    const encrypted = encryptBackup(payload, key);
    const written = writeBackupFile(outputDirectory, now, encrypted);

    console.log(`Backup written: ${written.path}`);
    console.log(`Size: ${formatBytes(written.bytes)} (AES-256-GCM)`);
    console.log(`Created: ${payload.createdAt}`);
    console.log(`Schema migrations: ${payload.schemaMigrations}`);
    console.log(
      `Tables: ${payload.tables.length}  Rows: ${payload.totalRows}`,
    );
    console.log("Checksums: verified for every table before encryption");

    if (flag("no-prune")) {
      console.log("Retention pruning skipped (--no-prune).");
      return;
    }

    const retentionDays = integerEnv(
      process.env.BACKUP_RETENTION_DAYS,
      30,
    );
    const minCopies = integerEnv(process.env.BACKUP_MIN_COPIES, 3);
    if (retentionDays === 0) {
      console.log("Retention pruning disabled (BACKUP_RETENTION_DAYS=0).");
      return;
    }

    const expired = selectExpiredBackups(listBackupFiles(outputDirectory), {
      now,
      retentionDays,
      minCopies,
    }).filter((name) => name !== written.name);

    for (const name of expired) {
      removeBackupFile(outputDirectory, name);
    }

    console.log(
      expired.length === 0
        ? `Retention: nothing to prune (keeping at least ${minCopies}).`
        : `Retention: removed ${expired.length} expired backup(s); keeping at least ${minCopies}.`,
    );
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(sanitizeDbError(error));
  process.exitCode = 1;
});
