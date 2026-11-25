import { describe, expect, it } from "vitest";

import {
  assertAllowedColumns,
  checksumRows,
  compareRowsByPrimaryKey,
  decodeRow,
  decodeValue,
  encodeRow,
  encodeTableRows,
  encodeValue,
  orderRowsForInsert,
  type EncodedRow,
} from "@/lib/backups/codec";

describe("backup codec", () => {
  it("round-trips supported scalar and composite values", () => {
    const value = {
      nullValue: null,
      trueValue: true,
      falseValue: false,
      number: 42.5,
      negative: -7,
      string: "hello",
      date: new Date("2026-01-15T12:00:00.123Z"),
      bytes: Buffer.from([0, 1, 255]),
      big: BigInt("9007199254740993"),
      array: [1, "two", null, { nested: true }],
      object: { z: 1, a: 2 },
    };

    expect(decodeValue(encodeValue(value))).toEqual(value);
  });

  it("normalizes undefined to null", () => {
    expect(encodeValue(undefined)).toBeNull();
  });

  it("rejects unsupported value types", () => {
    expect(() => encodeValue(() => undefined)).toThrow(/unsupported/u);
    expect(() => encodeValue(Symbol("backup"))).toThrow(/unsupported/u);
  });

  it("sorts object keys for deterministic output", () => {
    expect(encodeValue({ b: 1, a: 2 })).toEqual([
      "o",
      [
        ["a", 2],
        ["b", 1],
      ],
    ]);
  });

  it("rejects malformed encoded values", () => {
    const malformed: unknown[] = [
      ["x", 1],
      ["d", "not-a-date"],
      ["d", 5],
      ["b", 5],
      ["n", "1.2"],
      ["n", 5],
      ["a", "not-an-array"],
      ["o", [["missing-value"]]],
      ["o", "not-an-array"],
      [1, 2],
      { raw: "object" },
    ];

    for (const value of malformed) {
      expect(() => decodeValue(value), JSON.stringify(value)).toThrow(/Backup/u);
    }
  });

  it("rejects duplicate object keys", () => {
    expect(() =>
      decodeValue([
        "o",
        [
          ["a", 1],
          ["a", 2],
        ],
      ]),
    ).toThrow(/duplicate object key/u);
  });

  it("keeps __proto__ as inert data", () => {
    const input = JSON.parse(
      '{"__proto__":{"polluted":true},"safe":1}',
    ) as Record<string, unknown>;
    const decoded = decodeValue(encodeValue(input)) as Record<string, unknown>;

    expect(Object.getPrototypeOf(decoded)).toBeNull();
    expect(decoded.safe).toBe(1);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("produces the same checksum regardless of row order", () => {
    const rows = [
      { id: "b", value: 2 },
      { id: "a", value: 1 },
    ];
    const first = encodeTableRows(rows, ["id"]);
    const second = encodeTableRows([...rows].reverse(), ["id"]);

    expect(first.checksum).toBe(second.checksum);
    expect(first.rows).toEqual(second.rows);
    expect(first.rows[0]?.id).toBe("a");
  });

  it("compares composite primary keys", () => {
    const left = encodeRow({ restaurantId: "a", userId: "b" });
    const right = encodeRow({ restaurantId: "a", userId: "c" });

    expect(compareRowsByPrimaryKey(left, right, ["restaurantId", "userId"])).toBeLessThan(0);
    expect(compareRowsByPrimaryKey(right, left, ["restaurantId", "userId"])).toBeGreaterThan(0);
    expect(compareRowsByPrimaryKey(left, left, ["restaurantId", "userId"])).toBe(0);
  });

  it("orders self-referencing rows after their parents", () => {
    const rows = [
      { id: "grandchild", parentId: "child" },
      { id: "root", parentId: null },
      { id: "child", parentId: "root" },
    ];

    expect(orderRowsForInsert(rows, ["id"], "parentId").map((row) => row.id)).toEqual([
      "root",
      "child",
      "grandchild",
    ]);
  });

  it("rejects self-reference cycles", () => {
    const rows = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ];

    expect(() => orderRowsForInsert(rows, ["id"], "parentId")).toThrow(/cycle/u);
  });

  it("rejects self-references to rows outside the backup", () => {
    expect(() =>
      orderRowsForInsert(
        [
          { id: "a", parentId: null },
          { id: "b", parentId: "missing" },
        ],
        ["id"],
        "parentId",
      ),
    ).toThrow(/not in the backup/u);
  });

  it("returns rows unchanged when there is no self-reference", () => {
    const rows = [{ id: "a" }, { id: "b" }];
    const ordered = orderRowsForInsert(rows, ["id"]);

    expect(ordered).toEqual(rows);
    expect(ordered).not.toBe(rows);
  });

  it("rejects unknown columns", () => {
    const rows: EncodedRow[] = [{ id: "a", secret: "value" }];

    expect(() => assertAllowedColumns(rows, ["id"])).toThrow(/unknown column/u);
    expect(() => assertAllowedColumns(rows, ["id", "secret"])).not.toThrow();
  });

  it("round-trips rows through decodeRow", () => {
    const row = {
      id: "a",
      createdAt: new Date("2026-01-15T12:00:00.000Z"),
      details: { b: 2, a: [1, true] },
    };

    expect(decodeRow(encodeRow(row))).toEqual(row);
  });

  it("checksums encoded rows", () => {
    const rows = [encodeRow({ id: "a" })];
    expect(checksumRows(rows)).toMatch(/^[a-f0-9]{64}$/u);
    expect(checksumRows(rows)).toBe(checksumRows([...rows]));
  });
});
