export type VariantRow = {
  name: string;
  price: string;
};

export type ModifierRow = {
  name: string;
  price: string;
  isAvailable: boolean;
};

export function createVariantRow(): VariantRow {
  return { name: "", price: "" };
}

export function createModifierRow(): ModifierRow {
  return { name: "", price: "", isAvailable: true };
}

export function addRow<Row>(rows: readonly Row[], row: Row): Row[] {
  return [...rows, row];
}

export function updateRow<Row extends object>(
  rows: readonly Row[],
  index: number,
  patch: Partial<Row>,
): Row[] {
  return rows.map((row, rowIndex) =>
    rowIndex === index ? { ...row, ...patch } : row,
  );
}

export function removeRowAt<Row>(rows: readonly Row[], index: number): Row[] {
  return rows.filter((_, rowIndex) => rowIndex !== index);
}

export function serializeVariantRows(rows: readonly VariantRow[]): string {
  return JSON.stringify(rows);
}

export function serializeModifierRows(rows: readonly ModifierRow[]): string {
  return JSON.stringify(rows);
}
