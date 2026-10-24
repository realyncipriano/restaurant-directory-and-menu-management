import Link from "next/link";

import { AcceptAllForm } from "@/components/imports/accept-all-form";
import { ApplyImportForm } from "@/components/imports/apply-import-form";
import { ProcessImportForm } from "@/components/imports/process-import-form";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import type { ImportReviewStat } from "@/lib/import-review-view";

const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function ImportReviewSidebar({
  restaurantId,
  importId,
  menuId,
  status,
  appliedAt,
  pagesCount,
  maxPages,
  stats,
  itemsCount,
  pendingCount,
  acceptCount,
  canProcess,
  canEdit,
  activeCategoryName,
}: {
  restaurantId: string;
  importId: string;
  menuId: string;
  status: string;
  appliedAt: Date | null;
  pagesCount: number;
  maxPages: number;
  stats: readonly ImportReviewStat[];
  itemsCount: number;
  pendingCount: number;
  acceptCount: number;
  canProcess: boolean;
  canEdit: boolean;
  activeCategoryName: string | null;
}) {
  return (
    <Card className="h-fit lg:sticky lg:top-24">
      <CardBody className="space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">
            Review status
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className={
                  stat.highlight
                    ? "rounded-xl border border-amber-200 bg-amber-50 px-3 py-2"
                    : "rounded-xl border border-zinc-200 bg-zinc-50/60 px-3 py-2"
                }
              >
                <dt className="text-[11px] text-zinc-500">{stat.label}</dt>
                <dd
                  className={
                    stat.highlight
                      ? "text-lg font-semibold text-amber-800"
                      : "text-lg font-semibold text-zinc-900"
                  }
                >
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[11px] leading-5 text-zinc-500">
            Pages {pagesCount}/{maxPages}. Confidence, missing prices,
            duplicates, and changes to existing items are flagged.
          </p>
        </div>

        {canProcess ? (
          <div className="border-t border-zinc-100 pt-4">
            <ProcessImportForm
              restaurantId={restaurantId}
              importId={importId}
              label={
                status === "failed" ? "Retry extraction" : "Extract menu items"
              }
            />
          </div>
        ) : null}

        {status === "needs_review" && itemsCount === 0 ? (
          <Notice tone="warning">
            No menu items were extracted. Check image clarity and provider
            settings, or add items manually to the draft.
          </Notice>
        ) : null}

        {status === "needs_review" && canEdit && !activeCategoryName ? (
          <div className="border-t border-zinc-100 pt-4">
            <AcceptAllForm
              restaurantId={restaurantId}
              importId={importId}
              pendingCount={pendingCount}
            />
          </div>
        ) : null}

        {status === "needs_review" && canEdit && activeCategoryName ? (
          <Notice tone="info">
            {`Use the category controls above to accept, reject, or keep only “${activeCategoryName}”.`}
          </Notice>
        ) : null}

        {status === "needs_review" && canEdit ? (
          <div className="border-t border-zinc-100 pt-4">
            <ApplyImportForm
              restaurantId={restaurantId}
              importId={importId}
              acceptCount={acceptCount}
            />
          </div>
        ) : null}

        {status === "applied" ? (
          <div className="border-t border-zinc-100 pt-4">
            <Notice tone="success">
              Applied to the draft on{" "}
              {appliedAt
                ? dateFormatter.format(appliedAt)
                : "an earlier date"}
              .
            </Notice>
            <Link
              href={`/dashboard/restaurants/${restaurantId}/menus/${menuId}`}
              className={buttonClass({
                variant: "secondary",
                size: "sm",
                className: "mt-2",
              })}
            >
              Open draft menu
            </Link>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
