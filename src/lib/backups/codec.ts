import { createHash } from "node:crypto";

/**
 * Backups contain password hashes, MFA state, and audit records, so every value
 * is encoded explicitly before JSON serialization. Tagged tuples avoid
 * collisions with user-provided JSONB objects and keep dates, byte arrays, and
 * bigints lossless.
 */
export type EncodedValue =
  | null
  | boolean
  | number
  | string
  | EncodedTuple;

export type EncodedTuple =
  | ["d", string]
  | ["b", string]
  | ["n", string]
  | ["a", EncodedValue[]]
  | ["o", Array<[string, EncodedValue]>];

export type EncodedRow = Record<string, EncodedValue>;

/**
 * Compares strings by UTF-16 code unit. Locale-aware comparison can order
 * non-ASCII keys differently across machines, which would change checksums
 * for the same data.
 */
function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function encodeValue(value: unknown): EncodedValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return ["n", value.toString()];
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error("Cannot encode an invalid Date.");
    }
    return ["d", value.toISOString()];
  }
  if (value instanceof Uint8Array) {
    return ["b", Buffer.from(value).toString("base64")];
  }
  if (Array.isArray(value)) {
    return ["a", value.map(encodeValue)];
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([key, child]): [string, EncodedValue] => [key, encodeValue(child)]);
    return ["o", entries];
  }

  throw new Error(`Cannot encode unsupported value type: ${typeof value}.`);
}

function tupleTag(value: unknown): string | null {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string") {
    return null;
  }
  return value[0];
}

export function decodeValue(value: unknown): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" || typeof value === "string") return value;

  const tag = tupleTag(value);
  if (!tag || !Array.isArray(value)) {
    throw new Error("Backup contains an invalid encoded value.");
  }

  const payload = value[1];
  if (tag === "d") {
    if (typeof payload !== "string") {
      throw new Error("Backup contains an invalid timestamp.");
    }
    const date = new Date(payload);
    if (Number.isNaN(date.getTime())) {
      throw new Error("Backup contains an invalid timestamp.");
    }
    return date;
  }
  if (tag === "b") {
    if (typeof payload !== "string") {
      throw new Error("Backup contains an invalid byte value.");
    }
    return Buffer.from(payload, "base64");
  }
  if (tag === "n") {
    if (typeof payload !== "string" || !/^-?\d+$/u.test(payload)) {
      throw new Error("Backup contains an invalid bigint.");
    }
    return BigInt(payload);
  }
  if (tag === "a") {
    if (!Array.isArray(payload)) {
      throw new Error("Backup contains an invalid array.");
    }
    return payload.map(decodeValue);
  }
  if (tag === "o") {
    if (!Array.isArray(payload)) {
      throw new Error("Backup contains an invalid object.");
    }
    // Null-prototype objects keep user JSON keys such as "__proto__" inert.
    const output = Object.create(null) as Record<string, unknown>;
    for (const entry of payload) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== "string"
      ) {
        throw new Error("Backup contains an invalid object entry.");
      }
      if (Object.hasOwn(output, entry[0])) {
        throw new Error("Backup contains a duplicate object key.");
      }
      output[entry[0]] = decodeValue(entry[1]);
    }
    return output;
  }

  throw new Error("Backup contains an unknown encoded value tag.");
}

export function encodeRow(row: Record<string, unknown>): EncodedRow {
  const encoded: EncodedRow = {};
  for (const key of Object.keys(row).sort()) {
    encoded[key] = encodeValue(row[key]);
  }
  return encoded;
}

export function decodeRow(row: EncodedRow): Record<string, unknown> {
  const decoded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    decoded[key] = decodeValue(value);
  }
  return decoded;
}

function compareEncoded(left: EncodedValue, right: EncodedValue): number {
  return compareStrings(JSON.stringify(left), JSON.stringify(right));
}

export function compareRowsByPrimaryKey(
  left: EncodedRow,
  right: EncodedRow,
  primaryKey: readonly string[],
): number {
  for (const key of primaryKey) {
    const compared = compareEncoded(left[key] ?? null, right[key] ?? null);
    if (compared !== 0) return compared;
  }
  return 0;
}

export function checksumRows(rows: readonly EncodedRow[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

/**
 * Encodes table rows in primary-key order so the same data always produces the
 * same checksum, regardless of database scan order.
 */
export function encodeTableRows(
  rows: readonly Record<string, unknown>[],
  primaryKey: readonly string[],
): { rows: EncodedRow[]; checksum: string } {
  const encoded = rows.map(encodeRow);
  encoded.sort((left, right) => compareRowsByPrimaryKey(left, right, primaryKey));
  return { rows: encoded, checksum: checksumRows(encoded) };
}

function rowKey(row: Record<string, unknown>, primaryKey: readonly string[]): string {
  return JSON.stringify(primaryKey.map((key) => row[key] ?? null));
}

/**
 * Self-referencing rows must be inserted after the row they point at. The
 * operation is stable and fails closed on a cycle instead of producing a
 * partial restore.
 */
export function orderRowsForInsert(
  rows: readonly Record<string, unknown>[],
  primaryKey: readonly string[],
  selfReference?: string,
): Record<string, unknown>[] {
  if (!selfReference || rows.length < 2) return [...rows];

  const keyed = new Map<string, number>();
  rows.forEach((row, index) => {
    keyed.set(rowKey(row, primaryKey), index);
  });

  const parentIndex = rows.map((row) => {
    const parent = row[selfReference];
    if (parent === null || parent === undefined) return null;
    const index = keyed.get(JSON.stringify([parent]));
    if (index === undefined) {
      throw new Error(
        `Backup cannot be restored because ${selfReference} references a row that is not in the backup.`,
      );
    }
    return index;
  });

  const children = rows.map(() => [] as number[]);
  const roots: number[] = [];
  parentIndex.forEach((parent, index) => {
    if (parent === null) {
      roots.push(index);
    } else {
      children[parent]!.push(index);
    }
  });

  const ordered: Record<string, unknown>[] = [];
  const queue = [...roots];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor]!;
    ordered.push(rows[index]!);
    queue.push(...children[index]!);
  }

  if (ordered.length !== rows.length) {
    throw new Error(
      `Backup cannot be restored because ${selfReference} contains a reference cycle.`,
    );
  }
  return ordered;
}

export function assertAllowedColumns(
  rows: readonly EncodedRow[],
  allowedColumns: readonly string[],
): void {
  const allowed = new Set(allowedColumns);
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!allowed.has(key)) {
        throw new Error(`Backup contains an unknown column: ${key}.`);
      }
    }
  }
}
