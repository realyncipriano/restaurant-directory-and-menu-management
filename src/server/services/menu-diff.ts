import type { MenuTree, MenuTreeItem } from "./menu-tree";

export type MenuChangeAction =
  | "item_created"
  | "item_updated"
  | "item_deleted"
  | "item_availability_changed"
  | "price_changed"
  | "category_created"
  | "category_updated"
  | "category_deleted"
  | "menu_published";

export type MenuChange = {
  logicalId: string | null;
  itemId: string | null;
  action: MenuChangeAction;
  previousValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
};

export function itemSnapshot(item: MenuTreeItem) {
  return {
    name: item.name,
    description: item.description,
    basePriceMinor: item.basePriceMinor,
    availabilityStatus: item.availabilityStatus,
    variants: [...item.variants]
      .map((variant) => ({
        name: variant.name,
        priceMinor: variant.priceMinor,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    modifiers: [...item.modifiers]
      .map((modifier) => ({
        name: modifier.name,
        additionalPriceMinor: modifier.additionalPriceMinor,
        isAvailable: modifier.isAvailable,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function snapshotsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function diffMenuTrees(
  previousTree: MenuTree | null,
  currentTree: MenuTree,
): MenuChange[] {
  const changes: MenuChange[] = [];
  const allItems = currentTree.categories.flatMap((category) => category.items);
  const previousItems = new Map(
    (previousTree?.categories.flatMap((category) => category.items) ?? []).map(
      (item) => [item.logicalId, item] as const,
    ),
  );
  const newItems = new Map(
    allItems.map((item) => [item.logicalId, item] as const),
  );

  for (const item of allItems) {
    const previousItem = previousItems.get(item.logicalId);
    if (!previousItem) {
      changes.push({
        logicalId: item.logicalId,
        itemId: item.id,
        action: "item_created",
        newValues: itemSnapshot(item),
      });
      continue;
    }

    const before = itemSnapshot(previousItem);
    const after = itemSnapshot(item);

    if (before.name !== after.name) {
      changes.push({
        logicalId: item.logicalId,
        itemId: item.id,
        action: "item_updated",
        previousValues: { name: before.name },
        newValues: { name: after.name },
      });
    }

    if (before.description !== after.description) {
      changes.push({
        logicalId: item.logicalId,
        itemId: item.id,
        action: "item_updated",
        previousValues: { description: before.description },
        newValues: { description: after.description },
      });
    }

    if (
      before.basePriceMinor !== after.basePriceMinor ||
      !snapshotsEqual(before.variants, after.variants) ||
      !snapshotsEqual(before.modifiers, after.modifiers)
    ) {
      changes.push({
        logicalId: item.logicalId,
        itemId: item.id,
        action: "price_changed",
        previousValues: {
          basePriceMinor: before.basePriceMinor,
          variants: before.variants,
          modifiers: before.modifiers,
        },
        newValues: {
          basePriceMinor: after.basePriceMinor,
          variants: after.variants,
          modifiers: after.modifiers,
        },
      });
    }

    if (before.availabilityStatus !== after.availabilityStatus) {
      changes.push({
        logicalId: item.logicalId,
        itemId: item.id,
        action: "item_availability_changed",
        previousValues: {
          availabilityStatus: before.availabilityStatus,
        },
        newValues: { availabilityStatus: after.availabilityStatus },
      });
    }
  }

  for (const [logicalId, item] of previousItems) {
    if (newItems.has(logicalId)) continue;
    changes.push({
      logicalId,
      itemId: null,
      action: "item_deleted",
      previousValues: itemSnapshot(item),
    });
  }

  const previousCategories = new Map(
    (previousTree?.categories ?? []).map(
      (category) => [category.name.toLowerCase(), category] as const,
    ),
  );
  const newCategories = new Map(
    currentTree.categories.map(
      (category) => [category.name.toLowerCase(), category] as const,
    ),
  );

  for (const category of currentTree.categories) {
    const previousCategory = previousCategories.get(
      category.name.toLowerCase(),
    );
    if (!previousCategory) {
      changes.push({
        logicalId: null,
        itemId: null,
        action: "category_created",
        newValues: {
          name: category.name,
          description: category.description,
          sortOrder: category.sortOrder,
        },
      });
    } else if (
      previousCategory.description !== category.description ||
      previousCategory.sortOrder !== category.sortOrder
    ) {
      changes.push({
        logicalId: null,
        itemId: null,
        action: "category_updated",
        previousValues: {
          name: previousCategory.name,
          description: previousCategory.description,
          sortOrder: previousCategory.sortOrder,
        },
        newValues: {
          name: category.name,
          description: category.description,
          sortOrder: category.sortOrder,
        },
      });
    }
  }

  for (const [name, category] of previousCategories) {
    if (newCategories.has(name)) continue;
    changes.push({
      logicalId: null,
      itemId: null,
      action: "category_deleted",
      previousValues: {
        name: category.name,
        description: category.description,
        sortOrder: category.sortOrder,
      },
    });
  }

  return changes;
}
