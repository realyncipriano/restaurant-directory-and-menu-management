import { itemCountLabel } from "@/lib/count-label";
import { formatPrice } from "@/lib/money";

export { itemCountLabel };

export type ReviewItem = {
  id: string;
  pageNumber: number | null;
  categoryName: string;
  name: string;
  description: string | null;
  basePriceMinor: number | null;
  currency: string;
  variants: { name: string; priceMinor: number | null }[];
  modifiers: {
    name: string;
    additionalPriceMinor: number | null;
    isAvailable: boolean;
  }[];
  availabilityStatus: "available" | "unavailable";
  confidence: number | null;
  needsReview: boolean;
  changeType: string;
  decision: "pending" | "accept" | "reject";
  duplicateName: string | null;
};

export type ImportReviewSourceItem = Omit<ReviewItem, "duplicateName"> & {
  duplicateOfImportItemId: string | null;
};

export type ImportReviewCounts = {
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  needsReview: number;
};

export type CategorySummary = {
  name: string;
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
};

export type ImportReviewGroup = CategorySummary & {
  items: ReviewItem[];
};

export type ImportReviewStat = {
  label: string;
  value: number;
  highlight?: boolean;
};

export type ImportReviewView = {
  counts: ImportReviewCounts;
  reviewItems: ReviewItem[];
  categories: CategorySummary[];
  activeCategory: CategorySummary | null;
  selectedCategoryMissing: boolean;
  noticeCategoryName: string;
  visibleGroups: ImportReviewGroup[];
  visibleCount: number;
  visibleReviewCount: number;
  pendingOutsideCategory: number;
  stats: ImportReviewStat[];
  keepOnlyMessage: string;
};

export type ImportReviewNoticeTone =
  | "success"
  | "error"
  | "warning"
  | "info";

export type ImportReviewNoticeKey =
  | "accepted"
  | "category-accepted"
  | "category-rejected"
  | "keep-only"
  | "accept-error"
  | "category-error"
  | "category-missing"
  | "failed"
  | "extraction-unconfigured"
  | "read-only";

export type ImportReviewNotice = {
  key: ImportReviewNoticeKey;
  tone: ImportReviewNoticeTone;
  title?: string;
  message: string;
};

export type ImportReviewNoticeInput = {
  notice?: string;
  error?: string;
  accepted?: number;
  rejected?: number;
  pending?: number;
  pendingInCategory?: number;
  selectedCategoryParam?: string;
  activeCategoryName?: string;
  selectedCategoryMissing: boolean;
  failedMessage: string | null;
  extractionConfigured: boolean;
  canEdit: boolean;
  status: string;
};

const changeLabels: Record<string, string> = {
  new: "New item",
  price_changed: "Price changed",
  description_changed: "Description changed",
  availability_changed: "Availability changed",
  unchanged: "Unchanged",
};

export function normalizeCategory(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function categoryLabel(value: string): string {
  return value.trim() || "Uncategorized";
}

function needsReviewFirst(items: ReviewItem[]): ReviewItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        Number(right.item.needsReview) - Number(left.item.needsReview) ||
        left.index - right.index,
    )
    .map(({ item }) => item);
}

export function importChangeLabel(value: string): string {
  return changeLabels[value] ?? value;
}

export function isLowConfidence(confidence: number | null): boolean {
  return (confidence ?? 0) < 70;
}

export function formatReviewItemPrice(
  item: Pick<ReviewItem, "basePriceMinor" | "currency" | "variants">,
): string {
  if (item.basePriceMinor !== null) {
    return formatPrice(item.basePriceMinor, item.currency);
  }
  return item.variants.length > 0 ? "Varies" : "No price";
}

export function buildCategoryHref(
  restaurantId: string,
  importId: string,
  categoryName?: string,
): string {
  const search = new URLSearchParams();
  if (categoryName) search.set("category", categoryName);
  const suffix = search.toString();
  return `/dashboard/restaurants/${restaurantId}/imports/${importId}${suffix ? `?${suffix}` : ""}`;
}

export function buildKeepOnlyMessage(
  activeCategory: CategorySummary,
  pendingOutsideCategory: number,
): string {
  return `Keep only “${activeCategory.name}”? This accepts eligible pending items in this category and moves eligible pending items outside it to rejected. ${itemCountLabel(activeCategory.pending)} are pending in this category and ${itemCountLabel(pendingOutsideCategory)} outside it. Flagged, low-confidence, unpriced, and duplicate items outside this category stay pending for manual review.`;
}

export function buildImportReviewView(
  items: readonly ImportReviewSourceItem[],
  selectedCategoryParam?: string,
): ImportReviewView {
  const acceptCount = items.filter((item) => item.decision === "accept").length;
  const pendingCount = items.filter((item) => item.decision === "pending").length;
  const rejectedCount = items.filter(
    (item) => item.decision === "reject",
  ).length;
  const reviewCount = items.filter(
    (item) => item.decision === "pending" && item.needsReview,
  ).length;

  const categoryMap = new Map<string, CategorySummary>();
  for (const item of items) {
    const label = categoryLabel(item.categoryName);
    const key = normalizeCategory(label);
    const summary = categoryMap.get(key) ?? {
      name: label,
      total: 0,
      pending: 0,
      accepted: 0,
      rejected: 0,
    };
    summary.total += 1;
    if (item.decision === "pending") summary.pending += 1;
    else if (item.decision === "accept") summary.accepted += 1;
    else summary.rejected += 1;
    categoryMap.set(key, summary);
  }
  const categories = [...categoryMap.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const activeCategory = selectedCategoryParam
    ? (categories.find(
        (category) =>
          normalizeCategory(category.name) ===
          normalizeCategory(selectedCategoryParam),
      ) ?? null)
    : null;
  const selectedCategoryMissing =
    Boolean(selectedCategoryParam) && activeCategory === null;

  const namesById = new Map(items.map((item) => [item.id, item.name]));
  const duplicateNames = new Map<string, string>();
  for (const item of items) {
    if (item.duplicateOfImportItemId) {
      const originalName = namesById.get(item.duplicateOfImportItemId);
      if (originalName !== undefined) {
        duplicateNames.set(item.id, originalName);
      }
    }
  }

  const reviewItems: ReviewItem[] = items.map((item) => ({
    id: item.id,
    pageNumber: item.pageNumber,
    categoryName: item.categoryName,
    name: item.name,
    description: item.description,
    basePriceMinor: item.basePriceMinor,
    currency: item.currency,
    variants: item.variants,
    modifiers: item.modifiers,
    availabilityStatus: item.availabilityStatus,
    confidence: item.confidence,
    needsReview: item.needsReview,
    changeType: item.changeType,
    decision: item.decision,
    duplicateName: duplicateNames.get(item.id) ?? null,
  }));

  const itemsByCategory = new Map<string, ReviewItem[]>();
  for (const item of reviewItems) {
    const key = normalizeCategory(categoryLabel(item.categoryName));
    const group = itemsByCategory.get(key) ?? [];
    group.push(item);
    itemsByCategory.set(key, group);
  }
  for (const [key, group] of itemsByCategory) {
    itemsByCategory.set(key, needsReviewFirst(group));
  }

  const visibleGroups = (activeCategory ? [activeCategory] : categories)
    .map((category) => ({
      ...category,
      items:
        itemsByCategory.get(normalizeCategory(category.name)) ?? [],
    }))
    .filter((category) => category.items.length > 0);
  const visibleCount = visibleGroups.reduce(
    (total, category) => total + category.items.length,
    0,
  );
  const visibleReviewCount = visibleGroups.reduce(
    (total, category) =>
      total +
      category.items.filter(
        (item) => item.decision === "pending" && item.needsReview,
      ).length,
    0,
  );
  const pendingOutsideCategory = Math.max(
    0,
    pendingCount - (activeCategory?.pending ?? 0),
  );
  const noticeCategoryName =
    selectedCategoryParam ?? activeCategory?.name ?? "the selected category";

  const stats: ImportReviewStat[] = [
    { label: "Extracted", value: items.length },
    { label: "Needs review", value: reviewCount, highlight: reviewCount > 0 },
    { label: "Pending", value: pendingCount },
    { label: "Accepted", value: acceptCount },
    { label: "Rejected", value: rejectedCount, highlight: rejectedCount > 0 },
  ];
  const keepOnlyMessage = activeCategory
    ? buildKeepOnlyMessage(activeCategory, pendingOutsideCategory)
    : "";

  return {
    counts: {
      total: items.length,
      pending: pendingCount,
      accepted: acceptCount,
      rejected: rejectedCount,
      needsReview: reviewCount,
    },
    reviewItems,
    categories,
    activeCategory,
    selectedCategoryMissing,
    noticeCategoryName,
    visibleGroups,
    visibleCount,
    visibleReviewCount,
    pendingOutsideCategory,
    stats,
    keepOnlyMessage,
  };
}

export function buildImportReviewNotices(
  input: ImportReviewNoticeInput,
): ImportReviewNotice[] {
  const notices: ImportReviewNotice[] = [];
  const noticeCategoryName =
    input.selectedCategoryParam ??
    input.activeCategoryName ??
    "the selected category";

  if (input.notice === "accepted") {
    notices.push({
      key: "accepted",
      tone: "success",
      message:
        "Confident, priced items were accepted. Review the remaining items before applying.",
    });
  }
  if (input.notice === "category-accepted") {
    const accepted = input.accepted ?? 0;
    const pendingInCategory = input.pendingInCategory ?? 0;
    notices.push({
      key: "category-accepted",
      tone: "success",
      message: `Accepted ${accepted} pending ${
        accepted === 1 ? "item" : "items"
      } in “${noticeCategoryName}”. ${
        pendingInCategory
          ? `${itemCountLabel(pendingInCategory)} in this category still need review.`
          : "No items remain pending in this category."
      }`,
    });
  }
  if (input.notice === "category-rejected") {
    const rejected = input.rejected ?? 0;
    notices.push({
      key: "category-rejected",
      tone: "success",
      message: `Rejected ${rejected} pending ${
        rejected === 1 ? "item" : "items"
      } in “${noticeCategoryName}”. ${itemCountLabel(
        input.pending ?? 0,
      )} remain pending across this scan.`,
    });
  }
  if (input.notice === "keep-only") {
    const accepted = input.accepted ?? 0;
    notices.push({
      key: "keep-only",
      tone: "success",
      message: `Kept only “${noticeCategoryName}”. Accepted ${accepted} ${
        accepted === 1 ? "item" : "items"
      } and moved ${input.rejected ?? 0} to rejected. ${itemCountLabel(
        input.pending ?? 0,
      )} remain pending for manual review.`,
    });
  }

  if (input.error === "accept") {
    notices.push({
      key: "accept-error",
      tone: "error",
      message: "Items could not be accepted. Please try again.",
    });
  }
  if (input.error === "category") {
    notices.push({
      key: "category-error",
      tone: "error",
      message:
        "The category action could not be completed. No item decisions were changed.",
    });
  }

  if (input.selectedCategoryMissing) {
    notices.push({
      key: "category-missing",
      tone: "warning",
      message:
        "That category is no longer present in this scan. Showing all categories instead.",
    });
  }

  if (input.status === "failed" && input.failedMessage) {
    notices.push({
      key: "failed",
      tone: "error",
      message: input.failedMessage,
    });
  }

  if (!input.extractionConfigured && input.status !== "applied") {
    notices.push({
      key: "extraction-unconfigured",
      tone: "warning",
      title: "Menu extraction is not configured",
      message:
        "Add an extraction provider and API key to process this scan, or continue with manual menu entry.",
    });
  }

  if (!input.canEdit) {
    notices.push({
      key: "read-only",
      tone: "info",
      message: "You have read-only access to this scan review.",
    });
  }

  return notices;
}
