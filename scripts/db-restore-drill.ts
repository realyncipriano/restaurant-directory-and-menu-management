import "./load-env";

import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  exportBackup,
  restoreBackup,
  verifyBackupDatabase,
  type BackupDb,
} from "../src/db/backup";
import type { DbClient } from "../src/db/client";
import {
  assertBackupKey,
  decryptBackup,
  encryptBackup,
  type BackupPayload,
} from "../src/lib/backups/crypto";
import { createEphemeralDb } from "../tests/db/ephemeral-db";
import {
  argument,
  formatBytes,
  readBackupFile,
  writeBackupFile,
} from "./lib/backup-files";
import {
  RESTORE_DRILL_CREATED_AT,
  seedRestoreDrillData,
} from "./lib/restore-drill-data";

function assertPayloadEqual(
  expected: BackupPayload,
  actual: BackupPayload,
): void {
  if (expected.createdAt !== actual.createdAt) {
    throw new Error("Backup creation time changed during encryption round-trip.");
  }
  if (expected.schemaMigrations !== actual.schemaMigrations) {
    throw new Error("Backup schema version changed during encryption round-trip.");
  }
  if (expected.totalRows !== actual.totalRows) {
    throw new Error("Backup row count changed during encryption round-trip.");
  }
  for (let index = 0; index < expected.tables.length; index += 1) {
    const left = expected.tables[index]!;
    const right = actual.tables[index]!;
    if (
      left.name !== right.name ||
      left.rowCount !== right.rowCount ||
      left.checksum !== right.checksum
    ) {
      throw new Error(`Backup table ${left.name} changed during encryption.`);
    }
  }
}

async function assertSecondRestoreRejected(
  db: BackupDb,
  payload: BackupPayload,
): Promise<void> {
  let nonEmptyRejected = false;
  try {
    await restoreBackup(db, payload);
  } catch (error) {
    nonEmptyRejected =
      error instanceof Error && /non-empty/u.test(error.message);
    if (!nonEmptyRejected) throw error;
  }
  if (!nonEmptyRejected) {
    throw new Error("Empty-target guard failed: the drill restored twice.");
  }
  console.log("Empty-target guard: second restore rejected.");
}

async function restoreIntoEmptyDatabase(
  payload: BackupPayload,
): Promise<void> {
  const target = await createEphemeralDb();
  try {
    const targetDb = target.db as unknown as BackupDb;
    const report = await restoreBackup(targetDb, payload);
    if (!report.verified) {
      throw new Error("Restore report did not verify the restored data.");
    }
    await verifyBackupDatabase(targetDb, payload);
    console.log(
      `Restore: ${report.totalRows} rows across ${report.tables.length} tables; checksums verified.`,
    );
    await assertSecondRestoreRejected(targetDb, payload);
  } finally {
    await target.client.close();
  }
}

async function runBackupFileDrill(file: string): Promise<void> {
  const payload = decryptBackup(
    readBackupFile(path.resolve(process.cwd(), file)),
    assertBackupKey(process.env.BACKUP_ENCRYPTION_KEY),
  );
  console.log("Restore drill (existing backup)");
  console.log(
    `Backup: ${payload.createdAt}; commit ${payload.commit ?? "unknown"}; ${payload.tables.length} tables, ${payload.totalRows} rows, schema ${payload.schemaMigrations}.`,
  );
  await restoreIntoEmptyDatabase(payload);
  console.log("Restore drill passed.");
}

async function runSyntheticDrill(): Promise<void> {
  const temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), "rdmm-restore-drill-"),
  );
  const source = await createEphemeralDb();
  try {
    const sourceDb = source.db as unknown as BackupDb;
    await seedRestoreDrillData(source.db as unknown as DbClient);
    const sourcePayload = await exportBackup(sourceDb, {
      now: RESTORE_DRILL_CREATED_AT,
      commit: "restore-drill",
    });

    console.log("Restore drill");
    console.log(
      `Source snapshot: ${sourcePayload.tables.length} tables, ${sourcePayload.totalRows} rows, schema ${sourcePayload.schemaMigrations}.`,
    );

    const ephemeralKey = randomBytes(48).toString("base64url");
    const encrypted = encryptBackup(sourcePayload, ephemeralKey);
    const written = writeBackupFile(
      temporaryDirectory,
      RESTORE_DRILL_CREATED_AT,
      encrypted,
    );
    const roundTripped = decryptBackup(
      readBackupFile(written.path),
      ephemeralKey,
    );
    assertPayloadEqual(sourcePayload, roundTripped);
    console.log(
      `Encrypted snapshot: ${formatBytes(written.bytes)}; decryption and checksums OK.`,
    );

    const tampered = Buffer.from(encrypted);
    tampered[tampered.byteLength - 1] ^= 0xff;
    let tamperRejected = false;
    try {
      decryptBackup(tampered, ephemeralKey);
    } catch {
      tamperRejected = true;
    }
    if (!tamperRejected) {
      throw new Error("Tamper detection failed: a modified backup decrypted.");
    }
    console.log("Tamper detection: modified ciphertext rejected.");

    await restoreIntoEmptyDatabase(roundTripped);
    console.log("Restore drill passed.");
  } finally {
    await source.client.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const file = argument("file");
  if (file) {
    await runBackupFileDrill(file);
  } else {
    await runSyntheticDrill();
  }
}

void main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Restore drill failed.",
  );
  process.exitCode = 1;
});
