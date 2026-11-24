import { describe, expect, it } from "vitest";

import type {
  MenuTreeViewCategory,
  MenuTreeViewItem,
} from "@/components/menus/editor/menu-tree-view";
import { paginateMenuTreeCategories } from "@/lib/menu-tree-pagination";

function items(count: number, prefix: string): MenuTreeViewItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-item-${index + 1}`,
    name: `${prefix} item ${index + 1}`,
    description: null,
    basePriceMinor: 1000,
    currency: "PHP",
    availabilityStatus: "available" as const,
    variants: [],
    modifiers: [],
  }));
}

function category(name: string, count: number): MenuTreeViewCategory {
  return {
    id: name.toLowerCase().replaceAll(" ", "-"),
    name,
    description: null,
    items: items(count, name),
  };
}

describe("menu tree pagination", () => {
  it("paginates items five at a time while preserving category order", () => {
    const categories = [
      category("Mains", 3),
      category("Drinks", 4),
      category("Desserts", 3),
    ];

    const firstPage = paginateMenuTreeCategories(categories);

    expect(firstPage).toMatchObject({
      totalItems: 10,
      page: 1,
      pageCount: 2,
      pageSize: 5,
      firstItem: 1,
      lastItem: 5,
    });
    expect(
      firstPage.categories.map((group) => [
        group.name,
        group.items.length,
        group.totalItemCount,
      ]),
    ).toEqual([
      ["Mains", 3, 3],
      ["Drinks", 2, 4],
    ]);
    expect(firstPage.categoryPages).toEqual({
      mains: 1,
      drinks: 1,
      desserts: 2,
    });

    const secondPage = paginateMenuTreeCategories(categories, { page: 2 });

    expect(secondPage).toMatchObject({
      totalItems: 10,
      page: 2,
      pageCount: 2,
      firstItem: 6,
      lastItem: 10,
    });
    expect(
      secondPage.categories.map((group) => [group.name, group.items.length]),
    ).toEqual([
      ["Drinks", 2],
      ["Desserts", 3],
    ]);
    expect(
      secondPage.categories.flatMap((group) =>
        group.items.map((item) => item.id),
      ),
    ).toEqual([
      "Drinks-item-3",
      "Drinks-item-4",
      "Desserts-item-1",
      "Desserts-item-2",
      "Desserts-item-3",
    ]);
  });

  it("clamps pages below and above the available range", () => {
    const categories = [category("Mains", 8), category("Drinks", 4)];

    expect(paginateMenuTreeCategories(categories, { page: 0 }).page).toBe(1);
    expect(paginateMenuTreeCategories(categories, { page: -4 }).page).toBe(1);
    expect(paginateMenuTreeCategories(categories, { page: 99 })).toMatchObject({
      page: 3,
      firstItem: 11,
      lastItem: 12,
    });
    expect(
      paginateMenuTreeCategories(categories, { page: Number.NaN }).page,
    ).toBe(1);
  });

  it("keeps empty categories on the page nearest their position", () => {
    const categories = [
      category("Empty start", 0),
      category("Mains", 6),
      category("Empty middle", 0),
      category("Drinks", 4),
      category("Empty end", 0),
    ];

    const firstPage = paginateMenuTreeCategories(categories);

    expect(firstPage.categories.map((group) => group.name)).toEqual([
      "Empty start",
      "Mains",
    ]);
    expect(firstPage.categoryPages).toMatchObject({
      "empty-start": 1,
      mains: 1,
      "empty-middle": 2,
      drinks: 2,
      "empty-end": 2,
    });

    const secondPage = paginateMenuTreeCategories(categories, { page: 2 });

    expect(secondPage.categories.map((group) => group.name)).toEqual([
      "Mains",
      "Empty middle",
      "Drinks",
      "Empty end",
    ]);
    expect(
      secondPage.categories.map((group) => [
        group.name,
        group.items.length,
        group.totalItemCount,
      ]),
    ).toEqual([
      ["Mains", 1, 6],
      ["Empty middle", 0, 0],
      ["Drinks", 4, 4],
      ["Empty end", 0, 0],
    ]);
  });

  it("returns an empty first page for an empty menu", () => {
    expect(paginateMenuTreeCategories([])).toEqual({
      categories: [],
      totalItems: 0,
      page: 1,
      pageCount: 1,
      pageSize: 5,
      firstItem: 0,
      lastItem: 0,
      categoryPages: {},
    });

    const emptyCategories = [category("Empty", 0)];
    const page = paginateMenuTreeCategories(emptyCategories);

    expect(page.pageCount).toBe(1);
    expect(page.categories.map((group) => group.name)).toEqual(["Empty"]);
    expect(page.firstItem).toBe(0);
    expect(page.lastItem).toBe(0);
    expect(page.categoryPages).toEqual({ empty: 1 });
  });

  it("supports a custom page size", () => {
    const categories = [category("Mains", 12), category("Drinks", 3)];
    const page = paginateMenuTreeCategories(categories, {
      page: 2,
      pageSize: 10,
    });

    expect(page).toMatchObject({
      totalItems: 15,
      page: 2,
      pageCount: 2,
      pageSize: 10,
      firstItem: 11,
      lastItem: 15,
    });
    expect(
      page.categories.map((group) => [group.name, group.items.length]),
    ).toEqual([
      ["Mains", 2],
      ["Drinks", 3],
    ]);
  });
});
