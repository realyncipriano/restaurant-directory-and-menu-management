import { describe, expect, it } from "vitest";

import { paginateImportReviewGroups } from "@/lib/import-review-pagination";
import {
  buildImportReviewView,
  type ImportReviewSourceItem,
} from "@/lib/import-review-view";

function items(
  count: number,
  categoryName: string,
  offset = 0,
): ImportReviewSourceItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${categoryName}-${offset + index}`,
    pageNumber: 1,
    categoryName,
    name: `Item ${offset + index + 1}`,
    description: null,
    basePriceMinor: 1000,
    currency: "PHP",
    variants: [],
    modifiers: [],
    availabilityStatus: "available" as const,
    confidence: 90,
    needsReview: false,
    changeType: "new",
    decision: "pending" as const,
    duplicateOfImportItemId: null,
  }));
}

describe("import review pagination", () => {
  it("paginates grouped items while preserving category order", () => {
    const groups = buildImportReviewView([
      ...items(25, "Mains"),
      ...items(5, "Drinks", 25),
    ]).visibleGroups;

    const firstPage = paginateImportReviewGroups(groups);

    expect(firstPage).toMatchObject({
      total: 30,
      page: 1,
      pageCount: 2,
      pageSize: 20,
      firstItem: 1,
      lastItem: 20,
    });
    expect(
      firstPage.groups.map((group) => [group.name, group.items.length]),
    ).toEqual([["Mains", 20]]);

    const secondPage = paginateImportReviewGroups(groups, { page: 2 });

    expect(secondPage).toMatchObject({
      total: 30,
      page: 2,
      pageCount: 2,
      firstItem: 21,
      lastItem: 30,
    });
    expect(
      secondPage.groups.map((group) => [group.name, group.items.length]),
    ).toEqual([
      ["Mains", 5],
      ["Drinks", 5],
    ]);
    expect(secondPage.groups[0]?.items.map((item) => item.id)).toEqual([
      "Mains-20",
      "Mains-21",
      "Mains-22",
      "Mains-23",
      "Mains-24",
    ]);
  });

  it("clamps pages below and above the available range", () => {
    const groups = buildImportReviewView([
      ...items(25, "Mains"),
      ...items(5, "Drinks", 25),
    ]).visibleGroups;

    expect(paginateImportReviewGroups(groups, { page: 0 }).page).toBe(1);
    expect(paginateImportReviewGroups(groups, { page: -4 }).page).toBe(1);
    expect(paginateImportReviewGroups(groups, { page: 99 })).toMatchObject({
      page: 2,
      firstItem: 21,
      lastItem: 30,
    });
    expect(paginateImportReviewGroups(groups, { page: Number.NaN }).page).toBe(
      1,
    );
  });

  it("returns an empty first page when there are no items", () => {
    expect(paginateImportReviewGroups([])).toEqual({
      groups: [],
      total: 0,
      page: 1,
      pageCount: 1,
      pageSize: 20,
      firstItem: 0,
      lastItem: 0,
    });
  });

  it("supports a custom page size", () => {
    const groups = buildImportReviewView(items(30, "Mains")).visibleGroups;
    const page = paginateImportReviewGroups(groups, { page: 3, pageSize: 10 });

    expect(page).toMatchObject({
      total: 30,
      page: 3,
      pageCount: 3,
      pageSize: 10,
      firstItem: 21,
      lastItem: 30,
    });
    expect(page.groups[0]?.items).toHaveLength(10);
  });
});
