import {
  keepOnlyCategoryAction,
  updateCategoryDecisionAction,
} from "@/app/dashboard/restaurants/[id]/imports/actions";
import { ConfirmButton } from "@/components/dashboard/confirm-button";
import { buttonClass } from "@/components/ui/button";
import {
  itemCountLabel,
  type CategorySummary,
} from "@/lib/import-review-view";

export function ImportCategoryControls({
  restaurantId,
  importId,
  category,
  pendingOutsideCategory,
  keepOnlyMessage,
  canEdit,
  status,
}: {
  restaurantId: string;
  importId: string;
  category: CategorySummary;
  pendingOutsideCategory: number;
  keepOnlyMessage: string;
  canEdit: boolean;
  status: string;
}) {
  return (
    <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3.5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900">
            Working on “{category.name}”
          </p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            {itemCountLabel(category.pending)} pending in this category;{" "}
            {itemCountLabel(pendingOutsideCategory)} pending outside it.
          </p>
        </div>

        {canEdit && status !== "applied" ? (
          <div className="flex flex-wrap gap-2">
            <form action={updateCategoryDecisionAction}>
              <input type="hidden" name="restaurantId" value={restaurantId} />
              <input type="hidden" name="importId" value={importId} />
              <input
                type="hidden"
                name="categoryName"
                value={category.name}
              />
              <input type="hidden" name="decision" value="accept" />
              <button
                type="submit"
                disabled={category.pending === 0}
                className={buttonClass({
                  variant: "outline",
                  size: "sm",
                  className:
                    "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
                })}
              >
                Accept pending in {category.name}
              </button>
            </form>

            <form action={updateCategoryDecisionAction}>
              <input type="hidden" name="restaurantId" value={restaurantId} />
              <input type="hidden" name="importId" value={importId} />
              <input
                type="hidden"
                name="categoryName"
                value={category.name}
              />
              <input type="hidden" name="decision" value="reject" />
              <button
                type="submit"
                disabled={category.pending === 0}
                className={buttonClass({
                  variant: "danger",
                  size: "sm",
                })}
              >
                Reject pending in {category.name}
              </button>
            </form>

            <form action={keepOnlyCategoryAction}>
              <input type="hidden" name="restaurantId" value={restaurantId} />
              <input type="hidden" name="importId" value={importId} />
              <input
                type="hidden"
                name="categoryName"
                value={category.name}
              />
              <ConfirmButton
                message={keepOnlyMessage}
                className={buttonClass({
                  variant: "secondary",
                  size: "sm",
                })}
              >
                Keep only “{category.name}”
              </ConfirmButton>
            </form>
          </div>
        ) : null}
      </div>

      <p className="mt-3 text-[11px] leading-5 text-zinc-500">
        {`Accept uses the same rules as Accept all: only pending, priced, confident, non-duplicate items are accepted. Keep only accepts eligible pending items in “${category.name}” and moves eligible pending items outside it to rejected. Flagged, low-confidence, unpriced, and duplicate items outside this category stay pending for manual review.`}
      </p>
    </div>
  );
}
