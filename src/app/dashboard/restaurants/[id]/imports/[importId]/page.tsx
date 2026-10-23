import type { Metadata } from "next";
import { AlertTriangle, ScanLine } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getDb } from "@/db/client";
import {
  keepOnlyCategoryAction,
  updateCategoryDecisionAction,
} from "@/app/dashboard/restaurants/[id]/imports/actions";
import { ConfirmButton } from "@/components/dashboard/confirm-button";
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

type CategorySummary = {
  name: string;
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
};

function normalizeCategory(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function categoryLabel(value: string): string {
  return value.trim() || "Uncategorized";
}

function queryString(
  value: string | string[] | undefined,
): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function queryNumber(
  value: string | string[] | undefined,
): number | undefined {
  const raw = queryString(value);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function itemCountLabel(count: number): string {
  return `${count} item${count === 1 ? "" : "s"}`;
}

export default async function MenuImportReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; importId: string }>;
  searchParams: Promise<{
    notice?: string | string[];
    error?: string | string[];
    category?: string | string[];
    accepted?: string | string[];
    rejected?: string | string[];
    pending?: string | string[];
    pendingInCategory?: string | string[];
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
  const notice = queryString(query.notice);
  const error = queryString(query.error);
  const selectedCategoryParam = queryString(query.category);
  const noticeAccepted = queryNumber(query.accepted);
  const noticeRejected = queryNumber(query.rejected);
  const noticePending = queryNumber(query.pending);
  const noticePendingInCategory = queryNumber(query.pendingInCategory);
  const canProcess =
    canEdit &&
    extractionConfigured &&
    (record.status === "uploaded" || record.status === "failed");
  const acceptCount = items.filter((item) => item.decision === "accept").length;
  const pendingCount = items.filter((item) => item.decision === "pending").length;
  const rejectedCount = items.filter(
    (item) => item.decision === "reject",
  ).length;
  const reviewCount = items.filter(
    (item) => item.decision === "pending" && item.needsReview,
  ).length;

  const categoryMap = new Map<string, CategorySummary>();
  for (const item of items) {
    const label = categoryLabel(item.categoryName);
    const key = normalizeCategory(label);
    const summary = categoryMap.get(key) ?? {
      name: label,
      total: 0,
      pending: 0,
      accepted: 0,
      rejected: 0,
    };
    summary.total += 1;
    if (item.decision === "pending") summary.pending += 1;
    else if (item.decision === "accept") summary.accepted += 1;
    else summary.rejected += 1;
    categoryMap.set(key, summary);
  }
  const categorySummaries = [...categoryMap.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const activeCategory = selectedCategoryParam
    ? (categorySummaries.find(
        (category) =>
          normalizeCategory(category.name) ===
          normalizeCategory(selectedCategoryParam),
      ) ?? null)
    : null;
  const selectedCategoryMissing =
    Boolean(selectedCategoryParam) && activeCategory === null;

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
  const itemsByCategory = new Map<string, ReviewItem[]>();
  for (const item of reviewItems) {
    const key = normalizeCategory(categoryLabel(item.categoryName));
    const group = itemsByCategory.get(key) ?? [];
    group.push(item);
    itemsByCategory.set(key, group);
  }
  for (const group of itemsByCategory.values()) {
    group.sort(
      (left, right) => Number(right.needsReview) - Number(left.needsReview),
    );
  }
  const visibleGroups = (activeCategory ? [activeCategory] : categorySummaries)
    .map((category) => ({
      ...category,
      items:
        itemsByCategory.get(normalizeCategory(category.name)) ?? [],
    }))
    .filter((category) => category.items.length > 0);
  const visibleCount = visibleGroups.reduce(
    (total, category) => total + category.items.length,
    0,
  );
  const visibleReviewCount = visibleGroups.reduce(
    (total, category) =>
      total +
      category.items.filter(
        (item) => item.decision === "pending" && item.needsReview,
      ).length,
    0,
  );
  const pendingOutsideCategory = Math.max(
    0,
    pendingCount - (activeCategory?.pending ?? 0),
  );
  const categoryHref = (categoryName?: string): string => {
    const search = new URLSearchParams();
    if (categoryName) search.set("category", categoryName);
    const suffix = search.toString();
    return `/dashboard/restaurants/${restaurant.id}/imports/${importId}${suffix ? `?${suffix}` : ""}`;
  };
  const noticeCategoryName =
    selectedCategoryParam ?? activeCategory?.name ?? "the selected category";

  const stats = [
    { label: "Extracted", value: items.length },
    { label: "Needs review", value: reviewCount, highlight: reviewCount > 0 },
    { label: "Pending", value: pendingCount },
    { label: "Accepted", value: acceptCount },
    { label: "Rejected", value: rejectedCount, highlight: rejectedCount > 0 },
  ];
  const keepOnlyMessage = activeCategory
    ? `Keep only “${activeCategory.name}”? This accepts eligible pending items in this category and moves eligible pending items outside it to rejected. ${itemCountLabel(activeCategory.pending)} are pending in this category and ${itemCountLabel(pendingOutsideCategory)} outside it. Flagged, low-confidence, unpriced, and duplicate items outside this category stay pending for manual review.`
    : "";

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
      {notice === "category-accepted" ? (
        <Notice tone="success">
          {`Accepted ${noticeAccepted ?? 0} pending ${
            noticeAccepted === 1 ? "item" : "items"
          } in “${noticeCategoryName}”. ${
            noticePendingInCategory
              ? `${itemCountLabel(noticePendingInCategory)} in this category still need review.`
              : "No items remain pending in this category."
          }`}
        </Notice>
      ) : null}
      {notice === "category-rejected" ? (
        <Notice tone="success">
          {`Rejected ${noticeRejected ?? 0} pending ${
            noticeRejected === 1 ? "item" : "items"
          } in “${noticeCategoryName}”. ${itemCountLabel(
            noticePending ?? 0,
          )} remain pending across this scan.`}
        </Notice>
      ) : null}
      {notice === "keep-only" ? (
        <Notice tone="success">
          {`Kept only “${noticeCategoryName}”. Accepted ${
            noticeAccepted ?? 0
          } ${noticeAccepted === 1 ? "item" : "items"} and moved ${
            noticeRejected ?? 0
          } to rejected. ${itemCountLabel(
            noticePending ?? 0,
          )} remain pending for manual review.`}
        </Notice>
      ) : null}
      {error === "accept" ? (
        <Notice tone="error">
          Items could not be accepted. Please try again.
        </Notice>
      ) : null}
      {error === "category" ? (
        <Notice tone="error">
          The category action could not be completed. No item decisions were
          changed.
        </Notice>
      ) : null}
      {selectedCategoryMissing ? (
        <Notice tone="warning">
          That category is no longer present in this scan. Showing all
          categories instead.
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

            {record.status === "needs_review" && canEdit && !activeCategory ? (
              <div className="border-t border-zinc-100 pt-4">
                <AcceptAllForm
                  restaurantId={restaurant.id}
                  importId={importId}
                  pendingCount={pendingCount}
                />
              </div>
            ) : null}

            {record.status === "needs_review" && canEdit && activeCategory ? (
              <Notice tone="info">
                Use the category controls above to accept, reject, or keep only
                “{activeCategory.name}”.
              </Notice>
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

      <section
        aria-labelledby="scan-categories"
        className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2
              id="scan-categories"
              className="text-sm font-semibold text-zinc-900"
            >
              Categories in this scan
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-zinc-500">
              Every section heading is extracted first. The menu title names the
              overall container, such as “Beverages”, while headings detected in
              the scan become categories such as “Coffee”, “Non-coffee”, and
              “Espresso Specials”. Choose a category to review only that section.
            </p>
          </div>
          <p className="text-xs text-zinc-500">
            {itemCountLabel(items.length)} ·{" "}
            {categorySummaries.length}{" "}
            {categorySummaries.length === 1 ? "category" : "categories"}
          </p>
        </div>

        <nav
          aria-label="Filter scan by category"
          className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
        >
          <Link
            href={categoryHref()}
            aria-current={!activeCategory ? "page" : undefined}
            className={
              !activeCategory
                ? "rounded-xl border border-amber-400 bg-amber-50/70 p-3 shadow-sm ring-1 ring-amber-200 transition"
                : "rounded-xl border border-zinc-200 bg-white p-3 transition hover:border-amber-300 hover:bg-amber-50/40"
            }
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-semibold text-zinc-900">
                All categories
              </span>
              <span className="shrink-0 text-[11px] text-zinc-500">
                {itemCountLabel(items.length)}
              </span>
            </span>
            <span className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone="warning">{pendingCount} pending</Badge>
              <Badge tone="success">{acceptCount} accepted</Badge>
              <Badge tone="neutral">{rejectedCount} rejected</Badge>
            </span>
          </Link>

          {categorySummaries.map((category) => {
            const selected =
              activeCategory !== null &&
              normalizeCategory(activeCategory.name) ===
                normalizeCategory(category.name);
            return (
              <Link
                key={category.name}
                href={categoryHref(category.name)}
                aria-current={selected ? "page" : undefined}
                className={
                  selected
                    ? "rounded-xl border border-amber-400 bg-amber-50/70 p-3 shadow-sm ring-1 ring-amber-200 transition"
                    : "rounded-xl border border-zinc-200 bg-white p-3 transition hover:border-amber-300 hover:bg-amber-50/40"
                }
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-zinc-900">
                    {category.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-zinc-500">
                    {itemCountLabel(category.total)}
                  </span>
                </span>
                <span className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone="warning">{category.pending} pending</Badge>
                  <Badge tone="success">{category.accepted} accepted</Badge>
                  <Badge tone="neutral">{category.rejected} rejected</Badge>
                </span>
              </Link>
            );
          })}
        </nav>

        {activeCategory ? (
          <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3.5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900">
                  Working on “{activeCategory.name}”
                </p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  {itemCountLabel(activeCategory.pending)} pending in this
                  category; {itemCountLabel(pendingOutsideCategory)} pending
                  outside it.
                </p>
              </div>

              {canEdit && record.status !== "applied" ? (
                <div className="flex flex-wrap gap-2">
                  <form action={updateCategoryDecisionAction}>
                    <input
                      type="hidden"
                      name="restaurantId"
                      value={restaurant.id}
                    />
                    <input type="hidden" name="importId" value={importId} />
                    <input
                      type="hidden"
                      name="categoryName"
                      value={activeCategory.name}
                    />
                    <input type="hidden" name="decision" value="accept" />
                    <button
                      type="submit"
                      disabled={activeCategory.pending === 0}
                      className={buttonClass({
                        variant: "outline",
                        size: "sm",
                        className:
                          "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
                      })}
                    >
                      Accept pending in {activeCategory.name}
                    </button>
                  </form>

                  <form action={updateCategoryDecisionAction}>
                    <input
                      type="hidden"
                      name="restaurantId"
                      value={restaurant.id}
                    />
                    <input type="hidden" name="importId" value={importId} />
                    <input
                      type="hidden"
                      name="categoryName"
                      value={activeCategory.name}
                    />
                    <input type="hidden" name="decision" value="reject" />
                    <button
                      type="submit"
                      disabled={activeCategory.pending === 0}
                      className={buttonClass({
                        variant: "danger",
                        size: "sm",
                      })}
                    >
                      Reject pending in {activeCategory.name}
                    </button>
                  </form>

                  <form action={keepOnlyCategoryAction}>
                    <input
                      type="hidden"
                      name="restaurantId"
                      value={restaurant.id}
                    />
                    <input type="hidden" name="importId" value={importId} />
                    <input
                      type="hidden"
                      name="categoryName"
                      value={activeCategory.name}
                    />
                    <ConfirmButton
                      message={keepOnlyMessage}
                      className={buttonClass({
                        variant: "secondary",
                        size: "sm",
                      })}
                    >
                      Keep only “{activeCategory.name}”
                    </ConfirmButton>
                  </form>
                </div>
              ) : null}
            </div>

            <p className="mt-3 text-[11px] leading-5 text-zinc-500">
              {`Accept uses the same rules as Accept all: only pending, priced, confident, non-duplicate items are accepted. Keep only accepts eligible pending items in “${activeCategory.name}” and moves eligible pending items outside it to rejected. Flagged, low-confidence, unpriced, and duplicate items outside this category stay pending for manual review.`}
            </p>
          </div>
        ) : (
          <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/60 px-3.5 py-3 text-xs leading-5 text-zinc-500">
            Choose a category to accept, reject, or keep only that section. To
            accept every confident, priced item across the whole scan, use the
            sidebar.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900">
            Extracted items
          </h2>
          <p className="text-xs text-zinc-500">
            Showing {itemCountLabel(visibleCount)}
            {activeCategory ? ` in “${activeCategory.name}”` : " across all categories"}
          </p>
          {visibleReviewCount > 0 ? (
            <p className="flex items-center gap-1 text-xs text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              {visibleReviewCount} item{visibleReviewCount === 1 ? "" : "s"}{" "}
              flagged for review
            </p>
          ) : null}
        </div>

        {items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-10 text-center text-sm text-zinc-500">
            No extracted items yet.
          </p>
        ) : visibleGroups.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-10 text-center text-sm text-zinc-500">
            No items match this category.
          </p>
        ) : (
          <div className="space-y-5">
            {visibleGroups.map((category, index) => (
              <section
                key={category.name}
                aria-labelledby={`category-group-${index}`}
                className="space-y-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3
                    id={`category-group-${index}`}
                    className="text-sm font-semibold text-zinc-900"
                  >
                    {category.name}
                  </h3>
                  <p className="text-xs text-zinc-500">
                    {itemCountLabel(category.total)} · {category.pending}{" "}
                    pending · {category.accepted} accepted ·{" "}
                    {category.rejected} rejected
                  </p>
                </div>

                <div className="space-y-3">
                  {category.items.map((item) => (
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
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
