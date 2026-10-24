import { AlertTriangle } from "lucide-react";

import { ImportItemGroup } from "@/components/imports/review/import-item-group";
import {
  itemCountLabel,
  type ImportReviewGroup,
} from "@/lib/import-review-view";

export function ImportItemList({
  restaurantId,
  importId,
  itemCount,
  visibleCount,
  visibleReviewCount,
  groups,
  activeCategoryName,
  canEdit,
  status,
}: {
  restaurantId: string;
  importId: string;
  itemCount: number;
  visibleCount: number;
  visibleReviewCount: number;
  groups: readonly ImportReviewGroup[];
  activeCategoryName: string | null;
  canEdit: boolean;
  status: string;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900">
          Extracted items
        </h2>
        <p className="text-xs text-zinc-500">
          Showing {itemCountLabel(visibleCount)}
          {activeCategoryName
            ? ` in “${activeCategoryName}”`
            : " across all categories"}
        </p>
        {visibleReviewCount > 0 ? (
          <p className="flex items-center gap-1 text-xs text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {visibleReviewCount} item{visibleReviewCount === 1 ? "" : "s"}{" "}
            flagged for review
          </p>
        ) : null}
      </div>

      {itemCount === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-10 text-center text-sm text-zinc-500">
          No extracted items yet.
        </p>
      ) : groups.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-10 text-center text-sm text-zinc-500">
          No items match this category.
        </p>
      ) : (
        <div className="space-y-5">
          {groups.map((group, index) => (
            <ImportItemGroup
              key={group.name}
              group={group}
              index={index}
              restaurantId={restaurantId}
              importId={importId}
              canEdit={canEdit}
              status={status}
            />
          ))}
        </div>
      )}
    </section>
  );
}
