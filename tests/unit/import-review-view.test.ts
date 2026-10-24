import { describe, expect, it } from "vitest";

import {
  buildCategoryHref,
  buildImportReviewView,
  formatReviewItemPrice,
  importChangeLabel,
  isLowConfidence,
  itemCountLabel,
  type ImportReviewSourceItem,
} from "@/lib/import-review-view";

function item(
  overrides: Partial<ImportReviewSourceItem> = {},
): ImportReviewSourceItem {
  return {
    id: "item-1",
    pageNumber: 1,
    categoryName: "Coffee",
    name: "Latte",
    description: null,
    basePriceMinor: 18500,
    currency: "PHP",
    variants: [],
    modifiers: [],
    availabilityStatus: "available",
    confidence: 90,
    needsReview: false,
    changeType: "new",
    decision: "pending",
    duplicateOfImportItemId: null,
    ...overrides,
  };
}

describe("import review view", () => {
  it("counts decisions and builds the ordered stats", () => {
    const view = buildImportReviewView([
      item({ id: "pending" }),
      item({ id: "review", needsReview: true }),
      item({ id: "accepted", decision: "accept" }),
      item({ id: "rejected", decision: "reject" }),
      item({ id: "other", categoryName: "Tea" }),
    ]);

    expect(view.counts).toEqual({
      total: 5,
      pending: 3,
      accepted: 1,
      rejected: 1,
      needsReview: 1,
    });
    expect(view.stats).toEqual([
      { label: "Extracted", value: 5 },
      { label: "Needs review", value: 1, highlight: true },
      { label: "Pending", value: 3 },
      { label: "Accepted", value: 1 },
      { label: "Rejected", value: 1, highlight: true },
    ]);
  });

  it("does not highlight empty review or rejected counts", () => {
    const view = buildImportReviewView([item()]);

    expect(view.stats).toEqual([
      { label: "Extracted", value: 1 },
      { label: "Needs review", value: 0, highlight: false },
      { label: "Pending", value: 1 },
      { label: "Accepted", value: 0 },
      { label: "Rejected", value: 0, highlight: false },
    ]);
  });

  it("normalizes, labels, sorts, and counts categories", () => {
    const view = buildImportReviewView([
      item({ id: "coffee-1", categoryName: "Coffee" }),
      item({ id: "coffee-2", categoryName: " coffee " }),
      item({ id: "tea-1", categoryName: "Tea", decision: "accept" }),
      item({ id: "tea-2", categoryName: "Tea", decision: "reject" }),
      item({ id: "blank", categoryName: "   " }),
    ]);

    expect(view.categories).toEqual([
      { name: "Coffee", total: 2, pending: 2, accepted: 0, rejected: 0 },
      { name: "Tea", total: 2, pending: 0, accepted: 1, rejected: 1 },
      { name: "Uncategorized", total: 1, pending: 1, accepted: 0, rejected: 0 },
    ]);
    expect(view.activeCategory).toBeNull();
    expect(view.selectedCategoryMissing).toBe(false);
  });

  it("sorts category labels independently of input order", () => {
    const view = buildImportReviewView([
      item({ id: "zebra", categoryName: "Zebra" }),
      item({ id: "alpha", categoryName: "Alpha" }),
      item({ id: "middle", categoryName: "Middle" }),
    ]);

    expect(view.categories.map((category) => category.name)).toEqual([
      "Alpha",
      "Middle",
      "Zebra",
    ]);
  });

  it("matches selected categories case-insensitively and ignores surrounding whitespace", () => {
    const view = buildImportReviewView(
      [
        item({ id: "coffee", categoryName: "Coffee" }),
        item({ id: "tea", categoryName: "Tea" }),
      ],
      "  COFFEE  ",
    );

    expect(view.activeCategory).toEqual({
      name: "Coffee",
      total: 1,
      pending: 1,
      accepted: 0,
      rejected: 0,
    });
    expect(view.selectedCategoryMissing).toBe(false);
    expect(view.noticeCategoryName).toBe("  COFFEE  ");
    expect(view.visibleGroups).toHaveLength(1);
    expect(view.visibleGroups[0]?.name).toBe("Coffee");
  });

  it("shows all categories and reports a missing selected category", () => {
    const view = buildImportReviewView(
      [
        item({ id: "coffee", categoryName: "Coffee" }),
        item({ id: "tea", categoryName: "Tea" }),
      ],
      "Dessert",
    );

    expect(view.activeCategory).toBeNull();
    expect(view.selectedCategoryMissing).toBe(true);
    expect(view.noticeCategoryName).toBe("Dessert");
    expect(view.visibleGroups.map((category) => category.name)).toEqual([
      "Coffee",
      "Tea",
    ]);
  });

  it("resolves duplicate labels only when the original item exists", () => {
    const view = buildImportReviewView([
      item({ id: "original", name: "Latte" }),
      item({ id: "duplicate", duplicateOfImportItemId: "original" }),
      item({ id: "orphan", duplicateOfImportItemId: "missing" }),
    ]);
    const byId = new Map(view.reviewItems.map((reviewItem) => [reviewItem.id, reviewItem]));

    expect(byId.get("duplicate")?.duplicateName).toBe("Latte");
    expect(byId.get("orphan")?.duplicateName).toBeNull();
  });

  it("groups items and keeps needs-review items first with stable ties", () => {
    const view = buildImportReviewView([
      item({ id: "first-normal" }),
      item({ id: "first-review", needsReview: true }),
      item({ id: "accepted", decision: "accept" }),
      item({ id: "second-review", needsReview: true }),
    ]);

    expect(view.visibleGroups).toHaveLength(1);
    expect(view.visibleGroups[0]?.items.map((reviewItem) => reviewItem.id)).toEqual([
      "first-review",
      "second-review",
      "first-normal",
      "accepted",
    ]);
  });

  it("filters groups and computes visible and pending-outside counts", () => {
    const view = buildImportReviewView(
      [
        item({ id: "coffee-pending" }),
        item({ id: "coffee-review", needsReview: true }),
        item({ id: "tea-pending", categoryName: "Tea" }),
        item({
          id: "coffee-accepted",
          categoryName: "Coffee",
          decision: "accept",
        }),
      ],
      "Coffee",
    );

    expect(view.pendingOutsideCategory).toBe(1);
    expect(view.visibleCount).toBe(3);
    expect(view.visibleReviewCount).toBe(1);
    expect(view.visibleGroups).toHaveLength(1);
    expect(view.visibleGroups[0]?.total).toBe(3);
  });

  it("builds category URLs without rewriting the category value", () => {
    expect(buildCategoryHref("rest-1", "import-1")).toBe(
      "/dashboard/restaurants/rest-1/imports/import-1",
    );
    expect(buildCategoryHref("rest-1", "import-1", "Coffee & Tea")).toBe(
      "/dashboard/restaurants/rest-1/imports/import-1?category=Coffee+%26+Tea",
    );
    expect(buildCategoryHref("rest-1", "import-1", "  Coffee  ")).toBe(
      "/dashboard/restaurants/rest-1/imports/import-1?category=++Coffee++",
    );
  });

  it("builds the Keep-only message with exact pluralization", () => {
    const view = buildImportReviewView(
      [
        item({ id: "coffee-1", categoryName: "Coffee" }),
        item({ id: "coffee-2", categoryName: "Coffee" }),
        item({ id: "tea-1", categoryName: "Tea" }),
      ],
      "Coffee",
    );

    expect(view.keepOnlyMessage).toBe(
      "Keep only “Coffee”? This accepts eligible pending items in this category and moves eligible pending items outside it to rejected. 2 items are pending in this category and 1 item outside it. Flagged, low-confidence, unpriced, and duplicate items outside this category stay pending for manual review.",
    );
  });

  it("uses an empty Keep-only message without an active category", () => {
    const view = buildImportReviewView([item()]);

    expect(view.keepOnlyMessage).toBe("");
  });

  it("preserves price, confidence, change, and item count display rules", () => {
    expect(itemCountLabel(0)).toBe("0 items");
    expect(itemCountLabel(1)).toBe("1 item");
    expect(itemCountLabel(2)).toBe("2 items");
    expect(
      formatReviewItemPrice({
        basePriceMinor: 18500,
        currency: "PHP",
        variants: [],
      }),
    ).toBe("₱185.00");
    expect(
      formatReviewItemPrice({
        basePriceMinor: null,
        currency: "PHP",
        variants: [{ name: "Small", priceMinor: null }],
      }),
    ).toBe("Varies");
    expect(
      formatReviewItemPrice({
        basePriceMinor: null,
        currency: "PHP",
        variants: [],
      }),
    ).toBe("No price");
    expect(isLowConfidence(null)).toBe(true);
    expect(isLowConfidence(69)).toBe(true);
    expect(isLowConfidence(70)).toBe(false);
    expect(importChangeLabel("new")).toBe("New item");
    expect(importChangeLabel("price_changed")).toBe("Price changed");
    expect(importChangeLabel("custom")).toBe("custom");
  });
});
