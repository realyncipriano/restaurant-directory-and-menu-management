import type { ModifierRow, VariantRow } from "@/lib/menu-item-rows";
import { formatMinorForInput } from "@/lib/money";

export type MenuStatusTone = "warning" | "success" | "neutral";

export type MenuEditorFlags = {
  isDraft: boolean;
  restaurantActive: boolean;
  canEdit: boolean;
  canPublish: boolean;
};

export type MenuEditorMessages = {
  noticeMessage: string | null;
  errorMessage: string | null;
};

export type MenuEditorCategoryOption = {
  id: string;
  name: string;
};

export type MenuEditorItemVariant = {
  name: string;
  priceMinor: number | null;
};

export type MenuEditorItemModifier = {
  name: string;
  additionalPriceMinor: number | null;
  isAvailable: boolean;
};

export type MenuEditorItem = {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  basePriceMinor: number | null;
  currency: string;
  availabilityStatus: "available" | "unavailable";
  sortOrder: number;
  variants: readonly MenuEditorItemVariant[];
  modifiers: readonly MenuEditorItemModifier[];
};

export type MenuEditorItemFormValues = {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  basePrice: string;
  availabilityStatus: "available" | "unavailable";
  sortOrder: number;
  variants: VariantRow[];
  modifiers: ModifierRow[];
};

export function menuEditorNoticeMessage(
  notice: string | null | undefined,
): string | null {
  switch (notice) {
    case "settings":
      return "Menu details saved.";
    case "draft":
      return "Draft revision created. The published menu is unchanged until you publish.";
    case "published":
      return "Menu published. The previous version was archived.";
    case "category-deleted":
      return "Category deleted from this draft.";
    case "item-deleted":
      return "Menu item deleted from this draft.";
    case "import-applied":
      return "Accepted scan items were applied to this draft. Review the menu before publishing.";
    default:
      return null;
  }
}

export function menuEditorErrorMessage(
  error: string | null | undefined,
): string | null {
  switch (error) {
    case "draft":
      return "A draft revision could not be created. Check that this menu still has a published version.";
    case "discard":
      return "The draft could not be discarded.";
    case "delete-category":
      return "The category could not be deleted.";
    case "delete-item":
      return "The menu item could not be deleted.";
    default:
      return error
        ? "The action could not be completed. Please try again."
        : null;
  }
}

export function buildMenuEditorMessages(input: {
  notice?: string | null;
  error?: string | null;
}): MenuEditorMessages {
  return {
    noticeMessage: menuEditorNoticeMessage(input.notice),
    errorMessage: menuEditorErrorMessage(input.error),
  };
}

export function menuStatusTone(status: string): MenuStatusTone {
  switch (status) {
    case "draft":
      return "warning";
    case "published":
      return "success";
    default:
      return "neutral";
  }
}

export function deriveMenuEditorFlags(input: {
  canEditMenu: boolean;
  canPublishMenu: boolean;
  restaurantStatus: string;
  menuStatus: string;
}): MenuEditorFlags {
  const isDraft = input.menuStatus === "draft";
  const restaurantActive = input.restaurantStatus === "active";

  return {
    isDraft,
    restaurantActive,
    canEdit: input.canEditMenu && restaurantActive,
    canPublish: input.canPublishMenu && restaurantActive && isDraft,
  };
}

export function buildCategoryOptions<Category extends MenuEditorCategoryOption>(
  categories: readonly Category[],
): MenuEditorCategoryOption[] {
  return categories.map(({ id, name }) => ({ id, name }));
}

export function toItemFormValues(
  item: MenuEditorItem,
): MenuEditorItemFormValues {
  return {
    id: item.id,
    categoryId: item.categoryId,
    name: item.name,
    description: item.description ?? "",
    basePrice: formatMinorForInput(item.basePriceMinor),
    availabilityStatus: item.availabilityStatus,
    sortOrder: item.sortOrder,
    variants: item.variants.map((variant) => ({
      name: variant.name,
      price: formatMinorForInput(variant.priceMinor),
    })),
    modifiers: item.modifiers.map((modifier) => ({
      name: modifier.name,
      price: formatMinorForInput(modifier.additionalPriceMinor),
      isAvailable: modifier.isAvailable,
    })),
  };
}

export function nextItemSortOrder(itemCount: number): number {
  return (itemCount + 1) * 10;
}

export function nextCategorySortOrder(categoryCount: number): number {
  return (categoryCount + 1) * 10;
}

export function countLabel(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function itemCountLabel(count: number): string {
  return countLabel(count, "item");
}

export function variantCountLabel(count: number): string {
  return countLabel(count, "variant");
}

export function addOnCountLabel(count: number): string {
  return countLabel(count, "add-on");
}

export function categoryCountLabel(count: number): string {
  return countLabel(count, "category", "categories");
}
