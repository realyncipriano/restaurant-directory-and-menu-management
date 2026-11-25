import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

import {
  BACKUP_FILE_PREFIX,
  BACKUP_FILE_SUFFIX,
  backupFileName,
  parseBackupFileName,
} from "../../src/lib/backups/crypto";

export function argument(name: string): string | undefined {
  const inline = process.argv.find((value) =>
    value.startsWith(`--${name}=`),
  );
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export function integerEnv(
  value: string | undefined,
  fallback: number,
): number {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function backupOutputDirectory(override?: string): string {
  const configured =
    override?.trim() ||
    process.env.BACKUP_OUTPUT_DIR?.trim() ||
    "backups";
  return resolve(process.cwd(), configured);
}

export function ensureBackupDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

export function writeBackupFile(
  directory: string,
  createdAt: Date,
  encrypted: Buffer,
): { path: string; name: string; bytes: number } {
  ensureBackupDirectory(directory);
  const name = backupFileName(createdAt, encrypted);
  const finalPath = resolve(directory, name);
  const temporaryPath = `${finalPath}.${process.pid}.tmp`;

  try {
    writeFileSync(temporaryPath, encrypted, { mode: 0o600, flag: "wx" });
    renameSync(temporaryPath, finalPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }

  return { path: finalPath, name, bytes: encrypted.byteLength };
}

export function listBackupFiles(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.startsWith(BACKUP_FILE_PREFIX) &&
          entry.name.endsWith(BACKUP_FILE_SUFFIX),
      )
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function readBackupFile(file: string): Buffer {
  return readFileSync(resolve(process.cwd(), file));
}

export function removeBackupFile(directory: string, name: string): void {
  if (
    name !== name.split(/[\\/]/u).pop() ||
    !name.startsWith(BACKUP_FILE_PREFIX) ||
    !name.endsWith(BACKUP_FILE_SUFFIX) ||
    parseBackupFileName(name) === null
  ) {
    throw new Error(`Refusing to delete an invalid backup file name: ${name}`);
  }
  rmSync(resolve(directory, name), { force: true });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}
