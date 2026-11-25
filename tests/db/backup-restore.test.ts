import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  assertRestoreTargetEmpty,
  exportBackup,
  restoreBackup,
  verifyBackupDatabase,
  type BackupDb,
} from "@/db/backup";
import type { DbClient } from "@/db/client";
import { checksumRows } from "@/lib/backups/codec";
import type { BackupPayload } from "@/lib/backups/crypto";
import {
  RESTORE_DRILL_CREATED_AT,
  seedRestoreDrillData,
} from "../../scripts/lib/restore-drill-data";
import { resetTestDb } from "../helpers/db";
import { createEphemeralDb, type EphemeralDb } from "./ephemeral-db";

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (result as { rows: Record<string, unknown>[] }).rows;
}

async function countRows(db: BackupDb, table: string): Promise<number> {
  const rows = rowsOf(
    await db.execute(
      sql`select count(*)::int as "count" from ${sql.identifier(table)}`,
    ),
  );
  return Number(rows[0]?.count ?? 0);
}

function clonePayload(payload: BackupPayload): BackupPayload {
  return JSON.parse(JSON.stringify(payload)) as BackupPayload;
}

function rechecksum(payload: BackupPayload, tableName: string): void {
  const table = payload.tables.find((entry) => entry.name === tableName);
  if (!table) throw new Error(`Missing test table: ${tableName}.`);
  table.checksum = checksumRows(table.rows);
}

describe("backup and restore (ephemeral PGlite)", () => {
  let source: EphemeralDb;
  let target: EphemeralDb;
  let sourceDb: BackupDb;
  let targetDb: BackupDb;

  beforeAll(async () => {
    source = await createEphemeralDb();
    target = await createEphemeralDb();
    sourceDb = source.db as unknown as BackupDb;
    targetDb = target.db as unknown as BackupDb;
  });

  afterAll(async () => {
    await target.client.close();
    await source.client.close();
  });

  beforeEach(async () => {
    await resetTestDb(source);
    await resetTestDb(target);
    await seedRestoreDrillData(source.db as unknown as DbClient);
  });

  it("exports and restores every table with verified checksums", async () => {
    const payload = await exportBackup(sourceDb, {
      now: RESTORE_DRILL_CREATED_AT,
      commit: "test-commit",
    });

    expect(payload.tables).toHaveLength(19);
    expect(payload.tables.every((table) => table.rowCount > 0)).toBe(true);
    expect(payload.totalRows).toBeGreaterThanOrEqual(19);

    const report = await restoreBackup(targetDb, payload);
    expect(report.verified).toBe(true);
    expect(report.totalRows).toBe(payload.totalRows);

    await verifyBackupDatabase(targetDb, payload);
    const restored = await exportBackup(targetDb);
    expect(restored.tables.map((table) => table.checksum)).toEqual(
      payload.tables.map((table) => table.checksum),
    );

    const selfReferences = rowsOf(
      await targetDb.execute(
        sql`select
              (select count(*)::int from menus where cloned_from_menu_id is not null) as "menus",
              (select count(*)::int from menu_import_items where duplicate_of_import_item_id is not null) as "importItems"`,
      ),
    )[0];
    expect(Number(selfReferences?.menus)).toBe(1);
    expect(Number(selfReferences?.importItems)).toBe(1);

    const scalarJson = rowsOf(
      await targetDb.execute(
        sql`select extraction_metadata->>'raw' as "raw" from menu_import_pages`,
      ),
    )[0];
    expect(scalarJson?.raw).toBe("drill-scalar-json");
  });

  it("rejects a non-empty target without changing it", async () => {
    const payload = await exportBackup(sourceDb);
    await seedRestoreDrillData(target.db as unknown as DbClient);

    await expect(restoreBackup(targetDb, payload)).rejects.toThrow(
      /non-empty/u,
    );
    await expect(
      assertRestoreTargetEmpty(targetDb, { allowMissingTables: true }),
    ).rejects.toThrow(/non-empty/u);
    expect(await countRows(targetDb, "users")).toBe(2);
    expect(await countRows(targetDb, "sessions")).toBe(1);
  });

  it("allows a pre-migration empty target but restore itself requires tables", async () => {
    const bareClient = new PGlite();
    try {
      const bareDb = drizzle(bareClient) as unknown as BackupDb;
      await expect(
        assertRestoreTargetEmpty(bareDb, { allowMissingTables: true }),
      ).resolves.toBeUndefined();
      await expect(assertRestoreTargetEmpty(bareDb)).rejects.toThrow(
        /missing the users table/u,
      );
    } finally {
      await bareClient.close();
    }
  });

  it("rejects a schema migration mismatch", async () => {
    const payload = clonePayload(await exportBackup(sourceDb));
    payload.schemaMigrations += 1;

    await expect(restoreBackup(targetDb, payload)).rejects.toThrow(
      /applied migrations/u,
    );
    expect(await countRows(targetDb, "users")).toBe(0);
  });

  it("rejects a modified row before opening a transaction", async () => {
    const payload = clonePayload(await exportBackup(sourceDb));
    payload.tables[0]!.rows[0]!.name = "Tampered Name";

    await expect(restoreBackup(targetDb, payload)).rejects.toThrow(
      /checksum verification failed/u,
    );
    expect(await countRows(targetDb, "users")).toBe(0);
  });

  it("rejects unknown and missing columns", async () => {
    const unknownColumn = clonePayload(await exportBackup(sourceDb));
    unknownColumn.tables[0]!.rows[0]!.rogue = "value";
    rechecksum(unknownColumn, "users");

    await expect(restoreBackup(targetDb, unknownColumn)).rejects.toThrow(
      /unknown column/u,
    );

    const missingColumn = clonePayload(await exportBackup(sourceDb));
    delete missingColumn.tables[0]!.rows[0]!.email;
    rechecksum(missingColumn, "users");

    await expect(restoreBackup(targetDb, missingColumn)).rejects.toThrow(
      /expected columns/u,
    );
    expect(await countRows(targetDb, "users")).toBe(0);
  });

  it("rolls back the entire restore when self-references cycle", async () => {
    const payload = clonePayload(await exportBackup(sourceDb));
    const menus = payload.tables.find((table) => table.name === "menus");
    if (!menus) throw new Error("Test payload is missing menus.");

    const parent = menus.rows.find((row) => row.clonedFromMenuId === null);
    const child = menus.rows.find((row) => row.clonedFromMenuId !== null);
    if (!parent || !child) throw new Error("Test payload is missing menu rows.");

    parent.clonedFromMenuId = child.id;
    rechecksum(payload, "menus");

    await expect(restoreBackup(targetDb, payload)).rejects.toThrow(/cycle/u);
    expect(await countRows(targetDb, "users")).toBe(0);
    expect(await countRows(targetDb, "menus")).toBe(0);
    expect(await countRows(targetDb, "sessions")).toBe(0);
  });

  it("rolls back when a foreign key is invalid", async () => {
    const payload = clonePayload(await exportBackup(sourceDb));
    const menus = payload.tables.find((table) => table.name === "menus");
    if (!menus) throw new Error("Test payload is missing menus.");

    menus.rows[0]!.restaurantId = "00000000-0000-4000-8000-999999999999";
    rechecksum(payload, "menus");

    await expect(restoreBackup(targetDb, payload)).rejects.toThrow();
    expect(await countRows(targetDb, "users")).toBe(0);
    expect(await countRows(targetDb, "restaurants")).toBe(0);
  });
});
