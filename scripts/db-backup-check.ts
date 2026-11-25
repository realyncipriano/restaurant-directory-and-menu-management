import "./load-env";

import { basename, resolve } from "node:path";

import {
  assertBackupKey,
  decryptBackup,
  latestBackupFileName,
  parseBackupFileName,
} from "../src/lib/backups/crypto";
import {
  argument,
  backupOutputDirectory,
  formatBytes,
  integerEnv,
  listBackupFiles,
  readBackupFile,
} from "./lib/backup-files";

function main(): void {
  const key = assertBackupKey(process.env.BACKUP_ENCRYPTION_KEY);
  const directory = backupOutputDirectory();
  const requested = argument("file");
  const name = requested
    ? basename(requested)
    : latestBackupFileName(listBackupFiles(directory));

  if (!name) {
    throw new Error(
      `No backups found in ${directory}. Run npm run db:backup first.`,
    );
  }

  const file = requested ? resolve(process.cwd(), requested) : resolve(directory, name);
  const encrypted = readBackupFile(file);
  const payload = decryptBackup(encrypted, key);
  const createdAt = Date.parse(payload.createdAt);
  const ageHours = (Date.now() - createdAt) / (60 * 60 * 1000);
  const maxAgeHours = integerEnv(
    argument("max-age-hours") ?? process.env.BACKUP_MAX_AGE_HOURS,
    26,
  );

  if (ageHours < -1) {
    throw new Error(
      "Backup creation time is in the future. Check the system clock before trusting this backup.",
    );
  }

  if (maxAgeHours > 0 && ageHours > maxAgeHours) {
    throw new Error(
      `Latest backup is ${ageHours.toFixed(1)} hours old, exceeding BACKUP_MAX_AGE_HOURS=${maxAgeHours}. Create a new backup or investigate the schedule.`,
    );
  }

  const fileDate = parseBackupFileName(name);
  if (fileDate && Math.abs(fileDate.getTime() - createdAt) > 1000) {
    console.warn(
      "Warning: the file name timestamp does not match the encrypted payload timestamp.",
    );
  }

  console.log(`Backup OK: ${name}`);
  console.log(`Created: ${payload.createdAt}`);
  console.log(`Age: ${ageHours.toFixed(1)} hours`);
  console.log(`Size: ${formatBytes(encrypted.byteLength)}`);
  console.log(`Schema migrations: ${payload.schemaMigrations}`);
  console.log(
    `Tables: ${payload.tables.length}  Rows: ${payload.totalRows}`,
  );
  console.log("Checksums: verified");
  console.log("Freshness: OK");
}

try {
  main();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Backup check failed.",
  );
  process.exitCode = 1;
}
