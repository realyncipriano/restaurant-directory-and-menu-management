import type { ImportReviewGroup } from "@/lib/import-review-view";

export const IMPORT_REVIEW_PAGE_SIZE = 5;

export type PaginatedImportReviewGroups = {
  groups: ImportReviewGroup[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  firstItem: number;
  lastItem: number;
};

/**
 * Slices grouped review items into a single page while preserving category
 * headers. A page can span the end of one category and the start of the next.
 */
export function paginateImportReviewGroups(
  groups: readonly ImportReviewGroup[],
  options: { page?: number; pageSize?: number } = {},
): PaginatedImportReviewGroups {
  const requestedPageSize = options.pageSize ?? IMPORT_REVIEW_PAGE_SIZE;
  const flooredPageSize = Number.isFinite(requestedPageSize)
    ? Math.floor(requestedPageSize)
    : IMPORT_REVIEW_PAGE_SIZE;
  const pageSize =
    flooredPageSize > 0 ? flooredPageSize : IMPORT_REVIEW_PAGE_SIZE;
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const requestedPage = options.page ?? 1;
  const page = Number.isFinite(requestedPage)
    ? Math.min(Math.max(1, Math.floor(requestedPage)), pageCount)
    : 1;
  const start = (page - 1) * pageSize;
  const end = start + pageSize;

  const pagedGroups: ImportReviewGroup[] = [];
  let offset = 0;
  for (const group of groups) {
    const groupStart = offset;
    const groupEnd = offset + group.items.length;
    offset = groupEnd;

    if (groupEnd <= start || groupStart >= end) continue;

    const sliceStart = Math.max(0, start - groupStart);
    const sliceEnd = Math.min(group.items.length, end - groupStart);
    if (sliceEnd <= sliceStart) continue;

    pagedGroups.push({
      ...group,
      items: group.items.slice(sliceStart, sliceEnd),
    });
  }

  return {
    groups: pagedGroups,
    total,
    page,
    pageCount,
    pageSize,
    firstItem: total === 0 ? 0 : start + 1,
    lastItem: Math.min(end, total),
  };
}
