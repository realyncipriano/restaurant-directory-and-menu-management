import Link from "next/link";

import { ImportCategoryControls } from "@/components/imports/review/import-category-controls";
import { Badge } from "@/components/ui/badge";
import {
  buildCategoryHref,
  itemCountLabel,
  normalizeCategory,
  type CategorySummary,
  type ImportReviewCounts,
} from "@/lib/import-review-view";

export function ImportCategorySection({
  restaurantId,
  importId,
  itemCount,
  counts,
  categories,
  activeCategory,
  pendingOutsideCategory,
  keepOnlyMessage,
  canEdit,
  status,
}: {
  restaurantId: string;
  importId: string;
  itemCount: number;
  counts: ImportReviewCounts;
  categories: readonly CategorySummary[];
  activeCategory: CategorySummary | null;
  pendingOutsideCategory: number;
  keepOnlyMessage: string;
  canEdit: boolean;
  status: string;
}) {
  return (
    <section
      aria-labelledby="scan-categories"
      className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2
            id="scan-categories"
            className="text-sm font-semibold text-zinc-900"
          >
            Categories in this scan
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-zinc-500">
            Every section heading is extracted first. The menu title names the
            overall container, such as “Beverages”, while headings detected in
            the scan become categories such as “Coffee”, “Non-coffee”, and
            “Espresso Specials”. Choose a category to review only that section.
          </p>
        </div>
        <p className="text-xs text-zinc-500">
          {`${itemCountLabel(itemCount)} · ${categories.length} ${
            categories.length === 1 ? "category" : "categories"
          }`}
        </p>
      </div>

      <nav
        aria-label="Filter scan by category"
        className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
      >
        <Link
          href={buildCategoryHref(restaurantId, importId)}
          aria-current={!activeCategory ? "page" : undefined}
          className={
            !activeCategory
              ? "rounded-xl border border-amber-400 bg-amber-50/70 p-3 shadow-sm ring-1 ring-amber-200 transition"
              : "rounded-xl border border-zinc-200 bg-white p-3 transition hover:border-amber-300 hover:bg-amber-50/40"
          }
        >
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-semibold text-zinc-900">
              All categories
            </span>
            <span className="shrink-0 text-[11px] text-zinc-500">
              {itemCountLabel(itemCount)}
            </span>
          </span>
          <span className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="warning">{counts.pending} pending</Badge>
            <Badge tone="success">{counts.accepted} accepted</Badge>
            <Badge tone="neutral">{counts.rejected} rejected</Badge>
          </span>
        </Link>

        {categories.map((category) => {
          const selected =
            activeCategory !== null &&
            normalizeCategory(activeCategory.name) ===
              normalizeCategory(category.name);
          return (
            <Link
              key={category.name}
              href={buildCategoryHref(restaurantId, importId, category.name)}
              aria-current={selected ? "page" : undefined}
              className={
                selected
                  ? "rounded-xl border border-amber-400 bg-amber-50/70 p-3 shadow-sm ring-1 ring-amber-200 transition"
                  : "rounded-xl border border-zinc-200 bg-white p-3 transition hover:border-amber-300 hover:bg-amber-50/40"
              }
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-semibold text-zinc-900">
                  {category.name}
                </span>
                <span className="shrink-0 text-[11px] text-zinc-500">
                  {itemCountLabel(category.total)}
                </span>
              </span>
              <span className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone="warning">{category.pending} pending</Badge>
                <Badge tone="success">{category.accepted} accepted</Badge>
                <Badge tone="neutral">{category.rejected} rejected</Badge>
              </span>
            </Link>
          );
        })}
      </nav>

      {activeCategory ? (
        <ImportCategoryControls
          restaurantId={restaurantId}
          importId={importId}
          category={activeCategory}
          pendingOutsideCategory={pendingOutsideCategory}
          keepOnlyMessage={keepOnlyMessage}
          canEdit={canEdit}
          status={status}
        />
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/60 px-3.5 py-3 text-xs leading-5 text-zinc-500">
          Choose a category to accept, reject, or keep only that section. To
          accept every confident, priced item across the whole scan, use the
          sidebar.
        </p>
      )}
    </section>
  );
}
