import { describe, expect, it } from "vitest";

import { encodeTableRows } from "@/lib/backups/codec";
import {
  BACKUP_FORMAT,
  BACKUP_KEY_MIN_LENGTH,
  BACKUP_VERSION,
  assertBackupKey,
  backupFileName,
  decryptBackup,
  encryptBackup,
  latestBackupFileName,
  parseBackupFileName,
  parseBackupPayload,
  selectExpiredBackups,
  tableSummaries,
  type BackupPayload,
} from "@/lib/backups/crypto";

const KEY = "unit-test-backup-key-0123456789abcdef";

function makePayload(
  overrides: Partial<BackupPayload> = {},
): BackupPayload {
  const encoded = encodeTableRows(
    [
      {
        id: "row-1",
        createdAt: new Date("2026-01-15T12:00:00.123Z"),
        details: { z: 1, a: [true, null] },
      },
    ],
    ["id"],
  );

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: "2026-01-15T12:00:00.123Z",
    commit: "abc1234",
    schemaMigrations: 6,
    totalRows: 1,
    tables: [
      {
        name: "users",
        rowCount: 1,
        checksum: encoded.checksum,
        rows: encoded.rows,
      },
    ],
    ...overrides,
  };
}

function clonePayload(payload: BackupPayload): BackupPayload {
  return JSON.parse(JSON.stringify(payload)) as BackupPayload;
}

describe("backup encryption", () => {
  it("encrypts and decrypts a payload", () => {
    const payload = makePayload();
    const encrypted = encryptBackup(payload, KEY);
    const decrypted = decryptBackup(encrypted, KEY);

    expect(decrypted).toEqual(payload);
    expect(encrypted.subarray(0, 7).toString("ascii")).toBe("RDMMB1\n");
  });

  it("does not leave plaintext in the ciphertext", () => {
    const encrypted = encryptBackup(makePayload(), KEY);
    expect(encrypted.toString("utf8")).not.toContain("row-1");
    expect(encrypted.toString("utf8")).not.toContain("users");
  });

  it("rejects a wrong key", () => {
    const encrypted = encryptBackup(makePayload(), KEY);
    expect(() =>
      decryptBackup(encrypted, "another-unit-test-key-0123456789abcdef"),
    ).toThrow(/could not be decrypted/u);
  });

  it("rejects modified ciphertext", () => {
    const encrypted = encryptBackup(makePayload(), KEY);
    const tampered = Buffer.from(encrypted);
    tampered[tampered.byteLength - 1] ^= 0xff;

    expect(() => decryptBackup(tampered, KEY)).toThrow(
      /could not be decrypted/u,
    );
  });

  it("rejects a modified header", () => {
    const encrypted = encryptBackup(makePayload(), KEY);
    const tampered = Buffer.from(encrypted);
    tampered[0] = 0x00;

    expect(() => decryptBackup(tampered, KEY)).toThrow(
      /Unrecognized backup file/u,
    );
  });

  it("rejects truncated files", () => {
    const encrypted = encryptBackup(makePayload(), KEY);
    expect(() => decryptBackup(encrypted.subarray(0, 10), KEY)).toThrow(
      /Unrecognized backup file/u,
    );
  });

  it("rejects a payload whose inner checksum was altered", () => {
    const payload = clonePayload(makePayload());
    payload.tables[0]!.rows[0]!.id = "row-2";

    const encrypted = encryptBackup(payload, KEY);
    expect(() => decryptBackup(encrypted, KEY)).toThrow(
      /checksum verification failed/u,
    );
  });

  it("validates encryption keys", () => {
    expect(assertBackupKey(KEY)).toBe(KEY);
    expect(() => assertBackupKey("short")).toThrow(/at least/u);
    expect(() => assertBackupKey(undefined)).toThrow(
      new RegExp(`at least ${BACKUP_KEY_MIN_LENGTH}`, "u"),
    );
    expect(() =>
      assertBackupKey("replace-with-a-random-key-0123456789"),
    ).toThrow(/placeholder/u);
    expect(encryptBackup).toBeTypeOf("function");
  });
});

describe("backup payload validation", () => {
  it("rejects an unsupported format or version", () => {
    expect(() =>
      parseBackupPayload({ ...makePayload(), format: "other" }),
    ).toThrow(/format or version/u);
    expect(() =>
      parseBackupPayload({ ...makePayload(), version: 99 }),
    ).toThrow(/format or version/u);
  });

  it("rejects invalid metadata", () => {
    expect(() =>
      parseBackupPayload({ ...makePayload(), createdAt: "not-a-date" }),
    ).toThrow(/creation time/u);
    expect(() =>
      parseBackupPayload({ ...makePayload(), schemaMigrations: -1 }),
    ).toThrow(/schema version/u);
    expect(() =>
      parseBackupPayload({ ...makePayload(), schemaMigrations: 1.5 }),
    ).toThrow(/schema version/u);
    expect(() =>
      parseBackupPayload({ ...makePayload(), tables: [] }),
    ).toThrow(/does not contain any tables/u);
  });

  it("rejects duplicate and malformed tables", () => {
    const payload = makePayload();
    expect(() =>
      parseBackupPayload({
        ...payload,
        totalRows: 2,
        tables: [payload.tables[0], payload.tables[0]],
      }),
    ).toThrow(/duplicate table/u);

    expect(() =>
      parseBackupPayload({ ...payload, tables: [null] }),
    ).toThrow(/invalid table entry/u);

    expect(() =>
      parseBackupPayload({
        ...payload,
        tables: [{ ...payload.tables[0], name: "" }],
      }),
    ).toThrow(/without a name/u);
  });

  it("rejects row count, checksum, and total mismatches", () => {
    const payload = makePayload();
    const table = payload.tables[0]!;

    expect(() =>
      parseBackupPayload({
        ...payload,
        tables: [{ ...table, rowCount: 2 }],
      }),
    ).toThrow(/row count does not match/u);

    expect(() =>
      parseBackupPayload({
        ...payload,
        tables: [{ ...table, checksum: "not-a-checksum" }],
      }),
    ).toThrow(/checksum is invalid/u);

    expect(() =>
      parseBackupPayload({
        ...payload,
        tables: [
          {
            ...table,
            rows: [{ id: ["d", "2026-01-15T12:00:00.123Z"] }],
          },
        ],
      }),
    ).toThrow(/checksum verification failed/u);

    expect(() =>
      parseBackupPayload({ ...payload, totalRows: 5 }),
    ).toThrow(/total row count/u);
  });

  it("rejects invalid rows and encoded values", () => {
    const payload = makePayload();
    const table = payload.tables[0]!;

    expect(() =>
      parseBackupPayload({
        ...payload,
        tables: [{ ...table, rows: ["not-a-row"] }],
      }),
    ).toThrow(/invalid row/u);

    expect(() =>
      parseBackupPayload({
        ...payload,
        tables: [
          { ...table, rows: [{ id: ["unknown-tag", "value"] }] },
        ],
      }),
    ).toThrow(/invalid row value/u);
  });

  it("accepts a payload without totalRows and recomputes it", () => {
    const payload = makePayload();
    const withoutTotal = { ...payload } as Record<string, unknown>;
    delete withoutTotal.totalRows;

    expect(parseBackupPayload(withoutTotal).totalRows).toBe(1);
  });
});

describe("backup file names and retention", () => {
  it("builds file names that round-trip the creation time", () => {
    const createdAt = new Date("2026-01-15T12:00:00.123Z");
    const name = backupFileName(createdAt, Buffer.from("ciphertext"));

    expect(name).toMatch(/^rdmm-backup-\d{8}T\d{9}Z-[a-f0-9]{8}\.rdmm\.enc$/u);
    expect(parseBackupFileName(name)?.toISOString()).toBe(
      createdAt.toISOString(),
    );
    expect(parseBackupFileName("not-a-backup.enc")).toBeNull();
  });

  it("rejects file names with invalid calendar dates", () => {
    const valid = "rdmm-backup-20260115T120000123Z-abcdef12.rdmm.enc";
    expect(parseBackupFileName(valid)).not.toBeNull();

    for (const invalid of [
      "rdmm-backup-20261315T120000123Z-abcdef12.rdmm.enc",
      "rdmm-backup-20260232T120000123Z-abcdef12.rdmm.enc",
      "rdmm-backup-20260115T250000123Z-abcdef12.rdmm.enc",
      "rdmm-backup-20260115T126100123Z-abcdef12.rdmm.enc",
      "rdmm-backup-20260115T120061123Z-abcdef12.rdmm.enc",
    ]) {
      expect(parseBackupFileName(invalid), invalid).toBeNull();
    }
  });

  it("selects the latest backup by file name timestamp", () => {
    const names = [
      backupFileName(new Date("2026-01-10T00:00:00.000Z"), Buffer.from("a")),
      backupFileName(new Date("2026-02-10T00:00:00.000Z"), Buffer.from("b")),
      backupFileName(new Date("2026-01-20T00:00:00.000Z"), Buffer.from("c")),
    ];

    expect(latestBackupFileName(names)).toBe(names[1]);
    expect(latestBackupFileName([])).toBeNull();
    expect(latestBackupFileName(["other.txt"])).toBeNull();
  });

  it("prunes expired backups while preserving the newest copies", () => {
    const now = new Date("2026-03-31T00:00:00.000Z");
    const daysAgo = (days: number) =>
      new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const old = backupFileName(daysAgo(40), Buffer.from("old"));
    const edge = backupFileName(daysAgo(31), Buffer.from("edge"));
    const recent = backupFileName(daysAgo(10), Buffer.from("recent"));
    const newest = backupFileName(daysAgo(1), Buffer.from("newest"));
    const names = [old, edge, recent, newest, "notes.txt"];

    expect(
      selectExpiredBackups(names, {
        now,
        retentionDays: 30,
        minCopies: 3,
      }),
    ).toEqual([old]);

    expect(
      selectExpiredBackups(names, {
        now,
        retentionDays: 30,
        minCopies: 0,
      }),
    ).toEqual([edge, old]);

    expect(
      selectExpiredBackups(names, {
        now,
        retentionDays: 0,
        minCopies: 0,
      }),
    ).toEqual([]);
  });

  it("summarizes tables without including rows", () => {
    const payload = makePayload();
    const summaries = tableSummaries(payload);

    expect(summaries).toEqual([
      {
        name: "users",
        rowCount: 1,
        checksum: payload.tables[0]!.checksum,
      },
    ]);
    expect(summaries[0]).not.toHaveProperty("rows");
  });
});
