import type { menuImportItems } from "@/db/schema";

import type { MenuTreeItem } from "./menu-tree";

export type ImportItemRow = typeof menuImportItems.$inferSelect;

export type ImportChangeType =
  | "new"
  | "price_changed"
  | "description_changed"
  | "availability_changed"
  | "unchanged";

export type ExtractedImportItem = {
  name: string;
  description: string | null;
  basePriceMinor: number | null;
  variants: { name: string; priceMinor: number | null }[];
  availabilityStatus: "available" | "unavailable";
};

export function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function itemPriceKey(item: MenuTreeItem): string {
  return JSON.stringify({
    base: item.basePriceMinor,
    variants: item.variants.map((variant) => [
      normalizeName(variant.name),
      variant.priceMinor,
    ]),
  });
}

export function importItemHasPrice(item: ImportItemRow): boolean {
  return (
    item.basePriceMinor !== null ||
    item.variants.some((variant) => variant.priceMinor !== null)
  );
}

export function isAcceptableImportItem(item: ImportItemRow): boolean {
  return (
    item.decision === "pending" &&
    importItemHasPrice(item) &&
    (item.confidence ?? 0) >= 70 &&
    item.duplicateOfImportItemId === null
  );
}

export function shouldStayPendingOnKeepOnly(item: ImportItemRow): boolean {
  return (
    item.needsReview ||
    (item.confidence ?? 0) < 70 ||
    !importItemHasPrice(item) ||
    item.duplicateOfImportItemId !== null
  );
}

export function buildChangeType(
  extracted: ExtractedImportItem,
  existing: MenuTreeItem | undefined,
): ImportChangeType {
  if (!existing) return "new";

  const priceChanged =
    existing.basePriceMinor !== extracted.basePriceMinor ||
    itemPriceKey(existing) !==
      JSON.stringify({
        base: extracted.basePriceMinor,
        variants: extracted.variants
          .filter((variant) => variant.priceMinor !== null)
          .map((variant) => [
            normalizeName(variant.name),
            variant.priceMinor,
          ]),
      });

  if (priceChanged) return "price_changed";
  if ((existing.description ?? null) !== extracted.description) {
    return "description_changed";
  }
  if (existing.availabilityStatus !== extracted.availabilityStatus) {
    return "availability_changed";
  }
  return "unchanged";
}
