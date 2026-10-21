import type { Metadata } from "next";
import { AlertTriangle, CheckCheck, ScanLine } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getDb } from "@/db/client";
import {
  acceptAllImportItemsAction,
} from "@/app/dashboard/restaurants/[id]/imports/actions";
import { ApplyImportForm } from "@/components/imports/apply-import-form";
import { ProcessImportForm } from "@/components/imports/process-import-form";
import {
  ImportItemReviewForm,
  type ReviewItem,
} from "@/components/imports/review-item-form";
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

const statusStyles: Record<string, string> = {
  uploaded: "bg-zinc-100 text-zinc-700 ring-zinc-500/20",
  processing: "bg-sky-50 text-sky-700 ring-sky-600/20",
  needs_review: "bg-amber-50 text-amber-800 ring-amber-600/20",
  reviewed: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  applied: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  failed: "bg-red-50 text-red-700 ring-red-600/20",
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

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/dashboard/restaurants/${restaurant.id}/imports`}
          className="text-sm font-medium text-zinc-500 hover:text-zinc-800"
        >
          ← Menu scans
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Scan review
          </h1>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${
              statusStyles[record.status] ?? statusStyles.uploaded
            }`}
          >
            {record.status.replaceAll("_", " ")}
          </span>
        </div>
        <p className="mt-1 text-sm text-zinc-600">
          Target draft:{" "}
          <Link
            href={`/dashboard/restaurants/${restaurant.id}/menus/${menu.id}`}
            className="font-medium text-amber-800 hover:underline"
          >
            {menu.title} v{menu.version}
          </Link>{" "}
          · Uploaded {dateFormatter.format(record.createdAt)}
        </p>
      </div>

      {notice === "accepted" ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Confident, priced items were accepted. Review the remaining items
          before applying.
        </p>
      ) : null}
      {error === "accept" ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Items could not be accepted. Please try again.
        </p>
      ) : null}

      {record.status === "failed" && record.errorDetails?.message ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {String(record.errorDetails.message)}
        </p>
      ) : null}

      {!extractionConfigured && record.status !== "applied" ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Menu extraction is not configured. Add an extraction provider and API
          key to process this scan, or continue with manual menu entry.
        </p>
      ) : null}

      {!canEdit ? (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
          You have read-only access to this scan review.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="rounded-2xl border border-zinc-200 bg-white p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <ScanLine className="h-4 w-4 text-zinc-400" aria-hidden="true" />
            Uploaded pages
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Private previews are served through authorized, short-lived signed
            links.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {pages.map((page) => (
              <a
                key={page.id}
                href={`/dashboard/restaurants/${restaurant.id}/imports/${importId}/pages/${page.id}`}
                target="_blank"
                rel="noreferrer"
                className="group block overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100"
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
        </section>

        <section className="h-fit space-y-4 rounded-2xl border border-zinc-200 bg-white p-5">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">Review status</h2>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-600">
              <div>
                <dt className="text-zinc-400">Extracted</dt>
                <dd className="font-medium text-zinc-900">{items.length}</dd>
              </div>
              <div>
                <dt className="text-zinc-400">Needs review</dt>
                <dd className="font-medium text-zinc-900">{reviewCount}</dd>
              </div>
              <div>
                <dt className="text-zinc-400">Pending</dt>
                <dd className="font-medium text-zinc-900">{pendingCount}</dd>
              </div>
              <div>
                <dt className="text-zinc-400">Accepted</dt>
                <dd className="font-medium text-zinc-900">{acceptCount}</dd>
              </div>
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
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              No menu items were extracted. Check image clarity and provider
              settings, or add items manually to the draft.
            </p>
          ) : null}

          {record.status === "needs_review" && canEdit ? (
            <div className="border-t border-zinc-100 pt-4">
              <form action={acceptAllImportItemsAction} className="space-y-2">
                <input
                  type="hidden"
                  name="restaurantId"
                  value={restaurant.id}
                />
                <input type="hidden" name="importId" value={importId} />
                <button
                  type="submit"
                  disabled={pendingCount === 0}
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Accept all confident, priced items
                </button>
              </form>
              <p className="mt-2 text-[11px] text-zinc-500">
                Duplicates and unpriced items stay pending.
              </p>
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
              <p className="text-xs text-emerald-800">
                Applied to the draft on{" "}
                {record.appliedAt
                  ? dateFormatter.format(record.appliedAt)
                  : "an earlier date"}
                .
              </p>
              <Link
                href={`/dashboard/restaurants/${restaurant.id}/menus/${menu.id}`}
                className="mt-2 inline-block rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800"
              >
                Open draft menu
              </Link>
            </div>
          ) : null}
        </section>
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
