import { ImportItemReviewForm } from "@/components/imports/review-item-form";
import {
  itemCountLabel,
  type ImportReviewGroup,
} from "@/lib/import-review-view";

export function ImportItemGroup({
  group,
  index,
  restaurantId,
  importId,
  canEdit,
  status,
}: {
  group: ImportReviewGroup;
  index: number;
  restaurantId: string;
  importId: string;
  canEdit: boolean;
  status: string;
}) {
  return (
    <section
      aria-labelledby={`category-group-${index}`}
      className="space-y-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          id={`category-group-${index}`}
          className="text-sm font-semibold text-zinc-900"
        >
          {group.name}
        </h3>
        <p className="text-xs text-zinc-500">
          {`${itemCountLabel(group.total)} · ${group.pending} pending · ${group.accepted} accepted · ${group.rejected} rejected`}
        </p>
      </div>

      <div className="space-y-3">
        {group.items.map((item) => (
          <fieldset
            key={item.id}
            disabled={!canEdit || status === "applied"}
            className="min-w-0"
          >
            <ImportItemReviewForm
              restaurantId={restaurantId}
              importId={importId}
              item={item}
            />
          </fieldset>
        ))}
      </div>
    </section>
  );
}
