import type { Metadata } from "next";
import { AlertTriangle, ScanLine } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getDb } from "@/db/client";
import { AcceptAllForm } from "@/components/imports/accept-all-form";
import { ApplyImportForm } from "@/components/imports/apply-import-form";
import { ProcessImportForm } from "@/components/imports/process-import-form";
import {
  ImportItemReviewForm,
  type ReviewItem,
} from "@/components/imports/review-item-form";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import {
  Card,
  CardBody,
  CardHeader,
} from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { requireCurrentUser } from "@/lib/auth/guards";
import {
  getExtractionConfig,
  isExtractionConfigured,
} from "@/lib/env";
import { NotFoundError } from "@/lib/errors";
import { getMenuImport } from "@/server/services/imports";

export const metadata: Metadata = {
  title: "Scan review",
  robots: { index: false, follow: false },
};

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

export default async function MenuImportReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; importId: string }>;
  searchParams: Promise<{
    notice?: string | string[];
    error?: string | string[];
  }>;
}) {
  const user = await requireCurrentUser();
  const { id, importId } = await params;
  const query = await searchParams;

  let data;
  try {
    data = await getMenuImport(getDb(), user.id, importId);
    if (data.import.restaurantId !== id) notFound();
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const { import: record, menu, access, pages, items } = data;
  const { restaurant, flags } = access;
  const canEdit = flags.canEditMenu && restaurant.status === "active";
  const extractionConfigured = isExtractionConfigured();
  const maxPages = getExtractionConfig()?.maxPages ?? 10;
  const notice = typeof query.notice === "string" ? query.notice : undefined;
  const error = typeof query.error === "string" ? query.error : undefined;
  const canProcess =
    canEdit &&
    extractionConfigured &&
    (record.status === "uploaded" || record.status === "failed");
  const acceptCount = items.filter((item) => item.decision === "accept").length;
  const pendingCount = items.filter((item) => item.decision === "pending").length;
  const reviewCount = items.filter(
    (item) => item.decision === "pending" && item.needsReview,
  ).length;

  const duplicateNames = new Map<string, string>();
  for (const item of items) {
    if (item.duplicateOfImportItemId) {
      const original = items.find(
        (candidate) => candidate.id === item.duplicateOfImportItemId,
      );
      if (original) duplicateNames.set(item.id, original.name);
    }
  }

  const reviewItems: ReviewItem[] = items.map((item) => ({
    id: item.id,
    pageNumber: item.pageNumber,
    categoryName: item.categoryName,
    name: item.name,
    description: item.description,
    basePriceMinor: item.basePriceMinor,
    currency: item.currency,
    variants: item.variants,
    modifiers: item.modifiers,
    availabilityStatus: item.availabilityStatus,
    confidence: item.confidence,
    needsReview: item.needsReview,
    changeType: item.changeType,
    decision: item.decision,
    duplicateName: duplicateNames.get(item.id) ?? null,
  }));

  const stats = [
    { label: "Extracted", value: items.length },
    { label: "Needs review", value: reviewCount, highlight: reviewCount > 0 },
    { label: "Pending", value: pendingCount },
    { label: "Accepted", value: acceptCount },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        backHref={`/dashboard/restaurants/${restaurant.id}/imports`}
        backLabel="Menu scans"
        title="Scan review"
        description={
          <span className="text-sm text-zinc-600">
            Target draft:{" "}
            <Link
              href={`/dashboard/restaurants/${restaurant.id}/menus/${menu.id}`}
              className="font-medium text-amber-800 hover:underline"
            >
              {menu.title} v{menu.version}
            </Link>{" "}
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

      {notice === "accepted" ? (
        <Notice tone="success">
          Confident, priced items were accepted. Review the remaining items
          before applying.
        </Notice>
      ) : null}
      {error === "accept" ? (
        <Notice tone="error">
          Items could not be accepted. Please try again.
        </Notice>
      ) : null}

      {record.status === "failed" && record.errorDetails?.message ? (
        <Notice tone="error">{String(record.errorDetails.message)}</Notice>
      ) : null}

      {!extractionConfigured && record.status !== "applied" ? (
        <Notice tone="warning" title="Menu extraction is not configured">
          Add an extraction provider and API key to process this scan, or continue
          with manual menu entry.
        </Notice>
      ) : null}

      {!canEdit ? (
        <Notice tone="info">You have read-only access to this scan review.</Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader
            icon={<ScanLine className="h-4 w-4 text-zinc-400" aria-hidden="true" />}
            title="Uploaded pages"
            description="Private previews are served through authorized, short-lived signed links."
          />
          <CardBody>
            <div className="grid gap-3 sm:grid-cols-2">
              {pages.map((page) => (
                <a
                  key={page.id}
                  href={`/dashboard/restaurants/${restaurant.id}/imports/${importId}/pages/${page.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="group block overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 transition hover:border-amber-300 hover:shadow-sm"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/dashboard/restaurants/${restaurant.id}/imports/${importId}/pages/${page.id}`}
                    alt={`Menu page ${page.pageNumber}`}
                    className="h-48 w-full object-contain"
                    loading="lazy"
                  />
                  <p className="bg-white px-3 py-2 text-xs text-zinc-500">
                    Page {page.pageNumber} ·{" "}
                    <span className="capitalize">{page.processingStatus}</span>
                  </p>
                </a>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card className="h-fit">
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
                Pages {pages.length}/{maxPages}. Confidence, missing prices,
                duplicates, and changes to existing items are flagged.
              </p>
            </div>

            {canProcess ? (
              <div className="border-t border-zinc-100 pt-4">
                <ProcessImportForm
                  restaurantId={restaurant.id}
                  importId={importId}
                  label={
                    record.status === "failed"
                      ? "Retry extraction"
                      : "Extract menu items"
                  }
                />
              </div>
            ) : null}

            {record.status === "needs_review" && items.length === 0 ? (
              <Notice tone="warning">
                No menu items were extracted. Check image clarity and provider
                settings, or add items manually to the draft.
              </Notice>
            ) : null}

            {record.status === "needs_review" && canEdit ? (
              <div className="border-t border-zinc-100 pt-4">
                <AcceptAllForm
                  restaurantId={restaurant.id}
                  importId={importId}
                  pendingCount={pendingCount}
                />
              </div>
            ) : null}

            {record.status === "needs_review" && canEdit ? (
              <div className="border-t border-zinc-100 pt-4">
                <ApplyImportForm
                  restaurantId={restaurant.id}
                  importId={importId}
                  acceptCount={acceptCount}
                />
              </div>
            ) : null}

            {record.status === "applied" ? (
              <div className="border-t border-zinc-100 pt-4">
                <Notice tone="success">
                  Applied to the draft on{" "}
                  {record.appliedAt
                    ? dateFormatter.format(record.appliedAt)
                    : "an earlier date"}
                  .
                </Notice>
                <Link
                  href={`/dashboard/restaurants/${restaurant.id}/menus/${menu.id}`}
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
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900">
            Extracted items
          </h2>
          {reviewCount > 0 ? (
            <p className="flex items-center gap-1 text-xs text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              {reviewCount} item{reviewCount === 1 ? "" : "s"} flagged for review
            </p>
          ) : null}
        </div>

        {items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-10 text-center text-sm text-zinc-500">
            No extracted items yet.
          </p>
        ) : (
          <div className="space-y-3">
            {reviewItems.map((item) => (
              <fieldset
                key={item.id}
                disabled={!canEdit || record.status === "applied"}
                className="min-w-0"
              >
                <ImportItemReviewForm
                  restaurantId={restaurant.id}
                  importId={importId}
                  item={item}
                />
              </fieldset>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
