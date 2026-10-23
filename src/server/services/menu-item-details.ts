import "server-only";

import { eq } from "drizzle-orm";

import { menuItemModifiers, menuItemVariants } from "@/db/schema";
import type { DbExecutor } from "@/db/types";

export type ItemVariantDetail = {
  name: string;
  priceMinor: number | null;
};

export type ItemModifierDetail = {
  name: string;
  additionalPriceMinor: number | null;
  isAvailable: boolean;
};

export async function replaceItemVariantsAndModifiers(
  db: DbExecutor,
  itemId: string,
  details: {
    variants: ItemVariantDetail[];
    modifiers: ItemModifierDetail[];
  },
  now: Date,
): Promise<void> {
  const pricedVariants = details.variants.filter(
    (variant): variant is { name: string; priceMinor: number } =>
      variant.priceMinor !== null && Boolean(variant.name.trim()),
  );
  await db
    .delete(menuItemVariants)
    .where(eq(menuItemVariants.menuItemId, itemId));
  if (pricedVariants.length > 0) {
    await db.insert(menuItemVariants).values(
      pricedVariants.map((variant, index) => ({
        menuItemId: itemId,
        name: variant.name,
        priceMinor: variant.priceMinor,
        sortOrder: index,
        createdAt: now,
      })),
    );
  }

  const namedModifiers = details.modifiers.filter((modifier) =>
    Boolean(modifier.name.trim()),
  );
  await db
    .delete(menuItemModifiers)
    .where(eq(menuItemModifiers.menuItemId, itemId));
  if (namedModifiers.length > 0) {
    await db.insert(menuItemModifiers).values(
      namedModifiers.map((modifier, index) => ({
        menuItemId: itemId,
        name: modifier.name,
        additionalPriceMinor: modifier.additionalPriceMinor ?? 0,
        isAvailable: modifier.isAvailable,
        sortOrder: index,
        createdAt: now,
      })),
    );
  }
}
