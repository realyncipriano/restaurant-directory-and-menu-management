import { describe, expect, it } from "vitest";

import {
  buildChangeType,
  isAcceptableImportItem,
  shouldStayPendingOnKeepOnly,
  type ImportItemRow,
} from "@/server/services/import-rules";
import type { MenuTreeItem } from "@/server/services/menu-tree";

function stagedItem(
  overrides: Partial<ImportItemRow> = {},
): ImportItemRow {
  return {
    decision: "pending",
    basePriceMinor: 10000,
    variants: [],
    confidence: 90,
    duplicateOfImportItemId: null,
    needsReview: false,
    ...overrides,
  } as ImportItemRow;
}

function menuItem(
  overrides: Partial<MenuTreeItem> = {},
): MenuTreeItem {
  return {
    name: "Dish",
    description: null,
    basePriceMinor: 10000,
    availabilityStatus: "available",
    variants: [],
    modifiers: [],
    ...overrides,
  } as MenuTreeItem;
}

describe("import rules", () => {
  it("accepts only priced, confident, non-duplicate pending items", () => {
    expect(isAcceptableImportItem(stagedItem())).toBe(true);
    expect(
      isAcceptableImportItem(stagedItem({ basePriceMinor: null })),
    ).toBe(false);
    expect(isAcceptableImportItem(stagedItem({ confidence: 69 }))).toBe(false);
    expect(
      isAcceptableImportItem(
        stagedItem({ duplicateOfImportItemId: "duplicate" }),
      ),
    ).toBe(false);
    expect(isAcceptableImportItem(stagedItem({ decision: "accept" }))).toBe(
      false,
    );
  });

  it("keeps flagged, low-confidence, unpriced, and duplicate items pending", () => {
    expect(shouldStayPendingOnKeepOnly(stagedItem({ needsReview: true }))).toBe(
      true,
    );
    expect(shouldStayPendingOnKeepOnly(stagedItem({ confidence: 60 }))).toBe(
      true,
    );
    expect(
      shouldStayPendingOnKeepOnly(stagedItem({ basePriceMinor: null })),
    ).toBe(true);
    expect(
      shouldStayPendingOnKeepOnly(
        stagedItem({ duplicateOfImportItemId: "duplicate" }),
      ),
    ).toBe(true);
    expect(shouldStayPendingOnKeepOnly(stagedItem())).toBe(false);
  });

  it("classifies new, changed, and unchanged items", () => {
    const extracted = {
      name: "Dish",
      description: null,
      basePriceMinor: 10000,
      variants: [],
      availabilityStatus: "available" as const,
    };

    expect(buildChangeType(extracted, undefined)).toBe("new");
    expect(buildChangeType(extracted, menuItem())).toBe("unchanged");
    expect(
      buildChangeType(extracted, menuItem({ basePriceMinor: 9000 })),
    ).toBe("price_changed");
    expect(
      buildChangeType(extracted, menuItem({ description: "Old" })),
    ).toBe("description_changed");
    expect(
      buildChangeType(
        extracted,
        menuItem({ availabilityStatus: "unavailable" }),
      ),
    ).toBe("availability_changed");
  });
});
