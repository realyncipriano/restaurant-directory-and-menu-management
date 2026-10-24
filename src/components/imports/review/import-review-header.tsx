import Link from "next/link";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";

const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

const statusTones: Record<string, BadgeTone> = {
  uploading: "info",
  uploaded: "neutral",
  processing: "info",
  needs_review: "warning",
  reviewed: "success",
  applied: "success",
  failed: "danger",
};

export function ImportReviewHeader({
  restaurantId,
  menuId,
  menuTitle,
  menuVersion,
  createdAt,
  status,
}: {
  restaurantId: string;
  menuId: string;
  menuTitle: string;
  menuVersion: number;
  createdAt: Date;
  status: string;
}) {
  return (
    <PageHeader
      backHref={`/dashboard/restaurants/${restaurantId}/imports`}
      backLabel="Menu scans"
      title="Scan review"
      description={
        <span className="text-sm text-zinc-600">
          Target draft:{" "}
          <Link
            href={`/dashboard/restaurants/${restaurantId}/menus/${menuId}`}
            className="font-medium text-amber-800 hover:underline"
          >
            {menuTitle} v{menuVersion}
          </Link>{" "}
          · Uploaded {dateFormatter.format(createdAt)}
        </span>
      }
      actions={
        <Badge
          tone={statusTones[status] ?? "neutral"}
          className="capitalize"
        >
          {status.replaceAll("_", " ")}
        </Badge>
      }
    />
  );
}
