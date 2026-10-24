import { describe, expect, it } from "vitest";

import { countLabel, itemCountLabel } from "@/lib/count-label";
import {
  addOnCountLabel,
  buildCategoryOptions,
  buildMenuEditorMessages,
  deriveMenuEditorFlags,
  menuEditorErrorMessage,
  menuEditorNoticeMessage,
  menuStatusTone,
  nextCategorySortOrder,
  nextItemSortOrder,
  toItemFormValues,
  variantCountLabel,
  type MenuEditorItem,
} from "@/lib/menu-editor-view";

function menuItem(overrides: Partial<MenuEditorItem> = {}): MenuEditorItem {
  return {
    id: "item-1",
    categoryId: "category-1",
    name: "Chicken Adobo",
    description: "Braised chicken",
    basePriceMinor: 18500,
    currency: "PHP",
    availabilityStatus: "available",
    sortOrder: 10,
    variants: [],
    modifiers: [],
    ...overrides,
  };
}

describe("menu editor messages", () => {
  it("maps known notices and ignores unknown or empty notices", () => {
    const notices = [
      ["settings", "Menu details saved."],
      [
        "draft",
        "Draft revision created. The published menu is unchanged until you publish.",
      ],
      ["published", "Menu published. The previous version was archived."],
      ["category-deleted", "Category deleted from this draft."],
      ["item-deleted", "Menu item deleted from this draft."],
      [
        "import-applied",
        "Accepted scan items were applied to this draft. Review the menu before publishing.",
      ],
    ] as const;

    for (const [notice, expected] of notices) {
      expect(menuEditorNoticeMessage(notice)).toBe(expected);
    }

    expect(menuEditorNoticeMessage("unknown")).toBeNull();
    expect(menuEditorNoticeMessage("")).toBeNull();
    expect(menuEditorNoticeMessage(null)).toBeNull();
    expect(menuEditorNoticeMessage(undefined)).toBeNull();
  });

  it("maps known errors and falls back for unknown errors", () => {
    const errors = [
      [
        "draft",
        "A draft revision could not be created. Check that this menu still has a published version.",
      ],
      ["discard", "The draft could not be discarded."],
      ["delete-category", "The category could not be deleted."],
      ["delete-item", "The menu item could not be deleted."],
    ] as const;

    for (const [error, expected] of errors) {
      expect(menuEditorErrorMessage(error)).toBe(expected);
    }

    expect(menuEditorErrorMessage("unknown")).toBe(
      "The action could not be completed. Please try again.",
    );
    expect(menuEditorErrorMessage("")).toBeNull();
    expect(menuEditorErrorMessage(null)).toBeNull();
    expect(menuEditorErrorMessage(undefined)).toBeNull();
  });

  it("builds notice and error messages together", () => {
    expect(
      buildMenuEditorMessages({ notice: "settings", error: "discard" }),
    ).toEqual({
      noticeMessage: "Menu details saved.",
      errorMessage: "The draft could not be discarded.",
    });
    expect(buildMenuEditorMessages({})).toEqual({
      noticeMessage: null,
      errorMessage: null,
    });
  });
});

describe("menu editor status and permissions", () => {
  it("maps menu statuses to notice tones", () => {
    expect(menuStatusTone("draft")).toBe("warning");
    expect(menuStatusTone("published")).toBe("success");
    expect(menuStatusTone("archived")).toBe("neutral");
    expect(menuStatusTone("unknown")).toBe("neutral");
  });

  it("derives edit and publish flags from menu, restaurant, and permissions", () => {
    expect(
      deriveMenuEditorFlags({
        canEditMenu: true,
        canPublishMenu: true,
        restaurantStatus: "active",
        menuStatus: "draft",
      }),
    ).toEqual({
      isDraft: true,
      restaurantActive: true,
      canEdit: true,
      canPublish: true,
    });

    expect(
      deriveMenuEditorFlags({
        canEditMenu: true,
        canPublishMenu: true,
        restaurantStatus: "active",
        menuStatus: "published",
      }),
    ).toEqual({
      isDraft: false,
      restaurantActive: true,
      canEdit: true,
      canPublish: false,
    });

    expect(
      deriveMenuEditorFlags({
        canEditMenu: true,
        canPublishMenu: true,
        restaurantStatus: "active",
        menuStatus: "archived",
      }),
    ).toEqual({
      isDraft: false,
      restaurantActive: true,
      canEdit: true,
      canPublish: false,
    });

    expect(
      deriveMenuEditorFlags({
        canEditMenu: true,
        canPublishMenu: true,
        restaurantStatus: "archived",
        menuStatus: "draft",
      }),
    ).toEqual({
      isDraft: true,
      restaurantActive: false,
      canEdit: false,
      canPublish: false,
    });

    expect(
      deriveMenuEditorFlags({
        canEditMenu: false,
        canPublishMenu: false,
        restaurantStatus: "active",
        menuStatus: "draft",
      }),
    ).toEqual({
      isDraft: true,
      restaurantActive: true,
      canEdit: false,
      canPublish: false,
    });
  });
});

describe("menu editor categories", () => {
  it("preserves the existing category order and drops extra fields", () => {
    const categories = [
      { id: "category-b", name: "Beverages", description: "Drinks" },
      { id: "category-a", name: "Appetizers" },
    ];

    expect(buildCategoryOptions(categories)).toEqual([
      { id: "category-b", name: "Beverages" },
      { id: "category-a", name: "Appetizers" },
    ]);
    expect(buildCategoryOptions([])).toEqual([]);
  });
});

describe("menu item form values", () => {
  it("converts prices, variants, and modifiers without losing empty values", () => {
    const values = toItemFormValues(
      menuItem({
        description: null,
        basePriceMinor: null,
        variants: [
          { name: "Regular", priceMinor: 18500 },
          { name: "Large", priceMinor: null },
        ],
        modifiers: [
          {
            name: "Extra rice",
            additionalPriceMinor: 2500,
            isAvailable: false,
          },
          {
            name: "Sauce",
            additionalPriceMinor: null,
            isAvailable: true,
          },
        ],
      }),
    );

    expect(values).toEqual({
      id: "item-1",
      categoryId: "category-1",
      name: "Chicken Adobo",
      description: "",
      basePrice: "",
      availabilityStatus: "available",
      sortOrder: 10,
      variants: [
        { name: "Regular", price: "185.00" },
        { name: "Large", price: "" },
      ],
      modifiers: [
        { name: "Extra rice", price: "25.00", isAvailable: false },
        { name: "Sauce", price: "", isAvailable: true },
      ],
    });
    expect("currency" in values).toBe(false);
  });

  it("preserves string prices, zero prices, and empty descriptions", () => {
    const values = toItemFormValues(
      menuItem({
        description: "",
        basePriceMinor: 0,
        variants: [{ name: "Free", priceMinor: 0 }],
        modifiers: [
          {
            name: "Free sauce",
            additionalPriceMinor: 0,
            isAvailable: true,
          },
        ],
      }),
    );

    expect(values.description).toBe("");
    expect(values.basePrice).toBe("0.00");
    expect(values.variants).toEqual([{ name: "Free", price: "0.00" }]);
    expect(values.modifiers).toEqual([
      { name: "Free sauce", price: "0.00", isAvailable: true },
    ]);
  });

  it("does not mutate the source item and returns new arrays", () => {
    const item = menuItem({
      variants: [{ name: "Regular", priceMinor: 18500 }],
      modifiers: [
        {
          name: "Extra rice",
          additionalPriceMinor: 2500,
          isAvailable: true,
        },
      ],
    });
    const snapshot = structuredClone(item);

    const values = toItemFormValues(item);

    expect(item).toEqual(snapshot);
    expect(values.variants).not.toBe(item.variants);
    expect(values.variants[0]).not.toBe(item.variants[0]);
    expect(values.modifiers).not.toBe(item.modifiers);
    expect(values.modifiers[0]).not.toBe(item.modifiers[0]);
  });
});

describe("menu editor defaults and labels", () => {
  it("calculates the next sort order", () => {
    expect(nextItemSortOrder(0)).toBe(10);
    expect(nextItemSortOrder(3)).toBe(40);
    expect(nextCategorySortOrder(0)).toBe(10);
    expect(nextCategorySortOrder(2)).toBe(30);
  });

  it("pluralizes counts with the existing labels", () => {
    expect(countLabel(1, "menu", "menus")).toBe("1 menu");
    expect(countLabel(2, "menu", "menus")).toBe("2 menus");
    expect(itemCountLabel(0)).toBe("0 items");
    expect(itemCountLabel(1)).toBe("1 item");
    expect(itemCountLabel(2)).toBe("2 items");
    expect(variantCountLabel(1)).toBe("1 variant");
    expect(variantCountLabel(2)).toBe("2 variants");
    expect(addOnCountLabel(1)).toBe("1 add-on");
    expect(addOnCountLabel(2)).toBe("2 add-ons");
  });
});
