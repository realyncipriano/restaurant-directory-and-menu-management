import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function PaginationControls({
  ariaLabel,
  page,
  pageCount,
  firstItem,
  lastItem,
  total,
  hrefForPage,
  className,
}: {
  ariaLabel: string;
  page: number;
  pageCount: number;
  firstItem: number;
  lastItem: number;
  total: number;
  hrefForPage: (page: number) => string;
  className?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        "flex flex-wrap items-center justify-between gap-2",
        className,
      )}
    >
      {page > 1 ? (
        <Link
          href={hrefForPage(page - 1)}
          scroll={false}
          className={buttonClass({ variant: "outline", size: "sm" })}
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Newer
        </Link>
      ) : (
        <span
          className={buttonClass({
            variant: "outline",
            size: "sm",
            className: "pointer-events-none opacity-40",
          })}
          aria-disabled="true"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Newer
        </span>
      )}
      <span className="text-xs text-zinc-500">
        Showing {firstItem}–{lastItem} of {total}
      </span>
      {page < pageCount ? (
        <Link
          href={hrefForPage(page + 1)}
          scroll={false}
          className={buttonClass({ variant: "outline", size: "sm" })}
        >
          Older
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      ) : (
        <span
          className={buttonClass({
            variant: "outline",
            size: "sm",
            className: "pointer-events-none opacity-40",
          })}
          aria-disabled="true"
        >
          Older
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      )}
    </nav>
  );
}
