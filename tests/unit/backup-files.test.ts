import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  argument,
  backupOutputDirectory,
  flag,
  formatBytes,
  integerEnv,
  listBackupFiles,
  readBackupFile,
  removeBackupFile,
  writeBackupFile,
} from "../../scripts/lib/backup-files";

describe("backup CLI helpers", () => {
  const originalArgv = process.argv;
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "rdmm-backup-files-"));
  });

  afterEach(() => {
    process.argv = originalArgv;
    delete process.env.BACKUP_OUTPUT_DIR;
    rmSync(directory, { recursive: true, force: true });
  });

  it("parses inline and separated arguments", () => {
    process.argv = [
      "node",
      "script",
      "--file",
      "backup.rdmm.enc",
      "--out=elsewhere",
      "--no-prune",
    ];

    expect(argument("file")).toBe("backup.rdmm.enc");
    expect(argument("out")).toBe("elsewhere");
    expect(argument("missing")).toBeUndefined();
    expect(flag("no-prune")).toBe(true);
    expect(flag("test")).toBe(false);
  });

  it("parses non-negative integers with a fallback", () => {
    expect(integerEnv("30", 7)).toBe(30);
    expect(integerEnv("0", 7)).toBe(0);
    expect(integerEnv("", 7)).toBe(7);
    expect(integerEnv(undefined, 7)).toBe(7);
    expect(integerEnv("-1", 7)).toBe(7);
    expect(integerEnv("1.5", 7)).toBe(7);
    expect(integerEnv("not-a-number", 7)).toBe(7);
  });

  it("resolves the output directory from an argument or environment", () => {
    process.env.BACKUP_OUTPUT_DIR = "from-env";
    expect(backupOutputDirectory()).toBe(
      path.resolve(process.cwd(), "from-env"),
    );
    expect(backupOutputDirectory("from-argument")).toBe(
      path.resolve(process.cwd(), "from-argument"),
    );
    delete process.env.BACKUP_OUTPUT_DIR;
    expect(backupOutputDirectory()).toBe(path.resolve(process.cwd(), "backups"));
  });

  it("formats byte sizes", () => {
    expect(formatBytes(10)).toBe("10 B");
    expect(formatBytes(2048)).toBe("2.0 KiB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.00 MiB");
  });

  it("writes, lists, reads, and removes encrypted backups", () => {
    const nested = path.join(directory, "nested");
    const older = writeBackupFile(
      nested,
      new Date("2026-01-10T00:00:00.000Z"),
      Buffer.from("older"),
    );
    const newer = writeBackupFile(
      nested,
      new Date("2026-02-10T00:00:00.000Z"),
      Buffer.from("newer"),
    );

    expect(existsSync(older.path)).toBe(true);
    expect(readFileSync(older.path)).toEqual(Buffer.from("older"));
    expect(readBackupFile(older.path)).toEqual(Buffer.from("older"));
    expect(listBackupFiles(nested)).toEqual([newer.name, older.name]);

    writeFileSync(path.join(nested, "notes.txt"), "ignore me");
    expect(listBackupFiles(nested)).toEqual([newer.name, older.name]);

    removeBackupFile(nested, older.name);
    expect(existsSync(older.path)).toBe(false);
    expect(listBackupFiles(nested)).toEqual([newer.name]);
  });

  it("returns an empty list for a missing directory", () => {
    expect(listBackupFiles(path.join(directory, "missing"))).toEqual([]);
  });

  it("refuses to delete files that are not valid backup names", () => {
    for (const name of [
      "notes.txt",
      "../escape.rdmm.enc",
      "rdmm-backup-not-a-date.rdmm.enc",
      "other/rdmm-backup-20260110T000000000Z-abcdef12.rdmm.enc",
    ]) {
      expect(() => removeBackupFile(directory, name), name).toThrow(
        /Refusing to delete/u,
      );
    }
  });
});
