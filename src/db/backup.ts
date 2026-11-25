import { getTableColumns, sql } from "drizzle-orm";
import type {
  PgColumn,
  PgDatabase,
  PgQueryResultHKT,
} from "drizzle-orm/pg-core";

import {
  assertAllowedColumns,
  checksumRows,
  decodeRow,
  encodeTableRows,
  orderRowsForInsert,
  type EncodedRow,
} from "../lib/backups/codec";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupPayload,
  type BackupTablePayload,
  type BackupTableSummary,
} from "../lib/backups/crypto";
import { BACKUP_TABLES, type BackupTableSpec } from "./backup-tables";
import type * as schema from "./schema";

/**
 * The backup engine works with any Drizzle Postgres database (Neon in
 * production, PGlite in tests). It does not import the application's
 * server-only database client so scripts can use it directly.
 */
export type BackupDb = PgDatabase<PgQueryResultHKT, typeof schema>;

type Row = Record<string, unknown>;

const MAX_BIND_PARAMETERS = 30_000;

function resultRows(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (
    result !== null &&
    typeof result === "object" &&
    Array.isArray((result as { rows?: unknown }).rows)
  ) {
    return (result as { rows: Row[] }).rows;
  }
  throw new Error("Database returned an unexpected query result.");
}

/**
 * Returns the number of applied Drizzle migrations, or null when the target
 * has no migration journal. Export and restore both require a managed schema.
 */
export async function readSchemaMigrationCount(
  db: BackupDb,
): Promise<number | null> {
  const exists = resultRows(
    await db.execute(
      sql`select to_regclass('drizzle.__drizzle_migrations') is not null as "exists"`,
    ),
  )[0];
  if (!exists?.exists) return null;

  const counted = resultRows(
    await db.execute(
      sql`select count(*)::int as "count" from drizzle.__drizzle_migrations`,
    ),
  )[0];
  const count = Number(counted?.count);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("Could not read the Drizzle migration count.");
  }
  return count;
}

async function readTableRows(
  db: BackupDb,
  spec: BackupTableSpec,
): Promise<Row[]> {
  const rows = await db.select().from(spec.table);
  return rows as unknown as Row[];
}

function tableProperties(spec: BackupTableSpec): {
  properties: string[];
  databaseColumns: string[];
  columns: Record<string, PgColumn>;
} {
  const columns = getTableColumns(spec.table) as Record<string, PgColumn>;
  const properties = Object.keys(columns).sort();
  return {
    properties,
    databaseColumns: properties.map((property) => columns[property]!.name),
    columns,
  };
}

/**
 * Reads every application table and returns deterministic, checksummed rows.
 * Row order is normalized by primary key so the same database always produces
 * the same checksums.
 */
async function snapshotTables(db: BackupDb): Promise<BackupTablePayload[]> {
  const tables: BackupTablePayload[] = [];
  for (const spec of BACKUP_TABLES) {
    const rows = await readTableRows(db, spec);
    const encoded = encodeTableRows(rows, spec.primaryKey);
    tables.push({
      name: spec.name,
      rowCount: encoded.rows.length,
      checksum: encoded.checksum,
      rows: encoded.rows,
    });
  }
  return tables;
}

export type ExportBackupOptions = {
  now?: Date;
  commit?: string | null;
};

export async function exportBackup(
  db: BackupDb,
  options: ExportBackupOptions = {},
): Promise<BackupPayload> {
  // One repeatable-read, read-only transaction gives every table the same MVCC
  // snapshot. Without it, a concurrent delete between table reads could
  // produce a backup that cannot satisfy foreign keys on restore.
  return db.transaction(
    async (transaction) => {
      const tx = transaction as unknown as BackupDb;
      const schemaMigrations = await readSchemaMigrationCount(tx);
      if (schemaMigrations === null) {
        throw new Error(
          "Cannot back up a database without a Drizzle migration journal. Run npm run db:migrate first.",
        );
      }

      const tables = await snapshotTables(tx);
      return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        createdAt: (options.now ?? new Date()).toISOString(),
        commit: options.commit ?? null,
        schemaMigrations,
        totalRows: tables.reduce((total, table) => total + table.rowCount, 0),
        tables,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/**
 * A backup must contain every table in the manifest, in dependency order, with
 * exactly the columns the current schema expects. Missing columns could let
 * defaults silently replace restored data; unknown columns could target SQL
 * identifiers outside the schema.
 */
export function validateBackupAgainstManifest(payload: BackupPayload): void {
  if (payload.tables.length !== BACKUP_TABLES.length) {
    throw new Error(
      `Backup contains ${payload.tables.length} tables but this version expects ${BACKUP_TABLES.length}.`,
    );
  }

  BACKUP_TABLES.forEach((spec, index) => {
    const table = payload.tables[index];
    if (table?.name !== spec.name) {
      throw new Error(
        `Backup table order does not match this application. Expected ${spec.name} at position ${index + 1}.`,
      );
    }
    if (table.rows.length !== table.rowCount) {
      throw new Error(`Backup row count does not match rows for ${spec.name}.`);
    }
    if (checksumRows(table.rows) !== table.checksum) {
      throw new Error(`Backup checksum verification failed for ${spec.name}.`);
    }

    const { properties } = tableProperties(spec);
    assertAllowedColumns(table.rows, properties);
    for (const row of table.rows) {
      const keys = Object.keys(row).sort();
      if (
        keys.length !== properties.length ||
        keys.some((key, keyIndex) => key !== properties[keyIndex])
      ) {
        throw new Error(
          `Backup row for ${spec.name} does not contain the expected columns.`,
        );
      }
    }
  });
}

export type EmptyTargetOptions = {
  /**
   * When true, tables that do not exist yet are treated as empty. This is used
   * before applying migrations to a brand-new database. Restore itself keeps
   * the stricter default so a partially migrated schema fails closed.
   */
  allowMissingTables?: boolean;
};

function isUndefinedTable(error: unknown, depth = 0): boolean {
  if (!error || depth > 4) return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (candidate.code === "42P01") return true;
  return isUndefinedTable(candidate.cause, depth + 1);
}

export async function assertRestoreTargetEmpty(
  db: BackupDb,
  options: EmptyTargetOptions = {},
): Promise<void> {
  const allowMissingTables = options.allowMissingTables ?? false;
  const nonEmpty: string[] = [];

  for (const spec of BACKUP_TABLES) {
    let rows: Row[];
    try {
      rows = resultRows(
        await db.execute(
          sql`select count(*)::int as "count" from ${sql.identifier(spec.name)}`,
        ),
      );
    } catch (error) {
      if (isUndefinedTable(error)) {
        if (allowMissingTables) continue;
        throw new Error(
          `Target database is missing the ${spec.name} table. Apply migrations at the backup's commit before restoring.`,
        );
      }
      throw error;
    }

    const count = Number(rows[0]?.count ?? 0);
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`Could not count rows in ${spec.name}.`);
    }
    if (count > 0) nonEmpty.push(`${spec.name}=${count}`);
  }

  if (nonEmpty.length > 0) {
    throw new Error(
      `Refusing to restore into a non-empty database: ${nonEmpty.join(", ")}. Restore into a fresh database or branch.`,
    );
  }
}

/**
 * Converts a decoded value into a primitive the Postgres driver can bind
 * consistently. JSON values are serialized explicitly instead of relying on
 * driver-specific object handling; a JSONB column can contain a scalar string
 * that must remain quoted JSON, not plain text.
 */
function bindValue(column: PgColumn, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (column.dataType === "json") return JSON.stringify(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value);
  return value;
}

async function insertRows(
  db: BackupDb,
  spec: BackupTableSpec,
  rows: readonly Row[],
): Promise<void> {
  if (rows.length === 0) return;

  const { properties, databaseColumns, columns } = tableProperties(spec);
  if (properties.length === 0) {
    throw new Error(`Table ${spec.name} does not define any columns.`);
  }

  const chunkSize = Math.max(
    1,
    Math.floor(MAX_BIND_PARAMETERS / properties.length),
  );

  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const values = chunk.map(
      (row) =>
        sql`(${sql.join(
          properties.map(
            (property) =>
              sql`${bindValue(columns[property]!, row[property])}`,
          ),
          sql`, `,
        )})`,
    );
    await db.execute(
      sql`insert into ${sql.identifier(spec.name)} (${sql.join(
        databaseColumns.map((column) => sql.identifier(column)),
        sql`, `,
      )}) values ${sql.join(values, sql`, `)}`,
    );
  }
}

async function assertSnapshotMatches(
  db: BackupDb,
  payload: BackupPayload,
): Promise<void> {
  const actual = await snapshotTables(db);
  if (actual.length !== payload.tables.length) {
    throw new Error("Post-restore table count does not match the backup.");
  }

  for (let index = 0; index < actual.length; index += 1) {
    const expectedTable = payload.tables[index]!;
    const actualTable = actual[index]!;
    if (actualTable.name !== expectedTable.name) {
      throw new Error("Post-restore table order does not match the backup.");
    }
    if (
      actualTable.rowCount !== expectedTable.rowCount ||
      actualTable.checksum !== expectedTable.checksum
    ) {
      throw new Error(
        `Post-restore verification failed for ${expectedTable.name}.`,
      );
    }
  }
}

export type RestoreBackupOptions = {
  /**
   * Re-reads every table inside the restore transaction and compares checksums
   * with the backup. Enabled by default; disabling it is intended only for
   * diagnostics.
   */
  verify?: boolean;
};

export type RestoreBackupReport = {
  createdAt: string;
  commit: string | null;
  schemaMigrations: number;
  totalRows: number;
  tables: BackupTableSummary[];
  verified: boolean;
};

/**
 * Restores a full backup into a migrated, empty database in a single
 * transaction. Any failure, including a post-restore checksum mismatch, rolls
 * the entire restore back.
 */
export async function restoreBackup(
  db: BackupDb,
  payload: BackupPayload,
  options: RestoreBackupOptions = {},
): Promise<RestoreBackupReport> {
  validateBackupAgainstManifest(payload);

  const schemaMigrations = await readSchemaMigrationCount(db);
  if (schemaMigrations === null) {
    throw new Error(
      "Target database has no Drizzle migration journal. Apply migrations at the backup's commit before restoring.",
    );
  }
  if (schemaMigrations !== payload.schemaMigrations) {
    throw new Error(
      `Target schema has ${schemaMigrations} applied migrations but the backup was taken at ${payload.schemaMigrations}. Check out the backup's commit, apply matching migrations, and retry.`,
    );
  }

  const verify = options.verify ?? true;

  await db.transaction(async (transaction) => {
    const tx = transaction as unknown as BackupDb;
    await assertRestoreTargetEmpty(tx);

    for (let index = 0; index < BACKUP_TABLES.length; index += 1) {
      const spec = BACKUP_TABLES[index]!;
      const table = payload.tables[index]!;
      const rows = table.rows.map((row) => decodeRow(row as EncodedRow));
      const ordered = orderRowsForInsert(
        rows,
        spec.primaryKey,
        spec.selfReference,
      );
      await insertRows(tx, spec, ordered);
    }

    if (verify) {
      await assertSnapshotMatches(tx, payload);
    }
  });

  return {
    createdAt: payload.createdAt,
    commit: payload.commit,
    schemaMigrations: payload.schemaMigrations,
    totalRows: payload.totalRows,
    tables: payload.tables.map(({ name, rowCount, checksum }) => ({
      name,
      rowCount,
      checksum,
    })),
    verified: verify,
  };
}

/**
 * Compares a database against a decrypted backup without modifying it. Useful
 * after a restore or when validating a snapshot against a staging database.
 */
export async function verifyBackupDatabase(
  db: BackupDb,
  payload: BackupPayload,
): Promise<void> {
  validateBackupAgainstManifest(payload);

  const schemaMigrations = await readSchemaMigrationCount(db);
  if (schemaMigrations === null) {
    throw new Error("Database has no Drizzle migration journal.");
  }
  if (schemaMigrations !== payload.schemaMigrations) {
    throw new Error(
      `Database has ${schemaMigrations} applied migrations but the backup has ${payload.schemaMigrations}.`,
    );
  }

  await assertSnapshotMatches(db, payload);
}
