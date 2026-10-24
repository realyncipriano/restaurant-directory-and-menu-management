import { describe, expect, it } from "vitest";

import {
  addRow,
  createModifierRow,
  createVariantRow,
  removeRowAt,
  serializeModifierRows,
  serializeVariantRows,
  updateRow,
  type ModifierRow,
  type VariantRow,
} from "@/lib/menu-item-rows";

describe("menu item row defaults", () => {
  it("creates empty variant and modifier rows", () => {
    expect(createVariantRow()).toEqual({ name: "", price: "" });
    expect(createModifierRow()).toEqual({
      name: "",
      price: "",
      isAvailable: true,
    });
  });

  it("creates independent row objects", () => {
    const first = createVariantRow();
    first.name = "Regular";

    expect(createVariantRow()).toEqual({ name: "", price: "" });

    const firstModifier = createModifierRow();
    firstModifier.isAvailable = false;

    expect(createModifierRow()).toEqual({
      name: "",
      price: "",
      isAvailable: true,
    });
  });
});

describe("menu item row operations", () => {
  it("adds a row without mutating or reordering existing rows", () => {
    const rows: VariantRow[] = [{ name: "Regular", price: "185.00" }];
    const added = addRow(rows, createVariantRow());

    expect(added).toEqual([
      { name: "Regular", price: "185.00" },
      { name: "", price: "" },
    ]);
    expect(added).not.toBe(rows);
    expect(added[0]).toBe(rows[0]);
    expect(rows).toHaveLength(1);
  });

  it("updates only the matching row and preserves other row references", () => {
    const rows: VariantRow[] = [
      { name: "Regular", price: "185.00" },
      { name: "Large", price: "220.00" },
    ];

    const updated = updateRow(rows, 1, { price: "225.00" });

    expect(updated).toEqual([
      { name: "Regular", price: "185.00" },
      { name: "Large", price: "225.00" },
    ]);
    expect(updated).not.toBe(rows);
    expect(updated[0]).toBe(rows[0]);
    expect(updated[1]).not.toBe(rows[1]);
    expect(rows[1].price).toBe("220.00");
  });

  it("updates modifier availability without mutating the source row", () => {
    const rows: ModifierRow[] = [
      { name: "Extra rice", price: "25.00", isAvailable: true },
    ];

    const updated = updateRow(rows, 0, { isAvailable: false });

    expect(updated).toEqual([
      { name: "Extra rice", price: "25.00", isAvailable: false },
    ]);
    expect(updated[0]).not.toBe(rows[0]);
    expect(rows[0].isAvailable).toBe(true);
  });

  it("returns a new array when the update index is out of range", () => {
    const rows: VariantRow[] = [{ name: "Regular", price: "185.00" }];
    const updated = updateRow(rows, 5, { name: "Missing" });

    expect(updated).toEqual(rows);
    expect(updated).not.toBe(rows);
    expect(updated[0]).toBe(rows[0]);
  });

  it("removes the matching row and preserves the remaining order", () => {
    const rows: VariantRow[] = [
      { name: "Regular", price: "185.00" },
      { name: "Large", price: "220.00" },
      { name: "Family", price: "450.00" },
    ];

    const removed = removeRowAt(rows, 1);

    expect(removed).toEqual([
      { name: "Regular", price: "185.00" },
      { name: "Family", price: "450.00" },
    ]);
    expect(removed).not.toBe(rows);
    expect(removed[0]).toBe(rows[0]);
    expect(removed[1]).toBe(rows[2]);
    expect(rows).toHaveLength(3);
  });

  it("returns a new unchanged array when the remove index is out of range", () => {
    const rows: ModifierRow[] = [
      { name: "Extra rice", price: "25.00", isAvailable: true },
    ];

    const removed = removeRowAt(rows, 4);

    expect(removed).toEqual(rows);
    expect(removed).not.toBe(rows);
    expect(removed[0]).toBe(rows[0]);
  });
});

describe("menu item row serialization", () => {
  it("serializes variants with the exact name and price shape", () => {
    const rows = [
      { name: "Regular", price: "185.00" },
      { name: "Large", price: "" },
    ];

    expect(serializeVariantRows(rows)).toBe(
      '[{"name":"Regular","price":"185.00"},{"name":"Large","price":""}]',
    );
  });

  it("serializes modifiers with the exact availability field", () => {
    const rows: ModifierRow[] = [
      { name: "Extra rice", price: "25.00", isAvailable: false },
      { name: "Sauce", price: "", isAvailable: true },
    ];

    expect(serializeModifierRows(rows)).toBe(
      '[{"name":"Extra rice","price":"25.00","isAvailable":false},{"name":"Sauce","price":"","isAvailable":true}]',
    );
  });

  it("serializes empty arrays as []", () => {
    expect(serializeVariantRows([])).toBe("[]");
    expect(serializeModifierRows([])).toBe("[]");
  });

  it("matches the previous JSON.stringify behavior for extra runtime properties", () => {
    const variants = [
      {
        name: "Regular",
        price: "185.00",
        id: "variant-1",
        metadata: { source: "manual" },
      },
    ];
    const modifiers = [
      {
        name: "Extra rice",
        price: "25.00",
        isAvailable: true,
        id: "modifier-1",
        metadata: { source: "manual" },
      },
    ];

    expect(serializeVariantRows(variants)).toBe(JSON.stringify(variants));
    expect(serializeModifierRows(modifiers)).toBe(JSON.stringify(modifiers));
    expect(serializeVariantRows(variants)).toBe(
      '[{"name":"Regular","price":"185.00","id":"variant-1","metadata":{"source":"manual"}}]',
    );
    expect(serializeModifierRows(modifiers)).toBe(
      '[{"name":"Extra rice","price":"25.00","isAvailable":true,"id":"modifier-1","metadata":{"source":"manual"}}]',
    );
  });

  it("does not mutate rows while serializing", () => {
    const variants: VariantRow[] = [{ name: "Regular", price: "185.00" }];
    const modifiers: ModifierRow[] = [
      { name: "Extra rice", price: "25.00", isAvailable: true },
    ];

    serializeVariantRows(variants);
    serializeModifierRows(modifiers);

    expect(variants).toEqual([{ name: "Regular", price: "185.00" }]);
    expect(modifiers).toEqual([
      { name: "Extra rice", price: "25.00", isAvailable: true },
    ]);
  });
});
