import type { MenuTreeViewCategory } from "@/components/menus/editor/menu-tree-view";

export const READ_ONLY_MENU_PAGE_SIZE = 5;

export type PaginatedMenuTreeCategories = {
  categories: MenuTreeViewCategory[];
  totalItems: number;
  page: number;
  pageCount: number;
  pageSize: number;
  firstItem: number;
  lastItem: number;
  categoryPages: Record<string, number>;
};

/**
 * Slices read-only menu categories into a single page of items while keeping
 * category order and headers. A page can span the end of one category and the
 * start of the next.
 */
export function paginateMenuTreeCategories(
  categories: readonly MenuTreeViewCategory[],
  options: { page?: number; pageSize?: number } = {},
): PaginatedMenuTreeCategories {
  const requestedPageSize = options.pageSize ?? READ_ONLY_MENU_PAGE_SIZE;
  const flooredPageSize = Number.isFinite(requestedPageSize)
    ? Math.floor(requestedPageSize)
    : READ_ONLY_MENU_PAGE_SIZE;
  const pageSize =
    flooredPageSize > 0 ? flooredPageSize : READ_ONLY_MENU_PAGE_SIZE;
  const totalItems = categories.reduce(
    (sum, category) => sum + category.items.length,
    0,
  );
  const pageCount = Math.max(1, Math.ceil(totalItems / pageSize));
  const requestedPage = options.page ?? 1;
  const page = Number.isFinite(requestedPage)
    ? Math.min(Math.max(1, Math.floor(requestedPage)), pageCount)
    : 1;
  const start = (page - 1) * pageSize;
  const end = start + pageSize;

  const pagedCategories: MenuTreeViewCategory[] = [];
  const categoryPages: Record<string, number> = {};
  let offset = 0;

  for (const category of categories) {
    if (category.items.length === 0) {
      const emptyCategoryPage = offset === 0 ? 1 : Math.ceil(offset / pageSize);
      categoryPages[category.id] = emptyCategoryPage;
      if (page === emptyCategoryPage) {
        pagedCategories.push({ ...category, items: [], totalItemCount: 0 });
      }
      continue;
    }

    const categoryStart = offset;
    const categoryEnd = offset + category.items.length;
    offset = categoryEnd;
    categoryPages[category.id] = Math.floor(categoryStart / pageSize) + 1;

    if (categoryEnd <= start || categoryStart >= end) continue;

    const sliceStart = Math.max(0, start - categoryStart);
    const sliceEnd = Math.min(category.items.length, end - categoryStart);
    if (sliceEnd <= sliceStart) continue;

    pagedCategories.push({
      ...category,
      items: category.items.slice(sliceStart, sliceEnd),
      totalItemCount: category.items.length,
    });
  }

  return {
    categories: pagedCategories,
    totalItems,
    page,
    pageCount,
    pageSize,
    firstItem: totalItems === 0 ? 0 : start + 1,
    lastItem: Math.min(end, totalItems),
    categoryPages,
  };
}
