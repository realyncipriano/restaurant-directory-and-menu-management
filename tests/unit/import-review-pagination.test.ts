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
  it("paginates grouped items five at a time while preserving category order", () => {
    const groups = buildImportReviewView([
      ...items(23, "Mains"),
      ...items(7, "Drinks", 23),
    ]).visibleGroups;

    const firstPage = paginateImportReviewGroups(groups);

    expect(firstPage).toMatchObject({
      total: 30,
      page: 1,
      pageCount: 6,
      pageSize: 5,
      firstItem: 1,
      lastItem: 5,
    });
    expect(
      firstPage.groups.map((group) => [group.name, group.items.length]),
    ).toEqual([["Mains", 5]]);

    const spanningPage = paginateImportReviewGroups(groups, { page: 5 });

    expect(spanningPage).toMatchObject({
      total: 30,
      page: 5,
      pageCount: 6,
      firstItem: 21,
      lastItem: 25,
    });
    expect(
      spanningPage.groups.map((group) => [group.name, group.items.length]),
    ).toEqual([
      ["Mains", 3],
      ["Drinks", 2],
    ]);
    expect(
      spanningPage.groups.flatMap((group) =>
        group.items.map((item) => item.id),
      ),
    ).toEqual([
      "Mains-20",
      "Mains-21",
      "Mains-22",
      "Drinks-23",
      "Drinks-24",
    ]);

    const lastPage = paginateImportReviewGroups(groups, { page: 6 });

    expect(lastPage).toMatchObject({
      total: 30,
      page: 6,
      pageCount: 6,
      firstItem: 26,
      lastItem: 30,
    });
    expect(
      lastPage.groups.map((group) => [group.name, group.items.length]),
    ).toEqual([["Drinks", 5]]);
  });

  it("clamps pages below and above the available range", () => {
    const groups = buildImportReviewView([
      ...items(23, "Mains"),
      ...items(7, "Drinks", 23),
    ]).visibleGroups;

    expect(paginateImportReviewGroups(groups, { page: 0 }).page).toBe(1);
    expect(paginateImportReviewGroups(groups, { page: -4 }).page).toBe(1);
    expect(paginateImportReviewGroups(groups, { page: 99 })).toMatchObject({
      page: 6,
      firstItem: 26,
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
      pageSize: 5,
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
