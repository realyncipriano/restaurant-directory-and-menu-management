import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import {
  checksumRows,
  type EncodedRow,
  type EncodedValue,
  decodeValue,
} from "./codec";

export const BACKUP_FORMAT = "rdmm-backup";
export const BACKUP_VERSION = 1;
export const BACKUP_FILE_PREFIX = "rdmm-backup-";
export const BACKUP_FILE_SUFFIX = ".rdmm.enc";
export const BACKUP_KEY_MIN_LENGTH = 32;

const BACKUP_MAGIC = Buffer.from("RDMMB1\n", "ascii");
const BACKUP_AAD = Buffer.from("rdmm-backup-v1", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_PLACEHOLDERS = [
  "replace-with",
  "changeme",
  "change-me",
  "example",
  "password",
];

export type BackupTablePayload = {
  name: string;
  rowCount: number;
  checksum: string;
  rows: EncodedRow[];
};

export type BackupPayload = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  commit: string | null;
  schemaMigrations: number;
  totalRows: number;
  tables: BackupTablePayload[];
};

export type BackupTableSummary = Omit<BackupTablePayload, "rows">;

export function assertBackupKey(secret: string | undefined): string {
  const key = secret ?? "";
  if (key.length < BACKUP_KEY_MIN_LENGTH) {
    throw new Error(
      `BACKUP_ENCRYPTION_KEY must be at least ${BACKUP_KEY_MIN_LENGTH} characters.`,
    );
  }
  const lowered = key.toLowerCase();
  if (KEY_PLACEHOLDERS.some((placeholder) => lowered.includes(placeholder))) {
    throw new Error(
      "BACKUP_ENCRYPTION_KEY looks like a placeholder. Generate a random key.",
    );
  }
  return key;
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256")
    .update("rdmm-backup-key-v1\0", "utf8")
    .update(secret, "utf8")
    .digest();
}

export function encryptBackup(
  payload: BackupPayload,
  secret: string,
): Buffer {
  const key = deriveKey(assertBackupKey(secret));
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(BACKUP_AAD);
  const plaintext = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), {
    level: 9,
  });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([BACKUP_MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

function isEncodedValue(value: unknown): value is EncodedValue {
  try {
    decodeValue(value);
    return true;
  } catch {
    return false;
  }
}

function assertEncodedRow(value: unknown): asserts value is EncodedRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Backup contains an invalid row.");
  }
  for (const child of Object.values(value)) {
    if (!isEncodedValue(child)) {
      throw new Error("Backup contains an invalid row value.");
    }
  }
}

export function parseBackupPayload(value: unknown): BackupPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Backup payload is invalid.");
  }
  const payload = value as Record<string, unknown>;
  if (payload.format !== BACKUP_FORMAT || payload.version !== BACKUP_VERSION) {
    throw new Error("Backup format or version is not supported.");
  }
  if (
    typeof payload.createdAt !== "string" ||
    Number.isNaN(Date.parse(payload.createdAt))
  ) {
    throw new Error("Backup creation time is invalid.");
  }
  if (
    typeof payload.schemaMigrations !== "number" ||
    !Number.isInteger(payload.schemaMigrations) ||
    payload.schemaMigrations < 0
  ) {
    throw new Error("Backup schema version is invalid.");
  }
  if (!Array.isArray(payload.tables) || payload.tables.length === 0) {
    throw new Error("Backup does not contain any tables.");
  }

  const names = new Set<string>();
  const tables: BackupTablePayload[] = [];
  let totalRows = 0;

  for (const entry of payload.tables) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Backup contains an invalid table entry.");
    }
    const table = entry as Record<string, unknown>;
    if (typeof table.name !== "string" || !table.name) {
      throw new Error("Backup contains a table without a name.");
    }
    if (names.has(table.name)) {
      throw new Error(`Backup contains a duplicate table: ${table.name}.`);
    }
    names.add(table.name);
    if (
      typeof table.rowCount !== "number" ||
      !Number.isInteger(table.rowCount) ||
      table.rowCount < 0
    ) {
      throw new Error(`Backup row count is invalid for ${table.name}.`);
    }
    if (typeof table.checksum !== "string" || !/^[a-f0-9]{64}$/u.test(table.checksum)) {
      throw new Error(`Backup checksum is invalid for ${table.name}.`);
    }
    if (!Array.isArray(table.rows) || table.rows.length !== table.rowCount) {
      throw new Error(`Backup row count does not match rows for ${table.name}.`);
    }
    table.rows.forEach(assertEncodedRow);
    const rows = table.rows as EncodedRow[];
    if (checksumRows(rows) !== table.checksum) {
      throw new Error(`Backup checksum verification failed for ${table.name}.`);
    }
    totalRows += table.rowCount;
    tables.push({
      name: table.name,
      rowCount: table.rowCount,
      checksum: table.checksum,
      rows,
    });
  }

  if (
    typeof payload.totalRows === "number" &&
    payload.totalRows !== totalRows
  ) {
    throw new Error("Backup total row count is incorrect.");
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: payload.createdAt,
    commit: typeof payload.commit === "string" ? payload.commit : null,
    schemaMigrations: payload.schemaMigrations,
    totalRows,
    tables,
  };
}

export function decryptBackup(blob: Buffer, secret: string): BackupPayload {
  try {
    const key = deriveKey(assertBackupKey(secret));
    if (
      blob.length <= BACKUP_MAGIC.length + IV_BYTES + TAG_BYTES ||
      !blob.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)
    ) {
      throw new Error("Unrecognized backup file.");
    }
    const ivStart = BACKUP_MAGIC.length;
    const tagStart = ivStart + IV_BYTES;
    const bodyStart = tagStart + TAG_BYTES;
    const iv = blob.subarray(ivStart, tagStart);
    const tag = blob.subarray(tagStart, bodyStart);
    const body = blob.subarray(bodyStart);

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(BACKUP_AAD);
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([
      decipher.update(body),
      decipher.final(),
    ]);
    const parsed: unknown = JSON.parse(gunzipSync(compressed).toString("utf8"));
    return parseBackupPayload(parsed);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith("Backup") ||
        error.message.startsWith("Unrecognized") ||
        error.message.includes("BACKUP_ENCRYPTION_KEY"))
    ) {
      throw error;
    }
    throw new Error(
      "Backup could not be decrypted. Check BACKUP_ENCRYPTION_KEY and file integrity.",
    );
  }
}

export function backupFileName(
  createdAt: Date,
  encrypted: Buffer,
): string {
  const stamp = createdAt.toISOString().replace(/[-:.]/gu, "");
  const fingerprint = createHash("sha256")
    .update(encrypted)
    .digest("hex")
    .slice(0, 8);
  return `${BACKUP_FILE_PREFIX}${stamp}-${fingerprint}${BACKUP_FILE_SUFFIX}`;
}

const FILE_PATTERN =
  /^rdmm-backup-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-[a-f0-9]{8}\.rdmm\.enc$/u;

export function parseBackupFileName(name: string): Date | null {
  const match = FILE_PATTERN.exec(name);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, millisecond] = match;
  const parts = [
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond),
  ] as const;
  const date = new Date(Date.UTC(...parts));

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== parts[0] ||
    date.getUTCMonth() !== parts[1] ||
    date.getUTCDate() !== parts[2] ||
    date.getUTCHours() !== parts[3] ||
    date.getUTCMinutes() !== parts[4] ||
    date.getUTCSeconds() !== parts[5] ||
    date.getUTCMilliseconds() !== parts[6]
  ) {
    return null;
  }
  return date;
}

export function tableSummaries(payload: BackupPayload): BackupTableSummary[] {
  return payload.tables.map(({ name, rowCount, checksum }) => ({
    name,
    rowCount,
    checksum,
  }));
}

export function selectExpiredBackups(
  names: readonly string[],
  options: { now: Date; retentionDays: number; minCopies: number },
): string[] {
  if (options.retentionDays <= 0) return [];
  const cutoff =
    options.now.getTime() - options.retentionDays * 24 * 60 * 60 * 1000;
  const backups = names
    .map((name) => ({ name, createdAt: parseBackupFileName(name) }))
    .filter(
      (file): file is { name: string; createdAt: Date } =>
        file.createdAt !== null,
    )
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

  return backups
    .slice(Math.max(0, options.minCopies))
    .filter((file) => file.createdAt.getTime() < cutoff)
    .map((file) => file.name);
}

export function latestBackupFileName(
  names: readonly string[],
): string | null {
  const backups = names
    .map((name) => ({ name, createdAt: parseBackupFileName(name) }))
    .filter(
      (entry): entry is { name: string; createdAt: Date } =>
        entry.createdAt !== null,
    )
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  return backups[0]?.name ?? null;
}
