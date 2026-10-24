import { Badge } from "@/components/ui/badge";
import {
  formatReviewItemPrice,
  importChangeLabel,
  isLowConfidence,
  type ReviewItem,
} from "@/lib/import-review-view";

export function ReviewItemIndicators({ item }: { item: ReviewItem }) {
  const lowConfidence = isLowConfidence(item.confidence);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <Badge tone="neutral">{importChangeLabel(item.changeType)}</Badge>
        <Badge tone={lowConfidence ? "danger" : "success"}>
          {item.confidence ?? "?"}% confidence
        </Badge>
        {item.needsReview ? <Badge tone="warning">Needs review</Badge> : null}
        {item.pageNumber ? (
          <span className="text-zinc-400">Page {item.pageNumber}</span>
        ) : null}
        {item.duplicateName ? (
          <Badge tone="warning">
            Possible duplicate of “{item.duplicateName}”
          </Badge>
        ) : null}
        <Badge
          tone={
            item.decision === "accept"
              ? "success"
              : item.decision === "reject"
                ? "neutral"
                : "warning"
          }
          className="ml-auto"
        >
          {item.decision}
        </Badge>
      </div>

      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-900">
            {item.name || "Untitled item"}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {item.categoryName}
            <span className="text-zinc-300"> · </span>
            {formatReviewItemPrice(item)}
          </p>
        </div>
      </div>
    </>
  );
}
