import { describe, expect, it } from "vitest";

import { diffMenuTrees } from "@/server/services/menu-diff";
import type { MenuTree, MenuTreeItem } from "@/server/services/menu-tree";

function menuItem(
  logicalId: string,
  overrides: Partial<MenuTreeItem> = {},
): MenuTreeItem {
  return {
    id: `item-${logicalId}`,
    logicalId,
    name: "Dish",
    description: null,
    basePriceMinor: 10000,
    availabilityStatus: "available",
    variants: [],
    modifiers: [],
    ...overrides,
  } as MenuTreeItem;
}

function menuTree(items: MenuTreeItem[]): MenuTree {
  return {
    menu: { id: "menu-1" },
    categories: [
      {
        id: "category-1",
        name: "Mains",
        description: null,
        sortOrder: 10,
        items,
      },
    ],
  } as MenuTree;
}

describe("menu diff", () => {
  it("records created items and categories for a first publish", () => {
    const changes = diffMenuTrees(null, menuTree([menuItem("dish")]));

    expect(changes.map((change) => change.action)).toEqual([
      "item_created",
      "category_created",
    ]);
  });

  it("records price changes, deletions, and category changes", () => {
    const previous = menuTree([
      menuItem("dish"),
      menuItem("removed", { name: "Removed Dish" }),
    ]);
    const current = menuTree([
      menuItem("dish", { basePriceMinor: 12000 }),
    ]);
    current.categories[0]!.description = "Updated";

    const changes = diffMenuTrees(previous, current);
    const actions = changes.map((change) => change.action);

    expect(actions).toContain("price_changed");
    expect(actions).toContain("item_deleted");
    expect(actions).toContain("category_updated");
  });
});
