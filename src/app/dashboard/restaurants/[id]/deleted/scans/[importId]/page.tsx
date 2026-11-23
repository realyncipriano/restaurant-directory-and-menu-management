import type { Metadata } from "next";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ScanLine,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ReviewItemIndicators } from "@/components/imports/review/review-item-indicators";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/db/client";
import { requireAdminUser } from "@/lib/auth/guards";
import { NotFoundError } from "@/lib/errors";
import { paginateImportReviewGroups } from "@/lib/import-review-pagination";
import {
  buildImportReviewView,
  type ReviewItem,
} from "@/lib/import-review-view";
import { formatPrice } from "@/lib/money";
import { getDeletedMenuImport } from "@/server/services/deleted-items";
import { getRestaurantAccess } from "@/server/services/restaurant-access";

export const metadata: Metadata = {
  title: "Deleted scan",
  robots: { index: false, follow: false },
};

const DAY_MS = 24 * 60 * 60 * 1000;

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

function dayLabel(days: number): string {
  return `${days} day${days === 1 ? "" : "s"}`;
}

function requestedPageNumber(value: string | string[] | undefined): number {
  const raw = typeof value === "string" ? value.trim() : "";
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 1;
}

function scanItemsHref(
  restaurantId: string,
  importId: string,
  page: number,
): string {
  const base = `/dashboard/restaurants/${restaurantId}/deleted/scans/${importId}`;
  return page > 1 ? `${base}?page=${page}` : base;
}

function ReadOnlyItem({ item }: { item: ReviewItem }) {
  return (
    <article className="rounded-2xl border border-zinc-200 bg-surface p-4 shadow-sm">
      <ReviewItemIndicators item={item} />

      {item.description ? (
        <p className="mt-2 whitespace-pre-line text-sm leading-6 text-zinc-600">
          {item.description}
        </p>
      ) : null}

      {item.variants.length > 0 ? (
        <p className="mt-2 text-xs leading-5 text-zinc-500">
          Variants:{" "}
          {item.variants
            .map(
              (variant) =>
                `${variant.name} ${formatPrice(variant.priceMinor, item.currency)}`,
            )
            .join(" · ")}
        </p>
      ) : null}

      {item.modifiers.length > 0 ? (
        <p className="mt-1 text-xs leading-5 text-zinc-400">
          Add-ons:{" "}
          {item.modifiers
            .map(
              (modifier) =>
                `${modifier.name} +${formatPrice(modifier.additionalPriceMinor, item.currency)}`,
            )
            .join(" · ")}
        </p>
      ) : null}
    </article>
  );
}

export default async function DeletedScanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; importId: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const admin = await requireAdminUser();
  const { id, importId } = await params;
  const query = await searchParams;
  const requestedPage = requestedPageNumber(query.page);

  let restaurant;
  let data;
  try {
    const access = await getRestaurantAccess(getDb(), admin.id, id);
    restaurant = access.restaurant;
    data = await getDeletedMenuImport(getDb(), admin.id, importId);
    if (data.import.restaurantId !== id) notFound();
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const record = data.import;
  const view = buildImportReviewView(data.items);
  const pagination = paginateImportReviewGroups(view.visibleGroups, {
    page: requestedPage,
  });
  const purgeAfter = new Date(
    record.deletedAt.getTime() + data.retentionDays * DAY_MS,
  );
  const retentionLabel = dayLabel(data.retentionDays);

  return (
    <div className="space-y-6">
      <PageHeader
        backHref={`/dashboard/restaurants/${restaurant.id}/deleted`}
        backLabel="Deleted items"
        title="Deleted scan"
        description={
          <span className="text-sm text-zinc-600">
            {data.menu ? (
              <>
                Target menu:{" "}
                <Link
                  href={`/dashboard/restaurants/${restaurant.id}/menus/${data.menu.id}`}
                  className="font-medium text-accent hover:underline"
                >
                  {data.menu.title} v{data.menu.version}
                </Link>
              </>
            ) : (
              "Target menu removed"
            )}{" "}
            · Uploaded {dateFormatter.format(record.createdAt)}
          </span>
        }
        actions={
          <Badge
            tone={statusTones[record.status] ?? "neutral"}
            className="capitalize"
          >
            {record.status.replaceAll("_", " ")}
          </Badge>
        }
      />

      <Notice tone="warning" title="This scan was deleted">
        Deleted {dateFormatter.format(record.deletedAt)}
        {data.deletedByEmail ? ` by ${data.deletedByEmail}` : ""}. The scan is
        read-only. Menu content was not changed. Its source images and extracted
        items will be permanently removed after {retentionLabel} (around{" "}
        {dateFormatter.format(purgeAfter)}).
      </Notice>

      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Source pages
              </dt>
              <dd className="mt-1 text-2xl font-semibold text-zinc-900">
                {data.pages.length}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Extracted items
              </dt>
              <dd className="mt-1 text-2xl font-semibold text-zinc-900">
                {view.counts.total}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Accepted
              </dt>
              <dd className="mt-1 text-2xl font-semibold text-zinc-900">
                {view.counts.accepted}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Rejected
              </dt>
              <dd className="mt-1 text-2xl font-semibold text-zinc-900">
                {view.counts.rejected}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon={<ScanLine className="h-4 w-4 text-zinc-400" aria-hidden="true" />}
          title="Source pages"
          description="Read-only previews are served through authorized, short-lived signed links."
        />
        <CardBody>
          {data.pages.length === 0 ? (
            <p className="text-sm text-zinc-500">No source pages remain.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.pages.map((page) => (
                <a
                  key={page.id}
                  href={`/dashboard/restaurants/${restaurant.id}/deleted/scans/${importId}/pages/${page.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="group block overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 transition hover:border-amber-300 hover:shadow-sm"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/dashboard/restaurants/${restaurant.id}/deleted/scans/${importId}/pages/${page.id}`}
                    alt={`Menu page ${page.pageNumber}`}
                    className="h-48 w-full object-contain"
                    loading="lazy"
                  />
                  <p className="bg-surface px-3 py-2 text-xs text-zinc-500">
                    Page {page.pageNumber} ·{" "}
                    <span className="capitalize">
                      {page.processingStatus.replaceAll("_", " ")}
                    </span>
                  </p>
                </a>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900">
            Extracted items
          </h2>
          <p className="text-xs text-zinc-500">
            {pagination.pageCount > 1
              ? `Page ${pagination.page} of ${pagination.pageCount} · `
              : ""}
            {view.counts.total} item{view.counts.total === 1 ? "" : "s"} ·{" "}
            {view.counts.pending} pending · {view.counts.accepted} accepted ·{" "}
            {view.counts.rejected} rejected
          </p>
        </div>

        {view.visibleGroups.length === 0 ? (
          <EmptyState
            title="No extracted items"
            description="This scan has no extracted items to display."
          />
        ) : (
          <div className="space-y-5">
            {pagination.groups.map((group) => (
              <section key={group.name} className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-zinc-900">
                    {group.name}
                  </h3>
                  <p className="text-xs text-zinc-500">
                    {group.items.length < group.total
                      ? `${group.items.length} of ${group.total} items on this page`
                      : `${group.total} item${group.total === 1 ? "" : "s"}`}
                  </p>
                </div>
                <div className="space-y-3">
                  {group.items.map((item) => (
                    <ReadOnlyItem key={item.id} item={item} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {pagination.pageCount > 1 ? (
          <nav
            aria-label="Extracted items pagination"
            className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-3"
          >
            {pagination.page > 1 ? (
              <Link
                href={scanItemsHref(
                  restaurant.id,
                  importId,
                  pagination.page - 1,
                )}
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
              Showing {pagination.firstItem}–{pagination.lastItem} of{" "}
              {pagination.total}
            </span>
            {pagination.page < pagination.pageCount ? (
              <Link
                href={scanItemsHref(
                  restaurant.id,
                  importId,
                  pagination.page + 1,
                )}
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
        ) : null}
      </section>

      <div>
        <Link
          href={`/dashboard/restaurants/${restaurant.id}/deleted`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition hover:text-zinc-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to deleted items
        </Link>
      </div>
    </div>
  );
}
